# Product requirements: Pin Art Studio

**Status:** Current demo baseline

**Last updated:** October 4, 2026

## 1. Purpose

Help a user explore a pin-art design by configuring a preset or image-derived base with automatically positioned cylindrical pins, viewing it in 3D, and mapping an image to pin heights and preset filament colors.

The first audience is the project owner and makers experimenting with pin-art geometry before a future printable-model workflow. Success means users can quickly understand how dimensions, grid density, and image brightness affect the model without using CAD software.

## 2. Scope and delivery stages

| Stage | Capability | Status |
| --- | --- | --- |
| Initial MVP | Parametric base, uniform pin array, interactive 3D preview, English UI | Implemented |
| Image mapping | Local upload, Height / Color / Height + Color, automatic or user-selected preset palettes, range controls and inversion | Implemented |
| Engineering foundation | Feature folders and automated unit/integration tests | Implemented |
| Monorepo tooling | pnpm/Turborepo orchestration and uv-managed Python backend | Implemented |
| Appearance | Light/dark themes with a locally saved preference | Implemented |
| Model downloads | STL, Bambu-compatible colored 3MF, detachable socket pins, multi-plate layout | Implemented; Bambu GUI/physical fit verification is user-owned |
| Per-pin editing | Selection, Set/Offset heights, per-pin materials, transactional drag and undo/redo | Implemented |
| Base shapes | Rectangle, rounded rectangle, circle, ellipse, solid image silhouettes/disconnected regions and automatic layout | Implemented |
| Moving-pin hardware | Captive sliding pins, stops, and retainers | Deferred |

The initial request prioritized a quick demo without tests. A later explicit request added automated testing. That later requirement governs the current project.

## 3. User workflow

1. Open the app and inspect the default uniform pin array.
2. Choose a preset or image-derived contour. Set dimensions, edge padding, pin spacing, diameter, and generated height.
3. Rotate, zoom, pan, or use camera buttons to inspect the geometry.
4. Optionally upload an image or select **Try sample**.
5. Adjust the minimum/maximum extensions and inversion to explore the image relief.
6. Resolve generation errors by changing settings; the last applied design remains visible and export is blocked.
7. Remove the image to return to uniform heights on a preset base. From image requires a new upload or switching to a preset.

## 4. Base and pin requirements

All dimensions use millimeters. Pins extend along Z; a centered X/Y square lattice generates actual positions, not editable row/column counts.

| English control | Default | Behavior |
| --- | --- | --- |
| Base source / Base shape | Preset shape / Rectangle | Rectangle, Rounded rectangle, Circle, Ellipse, or From image |
| Base width / Base depth | 120 / 100 mm | Positive dimensions; circle uses Base diameter; image dimensions preserve foreground aspect ratio |
| Base thickness | 3 mm | Positive Z thickness |
| Corner radius | 10 mm | Rounded rectangle only; 0 to half the shorter side |
| Edge padding | 5 mm | Minimum gap from pin outer wall to the outer silhouette boundary; nonnegative |
| Pin spacing | 5 mm | Equal X/Y center spacing, never adjusted automatically |
| Pin diameter | 2 mm | Positive cylindrical diameter |
| Generated pin height | 20 mm | Visible height above base; manual heights may exceed it |
| Map image to pins | On | Off allows image-only base shaping without height/color generation |
| Min height / Max height | 2 / 20 mm | One dual-thumb Height range with linked positive, ordered inputs |
| Invert mapping | Off | Height only: dark-tall vs light-tall |

