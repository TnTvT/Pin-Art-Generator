# Product and engineering documentation

Pin Art Studio's product requirements and significant decisions live here.

## Product requirements

- [PRD](PRD.md): current user needs, capabilities, defaults, acceptance criteria, and deferred work.

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

These records were written on September 30, 2026, from the agreed requirements and implemented demo. They summarize accepted choices and engineering tradeoffs; they do not imply that every alternative was formally evaluated during development.

## Keeping the docs current

- Update the PRD when agreed product behavior or scope changes.
- Add sequentially numbered records for significant new decisions.
- When replacing an accepted decision, add a new record and mark the earlier record as superseded with a link. Keep the earlier record for historical context.
- Keep implementation details and run commands in the root README where possible; link to this folder for requirements and rationale.
