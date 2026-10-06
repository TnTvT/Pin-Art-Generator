# Pin Art Studio

A React, TypeScript, Mantine, and Three.js demo with a Python export service for designing printable pin art. All dimensions are in millimeters. The monorepo uses pnpm and Turborepo for task orchestration, with uv managing Python independently.

## Documentation

- [Product requirements](docs/PRD.md)
- [Architecture and product decisions](docs/README.md)
- [Archived export runtime evaluation](docs/spikes/002-export-runtime-comparison.md): measurements and the decision to retain the Python backend; experimental code has been removed.

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
│   │   ├── components/          # Shared accessible help UI, colocated tests
│   │   ├── features/
│   │   │   ├── base-shape/      # Contours, automatic layouts, workers, snapshots
│   │   │   ├── pin-design/
│   │   │   ├── image-mapping/
│   │   │   ├── pin-editing/      # Selection, overrides, transactions, editor UI
│   │   │   ├── preview/
│   │   │   ├── filaments/        # Bundled color catalog and selection UI
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
├── decisions/
└── spikes/                      # Archived evaluation reports and measurements
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

- Choose Rectangle, Rounded rectangle, Circle, Ellipse, or From image. Shared polygon regions are extruded without bevels in preview and export. Image bases follow outer silhouettes only; enclosed gaps become solid base, not cutouts.
- Pins use a center-origin square lattice with coordinates at integer multiples of spacing, filtered against the base. Rows/columns are automatic, not user controls.
- **Edge padding** (default 5 mm) measures from pin outer walls to the outer silhouette boundary. Spacing stays center-to-center; extension starts at the base top.
- Choose **Round**, **Square**, or equilateral **Triangle** for all pins. **Pin size** is the circumscribed diameter: round diameter, square diagonal (side = size / √2), or triangle circumdiameter (side = √3 × size / 2). Default size is 2 mm.
- Polygon **Pin rotation** accepts 0–360° counterclockwise in Top view. At 0°, square sides align with X/Y and a triangle vertex points toward +Y. Round ignores rotation but remembers it for switching back. Geometry/export treat 360° as 0°.
- Layout filtering, the 2D/3D previews, footprint and minimum-neighbor clearance use actual rotated shapes, not their enclosing circles. A lone pin displays no clearance. Shape changes preserve edits/history/selection when actual positions are unchanged; otherwise confirm the layout change.
- Defaults are 120 × 100 × 3 mm, spacing 5 mm, round size 2 mm, height 20 mm, rounded radius 10 mm. The default rectangle contains **357 pins**.
- Limit layouts to 10,000 actual pins, 1,000,000 candidates and 20,000 contour vertices. Empty/excessive layouts are errors, not truncated results. Overlapping pins remain visible but block exports.
- **From image** shares the Image mapping upload. Auto uses alpha if any pixel is below 128; otherwise detect background with Color.js ΔE2000 (white, tolerance 10; 0–50). No AI. Keep separate outer silhouettes, fill enclosed gaps, and merge islands inside an already-filled silhouette. Pins can occupy those filled areas; height/color mapping still uses the original pixels. Image width/depth stay linked to foreground bounds.
- A 2D applied contour preview shows actual pins and region count. Separate regions remain separate print pieces; padding does not create borders or bridges.
- Processing happens in cancellable workers. Publish shape, actual positions and generated heights/materials together; stale work cannot overwrite new settings. Errors retain the applied preview and block export until resolved or retried.

The top-right XYZ orientation helper follows the camera as you orbit: red X, green Y, and blue Z (world up). It is an indicator, not a camera control, and stays fixed in size during pan and zoom. Top view shows X to the right, Y upward, and Z toward the viewer.

## Image mapping

**Adjust image** opens a separate 2D window with the applied base outline and actual pin footprints. Drag the image to translate it in world X/Y mm; scroll to zoom around the cursor, or use the 10–400% slider, **Zoom**, and **Offset X / Offset Y** fields. Arrow keys move 1 mm (Shift: 5 mm); +/− zoom. Escape, pointer cancellation, or loss of focus cancels the active drag. **Center image** resets translation while keeping zoom. **Fit image** fits the source content to the pin footprint (foreground bounds on an image-derived base), within the zoom limits. **Reset** restores the original centered mapping. Changes apply live and closing keeps them.

Placement changes only height/color sampling, never the base contour or pin positions—even with **From image**. Heights and colors share the same aspect-preserving transform and original RGBA samples; uncovered areas are white. Manual overrides, selection and pin-edit history survive adjustment. Mapping updates retain their existing atomic publication, stale-worker cancellation and export blocking. Disable **Map image to pins** for contour-only use; adjustment is unavailable then. Successful image replacement/removal resets placement; failed uploads retain it. **Reset parameters** keeps the current image placement. Placement is session-local, is not a pin-edit undo transaction, and is not sent to the backend: downloads use the resolved heights/materials. See [ADR-021](docs/decisions/021-image-placement-and-shared-sampling.md).

