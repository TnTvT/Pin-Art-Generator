import { BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Camera, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { PinInstanceGroup } from './pin-grid';

export function createSelectionOutline(renderer: WebGLRenderer, geometry: BufferGeometry) {
  const scene = new Scene();
  scene.background = new Color('#000000');
  const material = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const masks = new Map<InstancedMesh, InstancedMesh>();
  function createMask(geometry: BufferGeometry) {
    const mask = new InstancedMesh(geometry, material, 10000);
    mask.name = 'Selected pin outline mask';
    mask.count = 0;
    mask.matrixAutoUpdate = false;
    mask.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(mask);
    return mask;
  }
  let initialMask: InstancedMesh | undefined = createMask(geometry);
  const target = new WebGLRenderTarget(1, 1, { samples: 4 });
  const outlineMaterial = new ShaderMaterial({
    uniforms: {
      maskTexture: { value: target.texture },
      sampleOffset: { value: new Vector2() },
      outlineColor: { value: new Color('#ffd43b') },
    },
    vertexShader: `varying vec2 screenUv;
      void main() {
        screenUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform sampler2D maskTexture;
      uniform vec2 sampleOffset;
      uniform vec3 outlineColor;
      varying vec2 screenUv;
      void main() {
        float center = texture2D(maskTexture, screenUv).r;
        float surrounding = 0.0;
        for (int horizontal = -1; horizontal <= 1; horizontal++) {
          for (int vertical = -1; vertical <= 1; vertical++) {
            vec2 offset = vec2(float(horizontal), float(vertical)) * sampleOffset;
            surrounding = max(surrounding, texture2D(maskTexture, screenUv + offset).r);
          }
        }
        float edgeAlpha = clamp(surrounding - center, 0.0, 1.0);
        if (edgeAlpha < 0.001) discard;
        gl_FragColor = vec4(outlineColor, edgeAlpha);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(outlineMaterial);

  return {
    update(pins: InstancedMesh | readonly PinInstanceGroup[], selected: ReadonlySet<number>) {
      const groups = pins instanceof InstancedMesh ? [{ mesh: pins, canonicalToLocal: undefined }] : pins;
      const matrix = new Matrix4();
      const active = new Set(groups.map(group => group.mesh));
      for (const [mesh, mask] of masks) {
        if (active.has(mesh)) continue;
        scene.remove(mask); mask.dispose(); masks.delete(mesh);
      }
      for (const group of groups) {
        const mesh = group.mesh;
        const mask = masks.get(mesh) ?? initialMask ?? createMask(mesh.geometry);
        initialMask = undefined;
        masks.set(mesh, mask);
        mask.geometry = mesh.geometry;
        let count = 0;
        for (const index of selected) {
          if (!Number.isInteger(index) || index < 0) continue;
          const localIndex = group.canonicalToLocal ? group.canonicalToLocal.get(index) : index;
          if (localIndex === undefined || localIndex >= mesh.count) continue;
          mesh.getMatrixAt(localIndex, matrix);
          mask.setMatrixAt(count++, matrix);
        }
        mesh.updateWorldMatrix(true, false);
        mask.matrix.copy(mesh.matrixWorld);
        mask.count = count;
        mask.instanceMatrix.needsUpdate = true;
        mask.computeBoundingSphere();
      }
    },
    resize(width: number, height: number) {
      const ratio = renderer.getPixelRatio();
      target.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
      outlineMaterial.uniforms.sampleOffset.value.set(1.25 / width, 1.25 / height);
    },
    render(camera: Camera) {
      if (![...masks.values()].some(mask => mask.count)) return;
      const previousTarget = renderer.getRenderTarget();
      const clearColor = renderer.getClearColor(new Color()).clone();
      const clearAlpha = renderer.getClearAlpha();
      const autoClear = renderer.autoClear;
      try {
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = false;
        quad.render(renderer);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      for (const mask of [...masks.values(), ...(initialMask ? [initialMask] : [])]) {
        scene.remove(mask); mask.dispose();
      }
      masks.clear(); initialMask = undefined; material.dispose();
      target.dispose(); outlineMaterial.dispose(); quad.dispose();
    },
  };
}
