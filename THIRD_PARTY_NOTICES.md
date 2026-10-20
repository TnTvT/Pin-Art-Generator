# Third-party notices and reference sources

The project's MIT License applies to project-authored code and documentation. It does not change third-party licenses or grant rights in third-party datasets, preset materials, names or trademarks. Attribution alone is not a redistribution permission. This file is provenance information, not a completed legal review or an exhaustive dependency-license inventory.

## Dependencies

JavaScript packages are identified by `package.json`, workspace manifests and `pnpm-lock.yaml`; Python packages are identified by `apps/api/pyproject.toml` and `apps/api/uv.lock`. They retain their own licenses and notices. Preserve the license files supplied with dependencies in any distribution. Major components include React, Mantine, Three.js, Color.js, d3-contour, RBush, FastAPI, Pydantic, Uvicorn, lib3mf, manifold3d, NumPy and Shapely.

## Filament reference catalog

The current `apps/web/src/features/filaments/data/bambu-pla.ts` catalog is independently selected from [piitaya/bambu-filaments](https://github.com/piitaya/bambu-filaments) at commit `73cf0567028942e2ea9962371fc033511aac2ed7`, retrieved October 19, 2026. That repository publishes its catalog under the [MIT License](https://github.com/piitaya/bambu-filaments/blob/73cf0567028942e2ea9962371fc033511aac2ed7/LICENSE), copyright (c) 2026 Paul Bottein. Its complete license and copyright notice are preserved in [the bundled license](apps/web/public/licenses/bambu-filaments-MIT.txt), also served at `/licenses/bambu-filaments-MIT.txt` by the web application.

- [Pinned source data](https://github.com/piitaya/bambu-filaments/blob/73cf0567028942e2ea9962371fc033511aac2ed7/filaments.json).
- `fixtures/filaments/bambu-pla-source.json` preserves the source's Basic/Matte records, including RFID variants, for offline verification; the same upstream MIT notice applies to this fixture.
- `apps/web/src/features/filaments/data/bambu-pla.provenance.json` records the source revision, selection policy and SHA-256 hashes. The upstream README identifies RFID tag data, Bambu Studio and SpoolmanDB as its sources; this project does not claim to have measured the colors or verified every upstream contributor's rights.

The application retains only opaque, single-color PLA Basic and PLA Matte entries, merges RFID variants with the same family and product code, and uses product-based identities. There are 31 Basic and 25 Matte entries. RGB is calculated from the source hex values. Gradient/multi-color and translucent entries are excluded rather than represented by one misleading color. Reference colors are not calibrated printed-color measurements or availability guarantees.

This replaces the previous restricted-source catalog; the replacement does not license earlier snapshots retained in Git history. Review historical content separately before redistributing that history. Product names and trademarks remain their owners' property; the upstream MIT grant does not imply vendor endorsement.

## Printer and slicer interoperability references

The export service writes standard 3MF data with compatibility metadata and installed-preset references. These sources document preset identifiers, machine envelopes and package conventions; the application does not bundle a slicer binary or claim an upstream slicer generated its files.

- [Bambu Studio source and license](https://github.com/bambulab/BambuStudio), including its [3MF format implementation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).
- Bambu system filament references: [PLA Basic X1C](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/Bambu%20PLA%20Basic%20%40BBL%20X1C.json) and [PLA Matte X1C](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/Bambu%20PLA%20Matte%20%40BBL%20X1C.json).
- Snapmaker Orca profile references at commit `441f73cc8d91d84f574a9d910e84fb8eeb099cf5`: [U1 machine](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/machine/Snapmaker%20U1%20%280.4%20nozzle%29.json), [machine parent](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/machine/fdm_U1.json), [process](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/process/0.20mm%20Standard%20%40Snapmaker%20U1%20%280.4%20nozzle%29.json) and [Generic PLA parent](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/OrcaFilamentLibrary/filament/Generic%20PLA%20%40System.json).

Upstream code and materials remain subject to their applicable licenses; these references do not relicense them under MIT. U1 exports use project materials inheriting Generic PLA settings, not official U1-tuned Bambu filament profiles. Users must verify the inherited settings and material/toolhead assignments.

Bambu Lab, Bambu Studio, Snapmaker and other product names belong to their respective owners. This project is independent and does not claim vendor endorsement.