Upload a PNG, JPG, or WebP (up to 20 MB), or select **Try sample**. Images are decoded and processed locally; nothing is uploaded to a server. Large images are reduced to a maximum 1,024-pixel side for sampling.

Preset bases contain the whole image inside base dimensions. Image bases reuse the foreground-bounds transform for actual-coordinate sampling. **Map image to pins** defaults on; switch off to use an image only as the base shape. Transparent pixels and unused mapping margins are white. Image top maps to positive Y so it reads upright in Top view. **Mapping mode** defaults to **Height** (weighted grayscale; dark pixels are taller). **Color** maps image colors to preset filaments with uniform generated heights. **Height + Color** does both using the same samples; heights always come from original-image brightness, not the matched filament colors. **Invert mapping** only reverses the height relationship, including white margins.

**Auto palette** chooses from PLA Basic, PLA Matte, or both (default), using perceptual ΔE2000 from Color.js. **Max pin materials** defaults to 4 and allows 1–16, excluding the base. Deterministic greedy selection followed by two bounded replacement passes avoids wasting a slot on intermediate colors. The palette may be smaller when the base and manual colors occupy the 16-material budget. **My filaments** only matches the presets you select; its initial selections are the default base and pin presets, and the selection is retained when switching sources. Same-RGB Basic and Matte remain different materials. Reference RGB is approximate, not a calibrated printing guarantee.

Palette rows show the original matched groups and pin counts; hover or focus for names/codes, families, HEX and RGB. Click a row to choose a replacement preset or custom color and **Apply to group**. Every pin in that original group is recolored, including existing manual colors, without changing heights or selection. Rows show the current replacement or **Mixed**; assigning two groups the same color does not merge their membership. Group edits are one undoable batch and use the same 16-material validation and export snapshot as individual edits. Manual/base edits and undo/redo do not rematch the image; changing image or generation settings, or Retry, regenerates groups while keeping manual pin overrides. **Final design** counts used RGB + profile pairs including the base. Colors update in a cancellable Web Worker, with processing time displayed in ms. Updating disables edit submissions and downloads, but not camera navigation or mapping settings. Stale jobs cannot overwrite newer results. Failed updates retain the last applied snapshot and block export; fix settings or retry. A changed layout never reuses old samples.

Local validation measured about 0.53 seconds for 10,000 distinct synthetic RGB samples and about 10 ms of worker computation for a 10,000-pin four-color image. These are workload-specific measurements, not latency or frame-rate guarantees; decoding, sampling and preview updates are additional work.

In height modes, one **Height range** control in Image mapping sets both bounds with a dual-thumb slider and linked **Min height / Max height** numeric inputs. The default range is 2–20 mm. The slider supports 0.1 mm adjustments; numeric inputs allow two decimal places and extend its track beyond 80 mm when needed. The slider prevents crossing; equal bounds produce uniform mapped heights. Incomplete, nonpositive, or reversed numeric drafts keep the last valid range and preview. Actual mapped heights are displayed alongside the source preview. Pin array shows **Generated pin height** only without height mapping, or in Color mode. Removing the image returns unedited pins to uniform heights and the default pin preset, subject to the material limit; resetting parameters keeps the image while restoring default dimensions, range, and inversion. Manual height/color overrides survive regeneration and mode changes.

## Edit pins

Generate in the sidebar, edit with the floating **Edit pins** toolbar over the preview's upper-left, then export from the sidebar. Height and Material open beside it without resizing the canvas or changing camera framing; panels can overlap the model. At tablet/mobile widths, tools float along the canvas bottom and editing fields open in a bottom sheet over generation. Click a pin to select it; Shift-click toggles additional pins. An ordinary drag rotates the camera, even when it starts on a pin; Shift-drag adds a selection box over projected pin tips, including hidden pins. Clicking empty space clears selection without Shift. Scroll zooms and right-drag pans. Both perspective and orthographic Top view support these gestures without switching modes. Yellow exterior outlines indicate selection without tinting pin surfaces, changing printable colors, or changing the scene's exposure.

The dock counts selected RGB colors; the compact preview status strip counts all design colors including the base. Hover or focus a **Design** color swatch to see hex, RGB, selected filament names/codes and families, and base/pin usage. Different filament profiles sharing RGB count as one displayed color; its tooltip lists all used identities while export retains distinct slots. Custom colors are labeled Generic PLA, not inferred catalog matches. Info icons open on-demand guidance; errors and export blockers remain visible. Default/reset materials are **PLA Basic Gray (10103)** for the base and **PLA Basic Turquoise (10605)** for pins, not Custom color.

