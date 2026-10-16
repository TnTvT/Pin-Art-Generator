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
│   │   │   ├── mechanics/        # Captive pin geometry, validation and worker
│   │   │   ├── pin-shape/        # Cross-sections, mixed footprints and geometry validation
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

The app composes the feature modules. Pin design owns geometry parameters and layout validation; image mapping owns decoding, sampling, and upload controls; base shape's `useDesignGeneration` coordinates the single atomic layout/mapping/mechanics pipeline; preview owns Three.js rendering and its React integration. Tests live beside the code they verify. Shared test setup and the Mantine render wrapper live in `apps/web/src/test/`.

`apps/web/src/features/export/` owns export controls, request snapshots, validation, and the download client. `apps/api/pin_art/` owns API validation, process isolation, geometry, single-plate part placement, STL/3MF generation, and colocated Python tests. Both construction modes build one `Plate` directly; multi-plate wrappers and packing are not retained. The HTTP response retains `X-Plate-Count: 1`, and legacy rows/columns requests remain supported. pnpm manages JavaScript packages; uv manages the API's Python environment. The API's private `package.json` only exposes commands to Turbo. Shared packages and a Python workspace will be added only when there is an actual second consumer.

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
- Choose **Round**, **Square**, or equilateral **Triangle** as the generation default. **Shape** in the preview toolbar overrides one, several, or all selected pins without moving them. **Pin size** remains shared and is the circumscribed diameter: round diameter, square diagonal (side = size / √2), or triangle circumdiameter (side = √3 × size / 2). Default size is 2 mm.
- Polygon **Pin rotation** accepts 0–360° counterclockwise in Top view. At 0°, square sides align with X/Y and a triangle vertex points toward +Y. Round ignores rotation but remembers it for switching back. Geometry/export treat 360° as 0°.
- Layout filtering, the 2D/3D previews, footprint and minimum-neighbor clearance use actual rotated shapes, not their enclosing circles. A lone pin displays no clearance. Shape changes preserve edits/history/selection when actual positions are unchanged; otherwise confirm the layout change.
- Defaults are 120 × 100 × 3 mm, spacing 4 mm, round size 2 mm, height 20 mm, rounded radius 10 mm. The default rectangle contains **621 pins** in Fixed mode.
- Limit layouts to 5,000 actual pins, 1,000,000 candidates and 20,000 contour vertices. Empty/excessive layouts are errors, not truncated results. Overlapping pins remain visible but block exports.
- **From image** shares the Image mapping upload. Auto uses alpha if any pixel is below 128; otherwise detect background with Color.js ΔE2000 (white, tolerance 10; 0–50). No AI. Keep separate outer silhouettes, fill enclosed gaps, and merge islands inside an already-filled silhouette. Pins can occupy those filled areas; height/color mapping still uses the original pixels. Image width/depth stay linked to foreground bounds.
- A 2D applied contour preview shows actual pins and region count. Separate regions remain separate print pieces; padding does not create borders or bridges.
- Processing happens in cancellable workers. Publish shape, actual positions and generated heights/materials together; stale work cannot overwrite new settings. Errors retain the applied preview and block export until resolved or retried.

The top-right XYZ orientation helper follows the camera as you orbit: red X, green Y, and blue Z (world up). It is an indicator, not a camera control, and stays fixed in size during pan and zoom. Top view shows X to the right, Y upward, and Z toward the viewer.

## Image mapping

**Adjust image** opens a side-by-side 2D comparison: adjust the **Original image** on the left over a pixel-grid background and see live **Mapped samples** on the right. The right panel is read-only; both share placement, framing and numeric controls. On narrow screens they stack in the same order. Image mapping uses a compact grid: physical lattice centers are centered and scaled by `pin-top cell size / spacing`, so adjacent cells touch without counting physical gaps. Cell size is Pin size, plus twice Head flare in print-in-place mode. This shared envelope is independent of per-pin shape/rotation; missing lattice positions stay blank. Default placement contains the image in the compact grid's bounding rectangle; image-derived bases contain their foreground bounds. The base outline is a compressed reference, not the printing layout. Samples show the same per-pin RGB used for height/color generation before filament matching and manual edits. **Show pin shapes**, off by default, adds top outlines to both panels without changing sampling. Offsets and arrow keys use compact-grid mm, not assembled-model distances. Drag the left panel to translate; scroll there to zoom around the cursor, or use the 10–400% slider and numeric fields. Arrow keys move 1 mm (Shift: 5 mm); +/− zoom. Escape, pointer cancellation or focus loss cancels the active drag. **Center image** resets translation while keeping zoom; **Fit image** and **Reset** restore centered contain at 100%. Changes apply live and closing keeps them. Physical size, spacing, layout, pin IDs, manual edits and export geometry remain unchanged; generated heights/colors now sample the compact grid. Pixel samples can still change discretely on zoom, but the original image remains visible for alignment.

