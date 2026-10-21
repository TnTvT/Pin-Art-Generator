# Product requirements: Pin Art Studio

**Status:** Current product baseline

**Last updated:** October 19, 2026

## 1. Purpose

Help a user explore a pin-art design by configuring a preset or image-derived base with automatically positioned round, square or triangular pins, viewing it in 3D, and mapping an image to pin heights and preset filament colors.

The audience is makers exploring printable pin-art geometry without CAD software. Success means users can understand how dimensions, grid density, image brightness and material selection affect the preview and exported models.

## 2. Scope and delivery stages

| Stage | Capability | Status |
| --- | --- | --- |
| Initial MVP | Parametric base, uniform pin array, interactive 3D preview, English UI | Implemented |
| Image mapping | Local upload, Height / Color / Height + Color, Smooth / Pixel sampling, preset palettes, range controls, inversion and manual image placement | Implemented |
| Engineering foundation | Feature folders and automated unit/integration tests | Implemented |
| Monorepo tooling | pnpm/Turborepo orchestration and uv-managed Python backend | Implemented |
| Appearance | Light/dark themes with a locally saved preference | Implemented |
| Model downloads | STL, X1C/U1 colored 3MF, Fixed sculpture and Print-in-place | Implemented; slicer GUI/physical fit verification is user-owned |
| Per-pin editing | Selection, Set/Offset heights, materials, shape/rotation overrides, transactional drag and undo/redo | Implemented |
| Base shapes | Rectangle, rounded rectangle, circle, ellipse, solid image silhouettes/disconnected regions and automatic layout | Implemented |
| Moving-pin hardware | Captive sliding pins, through-guide base, retaining heads and true preview | Implemented; physical fit verification is user-owned |

Automated tests cover geometry, mapping, editing and export behavior. Slicer compatibility and physical fit remain user-verified.

## 3. User workflow

1. Open the app and inspect the default uniform pin array.
2. Choose a preset or image-derived contour. Set dimensions, edge padding, pin shape, size, rotation, spacing, generated extension and construction mode.
3. Rotate, zoom, pan, or use camera buttons to inspect the geometry.
4. Optionally upload an image or select **Try sample**.
5. Use **Adjust image** to align and zoom the original image over a compact pin-top grid without physical gaps. Adjust the height range, inversion and palette to explore the relief.
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
| Edge padding | 5 mm | Minimum outer-boundary gap from shaft (Fixed) or retaining head (Print-in-place); nonnegative |
| Pin spacing | 4 mm | Equal X/Y center spacing, never adjusted automatically |
| Pin shape | Round | Generation default: Round, Square, or equilateral Triangle; selected pins can override it |
| Pin size | 2 mm | Positive circumscribed diameter; square diagonal, triangle circumdiameter |
| Pin rotation | 0° | Polygon-only numeric input/slider, 0–360° counterclockwise around +Z; round remembers but ignores it |
| Generated pin extension | 20 mm | Base top to pin top including the Print-in-place head; not total length or travel |
| Map image to pins | On | Off allows image-only base shaping without height/color generation |
| Min height / Max height | 10 / 20 mm | One dual-thumb Height range with linked positive, ordered inputs |
| Invert mapping | Off | Height only: dark-tall vs light-tall |

