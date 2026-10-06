import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Parameters } from '../pin-design/model';
import { pinVertices } from '../pin-shape/geometry';
import type { SourceImage } from './image-mapping';
import { imageTransform, zoomImage, type ImagePlacement } from './image-placement';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling } from './image-sampling';

interface Props {
  source: SourceImage; parameters: Parameters; placement: ImagePlacement; blocked: boolean;
  preview?: SourceImage | null; sampling?: ImageSampling;
  onChange: (placement: ImagePlacement) => void;
}

export default function ImagePlacementCanvas({ source, preview = source, sampling = DEFAULT_IMAGE_SAMPLING, parameters, placement, blocked, onChange }: Props) {
  const canvas = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const drag = useRef<{ placement: ImagePlacement; point: { x: number; y: number }; pointerId: number } | null>(null);
  const current = useRef({ placement, blocked, onChange });
  current.current = { placement, blocked, onChange };
  const view = useMemo(() => {
    const margin = Math.max(parameters.width, parameters.depth) * 0.1;
    return { left: -parameters.width / 2 - margin, top: -parameters.depth / 2 - margin,
      width: parameters.width + margin * 2, height: parameters.depth + margin * 2 };
  }, [parameters.width, parameters.depth]);
  const contour = useMemo(() => parameters.layout?.regions.map(region => [region.outer, ...region.holes]
    .map(ring => `M${ring.map(([horizontal, vertical]) => `${horizontal},${-vertical}`).join('L')}Z`).join('')).join('') ?? '', [parameters.layout]);
  const pins = useMemo(() => {
    const vertices = parameters.pinShape && parameters.pinShape !== 'round' ? pinVertices(parameters.pinShape, parameters.diameter, parameters.pinRotation) : null;
    const radius = parameters.diameter / 2;
    return parameters.layout?.pins.map(pin => vertices
      ? `M${vertices.map(([horizontal, vertical]) => `${pin.x + horizontal},${-pin.y - vertical}`).join('L')}Z`
      : `M${pin.x - radius},${-pin.y}a${radius},${radius} 0 1,0 ${parameters.diameter},0a${radius},${radius} 0 1,0 ${-parameters.diameter},0`).join('') ?? '';
  }, [parameters.layout, parameters.diameter, parameters.pinShape, parameters.pinRotation]);
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
  }, [view]);

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

  return <svg ref={canvas} className="image-placement-canvas" role="application" aria-label="Image placement canvas" aria-describedby="image-placement-instructions"
    aria-disabled={blocked} tabIndex={0} viewBox={`${view.left} ${view.top} ${view.width} ${view.height}`}
    onPointerDown={start} onPointerMove={move} onPointerUp={event => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
    onPointerCancel={event => { if (event.pointerId === drag.current?.pointerId) finish(true); }} onLostPointerCapture={() => finish(true)}
    onBlur={() => finish(true)} onKeyDown={keyDown}>
    <defs><clipPath id={clipId}><path d={contour} fillRule="evenodd" clipRule="evenodd" /></clipPath></defs>
    {preview && <image href={preview.url} style={{ imageRendering: sampling === 'pixel' ? 'pixelated' : 'auto' }} preserveAspectRatio="none" x={transform.left} y={-transform.top} width={transform.width} height={transform.height} opacity="0.22" />}
    <path data-overlay="mapping-background" d={contour} fill="#ffffff" fillRule="evenodd" />
    {preview && <image href={preview.url} style={{ imageRendering: sampling === 'pixel' ? 'pixelated' : 'auto' }} preserveAspectRatio="none" x={transform.left} y={-transform.top} width={transform.width} height={transform.height} clipPath={`url(#${clipId})`} />}
    <path className="image-placement-base" d={contour} fill="none" vectorEffect="non-scaling-stroke" />
    <path className="image-placement-pins" data-overlay="pins" d={pins} fill="none" vectorEffect="non-scaling-stroke" />
  </svg>;
}