Grid lines use a dark stroke with a light outline so they remain visible over dark and light image areas. **Image opacity** below the original preview adjusts display opacity from 0–100% in 5% steps (default 100% each time the dialog opens). It does not change the right-hand samples, mapped heights, filament colors, placement or exports, and does not trigger resampling.

Placement changes only height/color sampling, never the base contour or pin positions—even with **From image**. Heights and colors share the same aspect-preserving transform and original RGBA samples; uncovered areas are white. Manual overrides, selection and pin-edit history survive adjustment. Mapping updates retain their existing atomic publication, stale-worker cancellation and export blocking. Disable **Map image to pins** for contour-only use; adjustment is unavailable then. Successful image replacement/removal resets placement; failed uploads retain it. **Reset parameters** keeps the current image placement. Placement is session-local, is not a pin-edit undo transaction, and is not sent to the backend: downloads use the resolved heights/materials. See [ADR-021](docs/decisions/021-image-placement-and-shared-sampling.md).

Upload a PNG, JPG, or WebP (up to 20 MB), or select **Try sample**. Images are decoded and processed locally; nothing is uploaded to a server. Large images are reduced to a maximum 1,024-pixel side for sampling.

**Sampling** defaults to **Smooth** (bilinear interpolation). **Pixel** reads the containing source pixel without blending neighbors: one source pixel or enlarged pixel-art block can drive many pins, with the same generated height/color before manual overrides. Physical pin gaps are not additional image pixels. Sampling never changes spacing, size, shape, count or image placement; it cannot recover details missed by sparse pins or JPEG damage. Both choices work in all three mapping modes. Large-image Pixel rasters are prepared directly from the original local Blob with nearest resizing, independently of the unchanged Smooth/contour raster. The adjustment dialog uses the matching capped raster and disables visual interpolation in Pixel. Cached raster resources are released on replacement/removal/unmount, preserving accepted images during layout rollback. See [ADR-022](docs/decisions/022-pixel-image-sampling.md).

Preset bases contain the whole image inside the compact pin-top grid; image bases contain the detected foreground bounds in that same grid. Contour extraction and physical layout stay separate from mapping. See [ADR-027](docs/decisions/027-compact-pin-top-image-grid.md). **Map image to pins** defaults on; switch off to use an image only as the base shape. Transparent pixels and unused mapping margins are white. Image top maps to positive Y so it reads upright in Top view. **Mapping mode** defaults to **Height** (weighted grayscale; dark pixels are taller). **Color** maps image colors to preset filaments with uniform generated heights. **Height + Color** does both using the same samples; heights always come from original-image brightness, not the matched filament colors. **Invert mapping** only reverses the height relationship, including white margins.

**Auto palette** chooses from PLA Basic, PLA Matte, or both (default), using perceptual ΔE2000 from Color.js. **Max pin materials** defaults to 4 and allows 1–16, excluding the base. Deterministic greedy selection followed by two bounded replacement passes avoids wasting a slot on intermediate colors. The palette may be smaller when the base and manual colors occupy the 16-material budget. **My filaments** only matches the presets you select; its initial selections are the default base and pin presets, and the selection is retained when switching sources. Same-RGB Basic and Matte remain different materials. Reference RGB is approximate, not a calibrated printing guarantee.

Palette rows show the original matched groups and pin counts; hover or focus for names/codes, families, HEX and RGB. Click a row to choose a replacement preset or custom color and **Apply to group**. Every pin in that original group is recolored, including existing manual colors, without changing heights or selection. Rows show the current replacement or **Mixed**; assigning two groups the same color does not merge their membership. Group edits are one undoable batch and use the same 16-material validation and export snapshot as individual edits. Manual/base edits and undo/redo do not rematch the image; changing image or generation settings, or Retry, regenerates groups while keeping manual pin overrides. **Final design** counts used RGB + profile pairs including the base. Colors update in a cancellable Web Worker, with processing time displayed in ms. Updating disables edit submissions and downloads, but not camera navigation or mapping settings. Stale jobs cannot overwrite newer results. Failed updates retain the last applied snapshot and block export; fix settings or retry. A changed layout never reuses old samples.

