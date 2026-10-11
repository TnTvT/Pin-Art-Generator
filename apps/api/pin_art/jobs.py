import asyncio
from dataclasses import dataclass
from pathlib import Path


@dataclass
class WorkerResult:
    returncode: int | None
    diagnostics: str
    disconnected: bool = False
    memory_limited: bool = False


def resident_bytes(pid):
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        pass
    return 0


async def wait_for_memory_limit(pid, limit):
    while True:
        if resident_bytes(pid) > limit:
            return
        await asyncio.sleep(0.05)


async def read_diagnostics(stream):
    tail = bytearray()
    while chunk := await stream.read(4096):
        tail.extend(chunk)
        del tail[:-4096]
    return tail.decode("utf-8", errors="replace")


async def wait_for_disconnect(request):
    while True:
        message = await request.receive()
        if message["type"] == "http.disconnect":
            return


async def finish_cleanup(operation):
    task = asyncio.create_task(operation)
    interrupted = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            interrupted = True
    task.result()
    if interrupted:
        raise asyncio.CancelledError


async def run_worker(command, cwd, request=None, env=None, max_rss_bytes=None):
    spawn = asyncio.create_task(asyncio.create_subprocess_exec(
        *command, cwd=cwd, env=env,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    ))
    process = None
    diagnostics = None
    waiting = None
    disconnected = None
    memory_limited = None

    async def cleanup():
        nonlocal process, diagnostics
        if process is None:
            try:
                process = await spawn
            except OSError:
                return
        if diagnostics is None:
            diagnostics = asyncio.create_task(read_diagnostics(process.stderr))
        if process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(process.wait(), 3)
            except TimeoutError:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()
        pending = [task for task in (waiting, disconnected, memory_limited) if task is not None]
        for task in pending:
            if not task.done():
                task.cancel()
        await asyncio.gather(*pending, diagnostics, return_exceptions=True)

    try:
        process = await asyncio.shield(spawn)
        diagnostics = asyncio.create_task(read_diagnostics(process.stderr))
        waiting = asyncio.create_task(process.wait())
        tasks = {waiting}
        if request is not None:
            disconnected = asyncio.create_task(wait_for_disconnect(request))
            tasks.add(disconnected)
        if max_rss_bytes is not None:
            memory_limited = asyncio.create_task(wait_for_memory_limit(process.pid, max_rss_bytes))
            tasks.add(memory_limited)
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if disconnected in done:
            disconnected.result()
            return WorkerResult(process.returncode, "", disconnected=True)
        if memory_limited in done:
            memory_limited.result()
            return WorkerResult(process.returncode, "", memory_limited=True)
        return WorkerResult(waiting.result(), await diagnostics)
    finally:
        await finish_cleanup(cleanup())
