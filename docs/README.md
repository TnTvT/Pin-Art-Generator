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

These records were written on September 30, 2026, from the agreed requirements and implemented demo. They summarize accepted choices and engineering tradeoffs; they do not imply that every alternative was formally evaluated during development.

## Keeping the docs current

- Update the PRD when agreed product behavior or scope changes.
- Add sequentially numbered records for significant new decisions.
- When replacing an accepted decision, add a new record and mark the earlier record as superseded with a link. Keep the earlier record for historical context.
- Keep implementation details and run commands in the root README where possible; link to this folder for requirements and rationale.