Historical measurement before the 5,000-pin cap: local validation measured about 0.53 seconds for 10,000 distinct synthetic RGB samples and about 10 ms of worker computation for a 10,000-pin four-color image. These are workload-specific measurements, not latency or frame-rate guarantees; decoding, sampling and preview updates are additional work.

In height modes, one **Height range** control in Image mapping sets both bounds with a dual-thumb slider and linked **Min height / Max height** numeric inputs. The default range is 10–20 mm. The slider supports 0.1 mm adjustments; numeric inputs allow two decimal places and extend its track beyond 80 mm when needed. The slider prevents crossing; equal bounds produce uniform mapped heights. Incomplete, nonpositive, or reversed numeric drafts keep the last valid range and preview. Actual mapped heights are displayed alongside the source preview. Pin array shows **Generated pin extension** only without height mapping, or in Color mode. Removing the image returns unedited pins to uniform heights and the default pin preset, subject to the material limit; resetting parameters keeps the image while restoring default dimensions, range, and inversion. Manual height/color overrides survive regeneration and mode changes.

## Edit pins

Generate in the sidebar, edit with the floating **Edit pins** toolbar over the preview's upper-left, then export from the sidebar. Height and Material open beside it without resizing the canvas or changing camera framing; panels can overlap the model. At tablet/mobile widths, tools float along the canvas bottom and editing fields open in a bottom sheet over generation. Click a pin to select it; Shift-click toggles additional pins. An ordinary drag rotates the camera, even when it starts on a pin; Shift-drag adds a selection box over projected pin tips, including hidden pins. Clicking empty space clears selection without Shift. Scroll zooms and right-drag pans. Both perspective and orthographic Top view support these gestures without switching modes. Yellow exterior outlines indicate selection without tinting pin surfaces, changing printable colors, or changing the scene's exposure.

The dock counts selected RGB colors; the compact preview status strip counts all design colors including the base. Hover or focus a **Design** color swatch to see hex, RGB, selected filament names/codes and families, and base/pin usage. Different filament profiles sharing RGB count as one displayed color; its tooltip lists all used identities while export retains distinct slots. Custom colors are labeled Generic PLA, not inferred catalog matches. Info icons open on-demand guidance; errors and export blockers remain visible. Default/reset materials are **PLA Basic Gray (10103)** for the base and **PLA Basic Turquoise (10605)** for pins, not Custom color.

Open **Height** in the toolbar. **Set extension** assigns a uniform height; **Offset extension** adds or subtracts mm while retaining height differences. Enter a value and press **Apply height** or Enter. Mixed selections display **Mixed**. Drag the active pin's ↑ handle along world Z in perspective, or vertically on screen in Top view; its tooltip shows the live height. A drag uses its starting heights and creates one undo record on release. Escape, pointer cancellation, loss of focus, or a view change restores the committed design. Downloads are disabled during a drag. Invalid batches are rejected together, never clamped.

Height inputs remember separate Set/Offset drafts, and the Material and Shape panels remember your last chosen material and cross-section/angle for the current session. Selecting another pin, clearing selection, reopening controls or undoing an edit does not erase these inputs or apply them automatically. The selection summary still shows actual current values, including **Mixed**. **Use selected height / Use selected material / Use selected shape** reloads the selection instead of the cached input; these UI drafts are not persisted across reloads and do not enter undo history.

Open **Shape**, choose Round/Square/Triangle and an optional polygon rotation, then **Apply shape** or Enter. The entire selection changes as one undoable batch; invalid angles, overlap, or boundary/padding violations reject the whole operation. **Restore default shape** removes selected geometry overrides without touching height/material edits. An explicit shape/angle remains an override even if it currently equals the default. Global same-position updates validate retained overrides; a conflict retains the applied model and blocks exports. Undo or restore affected shapes against that applied model, or revert the generation setting, to recover. Changes that remove/add/move pins use the existing confirmation flow. Reset all edits and geometry history replay also reject invalid footprints; they never silently move or shrink pins.

Open **Material**, choose **Selection filament / color**, then **Apply material** to paint one, several, or all selected pins. Close the custom color picker before applying. **Base filament / color** is independent and lives under **Base plate**. The toolbar's **⋯** menu offers **Select all**, **Restore generated heights**, **Restore generated colors**, and **Reset all edits**. Restore uses the latest image/uniform generator; reset all confirms before restoring generated pins and the default base while retaining the image and mapping settings. Undo/Redo (Ctrl/Cmd-Z, Shift-Z or Ctrl/Cmd-Y outside text fields) covers heights, materials and resets, retaining at most 50 transactions and 16 MiB of encoded sparse deltas. Regeneration does not add history; undo/redo validates material limits against the current generator and rejects invalid batches. On small screens, Undo/Redo move into the menu to keep the viewer unobstructed.

