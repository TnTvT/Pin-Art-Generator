import asyncio
import sys

import pytest

from pin_art.jobs import read_diagnostics, run_worker


def test_diagnostics_are_drained_but_only_keep_a_bounded_tail():
    async def check():
        stream = asyncio.StreamReader()
        stream.feed_data(b"a" * 100000 + b"failure marker")
        stream.feed_eof()
        result = await read_diagnostics(stream)
        assert result.endswith("failure marker")
        assert len(result.encode()) <= 4096

    asyncio.run(check())


def test_cancel_during_spawn_reaps_the_child(monkeypatch, tmp_path):
    import pin_art.jobs as jobs

    original_spawn = asyncio.create_subprocess_exec
    children = []

    async def check():
        child_started = asyncio.Event()
        release_spawn = asyncio.Event()

        async def delayed_spawn(*args, **kwargs):
            process = await original_spawn(*args, **kwargs)
            children.append(process)
            child_started.set()
            await release_spawn.wait()
            return process

        monkeypatch.setattr(jobs.asyncio, "create_subprocess_exec", delayed_spawn)
        task = asyncio.create_task(run_worker([sys.executable, "-c", "import time; time.sleep(60)"], tmp_path))
        await asyncio.wait_for(child_started.wait(), 5)
        task.cancel()
        release_spawn.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert children[0].returncode is not None

    asyncio.run(check())


def test_disconnected_client_stops_the_worker(tmp_path):
    class DisconnectedRequest:
        async def receive(self):
            return {"type": "http.disconnect"}

    async def check():
        result = await run_worker([sys.executable, "-c", "import time; time.sleep(60)"], tmp_path, request=DisconnectedRequest())
        assert result.disconnected

    asyncio.run(check())


def test_memory_pressure_stops_and_reaps_the_worker(tmp_path, monkeypatch):
    import pin_art.jobs as jobs

    monkeypatch.setattr(jobs, "resident_bytes", lambda pid: 1000, raising=False)

    async def check():
        result = await run_worker([sys.executable, "-c", "import time; time.sleep(60)"], tmp_path, max_rss_bytes=100)
        assert result.memory_limited

    asyncio.run(check())


def test_worker_timeout_reaps_a_started_child(tmp_path, monkeypatch):
    import pin_art.jobs as jobs

    original_spawn = asyncio.create_subprocess_exec
    children = []

    async def spawn(*args, **kwargs):
        process = await original_spawn(*args, **kwargs)
        children.append(process)
        return process

    monkeypatch.setattr(jobs.asyncio, "create_subprocess_exec", spawn)

    async def check():
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.05):
                await run_worker([sys.executable, "-c", "import time; time.sleep(60)"], tmp_path)
        assert children[0].returncode is not None

    asyncio.run(check())


def test_linux_rss_is_read_in_bytes_and_missing_processes_are_safe(monkeypatch):
    import pin_art.jobs as jobs

    monkeypatch.setattr(jobs.Path, "read_text", lambda path: "Name:\tpython\nVmRSS:\t1234 kB\n")
    assert jobs.resident_bytes(123) == 1234 * 1024

    def missing(path):
        raise FileNotFoundError

    monkeypatch.setattr(jobs.Path, "read_text", missing)
    assert jobs.resident_bytes(123) == 0