- Generate lattice coordinates at integer multiples of spacing from the base center; sort actual pins by Y then X. Stable IDs encode integer grid coordinates.
- Keep only complete pin disks inside the solid outer silhouettes with the specified padding. Enclosed image gaps are not cutouts and can contain pins. Padding never expands a base or adds connecting borders.
- Curved presets use 64-point polygon approximations, with only duplicate/collinear points removed. Preview and export use identical regions.
- Maximum 10,000 actual pins, 1,000,000 candidate positions and 20,000 total contour vertices. Empty or excessive layouts fail visibly without truncation.
- Numeric drafts retain valid input; complete but invalid shape settings retain the applied design and block export. Never silently substitute a rectangular base.
- Show Total pins, actual Pin footprint (XY bounds plus diameter), and Pin clearance (spacing minus diameter).
- Spacing smaller than diameter can be inspected with an overlap warning but cannot be exported.
- Contour recognition shares the local upload: PNG/JPG/WebP, 20 MB, maximum decoded side 1,024 px. Use original RGBA for contour detection.
- Auto uses Transparency if any alpha is below 128, otherwise Background color. Transparency treats alpha ≥ 128 as foreground. Background mode composites alpha onto the chosen background then compares Color.js ΔE2000; default white, tolerance 10, range 0–50.
- Use d3-contour with smoothing disabled. Keep external silhouettes, fill enclosed gaps, and absorb nested foreground islands into their enclosing solid silhouette to avoid overlapping regions. Preserve separate silhouettes and clean only duplicate/collinear outer points; no small-region removal, bridging, or AI. This affects base geometry and pin eligibility only, never the original height/color samples.
- Image bases use the full foreground bounds and linked width/depth. A compact applied 2D contour preview overlays actual pins and reports disconnected regions as separate print pieces.
- Validate and atomically publish contour, positions, heights and materials. Cancel replaced/unmounted workers and suppress stale results; processing blocks editing/export but not camera or settings.
- If IDs or XY change with manual pin edits, confirm before clearing overrides, selection and history. Retain base filament, source image and mapping settings. Cancel restores applied settings and image. Unchanged positions preserve edits.

## 5. Image mapping requirements

- Accept PNG, JPG/JPEG, and WebP files up to the limit displayed as 20 MB (20 × 1,024 × 1,024 bytes).
- Decode and process images locally in the browser. Source images are not uploaded to a service.
- Reject unsupported, oversized, or unreadable files with an English error. An unsuccessful replacement keeps the previous image.
- Provide a source thumbnail, filename, **Replace image**, and **Remove image**.
- Provide a generated sample image through **Try sample** when no image is selected.
- Preset bases contain the full image centered inside the base dimensions. Image bases sample through the exact foreground-bounds transform used by the contour. Preserve aspect ratio and positive-Y orientation.
- Composite transparent pixels and unused margins over white.
- Reduce the decoded image's longest side to at most 1,024 pixels for sampling, preserving its aspect ratio.
- Bilinearly sample original RGBA at actual pin XY positions; heights and colors share those samples.
- Convert RGB to weighted grayscale using `0.2126R + 0.7152G + 0.0722B`.
- Default height is `minimum + (1 − brightness / 255) × (maximum − minimum)`. Inversion replaces `1 − brightness / 255` with `brightness / 255`.
- Map image top to positive Y so **Top view** reads upright.
- Offer **Height** (default), **Color**, and **Height + Color**. Share the sampled pixels and row orientation between both outputs. Color-only generation uses uniform heights; height-only generation uses the default pin preset. Manual overrides remain higher priority.
- Match colors to the bundled Basic/Matte presets with Color.js Lab conversion and ΔE2000; never generate custom colors. Deduplicate identical RGB + profile candidates, but keep same-RGB Basic/Matte distinct. Resolve equal distances by Basic first, then product code and ID.
- **Auto palette** filters Both (default), PLA Basic or PLA Matte. **Max pin materials** defaults to 4, permits 1–16 and excludes the base. Optimize a weighted histogram of non-manually-colored pins with deterministic greedy selection and two bounded replacement passes. Reserve the base/manual materials and never exceed 16 final RGB + profile pairs; explain budget-limited palettes.
- **My filaments** is a searchable grouped preset multiselect, initialized with the default base/pin presets and retained across source switches. Match only selected filaments; empty or over-budget results fail without trimming the user's selection.
- Derive heights from original brightness, not palette colors; inversion only affects heights. Show generated palette/counts before manual overrides, actual final material count including the base, keyboard-focus/hover details, and on-demand help.
- Make generated palette rows editable groups: choose a preset or custom replacement and apply to every member of the original RGB + profile group, including manually colored members. Preserve heights, selection and other groups. Display current replacement or Mixed; groups do not merge when given the same material. Commit once with undo/redo and the existing 16-material limit. Preserve generated groups across manual/base edits, restore and undo/redo; regenerate on image/settings changes or Retry, retaining manual overrides. Invalidate open group dialogs when a new mapping is published; block submissions while generation or height dragging is active.
- Keep images local. Execute color selection/matching in a cancellable Web Worker; display Updating mapping and elapsed computation time, suppress stale results, terminate on replacement/unmount, and publish validated heights/materials together. Disable edit submissions and downloads during decoding/mapping, but retain camera navigation and setting changes.
- On generation failure, retain the last applied valid design and block export with a readable error and Retry mapping. Old samples must not be reused for changed positions.
- Display the actual sampled minimum and maximum heights; these may not reach the configured endpoints.
- Lowering the maximum below the current minimum also lowers the minimum. Equal endpoints produce a flat array.
- Inversion also affects white margins and transparent areas, making them tall in light-tall mode.
- On preset bases, removing an image restores uniform generated heights and the default pin preset, retaining manual overrides and applying the same atomic material-limit validation.
- **Reset parameters** restores geometry defaults, minimum 2 mm, and inversion off while retaining the source image. Camera changes remain separate from parameter resets.

