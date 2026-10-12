import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Parameters } from '../pin-design/model';
import { resolvePinGeometries } from '../pin-shape/geometry';
import { profilePoints } from '../mechanics/model';
import { getMappingGrid } from './mapping-grid';
import type { SourceImage } from './image-mapping';
import { imageTransform, zoomImage, type ImagePlacement } from './image-placement';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling } from './image-sampling';
import type { SamplingPreviewGroup } from './sampling-preview';

interface Props {
  source: SourceImage; parameters: Parameters; placement: ImagePlacement; blocked: boolean;
  preview?: SourceImage | null; sampling?: ImageSampling;
  samples?: SamplingPreviewGroup[]; showPinShapes?: boolean;
  showSamples?: boolean;
  interactive?: boolean;
  imageOpacity?: number;
  onChange: (placement: ImagePlacement) => void;
}

export default function ImagePlacementCanvas({ source, preview = source, sampling = DEFAULT_IMAGE_SAMPLING, samples = [], showSamples = false, showPinShapes = false, interactive = true, imageOpacity = 1, parameters, placement, blocked, onChange }: Props) {
  const canvas = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const patternId = useId();
  const linesId = useId();
  const drag = useRef<{ placement: ImagePlacement; point: { x: number; y: number }; pointerId: number } | null>(null);
  const current = useRef({ placement, blocked, onChange });
  current.current = { placement, blocked, onChange };
  const grid = useMemo(() => getMappingGrid(parameters), [parameters]);
  const cells = useMemo(() => grid.pins.map(pin => `M${pin.x - grid.cellSize / 2},${-pin.y - grid.cellSize / 2}h${grid.cellSize}v${grid.cellSize}h${-grid.cellSize}Z`).join(''), [grid]);
  const view = useMemo(() => {
    const width = Math.max(grid.width, (parameters.width + 2 * Math.abs(grid.centerX)) * grid.scale);
    const depth = Math.max(grid.depth, (parameters.depth + 2 * Math.abs(grid.centerY)) * grid.scale);
    const margin = Math.max(width, depth) * 0.1;
    return { left: -width / 2 - margin, top: -depth / 2 - margin, width: width + margin * 2, height: depth + margin * 2 };
  }, [grid, parameters.width, parameters.depth]);
  const contour = useMemo(() => parameters.layout?.regions.map(region => [region.outer, ...region.holes]
    .map(ring => `M${ring.map(([horizontal, vertical]) => `${(horizontal - grid.centerX) * grid.scale},${-(vertical - grid.centerY) * grid.scale}`).join('L')}Z`).join('')).join('')
    ?? `M${-parameters.width * grid.scale / 2},${-parameters.depth * grid.scale / 2}h${parameters.width * grid.scale}v${parameters.depth * grid.scale}h${-parameters.width * grid.scale}Z`, [parameters.layout, parameters.width, parameters.depth, grid]);
  const pins = useMemo(() => {
    if (!showPinShapes) return '';
    const geometries = resolvePinGeometries(parameters);
    const vertexCache = new Map<string, ReturnType<typeof profilePoints>>();
    const radius = grid.cellSize / 2;
    const flare = parameters.construction?.mode === 'print-in-place' ? parameters.construction.sliding.headFlare : 0;
    return grid.pins.map((pin, index) => {
      const geometry = geometries[index], key = `${geometry.shape}:${geometry.rotation}`;
      if (geometry.shape === 'round') return `M${pin.x - radius},${-pin.y}a${radius},${radius} 0 1,0 ${grid.cellSize},0a${radius},${radius} 0 1,0 ${-grid.cellSize},0`;
      if (!vertexCache.has(key)) {
        const angle = geometry.rotation * Math.PI / 180;
        vertexCache.set(key, profilePoints(geometry.shape, parameters.diameter, flare).map(([horizontal, vertical]) =>
          [horizontal * Math.cos(angle) - vertical * Math.sin(angle), horizontal * Math.sin(angle) + vertical * Math.cos(angle)]));
      }
      return `M${vertexCache.get(key)!.map(([horizontal, vertical]) => `${pin.x + horizontal},${-pin.y - vertical}`).join('L')}Z`;
    }).join('');
  }, [showPinShapes, grid, parameters]);
  const transform = imageTransform(source.bitmap, parameters, placement);

  function worldPoint(clientX: number, clientY: number) {
    const bounds = canvas.current!.getBoundingClientRect();
    const scale = Math.min(bounds.width / view.width, bounds.height / view.height);
    return { x: view.left + (clientX - bounds.left - (bounds.width - view.width * scale) / 2) / scale,
      y: -(view.top + (clientY - bounds.top - (bounds.height - view.height * scale) / 2) / scale) };
  }

  function finish(cancelled: boolean) {
    const gesture = drag.current;
    if (!gesture) return;
    drag.current = null;
    if (cancelled) current.current.onChange(gesture.placement);
    if (canvas.current?.hasPointerCapture(gesture.pointerId)) canvas.current.releasePointerCapture(gesture.pointerId);
  }

  useEffect(() => {
    if (!interactive) return;
    const target = canvas.current!;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (current.current.blocked || drag.current) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
      current.current.onChange(zoomImage(current.current.placement, current.current.placement.zoom * Math.exp(-delta * 0.002), worldPoint(event.clientX, event.clientY)));
    }
    const cancel = () => finish(true);
    target.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', cancel);
    return () => { target.removeEventListener('wheel', wheel); window.removeEventListener('blur', cancel); };
  }, [view, interactive]);

  function start(event: PointerEvent<SVGSVGElement>) {
    if (blocked || event.button !== 0 || drag.current) return;
    event.preventDefault();
    canvas.current!.focus();
    drag.current = { placement, point: worldPoint(event.clientX, event.clientY), pointerId: event.pointerId };
    canvas.current!.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = worldPoint(event.clientX, event.clientY);
    onChange({ ...gesture.placement, offsetX: gesture.placement.offsetX + point.x - gesture.point.x,
      offsetY: gesture.placement.offsetY + point.y - gesture.point.y });
  }

  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault(); event.stopPropagation(); finish(true); return;
    }
    if (blocked || drag.current) return;
    const step = event.shiftKey ? 5 : 1;
    const direction: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (direction[event.key]) {
      event.preventDefault();
      onChange({ ...placement, offsetX: placement.offsetX + direction[event.key][0], offsetY: placement.offsetY + direction[event.key][1] });
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault(); onChange(zoomImage(placement, placement.zoom * (event.key === '-' ? 1 / 1.1 : 1.1)));
    }
  }

  return <svg ref={canvas} className={`image-placement-canvas${interactive ? '' : ' image-placement-canvas-readonly'}`} role={interactive ? 'application' : 'img'} aria-label={interactive ? 'Image placement canvas' : 'Mapped pin samples'} aria-describedby={interactive ? 'image-placement-instructions' : undefined}
    aria-disabled={interactive ? blocked : undefined} tabIndex={interactive ? 0 : undefined} viewBox={`${view.left} ${view.top} ${view.width} ${view.height}`}
    onPointerDown={interactive ? start : undefined} onPointerMove={interactive ? move : undefined} onPointerUp={interactive ? event => { if (event.pointerId === drag.current?.pointerId) finish(false); } : undefined}
    onPointerCancel={interactive ? event => { if (event.pointerId === drag.current?.pointerId) finish(true); } : undefined} onLostPointerCapture={interactive ? () => finish(true) : undefined}
    onBlur={interactive ? () => finish(true) : undefined} onKeyDown={interactive ? keyDown : undefined}>
    <defs>
      <clipPath id={clipId}><path d={cells} /></clipPath>
      <pattern id={patternId} patternUnits="userSpaceOnUse" x={-grid.width / 2} y={-grid.depth / 2} width={grid.cellSize * 2} height={grid.cellSize * 2}>
        <rect width={grid.cellSize * 2} height={grid.cellSize * 2} fill="#ffffff" />
        <rect width={grid.cellSize} height={grid.cellSize} fill="#e8edf0" />
        <rect x={grid.cellSize} y={grid.cellSize} width={grid.cellSize} height={grid.cellSize} fill="#e8edf0" />
      </pattern>
      <pattern id={linesId} patternUnits="userSpaceOnUse" x={-grid.width / 2} y={-grid.depth / 2} width={grid.cellSize} height={grid.cellSize}>
        <path d={`M${grid.cellSize},0H0V${grid.cellSize}`} fill="none" stroke="#ffffff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={`M${grid.cellSize},0H0V${grid.cellSize}`} fill="none" stroke="#253b45" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      </pattern>
    </defs>
    {preview && <image href={preview.url} style={{ imageRendering: sampling === 'pixel' ? 'pixelated' : 'auto' }} preserveAspectRatio="none" x={transform.left} y={-transform.top} width={transform.width} height={transform.height} opacity={0.22 * imageOpacity} />}
    <rect data-overlay="mapping-background" x={-grid.width / 2} y={-grid.depth / 2} width={grid.width} height={grid.depth} fill="#ffffff" />
    <rect data-overlay="pixel-background" x={-grid.width / 2} y={-grid.depth / 2} width={grid.width} height={grid.depth} fill={`url(#${patternId})`} clipPath={`url(#${clipId})`} />
    {preview && !showSamples && <image data-overlay="original-image" href={preview.url} style={{ imageRendering: sampling === 'pixel' ? 'pixelated' : 'auto' }} preserveAspectRatio="none" x={transform.left} y={-transform.top} width={transform.width} height={transform.height} opacity={imageOpacity} clipPath={`url(#${clipId})`} />}
    {preview && showSamples && samples.length > 0 && <g data-overlay="samples" clipPath={`url(#${clipId})`} shapeRendering="crispEdges">
      {samples.map(group => <path key={group.color} d={group.path} fill={group.color} />)}
    </g>}
    {!showSamples && <rect data-overlay="pixel-grid" x={-grid.width / 2} y={-grid.depth / 2} width={grid.width} height={grid.depth} fill={`url(#${linesId})`} opacity="0.85" clipPath={`url(#${clipId})`} pointerEvents="none" />}
    <path className="image-placement-base" d={contour} fill="none" vectorEffect="non-scaling-stroke" />
    {showPinShapes && <path className="image-placement-pins" data-overlay="pins" d={pins} fill="none" vectorEffect="non-scaling-stroke" />}
  </svg>;
}
