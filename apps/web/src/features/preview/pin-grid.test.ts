import { afterEach, describe, expect, it } from 'vitest';
import { CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { DEFAULTS } from '../pin-design/model';
import { updatePinInstances } from './pin-grid';

const geometry = new CylinderGeometry(0.5, 0.5, 1, 16);
const material = new MeshBasicMaterial();
const mesh = new InstancedMesh(geometry, material, 5000);

afterEach(() => { mesh.count = 0; });

describe('pin instance placement', () => {
  it('places the longer 60-degree lower head without moving the upper head or pin top', () => {
    const parameters = { ...DEFAULTS, columns: 1, rows: 1,
      construction: { mode: 'print-in-place' as const, sliding: { clearance: 0.4, headFlare: 0.6, lowerHeadGap: 0.2, lowerHeadAngle: 60 } } };
    const transform = new Matrix4();
    updatePinInstances(mesh, parameters, new Float32Array([10]), undefined, 'shaft');
    mesh.getMatrixAt(0, transform);
    expect(new Vector3(0, 0, 0).applyMatrix4(transform).z).toBeCloseTo(0.6 * Math.sqrt(3));
    expect(new Vector3(0, 0, 1).applyMatrix4(transform).z).toBeCloseTo(12.4);
    updatePinInstances(mesh, parameters, new Float32Array([10]), undefined, 'top-head');
    mesh.getMatrixAt(0, transform);
    expect(new Vector3(0, 0, 0).applyMatrix4(transform).z).toBeCloseTo(12.4);
    expect(new Vector3(0, 0, 0.6).applyMatrix4(transform).z).toBeCloseTo(13);
  });
  it('places group-local instances using canonical positions, heights and rotations', () => {
    const parameters = { ...DEFAULTS, columns: 4, rows: 1, pinShape: 'triangle' as const, pinRotation: 120, pinGeometries: [
      { shape: 'round' as const, rotation: 90 }, { shape: 'square' as const, rotation: 0 },
      { shape: 'triangle' as const, rotation: 30 }, { shape: 'square' as const, rotation: 90 },
    ] };
    updatePinInstances(mesh, parameters, new Float32Array([2, 4, 6, 8]), [3, 1]);
    expect(mesh.count).toBe(2);
    const matrix = new Matrix4();
    mesh.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([6, 0, 7]);
    expect(new Vector3(0, -.5, 0).applyMatrix4(matrix).z).toBeCloseTo(3);
    expect(new Vector3(0, .5, 0).applyMatrix4(matrix).z).toBeCloseTo(11);
    const radial = new Vector3(.5, 0, 0).applyMatrix4(matrix).sub(new Vector3().setFromMatrixPosition(matrix));
    expect(radial.x).toBeCloseTo(0); expect(radial.y).toBeCloseTo(1);
    mesh.getMatrixAt(1, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([-2, 0, 5]);
    updatePinInstances(mesh, parameters, undefined, [0]);
    mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBeCloseTo(2);
  });
  it('centers pins and places their bottoms exactly on the base top', () => {
    updatePinInstances(mesh, { ...DEFAULTS, columns: 2, rows: 2 });
    const first = new Matrix4();
    const last = new Matrix4();
    mesh.getMatrixAt(0, first);
    mesh.getMatrixAt(3, last);
    expect(new Vector3().setFromMatrixPosition(first).toArray()).toEqual([-2, -2, 13]);
    expect(new Vector3().setFromMatrixPosition(last).toArray()).toEqual([2, 2, 13]);
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
    updatePinInstances(mesh, { ...DEFAULTS, columns: 100, rows: 50 });
    expect(mesh.count).toBe(5000);
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