- Generate lattice coordinates at integer multiples of spacing from the base center; sort actual pins by Y then X. Stable IDs encode integer grid coordinates.
- Keep only complete actual rotated pin footprints inside solid outer silhouettes with the specified padding. Test crossings and enclosed holes in compatible explicit API layouts, not just vertices. Enclosed image gaps are not cutouts and can contain pins. Padding never expands a base or adds connecting borders.
- Square at 0° has sides parallel to X/Y; triangle has a vertex toward +Y. Square side is size / √2; triangle side is √3 × size / 2. Show dimensions/orientation help in an info popup. Normalize full-turn geometry/export to 0°.
- Show actual rotated footprint bounds and the minimum physical wall gap, including diagonal neighbors; show no gap for a lone pin. Permit overlapping previews with warnings but block export. Preserve edits, selection and history only when pin IDs/coordinates stay unchanged; otherwise use the existing confirmation flow.
- Curved presets use 64-point polygon approximations, with only duplicate/collinear points removed. Preview and export use identical regions.
- Maximum 5,000 actual pins, 1,000,000 candidate positions and 20,000 total contour vertices. Empty or excessive layouts fail visibly without truncation.
- Numeric drafts retain valid input; complete but invalid shape settings retain the applied design and block export. Never silently substitute a rectangular base.
- Show Total pins, actual Pin footprint and minimum wall clearance using the resolved shapes/angles of each pin.
- Actual footprint overlap can be inspected in generated previews with a warning but cannot be exported; geometry editing requires a valid non-overlapping candidate.
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
- Center physical lattice coordinates around their bounding-box center and scale by `cell size / spacing` for image sampling. Cell size uses the nominal pin-top envelope: Pin size in Fixed, Pin size plus twice Head flare in Print-in-place. Per-pin shape/rotation does not repack this shared square grid. Keep pin IDs/order and missing lattice positions; do not compress missing rows or holes. Physical positions are unchanged.
- Default placement contains the full image centered inside the compact grid's bounding rectangle. Image bases contain their foreground bounds in that rectangle, independently of contour extraction. Preserve aspect ratio and positive-Y orientation.
- **Adjust image** shows **Original image** on the left over a pixel-grid background, with contrasting grid lines above opaque images, and live **Mapped samples** on the right. Both share framing and placement; only the original panel accepts gestures/keyboard input. Stack panels on narrow screens. Samples show per-pin RGB before filament matching/manual edits. Show the compressed base outline as a reference, not the physical printing layout. **Show pin shapes** adds top outlines to both panels at compact centers; it defaults off and does not modify placement or generation. Missing pin cells stay blank. Use the same prepared Smooth/Pixel raster, with the source faded outside the compact cells. Preparation and sampling failures show retryable errors rather than stale content. Drag the left panel to translate; wheel zoom there anchors at the cursor. Provide a shared 10–400% zoom slider and numeric Zoom / Offset X / Offset Y controls; numeric zoom preserves translation. Offsets and arrow keys use compact-grid mm, not physical-model distances. Arrow keys move 1 mm (Shift: 5 mm), and +/− zoom. Escape, pointer cancellation or focus loss restores the start of an active drag. Closing keeps live changes; explain these distinctions through the info popup.
- Strengthen the original preview's grid with dark lines and light outlines for visibility on both light and dark pixels. Provide **Image opacity** below the original preview: 0–100%, 5% steps, default 100% on dialog opening. This display-only setting does not resample, change placement, fade the right-hand samples or affect heights/materials/downloads; it remains available when design editing is blocked.
- **Center image** resets translation only; **Fit image** and **Reset** restore centered contain in the compact grid at zero offsets and 100%. Incomplete/invalid numeric drafts keep the last valid placement.
- Image placement affects height/color sampling only, not contour extraction, dimensions, padding, positions or pin count, including From image. Both outputs use the same transform; manual overrides, selection and edit history survive. Updates retain cancellation, atomic validation/publication and export blocking. Do not count placement as pin-edit undo history.
- Reset placement on successful image replacement/removal, not failed uploads, mode changes or Reset parameters. Cancelling a layout change restores the applied source and placement together. Disable adjustment for contour-only mapping or during a pin-height drag. Placement stays in session memory; the export contract continues to send only resolved geometry/heights/materials, not images or placement settings.
- Composite transparent pixels and unused margins over white.
- Reduce the decoded image's longest side to at most 1,024 pixels for sampling, preserving its aspect ratio.
- Offer **Sampling: Smooth / Pixel**, default Smooth, independently of the three mapping modes. Smooth retains bilinear RGBA interpolation; Pixel reads the containing raster pixel at compact pin-top coordinates without blending neighbors. Multiple pins may share a source pixel or enlarged pixel-art block; physical gaps are excluded from mapping. Never enforce one pin per pixel, collapse missing positions, or automatically change physical spacing, size, shape or count. Both outputs share the same sampled RGBA and placement transform. Invalidate mapping reuse when size, spacing or construction/head flare changes, even if physical positions are unchanged.
- For oversized images, retain the original local Blob and lazily prepare/cache a separate Pixel raster using nearest resizing to the canonical raster's exact capped dimensions. Keep the Smooth/contour raster and source identity unchanged; sampling switches must not change image-derived outlines or pin positions. Release owned rasters on replacement/removal/unmount while preserving accepted-source rollback. The adjustment dialog displays the matching processing raster, labeled with the active sampling mode; Pixel disables visual interpolation.
- Preserve manual height/material overrides, selection, edit drafts, history and placement when changing sampling. Regenerate generated groups, not overrides. Keep atomic validation, stale-result suppression, retry and last-valid preview/export blocking during raster preparation and mapping. Sampling preferences survive image replacement and Reset parameters, but are not persisted across reloads or sent to the exporter. Explain density, downsizing and JPEG limitations through an info popup, not a permanent block.
- Convert RGB to weighted grayscale using `0.2126R + 0.7152G + 0.0722B`.
- Default height is `minimum + (1 − brightness / 255) × (maximum − minimum)`. Inversion replaces `1 − brightness / 255` with `brightness / 255`.
- Map image top to positive Y so **Top view** reads upright.
- Offer **Height** (default), **Color**, and **Height + Color**. Share the sampled pixels and row orientation between both outputs. Color-only generation uses uniform heights; height-only generation uses the default pin preset. Manual overrides remain higher priority.
- Match colors to the bundled Basic/Matte presets with Color.js Lab conversion and ΔE2000; never generate custom colors. Deduplicate identical RGB + profile candidates, but keep same-RGB Basic/Matte distinct. Resolve equal distances by Basic first, then product code and ID.
- Source the offline presets from the pinned MIT-licensed bambu-filaments catalog, retaining its license and provenance. Include 31 opaque single-color Basic and 25 Matte products, deduplicated by family and product code. Use product-based IDs, never restricted-source record IDs; derive RGB from hex. Default Gray and Turquoise, custom fallback and exported profile assignments remain unchanged.
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
- **Reset parameters** restores geometry defaults, minimum 10 mm, and inversion off while retaining the source image. Camera changes remain separate from parameter resets.

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
- Use browser smoke checks for actual image decoding, WebGL rendering, the 5,000-pin case, and responsive layouts. DOM tests do not establish visual correctness or a guaranteed frame rate.

