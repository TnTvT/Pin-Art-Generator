import { Quaternion, Vector3, type Camera } from 'three';

function svgElement<Tag extends keyof SVGElementTagNameMap>(tag: Tag, attributes: Record<string, string>) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
}

export function createOrientationHelper(container: HTMLElement) {
  const svg = svgElement('svg', {
    class: 'orientation-helper',
    viewBox: '0 0 96 96',
    role: 'img',
    'aria-label': 'XYZ orientation helper',
  });
  const title = svgElement('title', {});
  title.textContent = 'World axes · Follows the camera · Z is up';
  svg.appendChild(title);
  const rotation = new Quaternion();
  const axes = [
    { label: 'X', direction: new Vector3(1, 0, 0), color: '#c94141' },
    { label: 'Y', direction: new Vector3(0, 1, 0), color: '#247747' },
    { label: 'Z', direction: new Vector3(0, 0, 1), color: '#286bc5' },
  ].map(({ label, direction, color }) => {
    const group = svgElement('g', { 'data-axis': label });
    const negative = svgElement('line', { x1: '48', y1: '48', stroke: color, 'stroke-width': '1.5', 'stroke-dasharray': '2 3', opacity: '0.4' });
    const positive = svgElement('line', { x1: '48', y1: '48', stroke: color, 'stroke-width': '2.5', 'stroke-linecap': 'round' });
    const head = svgElement('circle', { r: '10', fill: color });
    const text = svgElement('text', { fill: '#ffffff', 'text-anchor': 'middle', dy: '0.35em' });
    text.textContent = label;
    group.append(negative, positive, head, text);
    svg.appendChild(group);
    return { direction, projected: new Vector3(), group, negative, positive, head, text };
  });
  container.appendChild(svg);

  return {
    update(camera: Camera) {
      camera.getWorldQuaternion(rotation).invert();
      axes.forEach((axis) => {
        axis.projected.copy(axis.direction).applyQuaternion(rotation);
        const horizontal = (48 + axis.projected.x * 30).toFixed(3);
        const vertical = (48 - axis.projected.y * 30).toFixed(3);
        axis.positive.setAttribute('x2', horizontal);
        axis.positive.setAttribute('y2', vertical);
        axis.negative.setAttribute('x2', (48 - axis.projected.x * 30).toFixed(3));
        axis.negative.setAttribute('y2', (48 + axis.projected.y * 30).toFixed(3));
        axis.head.setAttribute('cx', horizontal);
        axis.head.setAttribute('cy', vertical);
        axis.text.setAttribute('x', horizontal);
        axis.text.setAttribute('y', vertical);
      });
      [...axes].sort((first, second) => first.projected.z - second.projected.z)
        .forEach((axis) => svg.appendChild(axis.group));
    },
    dispose() {
      svg.remove();
    },
  };
}
