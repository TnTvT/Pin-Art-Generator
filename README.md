# Pin Art Studio

A React, TypeScript, Mantine, and Three.js demo with a Python export service for designing printable pin art. All dimensions are in millimeters. The monorepo uses pnpm and Turborepo for task orchestration, with uv managing Python independently.

## Documentation

- [Product requirements](docs/PRD.md)
- [Architecture and product decisions](docs/README.md)

The root-level `docs/` folder records agreed behavior, defaults, technical rationale, and deferred work. Update the PRD when requirements change and add or supersede decision records for significant design changes.

## Run

```sh
pnpm install --frozen-lockfile
uv sync --project apps/api --locked
pnpm dev
```

Install Node.js **22.12 or newer**, **pnpm 11.19.0**, and **uv** (verified with 0.12.1). The root `packageManager` field pins pnpm. Python **3.14.6** is pinned in `apps/api/.python-version`; uv downloads that interpreter if it is not installed. The backend package supports Python 3.12 or newer. Native lib3mf wheels support macOS (including Apple Silicon), Linux x86-64, and Windows x86-64; Linux ARM needs a separately built native library.

Commit both `pnpm-lock.yaml` and `apps/api/uv.lock`. Backend scripts use `uv run --locked`, which refuses an outdated lockfile rather than silently changing dependencies. Development/test dependencies are in the default uv `dev` group. After changing Python dependencies, run `uv lock --project apps/api` and sync again; after changing JavaScript dependencies, run `pnpm install`.

Alternatively, start the frontend and backend in separate terminals:

```sh
pnpm dev:web
pnpm dev:api
```

Open http://127.0.0.1:4173. The backend listens only on http://127.0.0.1:8000; Vite proxies `/api` there. API documentation is at http://127.0.0.1:8000/docs. Both servers reload on source changes; stop them together with Ctrl+C. Change the parameters to update the model immediately. Drag to rotate, scroll to zoom, and right-drag to pan. Focus the canvas and use arrow keys to pan with the keyboard.

## Build

```sh
pnpm build
pnpm typecheck
```

The build includes TypeScript checking and writes `apps/web/dist/`. Only the frontend has build/typecheck tasks; the Python service runs directly and does not have a fabricated JavaScript build. Turbo caches frontend build, typecheck, and test tasks. Native backend tests always run uncached because their results depend on the local Python/native runtime. Development tasks are persistent and uncached.

## Appearance

Use **Dark mode** or **Light mode** in the header to switch the workspace and preview surroundings. Printable base/pin colors are independent of the theme. Light is the default and your appearance choice is saved locally. Switching themes preserves the design, image mapping, colors, and camera; reloading still resets the design.

## Project structure

```text
apps/
├── web/                         # @pin-art/web
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app/                 # Composition, theme, styling
│   │   ├── features/
│   │   │   ├── pin-design/
│   │   │   ├── image-mapping/
│   │   │   ├── preview/
│   │   │   └── export/
│   │   └── test/                # Shared test setup/render wrapper
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── vitest.config.ts
└── api/                         # @pin-art/api
    ├── pin_art/                 # API, geometry, layout, writers, tests
    ├── pyproject.toml
    ├── uv.lock
    ├── .python-version
    └── package.json             # Turbo adapter calling uv, no JS dependencies
docs/
├── PRD.md
└── decisions/
package.json                    # Root commands and Turbo dependency
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
```

The app composes the feature modules. Pin design owns geometry parameters and layout validation; image mapping owns decoding, sampling, and upload controls; preview owns Three.js rendering and its React integration. Tests live beside the code they verify. Shared test setup and the Mantine render wrapper live in `apps/web/src/test/`.

`apps/web/src/features/export/` owns export controls, request snapshots, validation, and the download client. `apps/api/pin_art/` owns API validation, process isolation, geometry, plate layout, STL/3MF generation, and colocated Python tests. pnpm manages JavaScript packages; uv manages the API's Python environment. The API's private `package.json` only exposes commands to Turbo. Shared packages and a Python workspace will be added only when there is an actual second consumer.

## Tests

```sh
pnpm test
pnpm test:web
pnpm test:api
pnpm --filter @pin-art/web test:watch
```

Vitest and React Testing Library cover grid dimensions and warnings, image aspect fitting and grayscale mapping, file selection, image decode failures and upload races, bitmap/URL cleanup, input validation, slider keyboard interaction, workspace updates, and preview lifecycle and view buttons.

Sampling math and Three.js instance transforms run without a browser GPU. Canvas decoding and WebGL initialization are mocked only at their browser boundaries in integration tests; actual image rendering, WebGL output, and responsive styling still need a browser smoke check.

## Geometry

