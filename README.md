# Pin Art Studio

Design printable pin art in your browser with React, TypeScript and Three.js, then export it with a Python geometry service.

- Generate pins inside rectangular, rounded, circular, elliptical or image-derived bases.
- Map an image to pin heights, preset filament colors, or both; adjust placement and use Smooth or Pixel sampling.
- Select individual or multiple pins to edit extension, material, shape and rotation, with undo/redo.
- Preview Fixed sculpture or real Print-in-place geometry and download STL or colored 3MF for Bambu X1C or Snapmaker U1.

Images are processed locally in the browser. Exports send resolved geometry, heights and materials to the backend, not the original image.

## Quick start

Requirements:

- Node.js **22.12 or newer** and **pnpm 11.19.0** (pinned in `package.json`).
- **uv** (verified with 0.12.1). The API pins Python **3.14.6**; uv downloads it if needed. The backend supports Python 3.12 or newer.
- Native lib3mf wheels support macOS, including Apple Silicon, Linux x86-64 and Windows x86-64. Linux ARM requires a separately built native library.

```sh
pnpm install --frozen-lockfile
uv sync --project apps/api --locked
pnpm dev
```

Open [the app](http://127.0.0.1:4173/). The frontend proxies `/api` to the localhost-only Python service at `http://127.0.0.1:8000`; [interactive API documentation](http://127.0.0.1:8000/docs) is available there. Both servers reload on source changes. Stop them with Ctrl+C.

To run them in separate terminals, use `pnpm dev:web` and `pnpm dev:api`.

## Using the app

1. Choose a base shape, dimensions, construction mode, pin size, spacing and edge padding.
2. Optionally upload an image or choose **Try sample**. Use **Adjust image** to align and zoom it, then choose height/color mapping and its palette.
3. Click a pin to select it; Shift-click toggles more pins. Drag to orbit, Shift-drag to box-select, scroll to zoom and right-drag to pan.
4. Use the floating editor to change selected pins. **Top view** is orthographic; **Fit model** reframes the current projection.
5. Select the target printer and download STL or 3MF. STL does not preserve colors. Open 3MF as a project in the appropriate slicer and verify profiles and material assignments.

The design is session-local; there is no project save/load yet. Appearance preference is saved independently of the design.

### Print-in-place is experimental

Extension means the initial distance from the base top to the pin top, including the upper retaining head—not total pin length or travel. A short straight guide can allow pins to tilt; the UI reports that risk without blocking export. Clearances are starting values, not a guarantee of release, smooth motion or retention. Keep supports, brims and purge structures out of mechanical gaps, and verify with a small physical sample before a full print.

The app supports at most **5,000 pins** and **16 logical materials**, including the base; the selected printer may impose a lower material limit. Dense native exports can require several GiB of memory. See the [user guide](docs/guide.md) for dimensions, limits, construction rules and export details.

## Development

The monorepo uses pnpm workspaces and Turborepo for JavaScript tasks, and uv for Python dependencies and the interpreter.

```text
apps/web/       React/TypeScript UI, Three.js preview and browser workers
apps/api/       FastAPI, solid geometry, STL/3MF writers and Python tests
fixtures/       Shared TypeScript/Python geometry and profile fixtures
docs/           Current product requirements and user documentation
```

Features own their implementation and colocated tests. The frontend export feature sends a resolved design snapshot to `POST /api/exports`; the API independently validates it and generates files in an isolated child process. Keep the same-origin `/api` contract when serving a built frontend.

```sh
pnpm test
pnpm typecheck
pnpm build
```

Focused commands: `pnpm test:web`, `pnpm test:api`, and `pnpm --filter @pin-art/web test:watch`. The build includes TypeScript checking and writes `apps/web/dist/`. It does not start an API server. The frontend-only `pnpm --filter @pin-art/web preview` command does not provide an API proxy; use `pnpm dev` for local exports.

Commit both `pnpm-lock.yaml` and `apps/api/uv.lock`. Backend commands use `uv run --locked`; after changing Python dependencies, update with `uv lock --project apps/api` and sync again. Use `pnpm install` after changing JavaScript dependencies. Native backend tests run uncached; browser/print behavior still needs manual verification alongside automated tests.

## Documentation

- [User guide](docs/guide.md): dimensions, mapping, editing, print-in-place and export contract.
- [Product requirements](docs/PRD.md): current capabilities, defaults and boundaries.
- [Third-party notices](THIRD_PARTY_NOTICES.md): dependency and reference-data provenance.

## License

Project-authored code and documentation are available under the [MIT License](LICENSE). Third-party dependencies, reference data and trademarks are not relicensed by it; see [third-party notices](THIRD_PARTY_NOTICES.md). Pin Art Studio is not affiliated with or endorsed by Bambu Lab, Snapmaker or the referenced data providers.

The offline PLA Basic/Matte catalog is selected from the independently maintained, MIT-licensed [bambu-filaments dataset](https://github.com/piitaya/bambu-filaments/tree/73cf0567028942e2ea9962371fc033511aac2ed7). Its [upstream license](apps/web/public/licenses/bambu-filaments-MIT.txt) is included in the source and web build.
