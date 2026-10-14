// ============================================================================
// LAYOUT VIEW — 투시 없는 정면(입면) 도면. 3개 벽면을 실제 비율로 펼쳐서 보여준다.
// ============================================================================
import { GAP_MM, MARGIN } from './constants.js';
import { loadWallImage } from './wall-image.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export function renderLayoutView(container, layout) {
  container.innerHTML = '';
  const panelW = Math.max(container.clientWidth || 900, 480);
  const maxLen = Math.max(...layout.walls.map((w) => w.wall.lengthMM));
  const scale = (panelW - 64) / maxLen; // px per mm

  const wrap = document.createElement('div');
  wrap.className = 'layout-stack';

  layout.walls.forEach(({ wall, items }) => {
    const wPx = wall.lengthMM * scale;
    const hPx = wall.heightMM * scale;
    const rulerH = 26;
    const labelH = 22;
    const svgH = hPx + rulerH + labelH + 8;

    const card = document.createElement('div');
    card.className = 'layout-wall-card';

    const head = document.createElement('div');
    head.className = 'layout-wall-head';
    const placedCount = wall.image ? wall.posterCount : items.length;
    head.innerHTML = `<span class="wall-tag ${wall.material}">${wall.name}</span>
      <span class="wall-dim">${wall.lengthMM.toLocaleString()} × ${wall.heightMM.toLocaleString()} mm</span>
      <span class="wall-mat">${wall.material === 'opaque' ? '불투명 벽' : '반투명 패널'}</span>
      <span class="wall-count">포스터 ${placedCount}장</span>`;
    card.appendChild(head);

    const svg = el('svg', { width: wPx + 64, height: svgH, viewBox: `0 0 ${wPx + 64} ${svgH}` });
    const gx = 32; // 좌측 여백(ruler label 공간)
    const gy = 4;

    // 벽 외곽
    el('rect', {
      x: gx, y: gy, width: wPx, height: hPx,
      fill: wall.material === 'opaque' ? 'var(--wall-opaque)' : 'var(--wall-translucent)',
      stroke: 'var(--wall-stroke)', 'stroke-width': 1.5,
    }, svg);

    // 시안 이미지가 있는 벽: 자동 배치 대신 입면 이미지를 벽 전체에 그대로 얹는다.
    if (wall.image) {
      // 이미지는 시안 기준 높이대로 바닥에 맞춘다 — 벽이 높으면 위가 비고, 낮으면 윗부분이 잘린다.
      const imgPx = (wall.imageHeightMM || wall.heightMM) * scale;
      const clipId = `wallclip-${wall.id}`;
      el('rect', { x: gx, y: gy, width: wPx, height: hPx }, el('clipPath', { id: clipId }, svg));
      const img = el('image', { x: gx, y: gy + hPx - imgPx, width: wPx, height: imgPx, preserveAspectRatio: 'none', 'clip-path': `url(#${clipId})` }, svg);
      loadWallImage(wall.image).then((canvas) => img.setAttribute('href', canvas.toDataURL('image/png')));
    }

    // 설치 여백 가이드(점선) — 자동 배치 벽에만 표시
    const mx = MARGIN.side * scale, my1 = MARGIN.top * scale, my2 = MARGIN.bottom * scale;
    if (!wall.image) el('rect', {
      x: gx + mx, y: gy + my1, width: wPx - mx * 2, height: hPx - my1 - my2,
      fill: 'none', stroke: 'var(--guide)', 'stroke-width': 1, 'stroke-dasharray': '4 4',
    }, svg);

    // 포스터
    items.forEach((it) => {
      const px = gx + it.u * scale;
      const py = gy + it.vTop * scale;
      const pw = it.w * scale;
      const ph = it.h * scale;
      const g = el('g', {}, svg);
      const clipId = `clip-${wall.id}-${it.uid}`.replace(/[^a-zA-Z0-9-]/g, '');
      const clip = el('clipPath', { id: clipId }, svg.querySelector('defs') || el('defs', {}, svg));
      el('rect', { x: px, y: py, width: pw, height: ph }, clip);
      el('image', {
        x: px, y: py, width: pw, height: ph,
        href: `posters/${it.poster.file}`, preserveAspectRatio: 'xMidYMid slice',
        'clip-path': `url(#${clipId})`,
      }, g);
      el('rect', { x: px, y: py, width: pw, height: ph, fill: 'none', stroke: 'var(--poster-edge)', 'stroke-width': 1 }, g);
      if (pw > 30 && ph > 40) {
        const tag = el('text', {
          x: px + 3, y: py + ph - 4, 'font-size': 8, fill: '#fff',
          'paint-order': 'stroke', stroke: 'rgba(0,0,0,.55)', 'stroke-width': 3,
        }, g);
        tag.textContent = it.sizeKey;
      }
    });

    // 하단 mm 눈금자
    const rulerY = gy + hPx + 6;
    el('line', { x1: gx, y1: rulerY, x2: gx + wPx, y2: rulerY, stroke: 'var(--guide-strong)', 'stroke-width': 1 }, svg);
    const step = wall.lengthMM <= 8000 ? 1000 : 2000;
    for (let m = 0; m <= wall.lengthMM; m += step) {
      const tx = gx + m * scale;
      el('line', { x1: tx, y1: rulerY, x2: tx, y2: rulerY + 5, stroke: 'var(--guide-strong)', 'stroke-width': 1 }, svg);
      const t = el('text', { x: tx, y: rulerY + 16, 'font-size': 9, 'text-anchor': 'middle', fill: 'var(--text-dim)' }, svg);
      t.textContent = (m / 1000) + 'm';
    }

    card.appendChild(svg);
    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}
