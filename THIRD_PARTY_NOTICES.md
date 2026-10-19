# Third-party notices and reference sources

The project's MIT License applies to project-authored code and documentation. It does not change third-party licenses or grant rights in third-party datasets, preset materials, names or trademarks. Attribution alone is not a redistribution permission. This file is provenance information, not a completed legal review or an exhaustive dependency-license inventory.

## Dependencies

JavaScript packages are identified by `package.json`, workspace manifests and `pnpm-lock.yaml`; Python packages are identified by `apps/api/pyproject.toml` and `apps/api/uv.lock`. They retain their own licenses and notices. Preserve the license files supplied with dependencies in any distribution. Major components include React, Mantine, Three.js, Color.js, d3-contour, RBush, FastAPI, Pydantic, Uvicorn, lib3mf, manifold3d, NumPy and Shapely.

## Filament reference catalog

`apps/web/src/features/filaments/data/bambu-pla.ts` records Bambu Lab PLA Basic and PLA Matte names, product codes and approximate reference colors captured on September 30, 2026:

- [PLA Basic source](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/basic).
- [PLA Matte source](https://3dfilamentprofiles.com/filaments/bambu-lab/pla/matte).

Per-entry source IDs and catalog provenance remain in the data. RGB values are not calibrated printed-color measurements. The catalog's redistribution terms have not been confirmed; verify applicable reuse permission with the source owner before redistributing this bundled data. The project's MIT License does not establish that permission.

## Printer and slicer interoperability references

The export service writes standard 3MF data with compatibility metadata and installed-preset references. These sources document preset identifiers, machine envelopes and package conventions; the application does not bundle a slicer binary or claim an upstream slicer generated its files.

- [Bambu Studio source and license](https://github.com/bambulab/BambuStudio), including its [3MF format implementation](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp).
- Bambu system filament references: [PLA Basic X1C](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/Bambu%20PLA%20Basic%20%40BBL%20X1C.json) and [PLA Matte X1C](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/Bambu%20PLA%20Matte%20%40BBL%20X1C.json).
- Snapmaker Orca profile references at commit `441f73cc8d91d84f574a9d910e84fb8eeb099cf5`: [U1 machine](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/machine/Snapmaker%20U1%20%280.4%20nozzle%29.json), [machine parent](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/machine/fdm_U1.json), [process](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/Snapmaker/process/0.20mm%20Standard%20%40Snapmaker%20U1%20%280.4%20nozzle%29.json) and [Generic PLA parent](https://github.com/Snapmaker/OrcaSlicer/blob/441f73cc8d91d84f574a9d910e84fb8eeb099cf5/resources/profiles/OrcaFilamentLibrary/filament/Generic%20PLA%20%40System.json).

Upstream code and materials remain subject to their applicable licenses; these references do not relicense them under MIT. U1 exports use project materials inheriting Generic PLA settings, not official U1-tuned Bambu filament profiles. Users must verify the inherited settings and material/toolhead assignments.

Bambu Lab, Bambu Studio, Snapmaker and other product names belong to their respective owners. This project is independent and does not claim vendor endorsement.
