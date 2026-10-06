import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_MODEL_COLORS, type ModelColors, type Parameters } from '../pin-design/model';
import { updatePinInstances } from './pin-grid';
import { fitCameraToBounds } from './camera-fit';
import { PREVIEW_COLORS, type PreviewColorScheme } from './appearance';
import { createOrientationHelper } from './orientation-helper';
import { createPinInteraction, type PreviewEditing } from './pin-interaction';
import { createSelectionOutline } from './selection-outline';
import { createBaseGeometry } from '../base-shape/base-geometry';
import type { Layout } from '../base-shape/layout';
import { createPinGeometry } from '../pin-shape/preview-geometry';
import type { PinShape } from '../pin-shape/geometry';
export type { PreviewEditing } from './pin-interaction';

export type ViewAction = 'reset' | 'top' | 'fit';

export interface Preview {
  update: (parameters: Parameters, heights?: Float32Array) => void;
  setView: (action: ViewAction) => void;
  setColorScheme: (colorScheme: PreviewColorScheme) => void;
  setModelColors: (colors: ModelColors) => void;
  setPinColors: (colors: readonly string[]) => void;
  setEditing: (editing: PreviewEditing) => void;
  dispose: () => void;
}

export function createPreview(container: HTMLDivElement): Preview {
  const scene = new THREE.Scene();
  const colors = PREVIEW_COLORS.light;
  const background = new THREE.Color(colors.background);
  scene.background = background;
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(36, 1, 0.01, 100000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(colors.background);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D pin model. Drag to rotate, scroll to zoom, right-drag or use arrow keys to pan.');
  container.appendChild(renderer.domElement);
  const orientationHelper = createOrientationHelper(container);

  scene.add(new THREE.HemisphereLight('#ffffff', '#8d9ba9', 2.2));
  const keyLight = new THREE.DirectionalLight('#ffffff', 3);
  keyLight.position.set(100, -150, 220);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#d9efee', 1.4);
  fillLight.position.set(-150, 100, 120);
  scene.add(fillLight);

  let baseGeometry: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1);
  let lastLayout: Layout | undefined;
  let lastThickness = 0;
  const baseMaterial = new THREE.MeshStandardMaterial({ color: DEFAULT_MODEL_COLORS.base, roughness: 0.7, metalness: 0.15 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  scene.add(base);
  let edgesGeometry = new THREE.EdgesGeometry(baseGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({ color: colors.edges, transparent: true, opacity: 0.45 });
  const baseEdges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  base.add(baseEdges);

  let lastPinShape: PinShape = 'round';
  let pinGeometry = createPinGeometry(lastPinShape);
  const pinMaterial = new THREE.MeshStandardMaterial({ color: DEFAULT_MODEL_COLORS.pins, roughness: 0.32, metalness: 0.28 });
  const pins = new THREE.InstancedMesh(pinGeometry, pinMaterial, 10000);
  pins.count = 0;
  pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(pins);
  const selectionOutline = createSelectionOutline(renderer, pinGeometry);
  const grid = new THREE.GridHelper(400, 40, '#cbd4d8', '#dfe5e7');
  grid.material.color.set(colors.gridTint);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.04;
  scene.add(grid);

  let frame: number | null = null;
  let disposed = false;
  let initialized = false;
  let radius = 1;
  let aspect = 1;
  let orthographicHalfHeight = 1;
  const center = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let editing: PreviewEditing | undefined;
  let hasInstanceColors = false;
  let controls = createControls();
  const interaction = createPinInteraction(container, renderer.domElement, pins, base, () => camera, enabled => { controls.enabled = enabled; });

  function updateHighlights() {
    selectionOutline.update(pins, editing?.selection ?? new Set());
  }

  function createControls() {
    const nextControls = new OrbitControls(camera, renderer.domElement);
    nextControls.enableDamping = true;
    nextControls.dampingFactor = 0.12;
    nextControls.maxPolarAngle = Math.PI;
    nextControls.listenToKeyEvents(renderer.domElement);
    nextControls.addEventListener('change', requestRender);
    return nextControls;
  }

  function updateProjection() {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.left = -orthographicHalfHeight * aspect;
      camera.right = orthographicHalfHeight * aspect;
      camera.top = orthographicHalfHeight;
      camera.bottom = -orthographicHalfHeight;
    } else {
      camera.aspect = aspect;
    }
    camera.far = Math.max(100000, radius * 50, camera.position.length() * 5);
    camera.updateProjectionMatrix();
  }

  function requestRender() {
    if (disposed || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      controls.update();
      camera.updateMatrixWorld();
      orientationHelper.update(camera);
      interaction.render();
      renderer.render(scene, camera);
      selectionOutline.render(camera);
    });
  }

  function setView(action: ViewAction) {
    interaction.cancel();
    controls.update();
    const direction = action === 'top'
      ? new THREE.Vector3(0, 0, 1)
      : action === 'reset'
        ? new THREE.Vector3(1.15, 1.55, 1.3).normalize()
        : camera.position.clone().sub(controls.target).normalize();
    controls.removeEventListener('change', requestRender);
    controls.dispose();
    if (action === 'top' || action === 'reset') {
      camera = action === 'top'
        ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000)
        : new THREE.PerspectiveCamera(36, aspect, 0.01, 100000);
      camera.up.set(0, action === 'top' ? 1 : 0, action === 'top' ? 0 : 1);
    }
    const distance = fitCameraToBounds(camera, bounds, aspect, direction);
    if (camera instanceof THREE.OrthographicCamera) {
      orthographicHalfHeight = camera.top;
    }
    controls = createControls();
    controls.target.copy(center);
    controls.maxDistance = Math.max(radius * 20, distance * 2);
    updateProjection();
    controls.update();
    requestRender();
  }

  function update(parameters: Parameters, heights?: Float32Array) {
    const pinShape = parameters.pinShape ?? 'round';
    if (pinShape !== lastPinShape) {
      const previousGeometry = pinGeometry;
      pinGeometry = createPinGeometry(pinShape);
      pins.geometry = pinGeometry;
      lastPinShape = pinShape;
      previousGeometry.dispose();
    }
    if (parameters.layout !== lastLayout || parameters.layout && parameters.thickness !== lastThickness) {
      baseGeometry.dispose(); edgesGeometry.dispose();
      baseGeometry = parameters.layout ? createBaseGeometry(parameters.layout, parameters.thickness) : new THREE.BoxGeometry(1, 1, 1);
      edgesGeometry = new THREE.EdgesGeometry(baseGeometry);
      base.geometry = baseGeometry; baseEdges.geometry = edgesGeometry;
      lastLayout = parameters.layout; lastThickness = parameters.thickness;
    }
    base.scale.set(parameters.layout ? 1 : parameters.width, parameters.layout ? 1 : parameters.depth, parameters.layout ? 1 : parameters.thickness);
    base.position.z = parameters.layout ? 0 : parameters.thickness / 2;
    updatePinInstances(pins, parameters, heights);
    interaction.update(parameters, heights);
    updateHighlights();
    bounds.set(
      new THREE.Vector3(-parameters.width / 2, -parameters.depth / 2, 0),
      new THREE.Vector3(parameters.width / 2, parameters.depth / 2, parameters.thickness),
    );
    if (pins.boundingBox) bounds.union(pins.boundingBox);
    const size = bounds.getSize(new THREE.Vector3());
    radius = size.length() / 2;
    bounds.getCenter(center);
    grid.scale.setScalar(Math.max(size.x, size.y) * 1.8 / 400);
    updateProjection();
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
    aspect = width / height;
    updateProjection();
    renderer.setSize(width, height);
    selectionOutline.resize(width, height);
    requestRender();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  return {
    update,
    setView,
    setColorScheme(colorScheme) {
      const nextColors = PREVIEW_COLORS[colorScheme];
      background.set(nextColors.background);
      renderer.setClearColor(nextColors.background);
      edgesMaterial.color.set(nextColors.edges);
      grid.material.color.set(nextColors.gridTint);
      requestRender();
    },
    setModelColors(modelColors) {
      baseMaterial.color.set(modelColors.base);
      pinMaterial.color.set(hasInstanceColors ? '#ffffff' : modelColors.pins);
      requestRender();
    },
    setPinColors(pinColors) {
      const color = new THREE.Color();
      pinColors.forEach((value, index) => pins.setColorAt(index, color.set(value)));
      hasInstanceColors = true;
      pinMaterial.color.set('#ffffff');
      if (pins.instanceColor) { pins.instanceColor.setUsage(THREE.DynamicDrawUsage); pins.instanceColor.needsUpdate = true; }
      requestRender();
    },
    setEditing(next) {
      const selectionChanged = editing?.selection !== next.selection;
      editing = next;
      interaction.setEditing(next);
      if (selectionChanged) updateHighlights();
      requestRender();
    },
    dispose() {
      disposed = true;
      interaction.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      pins.dispose();
      orientationHelper.dispose();
      baseGeometry.dispose();
      baseMaterial.dispose();
      edgesGeometry.dispose();
      edgesMaterial.dispose();
      pinGeometry.dispose();
      pinMaterial.dispose();
      selectionOutline.dispose();
      grid.geometry.dispose();
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      gridMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