Stable pin IDs encode integer grid coordinates, and the selected pin displays its ID and X/Y. Changes preserve edits only if actual ID/XY positions are unchanged; otherwise confirm clearing pin edits, selection and history, retaining base material, image and mapping settings. Cancel restores applied settings and image. **Generated pin extension** is not a ceiling on manual heights. 3MF validates the actual fixed/print-in-place printable height against the selected printer profile; STL remains printer-independent. The resolved committed heights and per-pin material identities are shared by preview and export. Editing allows up to 16 used **RGB + filament profile** pairs including the base; introducing a seventeenth is rejected. U1 3MF downloads additionally require at most four. Projects remain in memory and reset on reload.

## Model downloads

Choose the base material under **Base plate** and selected-pin materials in the preview toolbar, then download from **Print export**. Search the bundled Bambu Lab PLA Basic/Matte catalog by color name, product code, family, or hex, or choose **Custom color** for swatches, the color picker, or hex entry. The selected colors appear in the assembled preview and are retained in 3MF alongside the selected material family. Image processing stays in the browser; downloads send only committed contour regions/holes, actual pin IDs/XY, resolved heights, parameters, colors, material-profile keys, and per-pin material indices to the local backend. Edits made after submitting a download do not alter that request snapshot.

The offline catalog in `apps/web/src/features/filaments/data/bambu-pla.ts` stores brand, material, type, color, product code, hex, RGB, and source record IDs. Its September 30, 2026 snapshot contains 32 [PLA Basic](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/basic) and 25 [PLA Matte](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/matte) entries from 3D Filament Profiles, including distinct records sharing an RGB value. These are reference colors, not calibrated printed-color measurements or an availability guarantee. Basic selections reference **Bambu PLA Basic @BBL X1C**; Matte selections reference **Bambu PLA Matte @BBL X1C**. Custom colors reference **Generic PLA**, which users must verify is suitable for their actual material. Choosing Custom color clears the previous family even when RGB stays unchanged. No network request is needed to browse the presets. Update the data, capture date, and catalog tests together when refreshing the snapshot.

Selected colors live in the project's filament palette, not in modified system-preset default colors. X1C exports include single-nozzle logical filament routing arrays checked against Bambu Studio 2.7.1 source; U1 exports use Snapmaker Orca's four-toolhead configuration. Open the 3MF as a **project**, not geometry only, to load its printer/material settings. Automated package checks do not certify slicer GUI import or slicing; please verify both in your installed version.

- **Fixed sculpture** (default): STL is a watertight union of base and pins. 3MF keeps separate material regions in one assembled sculpture.
- **Print-in-place**: one perforated guide base and independent captive pins with tapered lower/upper retaining heads, printed together in their initial positions. STL contains separate closed solids; 3MF keeps the assembly together on one plate without individually re-grounding parts.
- **3MF**: choose **Printer** under **Print export**. X1C (default) retains the official Basic/Matte or Generic PLA presets and **0.20mm Standard @BBL X1C**. **Snapmaker U1 · 0.4 mm** targets **Snapmaker Orca**, referencing its official **Snapmaker U1 (0.4 nozzle)** and **0.20mm Standard @Snapmaker U1 (0.4 nozzle)** presets. Install these system presets and open the download as a project. U1 Basic/Matte selections preserve RGB/vendor/family as project materials derived from **Generic PLA @System**, not official U1-tuned Bambu profiles; verify material settings. No printer G-code, temperature/flow overrides, physical AMS assignments or Full Spectrum blending are generated.
- Only actually used RGB + profile pairs share slots: **16 for X1C, 4 for U1, including the base**. Unused entries do not consume the budget; identical RGB with distinct profiles remains distinct. Exceeding the U1 limit blocks 3MF with an actionable message, not editing or STL. Switching printers does not resize or remap the design.
- **STL**: one binary file, no colors or plate/profile metadata. Detachable mode, insertion/socket controls, multi-plate packing and STL ZIP manifests have been removed.

### Print-in-place mechanics

