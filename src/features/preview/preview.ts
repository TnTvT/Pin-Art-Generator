import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getMetrics, type Parameters } from '../pin-design/model';
import { updatePinInstances } from './pin-grid';

export type ViewAction = 'reset' | 'top' | 'fit';

export interface Preview {
  update: (parameters: Parameters, heights?: Float32Array) => void;
  setView: (action: ViewAction) => void;
  dispose: () => void;
}

export function createPreview(container: HTMLDivElement): Preview {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f1f4f5');
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor('#f1f4f5');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D pin model. Drag to rotate, scroll to zoom, right-drag or use arrow keys to pan.');
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI;
  controls.listenToKeyEvents(renderer.domElement);

  scene.add(new THREE.HemisphereLight('#ffffff', '#8d9ba9', 2.2));
  const keyLight = new THREE.DirectionalLight('#ffffff', 3);
  keyLight.position.set(100, -150, 220);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#d9efee', 1.4);
  fillLight.position.set(-150, 100, 120);
  scene.add(fillLight);

  const baseGeometry = new THREE.BoxGeometry(1, 1, 1);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: '#5b6b78', roughness: 0.7, metalness: 0.15 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  scene.add(base);
  const edgesGeometry = new THREE.EdgesGeometry(baseGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({ color: '#354652', transparent: true, opacity: 0.45 });
  base.add(new THREE.LineSegments(edgesGeometry, edgesMaterial));

  const pinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  const pinMaterial = new THREE.MeshStandardMaterial({ color: '#2dada3', roughness: 0.32, metalness: 0.28 });
  const pins = new THREE.InstancedMesh(pinGeometry, pinMaterial, 10000);
  pins.count = 0;
  pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pins);
  const grid = new THREE.GridHelper(400, 40, '#cbd4d8', '#dfe5e7');
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.04;
  scene.add(grid);

  let frame: number | null = null;
  let disposed = false;
  let initialized = false;
  let radius = 1;
  const center = new THREE.Vector3();

  function requestRender() {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      controls.update();
      renderer.render(scene, camera);
    });
  }

  function setView(action: ViewAction) {
    controls.update();
    const direction = action === 'top'
      ? new THREE.Vector3(0, -0.0001, 1).normalize()
      : action === 'reset'
        ? new THREE.Vector3(1.15, -1.55, 1.3).normalize()
        : camera.position.clone().sub(controls.target).normalize();
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.18;
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.update();
    requestRender();
  }

  function update(parameters: Parameters, heights?: Float32Array) {
    const metrics = getMetrics(parameters);
    base.scale.set(parameters.width, parameters.depth, parameters.thickness);
    base.position.z = parameters.thickness / 2;
    updatePinInstances(pins, parameters, heights);
    const totalHeight = parameters.thickness + parameters.extension;
    const width = Math.max(parameters.width, metrics.width);
    const depth = Math.max(parameters.depth, metrics.depth);
    radius = Math.hypot(width, depth, totalHeight) / 2;
    center.set(0, 0, totalHeight / 2);
    grid.scale.setScalar(Math.max(width, depth) * 1.8 / 400);
    camera.far = Math.max(100000, radius * 50, camera.position.length() * 5);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(radius * 20, camera.position.distanceTo(controls.target) * 2);
    if (!initialized) {
      initialized = true;
      setView('reset');
    }
    requestRender();
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    requestRender();
  }

  controls.addEventListener('change', requestRender);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  return {
    update,
    setView,
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      pins.dispose();
      baseGeometry.dispose();
      baseMaterial.dispose();
      edgesGeometry.dispose();
      edgesMaterial.dispose();
      pinGeometry.dispose();
      pinMaterial.dispose();
      grid.geometry.dispose();
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