Open **Height** in the toolbar. **Set height** assigns a uniform height; **Offset height** adds or subtracts mm while retaining height differences. Enter a value and press **Apply height** or Enter. Mixed selections display **Mixed**. Drag the active pin's ↑ handle along world Z in perspective, or vertically on screen in Top view; its tooltip shows the live height. A drag uses its starting heights and creates one undo record on release. Escape, pointer cancellation, loss of focus, or a view change restores the committed design. Downloads are disabled during a drag. Invalid batches are rejected together, never clamped.

Height inputs remember separate Set/Offset drafts, and the Material picker remembers your last chosen preset/custom color for the current session. Selecting another pin, clearing selection, reopening controls or undoing an edit does not erase these inputs or apply them automatically. The selection summary still shows actual current values, including **Mixed**. **Use selected height / Use selected material** reloads the selection instead of the cached input; these UI drafts are not persisted across reloads and do not enter undo history.

Open **Material**, choose **Selection filament / color**, then **Apply material** to paint one, several, or all selected pins. Close the custom color picker before applying. **Base filament / color** is independent and lives under **Base plate**. The toolbar's **⋯** menu offers **Select all**, **Restore generated heights**, **Restore generated colors**, and **Reset all edits**. Restore uses the latest image/uniform generator; reset all confirms before restoring generated pins and the default base while retaining the image and mapping settings. Undo/Redo (Ctrl/Cmd-Z, Shift-Z or Ctrl/Cmd-Y outside text fields) covers heights, materials and resets, retaining at most 50 transactions and 16 MiB of encoded sparse deltas. Regeneration does not add history; undo/redo validates material limits against the current generator and rejects invalid batches. On small screens, Undo/Redo move into the menu to keep the viewer unobstructed.

Stable pin IDs encode integer grid coordinates, and the selected pin displays its ID and X/Y. Changes preserve edits only if actual ID/XY positions are unchanged; otherwise confirm clearing pin edits, selection and history, retaining base material, image and mapping settings. Cancel restores applied settings and image. **Generated pin height** is not a ceiling on manual heights. 3MF validates the actual fixed/detachable printable height against the X1C profile; STL remains printer-independent. The resolved committed heights and per-pin material identities are shared by preview and export. Up to 16 used **RGB + filament profile** pairs are allowed, including the base; introducing a seventeenth is rejected. Projects remain in memory and reset on reload.

## Model downloads

Choose the base material under **Base plate** and selected-pin materials in the preview toolbar, then download from **Print export**. Search the bundled Bambu Lab PLA Basic/Matte catalog by color name, product code, family, or hex, or choose **Custom color** for swatches, the color picker, or hex entry. The selected colors appear in the assembled preview and are retained in 3MF alongside the selected material family. Image processing stays in the browser; downloads send only committed contour regions/holes, actual pin IDs/XY, resolved heights, parameters, colors, material-profile keys, and per-pin material indices to the local backend. Edits made after submitting a download do not alter that request snapshot.

The offline catalog in `apps/web/src/features/filaments/data/bambu-pla.ts` stores brand, material, type, color, product code, hex, RGB, and source record IDs. Its September 30, 2026 snapshot contains 32 [PLA Basic](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/basic) and 25 [PLA Matte](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/matte) entries from 3D Filament Profiles, including distinct records sharing an RGB value. These are reference colors, not calibrated printed-color measurements or an availability guarantee. Basic selections reference **Bambu PLA Basic @BBL X1C**; Matte selections reference **Bambu PLA Matte @BBL X1C**. Custom colors reference **Generic PLA**, which users must verify is suitable for their actual material. Choosing Custom color clears the previous family even when RGB stays unchanged. No network request is needed to browse the presets. Update the data, capture date, and catalog tests together when refreshing the snapshot.

Selected colors live in the project's filament palette, not in modified system-preset default colors. The export includes single-nozzle logical filament routing arrays checked against Bambu Studio 2.7.1 source. Open the 3MF as a **project**, not geometry only, to load its printer/material settings. Automated package checks do not certify Bambu GUI import or slicing; please verify both in your installed version.

