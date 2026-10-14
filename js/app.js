import { WALLS, POSTER_SIZES } from './constants.js';
import { buildLayout, countsSummary, autoFillWallCounts } from './pack.js';
import { renderLayoutView } from './view-layout.js';
import { PosterWall3D } from './view-3d.js';
import { tableSettings, TABLE_LIMITS, setTableValue, resetTableSettings } from './table-settings.js';
import { WALL_HEIGHT_LIMITS, setWallHeight, resetWallHeights } from './wall-settings.js';

const state = {
  pool: [],
  perWallCounts: {}, // { wall01: {A0,A1,A2}, ... }
  seed: 1,
  layout: null,
  view: 'layout',
};

let three = null;

async function loadPool() {
  const res = await fetch('posters.json', { cache: 'no-store' });
  state.pool = await res.json();
}

function recompute() {
  state.layout = buildLayout({ perWallCounts: state.perWallCounts, pool: state.pool, seed: state.seed });
  // 시안 이미지가 지정된 벽은 자동 배치 결과를 쓰지 않는다(이미지를 그대로 표시).
  state.layout.walls.forEach((entry) => { if (entry.wall.image) entry.items = []; });
  updateCountUI();
  renderActiveView();
}

function updateCountUI() {
  const summary = countsSummary(state.layout);
  summary.forEach((s) => {
    const block = document.querySelector(`.wall-count-block[data-wall="${s.id}"]`);
    if (!block) return;
    block.querySelector('.wcb-total').textContent = s.requested;
    block.querySelector('.wcb-placed').textContent = s.placed;
    const warn = block.querySelector('.wcb-warn');
    if (s.unplaced > 0) {
      warn.hidden = false;
      warn.textContent = `⚠ 이 벽 면적을 초과해 ${s.unplaced}장을 배치하지 못했습니다.`;
    } else {
      warn.hidden = true;
    }
  });
}

function renderActiveView() {
  if (state.view === 'layout') {
    renderLayoutView(document.getElementById('view-layout'), state.layout);
  } else if (state.view === 'three') {
    ensureThree();
    three.setWalls(WALLS);
    three.setPosters(state.layout);
  }
}

function ensureThree() {
  if (three) return;
  three = new PosterWall3D(document.getElementById('three-canvas'));
  three.goTo('full');
}

// ---------------- Per-wall poster-count panel ----------------

function buildCountPanel() {
  const root = document.getElementById('poster-counts');
  root.innerHTML = '<div class="ctrl-label">POSTER COUNT (벽별)</div>';
  WALLS.forEach((wall) => {
    const block = document.createElement('div');
    block.className = 'wall-count-block';
    block.dataset.wall = wall.id;
    block.innerHTML = `
      <div class="wall-count-head">
        <span class="wcb-name">${wall.name}</span>
        <span class="wcb-dim">${wall.lengthMM.toLocaleString()}mm</span>
        <span class="wcb-tag ${wall.material}">${wall.material === 'opaque' ? '불투명' : '반투명'}</span>
      </div>
      ${Object.keys(POSTER_SIZES).map((sizeKey) => {
        const s = POSTER_SIZES[sizeKey];
        return `
        <div class="count-row" data-size="${sizeKey}">
          <span class="count-name">${sizeKey} <em>${s.w}×${s.h}</em></span>
          <div class="count-input">
            <button class="step" data-dir="-1">−</button>
            <input type="number" min="0" max="300" value="0" />
            <button class="step" data-dir="1">+</button>
          </div>
        </div>`;
      }).join('')}
      <div class="wall-count-total">TOTAL <span class="wcb-total">0</span>장 · 배치됨 <span class="wcb-placed">-</span>장</div>
      <div class="count-warn wcb-warn" hidden></div>
      <button class="wall-count-fill" data-wall-fill="${wall.id}">이 벽 꽉 채우기</button>
    `;
    root.appendChild(block);
  });
}

function readCountsFromDOM(wallId) {
  const block = document.querySelector(`.wall-count-block[data-wall="${wallId}"]`);
  const counts = {};
  block.querySelectorAll('.count-row').forEach((row) => {
    counts[row.dataset.size] = parseInt(row.querySelector('input').value, 10) || 0;
  });
  return counts;
}

function writeCountsToDOM(wallId, counts) {
  const block = document.querySelector(`.wall-count-block[data-wall="${wallId}"]`);
  block.querySelectorAll('.count-row').forEach((row) => {
    row.querySelector('input').value = counts[row.dataset.size] || 0;
  });
}

function wireCountPanel() {
  document.querySelectorAll('.wall-count-block').forEach((block) => {
    const wallId = block.dataset.wall;
    const apply = () => {
      state.perWallCounts[wallId] = readCountsFromDOM(wallId);
      recompute();
    };
    block.querySelectorAll('.count-row').forEach((row) => {
      const input = row.querySelector('input');
      row.querySelectorAll('.step').forEach((btn) => {
        btn.addEventListener('click', () => {
          input.value = Math.max(0, (parseInt(input.value, 10) || 0) + parseInt(btn.dataset.dir, 10));
          apply();
        });
      });
      input.addEventListener('change', () => {
        input.value = Math.max(0, Math.min(300, parseInt(input.value, 10) || 0));
        apply();
      });
    });
    block.querySelector('[data-wall-fill]').addEventListener('click', () => {
      const wall = WALLS.find((w) => w.id === wallId);
      const filled = autoFillWallCounts(wall, state.pool, Date.now() % 2147483647);
      state.perWallCounts[wallId] = filled;
      writeCountsToDOM(wallId, filled);
      recompute();
    });
  });
}

