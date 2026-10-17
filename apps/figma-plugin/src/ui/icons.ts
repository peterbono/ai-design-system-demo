// Authored 16px stroke icons (1.5px, round caps), one consistent family.

const NS = 'http://www.w3.org/2000/svg';

const PATHS: Record<string, string> = {
  arrow: 'M3.5 8h9M9 4.5 12.5 8 9 11.5',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  alert: 'M8 5v3.5M8 11h.01M2.5 13.5h11L8 2.5z',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  external: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  info: 'M8 7.5V11M8 5h.01M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z',
  more: 'M3.75 8h.5M7.75 8h.5M11.75 8h.5',
  branch: 'M5 3v10M5 13a1.5 1.5 0 1 0 0-.01M11 6a1.5 1.5 0 1 0 0-.01M11 6c0 3-6 2-6 5',
};

export function icon(name: keyof typeof PATHS | string, label?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('class', `icon icon-${name}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}
