# Product requirements: Pin Art Studio

**Status:** Current demo baseline

**Last updated:** September 30, 2026

## 1. Purpose

Help a user explore a pin-art design by configuring a rectangular base and cylindrical pin array, viewing it in 3D, and mapping an image to pin heights.

The first audience is the project owner and makers experimenting with pin-art geometry before a future printable-model workflow. Success means users can quickly understand how dimensions, grid density, and image brightness affect the model without using CAD software.

## 2. Scope and delivery stages

| Stage | Capability | Status |
| --- | --- | --- |
| Initial MVP | Parametric base, uniform pin array, interactive 3D preview, English UI | Implemented |
| Image mapping | Local image upload, grayscale heights, range controls, inversion, sample image | Implemented |
| Engineering foundation | Feature folders and automated unit/integration tests | Implemented |
| Future printing workflow | STL/3MF export and physical moving-pin design | Deferred; requirements not defined |

The initial request prioritized a quick demo without tests. A later explicit request added automated testing. That later requirement governs the current project.

## 3. User workflow

1. Open the app and inspect the default uniform pin array.
2. Set base dimensions and the pin grid's counts, spacing, diameter, and extension.
3. Rotate, zoom, pan, or use camera buttons to inspect the geometry.
4. Optionally upload an image or select **Try sample**.
5. Adjust the minimum/maximum extensions and inversion to explore the image relief.
6. Resolve layout warnings by changing dimensions, or continue inspecting the invalid layout.
7. Remove the image to return to uniform heights, or reset design parameters.

## 4. Base and pin requirements

All dimensions use millimeters. Columns run along X, rows along Y, and pin extension runs along Z.

| English control | Default | Behavior |
| --- | --- | --- |
| Base width | 120 mm | Positive X dimension |
| Base depth | 100 mm | Positive Y dimension |
| Base thickness | 3 mm | Positive Z thickness |
| Columns | 20 | Integer from 1 to 100 |
| Rows | 16 | Integer from 1 to 100 |
| Pin spacing | 5 mm | Center-to-center distance, equal in both grid directions |
| Pin diameter | 2 mm | Positive cylindrical diameter |
| Pin extension | 20 mm | Uniform height above the base top; becomes **Max extension** when an image is loaded |
| Min extension | 2 mm | Image-mode minimum; must be positive and no greater than the maximum |
| Invert mapping | Off | In image mode, switches from dark-tall to light-tall |

- Center the entire grid on the base. Changing counts must not silently resize the base or change spacing.
- Update the model immediately on valid input; no generation button is required.
- Retain the last valid value and model while a numeric draft is empty or invalid, and show an input-level explanation.
- Provide numeric inputs for all dimensions; spacing, diameter, and extension also have linked sliders.
- Support up to 100 × 100 pins, or 10,000 total.
- Display **Total pins**, **Grid footprint**, and **Pin clearance**.
- Footprint width is `(columns − 1) × spacing + diameter`; depth is `(rows − 1) × spacing + diameter`.
- Clearance is `spacing − diameter`.
- Show a warning if either footprint dimension exceeds the base, or if multiple pins overlap. Keep the geometry visible so users can inspect it.
- A grid that exactly fits the base is valid. Pins that merely touch have zero clearance and do not trigger an overlap warning.

## 5. Image mapping requirements

- Accept PNG, JPG/JPEG, and WebP files up to the limit displayed as 20 MB (20 × 1,024 × 1,024 bytes).
- Decode and process images locally in the browser. Source images are not uploaded to a service.
- Reject unsupported, oversized, or unreadable files with an English error. An unsuccessful replacement keeps the previous image.
- Provide a source thumbnail, filename, **Replace image**, and **Remove image**.
- Provide a generated sample image through **Try sample** when no image is selected.
- Fit the whole image inside the physical pin-grid footprint, centered and with its original aspect ratio preserved. Do not stretch or crop it.
- Composite transparent pixels and unused margins over white.
- Reduce the decoded image's longest side to at most 1,024 pixels for sampling, preserving its aspect ratio.
- Sample at the current column/row resolution; count and geometry changes regenerate the mapping.
- Convert RGB to weighted grayscale using `0.2126R + 0.7152G + 0.0722B`.
- Default height is `minimum + (1 − brightness / 255) × (maximum − minimum)`. Inversion replaces `1 − brightness / 255` with `brightness / 255`.
- Map image top to positive Y so **Top view** reads upright.
- Display the actual sampled minimum and maximum heights; these may not reach the configured endpoints.
- Lowering the maximum below the current minimum also lowers the minimum. Equal endpoints produce a flat array.
- Inversion also affects white margins and transparent areas, making them tall in light-tall mode.
- Removing an image restores uniform heights using the current extension value.
- **Reset parameters** restores geometry defaults, minimum 2 mm, and inversion off while retaining the source image. Camera changes remain separate from parameter resets.

This is brightness mapping, not inference of an object's physical depth from a photograph.

## 6. Preview and interface requirements

- Use English throughout the product, including labels, instructions, errors, and buttons.
- Use a light, compact interface with image mapping above parameters in the left sidebar and a prominent preview on the right. Stack the panels on narrow screens.
- Base plate and Pin array are independently collapsible accordion groups, initially expanded. Collapsing a group preserves its values and does not alter the preview.
- Show **All dimensions in mm** in the top header; do not add a separate Workspace subheader.
- Distinguish the base from the pins visually and show both the top and side in the initial view.
- Support drag-to-rotate, scroll-to-zoom, right-drag-to-pan, and keyboard panning when the canvas is focused.
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
- Image fitting preserves aspect ratio, including when the physical footprint differs from the row/column ratio.
- Upload failures, replacement races, removal during decoding, and unmount release resources without restoring stale images.
- File-input controls allow reselecting the same image.
- Camera controls, preview updates, and cleanup are covered by integration tests.
- `npm test` and `npm run build` pass for behavior changes.
- Use browser smoke checks for actual image decoding, WebGL rendering, the 10,000-pin case, and responsive layouts. DOM tests do not establish visual correctness or a guaranteed frame rate.

## 8. Current boundaries and future work

- Design state is in memory. Reloading the page resets the design; save/load and persistence are not implemented.
- There is no authentication, backend, or public API.
- The preview represents fixed cylindrical pins on a solid base. Sliding pins, holes, retainers, print clearances, and assembly are not modeled.
- STL/3MF export, manufacturing checks, image cropping, contrast controls, and per-pin manual editing require separate product decisions.
- No deployment provider, rollout process, or physical-printing guarantees have been selected.