This is brightness mapping, not inference of an object's physical depth from a photograph.

## 6. Preview and interface requirements

- Use English throughout the product, including labels, instructions, errors, and buttons.
- Use a viewport-height workspace with 16px page padding and a 48px header without an MVP badge. Image mapping stays above parameters in the independently scrollable, keyboard-accessible left sidebar; the prominent right-side preview and measurements stay visible without scrolling the whole page. On narrow screens, show the preview above separately scrollable controls, with 12px outer padding.
- Default to light mode. Provide a keyboard-accessible header button to switch between light and dark mode, and remember the selection locally across reloads.
- Apply the selected theme to panels, controls, text, preview overlays, and the 3D background and grid, not printable model colors. Keep source image colors unchanged.
- Switching themes preserves parameters, partial input drafts, image mapping, accordion state, and the current camera, including projection and zoom. Do not recreate the renderer.
- Base plate and Pin array are independently collapsible accordion groups, initially expanded. Collapsing a group preserves its values and does not alter the preview.
- Show **All dimensions in mm** in the top header; do not add a separate Workspace subheader.
- Distinguish the base from the pins visually and show both the top and side in the initial perspective view, looking from positive X and positive Y with Z up. The orientation helper shows X down-left, Y down-right, and Z upward. **Reset view** returns to this same orientation.
- Support drag-to-rotate, scroll-to-zoom, right-drag-to-pan, and keyboard panning when the canvas is focused.
- Show a compact, read-only XYZ orientation helper in the top-right of the canvas instead of static axis tiles. Use labeled red X, green Y, and blue Z axes that follow camera rotation, with Z as world up. Keep its size and position fixed during pan and zoom; support both camera projections and color themes without intercepting canvas gestures.
- Provide **Top view**, **Fit model**, and **Reset view**.
- **Top view** uses orthographic projection with positive Y pointing upward; pin height does not change apparent size or spacing. **Fit model** retains the active projection and **Reset view** restores the initial perspective view.
- Parameter changes preserve the user's camera; **Fit model** explicitly reframes the current model while retaining the viewing direction.
- Fit against the actual base-and-pin bounds, excluding the background grid. Use projected bounds with a small margin, reset zoom/pan offset, and clear orbit damping so the fitted view remains centered. Top-view framing depends on the footprint, not pin height.
- Resize the canvas with its container. Release rendering resources and event listeners on unmount.
- Show an actionable error and disable camera buttons if WebGL cannot initialize.
- Keep labels keyboard-accessible and make layout feedback available through an accessible status region.

## 7. Acceptance and verification

- Parameter changes correctly affect geometry, statistics, and warnings without crashing on partial input.
- Every pin starts at the base's upper surface, including when image heights differ.
- Black/white and asymmetric image fixtures verify endpoints, inversion, RGB weighting, and orientation.
- Image fitting preserves aspect ratio, including when the base aspect ratio differs from the image ratio.
- Upload failures, replacement races, removal during decoding, and unmount release resources without restoring stale images.
- File-input controls allow reselecting the same image.
- Camera controls, preview updates, and cleanup are covered by integration tests.
- Verify orientation-helper alignment in Top view, rotation tracking, pan/zoom independence, and cleanup with the preview.
- Theme switching and persistence are covered by tests, including camera and design preservation. Keep light-mode grid lines visibly distinct from the canvas background on first render and after switching back from dark mode. Check both themes and narrow-screen layouts in the browser.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass for behavior changes. The root test task runs both frontend and backend suites.
- Use browser smoke checks for actual image decoding, WebGL rendering, the 10,000-pin case, and responsive layouts. DOM tests do not establish visual correctness or a guaranteed frame rate.

### Base-shape verification — October 4, 2026

