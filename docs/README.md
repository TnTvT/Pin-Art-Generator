# Product and engineering documentation

Pin Art Studio's product requirements and significant decisions live here.

## Product requirements

- [PRD](PRD.md): current user needs, capabilities, defaults, acceptance criteria, and deferred work.

## Feature plans

- [Per-pin color and height editing](plans/001-pin-editing.md): implemented selection, Set/Offset height, per-pin materials, undo/redo, and export integration plan; accepted in ADR-013.

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

These records document the agreed requirements and implemented demo. They summarize accepted choices and engineering tradeoffs; they do not imply that every alternative was formally evaluated during development.

## Keeping the docs current

- Update the PRD when agreed product behavior or scope changes.
- Add sequentially numbered records for significant new decisions.
- When replacing an accepted decision, add a new record and mark the earlier record as superseded with a link. Keep the earlier record for historical context.
- Keep implementation details and run commands in the root README where possible; link to this folder for requirements and rationale.