- **Fixed:** STL is a watertight union of the solid base and all pins. 3MF is an assembled sculpture with separate material regions.
- **Detachable:** plate 1 contains only the centered socket base. Straight pins include insertion length and are printed upright on separate pin-only plates, starting with plate 2. Each group is centered; at most 36 total plates are generated.
- **3MF:** one Bambu-compatible project with standard colors, selected filament presets, logical filament assignments, and plate ownership. Only identical **color + material profile** pairs share a filament slot; Basic and Matte with matching RGB remain separate. The project selects **Bambu Lab X1 Carbon 0.4 nozzle** and references **0.20mm Standard @BBL X1C** through Bambu system-preset inheritance. The physical bed is 256 × 256 mm; the referenced profile's printable height is 250 mm. Filament temperatures/flow inherit from Bambu Studio's installed system profiles; no third-party printer template, hardcoded temperature overrides, or physical AMS assignments are copied. Verify profiles and assign real spools before slicing. Other slicers may ignore Bambu profile metadata.
- **Detachable STL:** ZIP with one STL per plate and `manifest.json` containing indexed pin names, heights, colors, placement transforms, and socket settings. STL itself cannot preserve colors or multiple plates.

Socket defaults are **2 mm insertion depth** and **0.2 mm Socket clearance**: offset each pin wall outward by clearance / 2. Round socket diameter is pin size + clearance; square/triangle sockets follow the actual rotated footprint with rounded offset corners, rather than scaling its circumscribed diameter. Require a 1 mm floor and 0.8 mm socket walls/edge material. Test-print a fit sample: these defaults do not guarantee fit for every printer/material. This is not a sliding/captive-pin mechanism.

Detachable plate defaults are a 256 × 256 mm usable area, 5 mm edge margins, and 4 mm part separation. Smaller custom areas are centered within the X1C bed, not used as physical plate dimensions or multi-plate strides. 3MF blocks parts exceeding the X1C profile's bed/height or a usable area larger than its bed; STL remains printer-independent. Invalid sockets, invalid contours/layouts, and overlapping fixed pins block both formats; invalid numeric drafts use the last valid design. Plates use a deterministic shelf layout, not an optimal packing solver. Preview shows the assembled design, not socket cutaways or print-plate layouts.

Open 3MF as a project in Bambu Studio, select suitable printer/material/process presets, and check colors, plate assignments, height limits, exclusion zones, brims, and purge structures before slicing. Files contain nominal colors, not calibrated physical color reproduction. Bambu GUI verification is left to the user; strict lib3mf read-back and automated geometry/package checks do not replace slicer or physical-print validation.

Requests are capped at 2 MB and 10,000 pins. One isolated export worker runs at a time, with a 120-second timeout; a busy or failed export can be retried. Temporary artifacts are deleted after delivery or failure. No images, design database, public deployment, or production job queue are introduced.

Measured locally on Apple Silicon with 64-segment pins: the 320-pin examples export in roughly a second; 10,000-pin fixed 3MF takes under a second, while socketed 3MF and unioned STL take roughly 40–60 seconds. Dense STL outputs can exceed 120 MB and require multiple GB of worker memory. These are measurements, not guaranteed performance limits; reduce the pin count if exports time out or memory is constrained. Fixed STL requires a positive gap between adjacent pins because exact point-tangent cylinders cannot form a strictly manifold union without changing the geometry.

The October 4 base-shape benchmark used 10,000 pins across two disconnected regions: native validation took 0.21 s, fixed 3MF generation 1.19 s, peak process RSS about 146 MiB, and the package about 337 KB. Browser shape/layout generation measured 113 ms and combined image height/color generation 66 ms. See the [PRD verification notes](docs/PRD.md#base-shape-verification--october-4-2026) for scope and limitations.

`pnpm --filter @pin-art/web preview` serves the built frontend without an API proxy. To use exports locally, run `pnpm dev`; a deployed build needs a same-origin `/api` reverse proxy. The old root `npm` commands and manual `backend/.venv` setup have been replaced by the commands above.

## Shape export compatibility

New clients send `layout.regions` (outer/holes), `layout.pins` (id/x/y) and `layout.edgePadding` to the existing `POST /api/exports`, with heights/material indices in actual pin order and no rows/columns. Optional `parameters.pinShape` and `parameters.pinRotation` default to Round/0; `diameter` retains its API name but means circumscribed size. Requests without layout retain the legacy rectangular path. Shapely rejects invalid geometry without repairs; manifold3d CrossSection extrudes base regions and sockets. Every disconnected base region remains on plate 1 in its assembled relative position; pins start on plate 2. Rotated pin bounds determine packing and centering, including asymmetric triangle origins, with every pin grounded at Z = 0. The STL manifest records the stable layout, shape and rotation; pin names include assembly XY, total length and polygon identity. Image removal in From image mode requires another image or a preset; it never substitutes a rectangle. See [ADR-018](docs/decisions/018-base-shapes-and-position-layouts.md) and [ADR-020](docs/decisions/020-pin-cross-section-shapes.md).