The app currently offers **Round** and **Square** in Print-in-place; **Triangle** remains available in Fixed sculpture. Both the default-shape selector and selected-pin toolbar hide Triangle in movable mode. Designs containing default or manually edited Triangle pins must be changed explicitly before switching modes; pins are never silently converted. Cached Triangle drafts, editing history and frontend export validation follow the same restriction. Native Triangle geometry and API compatibility remain retained for legacy clients; this UI restriction does not certify physical print fit for any shape.

Switching from Fixed to Print-in-place automatically raises **Pin spacing** to a conservative safe value when needed, using the shared pin size and current mechanical offsets, rounded up to 0.1 mm. Existing larger spacing and every other parameter are kept; switching back to Fixed does not shrink spacing. If the new layout affects manual pin edits, the usual confirmation applies; cancelling restores the previous mode, spacing and edits. Later manual spacing or advanced-setting changes are not automatically corrected: an inline notice beside Construction explains that the canvas is the last valid preview and offers an explicit **Use … mm spacing** action. The pending base shape is kept and regenerated after correction.

Select construction under **Parameters**, not Export: it controls generation, preview and downloads together. **Advanced settings** defaults to **Sliding clearance 0.6 mm** (total shaft clearance, half on each wall), **Head flare 0.7 mm** (outward head offset), **Lower taper angle 45°** (from the horizontal print bed), and **Lower head surface gap 0.3 mm** (shortest separation of the lower head and lower mouth slopes in the initial printing position). The shaft guide uses the selected clearance, and the upper mouth expands with it while retaining its 45° angle. Lower surface gap remains independent of shaft clearance; both retaining heads use the selected flare, while pin length and upper taper angle stay unchanged. Round profiles use 64 segments; polygon offsets use rounded corners and preserve every pin's rotation.

Default Fixed spacing is **4 mm**. Entering Print-in-place raises it to **4.5 mm** for 2 mm pins, **5 mm** for 2.5 mm pins, or **5.5 mm** for 3 mm pins with the default mechanics, unless spacing is already larger. A default 2 mm round shaft has a 3.4 mm head and 2.6 mm guide bore, giving **0.4 mm ideal radial retention**. Increasing head flare to 0.7 mm compensates for the 0.6 mm total shaft clearance; nominal retention is not a physical print guarantee. Larger or rotated pins must still satisfy validation. The default 2 mm round pin needs approximately 4.4491 mm minimum spacing with the wider lower mouth. See [ADR-025](docs/decisions/025-reference-retention-defaults.md) for the historical defaults; the mode-switch spacing behavior is now superseded as described above.

**Extension E** always measures from the base top to the pin top, including its top head in the initial printing position. It is not total pin length or travel. With base thickness B, half-clearance c, flare h, angle θ and lower surface gap g, total length is B + E and the initial pin bottom is Z = 0. Compute horizontal taper separation d = g × sqrt(q⁻² + cot²θ), where q = cos(π/63) conservatively accounts for rounded profile facets. Lower head height is h × tanθ; lower mouth offset is h+d and its height L = (h+d−c) × tanθ. The straight guide keeps offset c; the upper mouth retains offset c+h and height h. Ideal fixed-orientation travel is −E−c to +d × tanθ; there is no motion/demo UI.

Require finite positive g, 0° < θ < 90°, h−c ≥ 0.2 mm, B−L−h ≥ 1 mm, E ≥ 2h, a positive shaft length between the two head tapers, 0.8 mm guide walls/edges, and 0.2 mm mouth walls/edges and head-to-head gaps. Check both upper and lower mouths. Edge padding is measured from the **head's outer wall**. Increasing the angle or gap may require more spacing or base thickness; neither is changed automatically. Mouth lips thinner than 0.8 mm show a visible warning. Invalid batches/settings are rejected without resizing parts or deleting conflicting pins; failed generation retains the applied preview and blocks downloads. Location-changing layouts use the existing edit-reset confirmation. See [ADR-028](docs/decisions/028-guide-mouth-release-clearance.md).

For a 3 mm shaft with these defaults, the heads are 4.4 mm wide and the straight bore is 3.6 mm wide. The lower mouth is approximately 5.2491 mm wide and 0.8245 mm deep; the upper mouth is 5.0 mm wide and 0.7 mm deep. The 0.3 mm target applies to the lower slopes, not every pin/base surface or a universal physical printing tolerance. Physical release still depends on the printer, material and slicing settings.

The preview renders real through holes, tapers, shafts and fixed-size retaining heads. **Transparent base** only changes display opacity, not printable color/material. Selection, yellow outlines, mixed shape/rotation edits, image mapping, Fit model and undo/redo remain available. Mechanical plate geometry is built in a cancellable worker; stale results cannot replace newer designs.

