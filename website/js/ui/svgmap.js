// SVG map of the reference area (Web-Mercator projection of the committed OSM extract).
// Every overlay is computed from the same problem object the solvers use.
import { project, metresPerWorldPixel } from '../math/geo.js';

const NS = 'http://www.w3.org/2000/svg';
export const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export class SvgMap {
  constructor(container, area, instance, { width = 800, label = 'Karte der Referenzfläche' } = {}) {
    const [w, s, e, n] = instance.area.bbox;
    const [x0, y0] = project(n, w), [x1, y1] = project(s, e);
    this.scale = width / (x1 - x0);
    this.x0 = x0; this.y0 = y0;
    this.width = width; this.height = (y1 - y0) * this.scale;
    this.lat0 = (n + s) / 2;
    this.svg = el('svg', { viewBox: `0 0 ${width} ${this.height.toFixed(1)}`, class: 'svgmap', role: 'img', 'aria-label': label });
    const t = el('title', {}, this.svg); t.textContent = label;
    container.innerHTML = '';
    container.appendChild(this.svg);
    this.base = el('g', { class: 'base' }, this.svg);
    this.zonesG = el('g', { class: 'zones' }, this.svg);
    this.circlesG = el('g', { class: 'circles' }, this.svg);
    this.linksG = el('g', { class: 'links' }, this.svg);
    this.candG = el('g', { class: 'cands' }, this.svg);
    this.drawBase(area);
  }
  xy(lat, lon) { const [x, y] = project(lat, lon); return [(x - this.x0) * this.scale, (y - this.y0) * this.scale]; }
  metres(m) { return (m / metresPerWorldPixel(this.lat0)) * this.scale; }
  path(coords) { return coords.map(([lon, lat], k) => { const [x, y] = this.xy(lat, lon); return `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(''); }
  drawBase(area) {
    const order = { water: 0, park: 1, building: 2, street: 3 };
    const feats = [...area.features].sort((a, b) => (order[a.properties.layer] ?? 9) - (order[b.properties.layer] ?? 9));
    for (const f of feats) {
      const g = f.geometry, cls = `osm-${f.properties.layer}`;
      if (g.type === 'LineString') el('path', { d: this.path(g.coordinates), class: cls }, this.base);
      else if (g.type === 'Polygon') el('path', { d: g.coordinates.map((r) => this.path(r) + 'Z').join(''), class: cls }, this.base);
      else if (g.type === 'MultiPolygon') el('path', { d: g.coordinates.flat().map((r) => this.path(r) + 'Z').join(''), class: cls }, this.base);
    }
  }
  // state: { problem, selected:Set, hits?, compare?: 'onlyA'.. per zone, showCircles, showLinks, onCandidate }
  render(problem, instance, { selected = new Set(), showCircles = true, showLinks = false, zoneClass, onCandidate, highlightZone } = {}) {
    this.zonesG.innerHTML = ''; this.circlesG.innerHTML = ''; this.linksG.innerHTML = ''; this.candG.innerHTML = '';
    const hits = new Uint16Array(problem.Z);
    for (const i of selected) for (const j of problem.cover[i]) hits[j]++;
    const active = new Map(problem.zones.map((z, j) => [z.id, j]));
    for (const z of instance.zones) {
      const j = active.get(z.id);
      const d = this.path(z.cell) + 'Z';
      let cls = 'zone';
      if (j === undefined) cls += ' blocked';
      else if (zoneClass) cls += ' ' + zoneClass(j, hits[j]);
      else cls += hits[j] > 1 ? ' multi' : hits[j] === 1 ? ' covered' : '';
      if (j !== undefined && highlightZone === j) cls += ' hl';
      const p = el('path', { d, class: cls }, this.zonesG);
      const t = el('title', {}, p);
      t.textContent = j === undefined ? `${z.id}: unzugänglich (${z.inaccessibleReason ?? 'ausgeschlossen'})` : `${z.id}: Gewicht ${problem.weights[j]}, ${hits[j]}× abgedeckt`;
      if (j !== undefined && problem.weights[j] > 1) { const [x, y] = this.xy(z.lat, z.lon); const s = el('text', { x, y: y + 3, class: 'wlabel' }, this.zonesG); s.textContent = problem.weights[j]; }
    }
    problem.candidates.forEach((c, i) => {
      const [x, y] = this.xy(c.lat, c.lon);
      const on = selected.has(i);
      if (showCircles && on) el('circle', { cx: x, cy: y, r: this.metres(problem.radiusM), class: 'radius' }, this.circlesG);
      if (showLinks && on) for (const j of problem.cover[i]) { const z = problem.zones[j]; const [zx, zy] = this.xy(z.lat, z.lon); el('line', { x1: x, y1: y, x2: zx, y2: zy, class: 'link' }, this.linksG); }
      const g = el('g', { class: `cand${on ? ' on' : ''}`, tabindex: onCandidate ? 0 : -1, role: onCandidate ? 'button' : 'img', 'aria-pressed': String(on), 'aria-label': `Kandidat x${i}: ${c.name}${on ? ', gewählt' : ''}` }, this.candG);
      el('circle', { cx: x, cy: y, r: on ? 9 : 6 }, g);
      const tx = el('text', { x: x + 11, y: y + 4 }, g); tx.textContent = `x${i}`;
      const tt = el('title', {}, g); tt.textContent = `x${i} – ${c.name}`;
      if (onCandidate) {
        g.addEventListener('click', () => onCandidate(i));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCandidate(i); } });
      }
    });
    for (const c of problem.excludedCandidates) {
      const [x, y] = this.xy(c.lat, c.lon);
      const g = el('g', { class: 'cand excluded' }, this.candG);
      el('path', { d: `M${x - 5},${y - 5}L${x + 5},${y + 5}M${x + 5},${y - 5}L${x - 5},${y + 5}` }, g);
      const tt = el('title', {}, g); tt.textContent = `${c.name}: ausgeschlossen (${c.inaccessibleReason ?? 'unzugänglich'})`;
    }
    return hits;
  }
}