- 218 frontend tests and 210 backend tests pass; the frontend production build includes a passing TypeScript check. Strict lib3mf reads validate shape exports, including explicit API holes, independent regions, materials and plate assignments. Silhouette regression tests cover filled interior gaps, nested islands and both transparency/background detection; browser verification confirms a solid base with original-pixel height mapping.
- Browser checks cover all four presets, real transparent/background-color uploads, linked dimensions, combined mapping, contour-only images, missing-image recovery, stable-ID picking, top-view height dragging/undo, layout-change cancellation, fixed/detachable downloads, both themes and a 390 × 844 viewport without horizontal overflow. The desktop preview remains fixed while controls scroll. Fresh runtime logs contain no errors or warnings.
- An exact 10,000-pin image layout remained editable: shape/layout generation measured 113 ms, cached height mapping 8 ms and combined height/color generation 66 ms locally. These include the generation pipeline, not guaranteed frame rates or full upload/decode latency.
- A two-region 10,000-pin fixed 3MF request measured 452,890 JSON bytes, 0.21 s native validation and 1.19 s native export, with approximately 146 MiB peak process RSS and a 337 KB package. The local HTTP result also passed strict lib3mf read-back with zero warnings. Timing and memory are workload-specific; dense socket/STL workloads remain more expensive. Bambu GUI/slicing and physical printing are not verified here.

## 8. Current boundaries and future work

- Design state is in memory. Reloading the page resets the design; design save/load and persistence are not implemented. The appearance preference is saved locally.
- A local Python backend handles model downloads; there is no authentication, design database, or public hosting.
- The main preview represents the assembled design. Detachable downloads include blind sockets, insertion length, and separate printable parts; socket cutaways and print layouts are not rendered in the main canvas. Captive sliding pins and retainers remain deferred.
- Offer Bambu Lab PLA Basic and Matte presets before a Custom color fallback for both the base and pins. Bundle the catalog locally with brand, material, type, color name, product code, hex, RGB, source links, and snapshot date. Retain provenance in the catalog and documentation, without a catalog reference/date disclaimer or family source links in the export panel footer. Preserve distinct records with identical RGB values, and let users search names, codes, families, and hex values. Keep Custom color available for an unmatched search.
- The editor displays preset material/type and RGB. Apply material commits selected-pin colors; base selection commits independently. Retain catalog identity in application state and export Basic/Matte as the corresponding X1C system filament preset. Custom color offers swatches, a color picker, and hex entry, preserving the last valid color for incomplete drafts; it explicitly clears catalog identity and uses Generic PLA for 3MF, even when RGB is unchanged. Preserve selections through theme changes. Submitted exports are immutable snapshots; downloads are disabled during transient height drags. Do not assign physical AMS slots; reference RGB values are not calibrated printed-color promises.
- Image cropping, contrast controls, mixed-filament dithering, and calibrated manufacturing guarantees require separate product decisions.
- No deployment provider, rollout process, or physical-printing guarantees have been selected.

## 9. Printable models and colors