### Base-shape verification — October 4, 2026

- 218 frontend tests and 210 backend tests pass; the frontend production build includes a passing TypeScript check. Strict lib3mf reads validate shape exports, including explicit API holes, independent regions, materials and plate assignments. Silhouette regression tests cover filled interior gaps, nested islands and both transparency/background detection; browser verification confirms a solid base with original-pixel height mapping.
- Browser checks cover all four presets, real transparent/background-color uploads, linked dimensions, combined mapping, contour-only images, missing-image recovery, stable-ID picking, top-view height dragging/undo, layout-change cancellation, fixed/detachable downloads, both themes and a 390 × 844 viewport without horizontal overflow. The desktop preview remains fixed while controls scroll. Fresh runtime logs contain no errors or warnings.
Historical measurements before the October 6 reduction to a 5,000-pin cap:

- An exact 10,000-pin image layout remained editable: shape/layout generation measured 113 ms, cached height mapping 8 ms and combined height/color generation 66 ms locally. These include the generation pipeline, not guaranteed frame rates or full upload/decode latency.
- A two-region 10,000-pin fixed 3MF request measured 452,890 JSON bytes, 0.21 s native validation and 1.19 s native export, with approximately 146 MiB peak process RSS and a 337 KB package. The local HTTP result also passed strict lib3mf read-back with zero warnings. Timing and memory are workload-specific; dense socket/STL workloads remain more expensive. Bambu GUI/slicing and physical printing are not verified here.

### Print-in-place verification — October 6, 2026

The current cap is **5,000 pins**, including legacy grids and every per-pin request array. Frontend generation rejects excessive layouts without truncation and retains the last applied design with editing/export blocked. API tests cover 5,001-element arrays and excessive legacy grids.

Local native benchmarks used round pins, 3 mm bases and 20 mm extensions:

| Pins | Base / pin size / spacing (mm) | Validation | 3MF generation / size | STL generation / size |
| --- | --- | --- | --- | --- |
| 775 | 120 × 100 / 2 / 3.5 | 0.13 s | 3.74 s / 3.86 MiB | 1.64 s / 37.99 MiB |
| 5,000 | 245 × 128 / 0.8 / 2.35 | 0.83 s | 40.83 s / 25.68 MiB | 20.53 s / 245.10 MiB |

These are local direct-export measurements, not HTTP latency or guarantees. Both 3MF packages passed strict lib3mf read-back with zero warnings. The benchmark process high-water RSS reached 2,394 MiB after the 5,000-pin 3MF generation and 4,732 MiB after subsequent read-back/STL work; the latter includes retained native read-back data and earlier exports, **not an isolated STL peak**. Dense models remain memory-intensive despite the reduced cap; the 120-second isolated export timeout is unchanged.

Browser checks exercised a 4,949-pin print-in-place design and Select all. Increasing it to 5,151 candidates produced the 5,000-pin error, retained the valid preview, and disabled exports. Small mixed-shape models verified real guide holes/heads, picking, extension rejection, transparency, Top view, theme/narrow layout and successful STL/3MF downloads. Shared fixtures and Boolean-reference tests verify frontend/backend profiles, volumes, closed solids and ideal travel/contact. Bambu slicing and physical release/fit remain unverified and user-owned.


## 8. Current boundaries and future work

- Design state is in memory. Reloading the page resets the design; design save/load and persistence are not implemented. The appearance preference is saved locally.
- A local Python backend handles model downloads; there is no authentication, design database, or public hosting.
- Construction mode controls the assembled preview and downloads together. Print-in-place shows real guide holes, clearances and retaining heads; Transparent base is display-only. No motion slider, pressing simulation, locks, springs or print-success guarantee.
- Offer Bambu Lab PLA Basic and Matte presets before a Custom color fallback for both the base and pins. Bundle the catalog locally with brand, material, type, color name, product code, hex, RGB, source links, and snapshot date. Retain provenance in the catalog and documentation, without a catalog reference/date disclaimer or family source links in the export panel footer. Preserve distinct records with identical RGB values, and let users search names, codes, families, and hex values. Keep Custom color available for an unmatched search.
- The editor displays preset material/type and RGB. Apply material commits selected-pin colors; base selection commits independently. Retain catalog identity in application state and export Basic/Matte as the corresponding X1C system filament preset. Custom color offers swatches, a color picker, and hex entry, preserving the last valid color for incomplete drafts; it explicitly clears catalog identity and uses Generic PLA for 3MF, even when RGB is unchanged. Preserve selections through theme changes. Submitted exports are immutable snapshots; downloads are disabled during transient height drags. Do not assign physical AMS slots; reference RGB values are not calibrated printed-color promises.
- Image cropping, contrast controls, mixed-filament dithering, and calibrated manufacturing guarantees require separate product decisions.
- No deployment provider, rollout process, or physical-printing guarantees have been selected.

## 9. Printable models and colors

