import { afterEach, describe, expect, it } from 'vitest';
import { CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { DEFAULTS } from '../pin-design/model';
import { updatePinInstances } from './pin-grid';

const geometry = new CylinderGeometry(0.5, 0.5, 1, 16);
const material = new MeshBasicMaterial();
const mesh = new InstancedMesh(geometry, material, 10000);

afterEach(() => { mesh.count = 0; });

describe('pin instance placement', () => {
  it('centers pins and places their bottoms exactly on the base top', () => {
    updatePinInstances(mesh, { ...DEFAULTS, columns: 2, rows: 2 });
    const first = new Matrix4();
    const last = new Matrix4();
    mesh.getMatrixAt(0, first);
    mesh.getMatrixAt(3, last);
    expect(new Vector3().setFromMatrixPosition(first).toArray()).toEqual([-2.5, -2.5, 13]);
    expect(new Vector3().setFromMatrixPosition(last).toArray()).toEqual([2.5, 2.5, 13]);
    expect(new Vector3(0, -0.5, 0).applyMatrix4(first).z).toBeCloseTo(3);
    expect(new Vector3(0, 0.5, 0).applyMatrix4(first).z).toBeCloseTo(23);
  });

  it('uses per-pin extensions while keeping every pin seated on the base', () => {
    updatePinInstances(mesh, { ...DEFAULTS, columns: 2, rows: 1 }, new Float32Array([2, 10]));
    const matrix = new Matrix4();
    mesh.getMatrixAt(1, matrix);
    expect(new Vector3(0, -0.5, 0).applyMatrix4(matrix).z).toBeCloseTo(3);
    expect(new Vector3(0, 0.5, 0).applyMatrix4(matrix).z).toBeCloseTo(13);
    expect(new Vector3(0.5, 0, 0).applyMatrix4(matrix).x - new Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(1);
  });

  it('updates count and bounds when switching between large and small grids', () => {
    updatePinInstances(mesh, { ...DEFAULTS, columns: 100, rows: 100 });
    expect(mesh.count).toBe(10000);
    updatePinInstances(mesh, { ...DEFAULTS, columns: 1, rows: 1 });
    expect(mesh.count).toBe(1);
    expect(mesh.boundingBox?.min.x).toBeCloseTo(-1);
    expect(mesh.boundingBox?.max.x).toBeCloseTo(1);
  });
  it('renders explicit coordinates and heights rather than inferring rows and columns', () => {
    const layout = { regions: [], edgePadding: 0, pins: [{ id: 'first', x: -18, y: 7 }, { id: 'second', x: 13, y: -9 }] };
    updatePinInstances(mesh, { ...DEFAULTS, layout }, new Float32Array([6,11]));
    expect(mesh.count).toBe(2);
    const transform = new Matrix4();
    mesh.getMatrixAt(1, transform);
    expect(new Vector3().setFromMatrixPosition(transform).toArray()).toEqual([13,-9,8.5]);
    expect(new Vector3(0,-.5,0).applyMatrix4(transform).z).toBeCloseTo(3);
    expect(new Vector3(0,.5,0).applyMatrix4(transform).z).toBeCloseTo(14);
  });
});