- Provide independent base and selected-pin material controls. Default the base to Bambu Lab PLA Basic Gray (10103, #8E9089) and pins to PLA Basic Turquoise (10605, #00B1B7), preserving catalog and official filament-profile identity. Preview and export use the same committed selected colors; theme changes affect surrounding presentation only.
- Offer Fixed and Detachable modes with Download STL and Download 3MF. Snapshot the last valid parameters and resolved heights in the actual pin position order; never upload source images or silently alter geometry.
- Fixed STL must be a watertight union. Fixed 3MF retains separate material regions within one assembled sculpture.
- Fixed STL rejects zero-clearance tangent neighbors with an explanation; the model is not silently reshaped to repair point-contact geometry. Dense STL exports are memory-intensive and may take around a minute.
- Detachable pins use blind sockets. Default insertion depth 2 mm and diametral clearance 0.2 mm; socket diameter equals pin diameter plus clearance. Require a 1 mm floor and 0.8 mm socket/edge walls. Printed pin length equals visible extension plus insertion depth. This is not a sliding mechanism or universal fit guarantee.
- Reserve plate 1 for the centered socket base; pack upright pins in actual position-list order (Y then X; legacy row-major) on centered pin-only plates starting with plate 2. Keep 5 mm margins and 4 mm part gaps. Default usable area 256 × 256 mm is editable; split automatically into at most 36 total plates. Reject oversized individual parts and invalid socket geometry.
- Deliver one Bambu-compatible multi-plate 3MF with standard colors and matching logical filament/part/plate assignments. Deduplicate color + material-profile pairs and reusable geometry; matching RGB must not merge Basic with Matte or Generic PLA. Embed Bambu Lab X1 Carbon 0.4 nozzle identity and reference its 0.20mm Standard process and selected filament presets through system-preset inheritance. Preserve selected colors in the project palette, not by modifying system filament preset defaults; inherit temperature/flow settings without hardcoded overrides or physical AMS assignments. Align Bambu filament variant and one-based self-index arrays with the compacted used palette.
- Extend the export snapshot with optional `filamentProfiles`, parallel to `materials`, accepting only `bambu-pla-basic`, `bambu-pla-matte`, and `generic-pla`. Validate palette alignment and reject unknown keys. Legacy omitted/null profiles resolve to Generic PLA, not an inferred Bambu product. Write aligned preset names, family IDs, vendors, PLA type, inheritance/difference groups, colors, and part extruder indices for the compacted used-material palette.
- Use the physical X1C 256 × 256 mm bed and 1.2-bed-size multi-plate strides independently of a smaller custom packing area. Center each plate's contents, keep detached parts at Z=0, and keep fixed pins starting at the base top. Center reusable meshes in all axes and compensate component transforms so Bambu's shared-mesh recentering cannot displace repeated pins.
- Block 3MF outside the X1C bed or its referenced profile's 250 mm printable height. Apply height limits to resolved edited heights, not the configured generator maximum. Manual heights must be finite and positive but may exceed generated heights. Keep STL available for valid designs intended for other printers.
- Detachable STL downloads are ZIP archives containing numbered plate STLs and an indexed height/material/placement manifest. STL itself carries no colors.
- Show pending/error/retry/download plate-count feedback and prevent duplicate exports. Limit requests to 2 MB/10,000 pins, isolate one worker at a time, terminate after 120 seconds, and clean temporary output.
- Automated checks cover geometry, dimensions, winding, sockets, layout, metadata, strict lib3mf read-back, API errors/cleanup, and UI request snapshots. Benchmark 10,000-pin cases; retain frontend tests/build checks.
- Bambu GUI inspection and slicing are left to the user. Check printer height/envelope, exclusion zones, brims, purge structures, and physical socket fit before printing. Opening a file successfully is not a manufacturing guarantee.

## 10. Engineering workspace

- Keep the React/TypeScript application in `apps/web` and the Python export service in `apps/api`, retaining feature ownership and colocated tests.
- Use pnpm workspaces for JavaScript dependencies, uv for Python dependencies/interpreter/environment, and Turborepo for root development/build/test commands. Commit both dependency lockfiles.
- Keep product requirements and architecture decisions in root-level `docs/`.
- Preserve the same-origin `/api` contract and local ports during the migration; do not change geometry, preview, or download behavior merely to reorganize files.
- Avoid speculative shared packages or a Python workspace until multiple real consumers require them.

## 11. Per-pin editing

- Keep generation and export in the independently scrollable sidebar. Float a fixed-width editing toolbar over the upper-left of the preview, with Height and Material panels beside it. The canvas occupies the full viewport; opening, switching or closing editing panels must not resize it, change projection, or refit the camera. Floating panels may overlap geometry. Keep the base material under Base plate. At 900px and narrower, float a compact tool row at the canvas bottom and use a bottom editing sheet over generation; small screens move history and Clear selection into the more menu.
- Maximize canvas space with compact preview headings, status and measurement strips, without decorative footer copy. Put explanatory preview, image, grid, height, material and export guidance behind labeled info icons with keyboard-accessible popups. Keep errors, export blockers and memory warnings directly visible. Escape dismisses nested controls before the editor and closing fields restores trigger focus.
- Display distinct selected-pin RGB color counts and swatches, plus design-wide color counts including the base. Design swatches reveal hex, RGB, actual selected filament names/codes and families, and base/pin usage through hover or keyboard-focus tooltips. Normalize hex case; identical RGB from different filament profiles counts as one displayed color, not one export material, and its tooltip lists all used identities without inferring a preset from RGB alone.
- Both views support direct click selection, Shift-click toggling, Shift-drag additive projected-tip marquee, all and clear selection, without Navigate/Select modes. An ordinary drag anywhere on the model or background rotates the camera and never changes selection, even if the pointer returns to its starting position. Empty clicks clear selection unless Shift is held. Scroll zooms; right-drag pans; height handles exclusively own height drags. Marquees include occluded pins but exclude tips outside the viewport or behind the camera.
- Preserve selection across view/theme changes. Show selected count, single-pin stable ID and X/Y coordinates, and Mixed heights/materials. Highlight only exterior contours in yellow (#FFD43B) using an isolated instanced selection mask and a screen-space edge overlay. Do not fill/tint pin surfaces, change printable instance colors, or switch the main scene's color-processing pipeline when selecting pins. Outline rendering supports both projections and theme changes; selected silhouettes can be visible through occluding geometry.
- Set height assigns one absolute value; Offset adds a signed amount while preserving differences. Apply/Enter commits a numeric batch; reject any nonpositive, nonfinite or unrepresentable result without changing any pins.
- Remember separate Set/Offset numeric drafts and the last chosen material across selections, clearing selection, editor reopening and history changes, for the current page session only. Changing selection never applies cached values automatically. Keep actual/Mixed values in the selection summary; Use selected height/material explicitly reloads current selection values. Draft changes do not enter edit history.
- Perspective height dragging uses a camera-facing plane containing the active pin's world-Z line. Top view uses vertical screen displacement scaled to orthographic mm. Show live mm; compute against starting heights; release commits once. Escape, pointer cancellation, blur or view changes restore the original committed heights. Invalid drag updates retain the last valid transient batch. Block export until release/cancellation.
- Keep generated heights/materials separate from sparse position-indexed pin overrides. Image regeneration/removal and mapping mode changes preserve overrides. Geometry adjustments preserve them only when actual ID/XY positions remain unchanged. Restore generated heights/colors removes selected overrides and resolves the latest image generator, or defaults when absent. Reset all retains mapping settings and resets the base to its default.
- Actual ID/XY changes with pin edits require confirmation. Acceptance clears pin edits, selection and history but retains base material; cancellation restores applied shape settings and source image. Reset all edits is confirmed and undoable.
- History covers heights, materials and resets, not selection/navigation/generation. Keep at most 50 transactions and 16 MiB of encoded sparse deltas; discard the oldest records first. New edits clear redo. Ignore undo shortcuts in text fields/dialogs.
- Preserve color and catalog identity per pin. Compact the actually used RGB + filament-profile pairs for export, including the base, with at most 16 slots. Reject a seventeenth material even if introduced by restoring colors, undo or redo against a changed generator. Same RGB with different profiles remains distinct.
- Fill existing API heights and pinMaterials from the shared committed design. No new endpoints, raw image transfers, physical AMS assignments, brush tools, AI depth/segmentation, project save/load or pin repositioning are introduced.
- Verify both projections, cancellation and history, regeneration and topology confirmations, 10,000-pin editing, fixed/detachable actual heights, profile/color indices, strict lib3mf read-back, backend/frontend tests, typecheck and build. Bambu import/slicing remains user-owned.

## 12. Shape export contract and validation

New clients send optional `layout` with `regions: [{outer, holes}]`, `pins: [{id, x, y}]` and `edgePadding`, all in mm. Heights and material indices follow that pin list. Do not send image bounds, pixels, or row/column parameters. Legacy requests without layout still require rows/columns and use rectangular grid geometry.

The current UI sends empty `holes` arrays: image recognition defines only solid outer silhouettes. The export contract retains explicit holes support for compatibility; the backend validates supplied contours as-is, rather than silently filling or repairing API input. Detachable sockets remain actual blind holes and are unaffected by this silhouette rule.

Shapely independently rejects invalid/overlapping contours, nonfinite values, incorrect dimensions/centering, duplicate IDs, padding/overlap violations, material indices and complexity limits. Do not repair invalid polygons. manifold3d CrossSection extrudes the validated regions and subtracts sockets at actual XY positions. Fixed STL unions connected pins into closed solids, allowing multiple independent regions. Fixed 3MF keeps non-overlapping base/pin material regions and the existing X1C profile. Detachable sockets require 1 mm floor and 0.8 mm walls to neighboring sockets and every outer/hole boundary. Keep all base regions together on plate 1 with original relative positions; pin-only plates start at plate 2. Names and STL manifests include stable IDs, assembled coordinates and total printed lengths.

No SVG import, manual contours, AI cutout, hexagonal layout or automatic bridges. Bambu GUI and physical fit checks remain user-owned. See ADR-018 for architecture and compatibility.