// ---------------- Other UI wiring ----------------

function wireViewTabs() {
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      state.view = v;
      document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));
      document.getElementById(v === 'layout' ? 'view-layout' : 'view-three').classList.add('active');
      document.getElementById('camera-group').hidden = v !== 'three';
      renderActiveView();
      if (v === 'three') requestAnimationFrame(() => three && three._resize());
    });
  });
}

function wireActions() {
  document.getElementById('btn-random').addEventListener('click', () => {
    state.seed = Date.now() % 2147483647;
    recompute();
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    state.seed = 1;
    WALLS.forEach((wall) => {
      const filled = autoFillWallCounts(wall, state.pool, 1);
      state.perWallCounts[wall.id] = filled;
      writeCountsToDOM(wall.id, filled);
    });
    recompute();
  });
}

function wireCameraButtons() {
  document.querySelectorAll('.cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ensureThree();
      three.goTo(btn.dataset.cam);
    });
  });
}

function wireSceneToggles() {
  document.querySelectorAll('.ver-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ver-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (three) three.setBookVersion(btn.dataset.ver);
    });
  });

  [['toggle-dims', 'setDimsVisible'], ['toggle-flow', 'setFlowVisible'], ['toggle-site', 'setSiteVisible'], ['toggle-perimeter', 'setPerimeterVisible'], ['toggle-columns', 'setColumnsVisible'], ['toggle-exits', 'setExitZonesVisible']].forEach(([id, fn]) => {
    document.getElementById(id).addEventListener('change', (e) => { if (three) three[fn](e.target.checked); });
  });
  document.getElementById('toggle-tables').addEventListener('change', (e) => {
    ensureThree();
    three.setTablesVisible(e.target.checked);
  });
  document.getElementById('toggle-people').addEventListener('change', (e) => {
    ensureThree();
    three.setPeopleVisible(e.target.checked);
  });
  document.getElementById('toggle-lights').addEventListener('change', (e) => {
    ensureThree();
    three.setCeilingLightsVisible(e.target.checked);
  });
}

// TABLE SIZE 입력 — 값이 바뀌면 3D 테이블·치수선을 다시 짓는다.
function wireTableSettings() {
  const inputs = [...document.querySelectorAll('.tbl-input[data-table]')];
  const sync = () => inputs.forEach((input) => { input.value = tableSettings[input.dataset.table]; });
  inputs.forEach((input) => {
    const [min, max] = TABLE_LIMITS[input.dataset.table];
    input.min = min; input.max = max;
    input.addEventListener('change', () => {
      input.value = setTableValue(input.dataset.table, input.value);
      if (three) three.rebuildTables();
    });
  });
  document.getElementById('btn-table-reset').addEventListener('click', () => {
    resetTableSettings();
    sync();
    if (three) three.rebuildTables();
  });
  sync();
}

// WALL SIZE의 높이 입력 — 값이 바뀌면 LAYOUT/3D의 벽과 치수선을 다시 짓는다.
function wireWallHeights() {
  const inputs = [...document.querySelectorAll('[data-wall-height]')];
  const sync = () => inputs.forEach((input) => { input.value = WALLS.find((w) => w.id === input.dataset.wallHeight).heightMM; });
  const apply = () => { recompute(); if (three) three.rebuildDimensions(); };
  inputs.forEach((input) => {
    [input.min, input.max] = WALL_HEIGHT_LIMITS;
    input.addEventListener('change', () => {
      input.value = setWallHeight(input.dataset.wallHeight, input.value);
      apply();
    });
  });
  document.getElementById('btn-wall-reset').addEventListener('click', () => {
    resetWallHeights();
    sync();
    apply();
  });
  sync();
}

async function main() {
  // 모든 벽이 시안 이미지로 고정돼 있으면 자동 배치용 컨트롤(수량·간격·랜덤)은 숨긴다.
  if (WALLS.every((w) => w.image)) {
    document.querySelectorAll('[data-auto-layout]').forEach((n) => { n.hidden = true; });
  }
  buildCountPanel();
  wireCountPanel();
  wireViewTabs();
  wireActions();
  wireCameraButtons();
  wireSceneToggles();
  wireTableSettings();
  wireWallHeights();
  await loadPool();

  // 기본값: 3벽 모두 "꽉 채우기" 결과로 시작 (레퍼런스처럼 A0/A1/A2가 고르게 섞여 촘촘하게 채워짐)
  WALLS.forEach((wall) => {
    const filled = autoFillWallCounts(wall, state.pool, 1);
    state.perWallCounts[wall.id] = filled;
    writeCountsToDOM(wall.id, filled);
  });

  recompute();
  document.getElementById('loading').hidden = true;
}

main();
