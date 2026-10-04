import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createBaseGeometry } from './base-geometry';
import type { Layout } from './layout';

describe('contour extrusion', () => {
  it('keeps hole openings and physical dimensions in the preview', () => {
    const layout: Layout = { edgePadding: 2, pins: [], regions: [{ outer: [[-20,-10],[20,-10],[20,10],[-20,10]], holes: [[[-3,-3],[-3,3],[3,3],[3,-3]]] }] };
    const geometry = createBaseGeometry(layout, 3);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.toArray()).toEqual([-20,-10,0]);
    expect(geometry.boundingBox?.max.toArray()).toEqual([20,10,3]);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(0,0,10), new Vector3(0,0,-1));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    ray.set(new Vector3(10,0,10), new Vector3(0,0,-1));
    expect(ray.intersectObject(mesh)[0].point.z).toBe(3);
    geometry.dispose();
    material.dispose();
  });
});
