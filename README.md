# Pin Art Studio

A React, TypeScript, Mantine, and Three.js demo for designing a rectangular base and a centered array of cylindrical pins. All dimensions are in millimeters.

## Documentation

- [Product requirements](docs/PRD.md)
- [Architecture and product decisions](docs/README.md)

The root-level `docs/` folder records agreed behavior, defaults, technical rationale, and deferred work. Update the PRD when requirements change and add or supersede decision records for significant design changes.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:4173. Change the parameters to update the model immediately. Drag to rotate, scroll to zoom, and right-drag to pan. Focus the canvas and use arrow keys to pan with the keyboard.

## Build

```sh
npm run build
```

The build includes TypeScript checking.

## Project structure

```text
src/
├── main.tsx
├── app/
│   ├── App.tsx
│   ├── App.test.tsx
│   └── styles.css
├── features/
│   ├── pin-design/
│   │   ├── model.ts
│   │   ├── model.test.ts
│   │   ├── ParameterField.tsx
│   │   └── ParameterField.test.tsx
│   ├── image-mapping/
│   │   ├── image-mapping.ts
│   │   ├── image-mapping.test.ts
│   │   ├── sampling.ts
│   │   ├── sampling.test.ts
│   │   ├── sample-image.ts
│   │   ├── useSourceImage.ts
│   │   ├── useSourceImage.test.ts
│   │   ├── ImageMappingPanel.tsx
│   │   └── ImageMappingPanel.test.tsx
│   └── preview/
│       ├── preview.ts
│       ├── pin-grid.ts
│       ├── pin-grid.test.ts
│       ├── ModelPreview.tsx
│       └── ModelPreview.test.tsx
└── test/
    ├── setup.ts
    └── render.tsx
```

The app composes the feature modules. Pin design owns geometry parameters and layout validation; image mapping owns decoding, sampling, and upload controls; preview owns Three.js rendering and its React integration. Tests live beside the code they verify. Shared test setup and the Mantine render wrapper live in `src/test/`.

## Tests

```sh
npm test
npm run test:watch
```

Vitest and React Testing Library cover grid dimensions and warnings, image aspect fitting and grayscale mapping, file selection, image decode failures and upload races, bitmap/URL cleanup, input validation, slider keyboard interaction, workspace updates, and preview lifecycle and view buttons.

Sampling math and Three.js instance transforms run without a browser GPU. Canvas decoding and WebGL initialization are mocked only at their browser boundaries in integration tests; actual image rendering, WebGL output, and responsive styling still need a browser smoke check.

## Geometry

- Columns run along X, rows along Y, and pins extend along Z.
- Spacing is the distance between pin centers in both directions.
- Extension starts at the top of the base plate.
- The grid remains centered and supports up to 100 columns × 100 rows.
- Empty or invalid inputs retain the last valid model. Out-of-bounds and overlapping arrays remain visible with warnings.

## Image mapping

Upload a PNG, JPG, or WebP (up to 20 MB), or select **Try sample**. Images are decoded and processed locally; nothing is uploaded to a server. Large images are reduced to a maximum 1,024-pixel side for sampling.

The image is centered over the pin grid with its aspect ratio preserved. Transparent pixels and unused margins are white. RGB values are converted to weighted grayscale: dark pixels produce taller pins by default. **Invert mapping** reverses this relationship, including the white margins. Image top maps to positive Y so it reads upright in Top view.

**Min extension** sets the shortest configured height; **Max extension** in the Pin array panel sets the tallest. Actual mapped heights are displayed alongside the source preview. Reducing the maximum below the minimum also reduces the minimum. Invalid inputs keep the last valid mapping. Removing the image returns to uniform heights; resetting parameters keeps the image while restoring the default dimensions, range, and inversion.

Printable mesh export and moving-pin hardware are planned for later versions.