- Columns run along X, rows along Y, and pins extend along Z.
- Spacing is the distance between pin centers in both directions.
- Extension starts at the top of the base plate.
- The grid remains centered and supports up to 100 columns × 100 rows.
- Empty or invalid inputs retain the last valid model. Out-of-bounds and overlapping arrays remain visible with warnings.

The top-right XYZ orientation helper follows the camera as you orbit: red X, green Y, and blue Z (world up). It is an indicator, not a camera control, and stays fixed in size during pan and zoom. Top view shows X to the right, Y upward, and Z toward the viewer.

## Image mapping

Upload a PNG, JPG, or WebP (up to 20 MB), or select **Try sample**. Images are decoded and processed locally; nothing is uploaded to a server. Large images are reduced to a maximum 1,024-pixel side for sampling.

The image is centered over the pin grid with its aspect ratio preserved. Transparent pixels and unused margins are white. RGB values are converted to weighted grayscale: dark pixels produce taller pins by default. **Invert mapping** reverses this relationship, including the white margins. Image top maps to positive Y so it reads upright in Top view.

**Min extension** sets the shortest configured height; **Max extension** in the Pin array panel sets the tallest. Actual mapped heights are displayed alongside the source preview. Reducing the maximum below the minimum also reduces the minimum. Invalid inputs keep the last valid mapping. Removing the image returns to uniform heights; resetting parameters keeps the image while restoring the default dimensions, range, and inversion.

## Model downloads

Choose **Base color** and **Pin color** in Export. These colors appear in the assembled preview and are retained in 3MF. Image processing stays in the browser; downloads send only the resolved heights, parameters, and material indices to the local backend.

- **Fixed:** STL is a watertight union of the solid base and all pins. 3MF is an assembled sculpture with separate material regions.
- **Detachable:** plate 1 contains only the centered socket base. Straight pins include insertion length and are printed upright on separate pin-only plates, starting with plate 2. Each group is centered; at most 36 total plates are generated.
- **3MF:** one Bambu-compatible project with standard colors, logical filament assignments, and plate ownership. Identical colors share one filament slot. The project selects **Bambu Lab X1 Carbon 0.4 nozzle** and references **0.20mm Standard @BBL X1C** through Bambu system-preset inheritance. The physical bed is 256 × 256 mm; the referenced profile's printable height is 250 mm. Material profiles and physical AMS assignments remain user choices; no third-party printer template or temperature overrides are copied.
- **Detachable STL:** ZIP with one STL per plate and `manifest.json` containing indexed pin names, heights, colors, placement transforms, and socket settings. STL itself cannot preserve colors or multiple plates.

Socket defaults are **2 mm insertion depth** and **0.2 mm diametral clearance** (`socket diameter = pin diameter + clearance`). Require a 1 mm floor and 0.8 mm socket walls/edge material. Test-print a fit sample: these defaults do not guarantee fit for every printer/material. This is not a sliding/captive-pin mechanism.

Detachable plate defaults are a 256 × 256 mm usable area, 5 mm edge margins, and 4 mm part separation. Smaller custom areas are centered within the X1C bed, not used as physical plate dimensions or multi-plate strides. 3MF blocks parts exceeding the X1C profile's bed/height or a usable area larger than its bed; STL remains printer-independent. Invalid sockets, overflowing grids, and overlapping fixed pins block both formats; invalid numeric drafts use the last valid design. Plates use a deterministic shelf layout, not an optimal packing solver. Preview shows the assembled design, not socket cutaways or print-plate layouts.

Open 3MF as a project in Bambu Studio, select suitable printer/material/process presets, and check colors, plate assignments, height limits, exclusion zones, brims, and purge structures before slicing. Files contain nominal colors, not calibrated physical color reproduction. Bambu GUI verification is left to the user; strict lib3mf read-back and automated geometry/package checks do not replace slicer or physical-print validation.

Requests are capped at 2 MB and 10,000 pins. One isolated export worker runs at a time, with a 120-second timeout; a busy or failed export can be retried. Temporary artifacts are deleted after delivery or failure. No images, design database, public deployment, or production job queue are introduced.

Measured locally on Apple Silicon with 64-segment pins: the 320-pin examples export in roughly a second; 10,000-pin fixed 3MF takes under a second, while socketed 3MF and unioned STL take roughly 40–60 seconds. Dense STL outputs can exceed 120 MB and require multiple GB of worker memory. These are measurements, not guaranteed performance limits; reduce the pin count if exports time out or memory is constrained. Fixed STL requires a positive gap between adjacent pins because exact point-tangent cylinders cannot form a strictly manifold union without changing the geometry.

`pnpm --filter @pin-art/web preview` serves the built frontend without an API proxy. To use exports locally, run `pnpm dev`; a deployed build needs a same-origin `/api` reverse proxy. The old root `npm` commands and manual `backend/.venv` setup have been replaced by the commands above.