Print-in-place 3MF must fit a centered **246 × 246 mm** usable area on X1C (256 × 256 mm bed, 250 mm height) or **260 × 260 mm** on U1 (270 × 270 mm bed, conservatively 270 mm height), leaving 5 mm edge margins. Fixed uses the full selected envelope. U1's official bed starts at X=0.5, Y=1 mm; the assembly is centered at **135.5, 136 mm**, with every Z position unchanged. Valid STL remains printer-independent. All base regions keep their relative positions; nothing is packed, split, scaled or moved to another plate. See [ADR-026](docs/decisions/026-selectable-printer-profiles.md) for pinned preset sources and compatibility boundaries.

These dimensions are a **test-print starting point**, not a guarantee of release, sliding or position holding. Bambu import/slicing and physical printing are user-owned. Keep supports, brims and purge structures out of mechanical gaps, verify printer/material/process profiles, and print a small fit sample first. There are no locks, springs, automatic supports or physical calibration.

Requests are capped at **2 MB and 5,000 pins** across generation, color mapping, preview and both API paths. JSON parsing, geometry validation and generation run in one isolated child process with a 120-second deadline. Uploads have a 10-second deadline; sending the file has a 30-second deadline. Temporary files and children are cleaned up on failure, cancellation or disconnect, and admission remains occupied until the download finishes.

Each API process accepts at most **6 export attempts per rolling 60 seconds**, shared by all users; invalid snapshots consume an attempt, busy responses do not. Busy requests return structured **503**, throttled attempts **429**, both with `Retry-After`; the UI shows the delay without automatically retrying. Restarting a process resets the window. This is a lightweight application safeguard, not per-user fairness, distributed rate limiting or a spending cap. Use one API worker for the single-export guarantee.

Generated files are capped at **256 MiB**. On Linux, a 50 ms RSS monitor stops workers observed above **6 GiB**, returning `EXPORT_MEMORY_LIMIT`; it is a sampled safeguard, not a hard memory reservation. Size the host for the worker, API and temporary-file memory; use `PIN_ART_WORKER_RSS_MIB` (1–6144, default 6144) to lower the worker budget in smaller containers. RSS monitoring requires Linux `/proc`; other platforms still have timeout/file-size protection and record worker peak memory where available. Dense models can require several GB of memory and large STL files; use fewer pins on constrained machines. Fixed STL requires a positive pin gap to avoid non-manifold point contacts. See [ADR-024](docs/decisions/024-print-in-place-mechanics.md).

`pnpm --filter @pin-art/web preview` serves the built frontend without an API proxy. To use exports locally, run `pnpm dev`; a deployed build needs a same-origin `/api` reverse proxy. The old root `npm` commands and manual `backend/.venv` setup have been replaced by the commands above.

## Shape export compatibility

`POST /api/exports` accepts `mode: "fixed" | "print-in-place"` and optional `sliding: {clearance, headFlare, lowerHeadAngle, lowerHeadGap}` (0.6 mm / 0.7 mm / 45° / 0.3 mm defaults). Omitted new fields adopt these defaults; existing dimensions remain subject to validation. The unreleased `headRelief` experiment is replaced by direct surface-gap control. Unknown fields and removed `detachable`, `socket` and `plate` values/fields return structured 422 errors, not silent conversions.

New clients send `layout.regions: [{outer, holes}]`, `layout.pins: [{id, x, y}]` and `layout.edgePadding` in mm, plus resolved `heights`, `pinMaterials`, `materials`, `filamentProfiles` and complete ordered `pinGeometries: [{shape, rotation}]`. No source images, image bounds or browser meshes are uploaded. Without layout, legacy rectangular rows/columns remain supported within the same 5,000-pin limit. Omitted geometry inherits global Round/0-compatible defaults; present incomplete arrays are rejected. `diameter` still means circumscribed size.

Shapely independently validates contours, positions, mechanical footprint distances and material indices without repairs. Native manifold3d builds/validates closed solids. The guide plate uses native triangulation of actual mouth holes plus tapered walls, avoiding a large repeated-cutter Boolean; shared TypeScript/Python fixtures and Boolean-reference tests verify the same geometry. Pin names retain stable IDs, assembly XY, extension, shape and rotation. Reusable 3MF meshes are centered with precise compensated transforms; the complete assembly, not individual pins, is centered on the bed. Image silhouettes stay solid; mechanical holes do not affect image sampling. Historical decisions are retained in [docs](docs/README.md).