- Keep independent base and selected-pin material controls. Default to PLA Basic Gray (10103, #8E9089) and Turquoise (10605, #00B1B7), preserving official profile identity. Theme changes never recolor printable parts.
- Construction under Parameters offers Fixed sculpture (default) and Print-in-place. It controls geometry generation, preview and export, not just downloading. Snapshot committed contour, positions, extensions, geometry and materials; never upload images.
- Fixed STL is a watertight Boolean union; fixed 3MF retains adjacent non-overlapping material regions in one assembly. Reject tangent fixed STL without silent repairs.
- Print-in-place outputs independent closed guide-base/pin solids, with initial pin bottoms at Z = 0. Preserve assembly transforms, per-pin material and rotation; never independently re-ground pins.
- Return one STL or one single-plate 3MF targeting the selected printer's slicer. Remove Detachable, blind sockets, insertion depth, plate dimensions/packing, multi-plate downloads and STL ZIP manifests.
- Retain the X1C 0.4 nozzle / 0.20mm Standard profile, official Basic/Matte or Generic PLA identities, colors, logical filament routing and one-based material assignments. Compact actual RGB + profile pairs, not RGB alone; at most 16 including the base. Reuse identical geometry/material resources.
- Print export offers X1C · 0.4 mm (default) and Snapmaker U1 · 0.4 mm. Selection affects only 3MF validation, target preset references and bed placement, never design geometry/mapping. Keep selection across theme/design updates and disable changes while a download is generating.
- X1C retains its current 256 × 256 × 250 mm envelope and official material profiles. U1 targets Snapmaker Orca's official machine/0.20mm Standard process, with a 270 × 270 mm bed and conservative 270 mm height limit. Reference installed system presets rather than embedding printer G-code or imposing temperature overrides. U1 Basic/Matte project materials inherit Generic PLA @System and retain family/vendor/colors; do not represent them as official U1-tuned Bambu filament presets.
- Print-in-place 3MF requires 5 mm margins: 246 × 246 mm usable on X1C or 260 × 260 mm on U1. Fixed uses the full selected envelope. Center U1 assemblies at X=135.5, Y=136 mm accounting for the official bed origin; preserve all assembled Z coordinates. STL remains printer-independent.
- Count actual RGB + profile pairs including the base: at most 16 on X1C, 4 on U1. Deduplicate identical pairs and ignore unused palette entries. Reject excess U1 3MF materials with actionable feedback in frontend/backend; do not alter the design, disable STL, substitute materials, blend colors or assign physical toolheads. Display used/available material counts.
- Show generating/error/retry/single-plate feedback; prevent duplicate downloads and release object URLs. Numeric incomplete drafts use last valid dimensions. Invalid generation blocks export while retaining the previous applied preview.
- Cap actual pins and all per-pin arrays at 5,000, requests at 2 MB, and isolated single-worker exports at 120 seconds; clean up on failure, cancellation or timeout. Do not silently truncate arrays or reduce complexity.
- Include JSON and geometry validation in the worker deadline. Bound upload time to 10 seconds, file transmission to 30 seconds and artifacts to 256 MiB. Keep admission occupied through transmission and clean up on disconnect, including cancellation during process creation.
- Apply a process-local, all-user rolling limit of 6 admitted attempts per 60 seconds; invalid requests count, busy responses do not. Return structured 429/503 with Retry-After and show the delay without automatic resubmission. The window resets on restart and is not a distributed/user-specific or billing safeguard.
- Keep one native export while allowing bounded concurrent HTTP requests for the UI, health and early busy rejection. Busy feedback must state that the request is not queued. Add a no-store `GET /api/exports/status` returning only availability and a conservative remaining-time estimate derived from upload/generation/download deadlines, never private design/job details. Include the additive estimate fields in busy 503 responses; label them approximate, not progress or a guaranteed finish. Poll status every five seconds, timeout stalled checks after eight seconds, stop on idle/dismiss/unmount, and require manual retry of the current committed snapshot. Reaching zero must not imply availability or trigger another export. Keep the shared attempt limit and remaining memory/timeout protections unchanged.
- On Linux, sample child RSS every 50 ms and terminate observed usage above 6 GiB with a readable EXPORT_MEMORY_LIMIT error. Retain platform memory sizing as the final boundary; sampled RSS cannot guarantee the absence of short allocation spikes. Log only aggregate export duration, format, mode, count, bytes and worker peak RSS, not uploaded design snapshots.
- Strict lib3mf read-back, geometry/transform/material tests and live browser checks are required. Bambu import/slicing and physical fit are verified by the user, not controlled automatically.

### Print-in-place mechanics

- On entry from Fixed to Print-in-place, raise Pin spacing only when below the conservative minimum derived from shared pin size and current mechanical settings, rounded up to 0.1 mm. Preserve larger spacing and all other parameters; returning to Fixed never shrinks spacing. Position changes still require confirmation when manual pin edits exist; cancellation restores mode, spacing and edits. Do not auto-correct subsequent manual spacing or advanced-setting changes: surface validation failures beside Construction, not as image-mapping failures. State explicitly that the preview is the last valid design and offer a user-triggered safe-spacing suggestion. Keep the pending Rectangle/Rounded rectangle/Circle/Ellipse choice and regenerate after correction. Spacing failures expose typed recovery information rather than deriving actions by parsing error messages.

- Offer Round and Square in Print-in-place, including per-pin rotation; keep Triangle available in Fixed sculpture. Hide Triangle in both shape selectors while movable mode is active. Block switching designs with default or edited Triangle pins until users explicitly change them; do not auto-convert. Reject cached Triangle drafts/history and frontend export attempts in movable mode. Retain the native Triangle geometry/API compatibility path for legacy clients rather than deleting it. Advanced settings default to total Sliding clearance 0.6 mm, Head flare 0.7 mm (outward offset), Lower taper angle 45° from the horizontal print bed, and Lower head surface gap 0.3 mm (shortest lower head/mouth slope separation at the initial position). Keep lower surface separation independent of shaft clearance. Widen the shaft guide and derived upper mouth with clearance; use the selected flare for both heads, retaining the upper 45° angle and initial Z bounds. Ideal radial capture remains 0.4 mm by increasing head flare to 0.7 mm alongside 0.6 mm total shaft clearance. Default Fixed spacing is 4 mm, with 621 pins in the default rectangle. Entering Print-in-place automatically raises insufficient spacing: default mechanics use 4.5 mm for 2 mm pins, 5 mm for 2.5 mm pins and 5.5 mm for 3 mm pins. Preserve already larger values. Larger/rotated pins must still satisfy validation.
- Extension E is base top to pin top including the upper head in its initial position, not total length or travel. Total pin length = B + E. UI uses Generated pin extension, Set extension and Offset extension; mapping/editor info popups define the measurement.
- Shaft uses actual cross-section; rounded outward offsets define heads (+h), guide (+c), lower mouth (+h+d) and upper mouth (+c+h). For requested angle θ and shortest lower surface gap g, d = g × sqrt(q⁻² + cot²θ), q = cos(π/63), accounting conservatively for the largest rounded profile facet. Lower head height = h × tanθ; lower mouth height L = (h+d−c) × tanθ. Upper head/mouth height remains h. Round uses 64 segments. Preview and export share the same dimension rules.
- Require finite positive dimensions and gap, 0° < θ < 90°, h−c ≥ 0.2 mm, B−L−h ≥ 1 mm, E ≥ 2h and a positive shaft length between head tapers. Guide walls/edges ≥ 0.8 mm, both upper/lower mouth walls/edges ≥ 0.2 mm and adjacent head gaps ≥ 0.2 mm. Warn when mouth lips are below 0.8 mm. Reject conflicting angle/gap settings without resizing, deleting pins or changing spacing. Test actual lower triangle-surface distances, including serialized meshes; do not equate horizontal clearance with slope separation.
- Edge padding measures from retaining head outer walls. Derive mechanical holes without changing user contours or image sampling. Never resize dimensions, change spacing or remove conflict pins to make an edit valid.
- Validate complete height/shape/rotation edits and history replays atomically, against current mechanics and generated baselines. Keep position-change confirmation and preserve valid edits when actual IDs/XY are unchanged.
- Show a nonblocking tilt advisory when actual straight guide length (B minus both tapered mouth heights) is less than the shared Pin size. Display guide length, pin size and total shaft clearance; suggest increasing Base thickness without changing successful release gaps. This is a documented one-size UX heuristic, not a tilt-angle prediction, print rejection threshold or guarantee that longer guides eliminate play. Explain the calculation and limitations in Construction help. Recompute from the applied design, retain the independent thin-mouth warning, and do not change geometry or export eligibility.
- Build actual perforated/tapered plate geometry in a cancellable worker and publish construction/layout/mapping/mechanics together. Failures retain the applied design; pending generation blocks edits/downloads.
- Render at most nine printable instance groups (three shapes × shaft/lower/upper heads), keeping retaining head dimensions independent of extension scaling. Picking, colors and outline masks use canonical pin indices.
- Transparent base affects appearance only and survives camera/theme changes. Fit model includes complete head bounds. Keep the fixed canvas, scrolling sidebar and floating toolbar.
- Ideal fixed-orientation travel −E−c to +d × tanθ is checked geometrically, with contact beyond the endpoints; add no motion UI. The surface-gap target applies only to the lower slopes at the initial printing position, not every pin/base surface. Clearance requires a fit sample and is not a universal release, smooth-motion or position-holding guarantee. Keep slicer supports/brims/purge structures out of gaps. No automatic supports, locks, springs or manufacturing guarantee.

## 10. Engineering workspace

- Keep the React/TypeScript application in `apps/web` and the Python export service in `apps/api`, retaining feature ownership and colocated tests.
- Use pnpm workspaces for JavaScript dependencies, uv for Python dependencies/interpreter/environment, and Turborepo for root development/build/test commands. Commit both dependency lockfiles.
- Keep current product requirements and user documentation in root-level `docs/`.
- Preserve the same-origin `/api` contract and local ports during the migration; do not change geometry, preview, or download behavior merely to reorganize files.
- Avoid speculative shared packages or a Python workspace until multiple real consumers require them.

## 11. Per-pin editing

- Keep generation and export in the independently scrollable sidebar. Float a fixed-width editing toolbar over the upper-left of the preview, with Height, Material and Shape panels beside it. The canvas occupies the full viewport; opening, switching or closing editing panels must not resize it, change projection, or refit the camera. Floating panels may overlap geometry. Keep the base material under Base plate. At 900px and narrower, float a compact tool row at the canvas bottom and use a bottom editing sheet over generation; small screens move history and Clear selection into the more menu.
- Maximize canvas space with compact preview headings, status and measurement strips, without decorative footer copy. Put explanatory preview, image, grid, height, material and export guidance behind labeled info icons with keyboard-accessible popups. Keep errors, export blockers and memory warnings directly visible. Escape dismisses nested controls before the editor and closing fields restores trigger focus.
- Display distinct selected-pin RGB color counts and swatches, plus design-wide color counts including the base. Design swatches reveal hex, RGB, actual selected filament names/codes and families, and base/pin usage through hover or keyboard-focus tooltips. Normalize hex case; identical RGB from different filament profiles counts as one displayed color, not one export material, and its tooltip lists all used identities without inferring a preset from RGB alone.
- Both views support direct click selection, Shift-click toggling, Shift-drag additive projected-tip marquee, all and clear selection, without Navigate/Select modes. An ordinary drag anywhere on the model or background rotates the camera and never changes selection, even if the pointer returns to its starting position. Empty clicks clear selection unless Shift is held. Scroll zooms; right-drag pans; height handles exclusively own height drags. Marquees include occluded pins but exclude tips outside the viewport or behind the camera.
- Preserve selection across view/theme changes. Show selected count, single-pin stable ID and X/Y coordinates, and Mixed heights/materials. Highlight only exterior contours in yellow (#FFD43B) using an isolated instanced selection mask and a screen-space edge overlay. Do not fill/tint pin surfaces, change printable instance colors, or switch the main scene's color-processing pipeline when selecting pins. Outline rendering supports both projections and theme changes; selected silhouettes can be visible through occluding geometry.
- Set extension assigns one absolute value; Offset adds a signed amount while preserving differences. Apply/Enter commits a numeric batch; reject any nonpositive, nonfinite or unrepresentable result without changing any pins.
- Shape changes one, multiple or all selected pins to Round, Square or Triangle and a finite 0–360° rotation. Mixed shape/angle needs explicit input; cache the reusable draft across selections, with Use selected shape to reload actual values. Round resolves to 0°, without erasing the cached polygon angle. Size remains shared. Reject invalid whole-design containment/padding/overlap atomically; keep positions, heights, materials, mapping and camera unchanged.
- Store a complete shape/angle override separately from height/material overrides. Applying the current default remains an explicit override until Restore default shape removes it. Reset all edits removes every override, including geometry. Undo/redo validates geometry against the latest committed dimensions, defaults, positions and padding; reject invalid replay/reset without moving the history cursor or partially changing pins.
- Same-position generation validates retained geometry before publication. A conflict retains the applied snapshot and blocks exports, but permits corrective editing, Undo and restoration against that snapshot; retry the requested settings after correction. Actual topology changes still require confirmation and clear all pin edits when accepted. Render at most three printable instance groups in Fixed and nine shaft/head groups in Print-in-place, with canonical pin identity and yellow outline masks across groups; both 2D overlays show actual per-pin shapes.
- Remember separate Set/Offset numeric drafts and the last chosen material across selections, clearing selection, editor reopening and history changes, for the current page session only. Changing selection never applies cached values automatically. Keep actual/Mixed values in the selection summary; Use selected height/material explicitly reloads current selection values. Draft changes do not enter edit history.
- Perspective height dragging uses a camera-facing plane containing the active pin's world-Z line. Top view uses vertical screen displacement scaled to orthographic mm. Show live mm; compute against starting heights; release commits once. Escape, pointer cancellation, blur or view changes restore the original committed heights. Invalid drag updates retain the last valid transient batch. Block export until release/cancellation.
- Keep generated heights/materials separate from sparse position-indexed pin overrides. Image regeneration/removal and mapping mode changes preserve overrides. Geometry adjustments preserve them only when actual ID/XY positions remain unchanged. Restore generated heights/colors removes selected overrides and resolves the latest image generator, or defaults when absent. Reset all retains mapping settings and resets the base to its default.
- Actual ID/XY changes with pin edits require confirmation. Acceptance clears pin edits, selection and history but retains base material; cancellation restores applied shape settings and source image. Reset all edits is confirmed and undoable.
- History covers heights, materials, shape/rotation and resets, not selection/navigation/generation. Keep at most 50 transactions and 16 MiB of encoded sparse deltas; discard the oldest records first. New edits clear redo. Ignore undo shortcuts in text fields/dialogs.
- Preserve color and catalog identity per pin. Compact the actually used RGB + filament-profile pairs for export, including the base, with at most 16 slots. Reject a seventeenth material even if introduced by restoring colors, undo or redo against a changed generator. Same RGB with different profiles remains distinct.
- Fill existing API heights and pinMaterials from the shared committed design. No new endpoints, raw image transfers, physical AMS assignments, brush tools, AI depth/segmentation, project save/load or pin repositioning are introduced.
- Verify both projections, cancellation and history, regeneration and topology confirmations, 5,000-pin editing, fixed/print-in-place actual extensions, profile/color indices, strict lib3mf read-back, backend/frontend tests, typecheck and build. Bambu import/slicing remains user-owned.

## 12. Shape export contract and validation

Keep `POST /api/exports`; accept `mode: fixed | print-in-place` and optional `sliding: {clearance, headFlare, lowerHeadAngle, lowerHeadGap}`, default 0.6 mm / 0.7 mm / 45° / 0.3 mm. Omitted angle/gap use these defaults. Replace the unreleased headRelief experiment with direct surface-gap control. Explicit dimensions remain subject to validation. Unknown fields and removed mode/fields `detachable`, `socket` and `plate` return readable structured 422 errors; no silent conversion.

Optional `layout` sends regions (outer/holes), ordered stable pin IDs/XY and edgePadding in mm. Heights/materials/geometry follow the actual pin list. New clients omit rows/columns; legacy rectangular requests retain rows/columns within the same 5,000-pin cap. Omitted per-pin geometry inherits global Round/0 defaults; complete arrays retain shapes/rotations. `diameter` remains shared circumscribed size. Keep colors, profile keys and existing material semantics.

UI image bases define solid external silhouettes; explicit API holes remain supported. Mechanical guide holes are derived separately and do not change sampling/contour detection.

Shapely independently rejects invalid/overlapping contours, nonfinite values, mismatched dimensions, duplicate IDs, boundary/padding violations, neighbor conflicts, material indices and complexity limits; no automatic polygon repairs. Native triangulation and ring-wall meshes produce guide bases efficiently; Boolean-reference and shared TypeScript/Python fixtures verify parity. Fixed STL unions pins/base; Print-in-place STL composes independent shells. 3MF retains material regions, names, compensated reuse transforms and centered initial assembly placement on one plate. Names contain stable ID, assembly XY, extension and shape/rotation.

No SVG/manual contours, AI cutout, hexagonal layout, automatic bridges or mechanical simulation.
