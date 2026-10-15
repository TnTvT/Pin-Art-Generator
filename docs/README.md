# Product and engineering documentation

Pin Art Studio's product requirements and significant decisions live here.

## Product requirements

- [PRD](PRD.md): current user needs, capabilities, defaults, acceptance criteria, and deferred work.

## Feature plans

- [Per-pin color and height editing](plans/001-pin-editing.md): implemented selection, Set/Offset height, per-pin materials, undo/redo, and export integration plan; accepted in ADR-013.
- [Pin cross-section shapes](plans/002-pin-cross-section-shapes.md): implemented Round/Square/Triangle controls, rotated footprint validation, matching sockets and compatible STL/3MF export; accepted in ADR-020.
- [Pixel image mapping](plans/003-pixel-image-mapping.md): implemented edge-preserving sampling with multiple pins per source pixel/block, independent spacing and preserved image placement; accepted in ADR-022.
- [Per-pin cross-section editing](plans/004-per-pin-cross-section-editing.md): implemented selected-pin shape/rotation overrides, mixed-shape preview, matching sockets and compatible export; accepted in ADR-023.

## Archived experiments

- [Balanced export runtime comparison](spikes/002-export-runtime-comparison.md): browser workers, warm Python/Node exports, live rendering and memory limits; decision is to retain the Python backend.
- [Node.js export feasibility and performance](spikes/001-node-export.md): initial TypeScript/Manifold WASM STL and Bambu 3MF evaluation and measurement snapshot.

The experimental workspace and its dependencies were removed after evaluation. Reports and measurement snapshots remain as historical evidence, not runnable features. Generated files are retained in a local, ignored `spikes/artifacts/` archive; they are not required to run or build the application.

## Accepted decisions

| Record | Topic |
| --- | --- |
| [ADR-001](decisions/001-frontend-stack.md) | React, TypeScript, Mantine, Vite, and direct Three.js integration |
| [ADR-002](decisions/002-pin-geometry-and-preview.md) | Grid geometry, parameter behavior, and instanced rendering |
| [ADR-003](decisions/003-local-image-height-mapping.md) | Local image processing and grayscale-to-height mapping |
| [ADR-004](decisions/004-feature-folders-and-testing.md) | Feature ownership, colocated tests, and verification boundaries |
| [ADR-005](decisions/005-color-schemes.md) | Shared light/dark themes, preference persistence, and in-place scene updates |
| [ADR-006](decisions/006-native-export-backend.md) | Local Python export service, native geometry, validation, and worker isolation |
| [ADR-007](decisions/007-bambu-3mf-compatibility.md) | Standard colors plus Bambu filament/plate metadata without printer presets |
| [ADR-008](decisions/008-detachable-sockets-and-plates.md) | Blind sockets, diametral fit clearance, and multi-plate printing layouts |
| [ADR-009](decisions/009-pnpm-turbo-uv-monorepo.md) | pnpm/Turborepo app orchestration with an independently uv-managed Python service |
| [ADR-010](decisions/010-x1c-profile-and-centered-export-plates.md) | X1C preset identity, centered reusable meshes, and dedicated base/pin plates |
| [ADR-011](decisions/011-bundled-filament-color-catalog.md) | Offline Bambu PLA catalog, source provenance, and preset-first color selection |
| [ADR-012](decisions/012-selected-filament-profiles-in-3mf.md) | Preserve material identity and reference X1C filament presets in 3MF |
| [ADR-013](decisions/013-per-pin-editing.md) | Sparse per-pin overrides, transactional editing, instance selection, and shared export snapshots |
| [ADR-014](decisions/014-direct-pin-interaction-and-outlines.md) | Mode-free click/orbit/Shift gestures, preview editing toolbar, and exterior-only selection outlines |
| [ADR-015](decisions/015-preview-editing-dock-and-preset-defaults.md) | Reserved left preview dock, compact on-demand guidance, RGB counts, yellow contours, and PLA defaults |
| [ADR-016](decisions/016-floating-editor-stable-viewport.md) | Floating editing controls with stable canvas bounds and camera framing |
| [ADR-017](decisions/017-preset-image-color-mapping.md) | Local perceptual preset color matching, bounded palettes, workers and generated material baselines |
| [ADR-018](decisions/018-base-shapes-and-position-layouts.md) | Preset/image contours, explicit XY layouts, atomic generation, socket validation and legacy export compatibility |
| [ADR-019](decisions/019-reusable-edit-inputs-and-generated-groups.md) | Reusable editing drafts and stable, undoable generated-palette group recoloring |
| [ADR-020](decisions/020-pin-cross-section-shapes.md) | Shared pin cross-sections, actual rotated footprints, offset sockets and bounds-aware print packing |
| [ADR-021](decisions/021-image-placement-and-shared-sampling.md) | Mapping-only image translation/zoom, shared sampling and independent 2D adjustment |
| [ADR-022](decisions/022-pixel-image-sampling.md) | Independent Smooth/Pixel sampling, original-Blob nearest resizing, shared raster ownership and unchanged export snapshots |
| [ADR-023](decisions/023-per-pin-cross-section-editing.md) | Transactional selected geometry, canonical mixed instances, validated history/recovery and compatible individual sockets/exports |
| [ADR-024](decisions/024-print-in-place-mechanics.md) | Captive headed pins, tapered guides, true mechanical preview, single-plate exports and a 5,000-pin cap |
| [ADR-025](decisions/025-reference-retention-defaults.md) | Reference-sized radial capture without widening clearance; shared 4 mm default spacing and no mode-based spacing changes |
| [ADR-026](decisions/026-selectable-printer-profiles.md) | Selectable X1C/U1 targets, profile-aware envelopes, offset bed centering and actual material budgets |
| [ADR-027](decisions/027-compact-pin-top-image-grid.md) | Compact pin-top sampling coordinates and original-image adjustment over a pixel-grid background |
| [ADR-028](decisions/028-guide-mouth-release-clearance.md) | Lower 60° tapers with direct surface-gap control; unchanged upper interface and radial capture |

These records document the agreed requirements and implemented demo. They summarize accepted choices and engineering tradeoffs; they do not imply that every alternative was formally evaluated during development.

## Keeping the docs current

- Update the PRD when agreed product behavior or scope changes.
- Add sequentially numbered records for significant new decisions.
- When replacing an accepted decision, add a new record and mark the earlier record as superseded with a link. Keep the earlier record for historical context.
- Keep implementation details and run commands in the root README where possible; link to this folder for requirements and rationale.
