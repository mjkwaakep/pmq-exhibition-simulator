import { WALLS, POSTER_SIZES, ROOM_WIDTH_MM, ROOM_DEPTH_MM } from './constants.js';
import { buildLayout, countsSummary, autoFillWallCounts } from './pack.js';
import { renderLayoutView } from './view-layout.js';
import { PosterWall3D } from './view-3d.js';
import { tableSettings, TABLE_LIMITS, setTableValue, resetTableSettings, bookTableZs } from './table-settings.js';
import { VIEW_ONLY, VIEW_PARAMS, makeViewLink } from './share.js';
import { translateToEnglish } from './i18n-en.js';
import { WALL_HEIGHT_LIMITS, getWallGap, setWallHeight, setWallLength, setWallGap, resetWallSizes } from './wall-settings.js';

const state = {
  pool: [],
  perWallCounts: {}, // { wall01: {A0,A1,A2}, ... }
  seed: 1,
  layout: null,
  view: 'three', // 처음 열면 3D PERSPECTIVE부터 보여 준다(index.html의 탭·패널 기본값과 맞춤)
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
  three.setCeilingLightsVisible(document.getElementById('toggle-lights').checked); // 기본은 꺼짐
  three.goTo('isoSE');
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

// 실사 렌더 — 버튼을 누르면 지금 카메라로 경로 추적 렌더를 시작하고, 왼쪽 아래에 진행 상황과 저장 버튼을 띄운다.
// 렌더 중에 사이드바의 다른 버튼을 누르면(카메라·버전·표시 옵션 등) 렌더를 멈추고 미리보기로 돌아간다.
function wireRender() {
  const btn = document.getElementById('btn-render');
  const hud = document.getElementById('render-hud');
  const status = document.getElementById('render-status');
  const count = document.getElementById('render-count');
  const bar = document.getElementById('render-bar');
  const save = document.getElementById('render-save');
  const T = VIEW_ONLY
    ? { prepare: 'Preparing render…', render: 'Rendering', done: 'Render complete', idle: '' }
    : { prepare: null, render: '렌더 중', done: '렌더 완료', idle: '' };
  const onStatus = (s) => {
    if (s.phase === 'idle') { hud.hidden = true; btn.classList.remove('rendering'); return; }
    hud.hidden = false;
    btn.classList.add('rendering');
    status.textContent = s.phase === 'prepare' ? (T.prepare || s.text) : (T[s.phase] || s.text);
    const pct = s.progress != null ? Math.min(100, s.progress * 100) : 0;
    count.textContent = s.seconds != null ? `${s.seconds.toFixed(1)}${VIEW_ONLY ? 's' : '초'}` : '';
    bar.style.width = `${pct}%`;
    save.disabled = !(s.phase === 'render' || s.phase === 'done');
  };
  const stop = () => { if (three && three.realRender.active) three.realRender.stop(); };
  btn.addEventListener('click', () => {
    if (state.view !== 'three') document.querySelector('.view-tab[data-view="three"]').click();
    ensureThree();
    const r = three.realRender;
    if (r.active) { r.stop(); return; }
    r.onStatus = onStatus;
    r.start();
  });
  save.addEventListener('click', () => three && three.realRender.save());
  document.getElementById('render-close').addEventListener('click', stop);
  document.querySelector('.panel').addEventListener('click', (e) => {
    if (!three || !three.realRender.active) return;
    if (e.target.closest('#btn-render, .cam-btn')) return; // 카메라 버튼은 렌더를 멈추지 않고 그 시점에서 다시 렌더한다
    if (e.target.closest('button, input, label')) stop();
  }, true);
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
// SPACE 표에서 테이블 위치에 따라 바뀌는 거리 두 줄.
function updateSpaceRows() {
  const fmt = (m) => Math.round(m * 1000).toLocaleString('en-US');
  const zs = bookTableZs(), half = tableSettings.bookDep / 2000;
  const sideTop = ROOM_DEPTH_MM / 1000 - 1.31 - 0.1 - 0.15 - tableSettings.sideDep / 1000; // view-3d.js _buildProps와 같은 값
  document.getElementById('space-wall01-book').textContent = fmt(zs[0] - half - WALLS[0].origin.z / 1000);
  document.getElementById('space-book-side').textContent = fmt(sideTop - zs[3] - half);
}

// (소개 벽·서문 벽 입력칸은 WALL SIZE 표에 있지만 같은 설정 객체를 쓰므로 여기서 함께 묶는다.)
let syncTableInputs = () => {};
function wireTableSettings() {
  const inputs = [...document.querySelectorAll('.tbl-input[data-table]')];
  const sync = syncTableInputs = () => inputs.forEach((input) => { input.value = tableSettings[input.dataset.table]; });
  inputs.forEach((input) => {
    const [min, max] = TABLE_LIMITS[input.dataset.table];
    input.min = min; input.max = max;
    input.addEventListener('change', () => {
      input.value = setTableValue(input.dataset.table, input.value);
      updateSpaceRows();
      if (three) three.rebuildTables();
    });
  });
  document.getElementById('btn-table-reset').addEventListener('click', () => {
    resetTableSettings();
    sync();
    updateSpaceRows();
    if (three) three.rebuildTables();
  });
  sync();
}

// WALL SIZE의 길이·높이·통로 입력 — 값이 바뀌면 LAYOUT/3D의 벽과 치수선을 다시 짓는다.
function wireWallSizes() {
  const byId = (id) => WALLS.find((w) => w.id === id);
  const heights = [...document.querySelectorAll('[data-wall-height]')];
  const lengths = [...document.querySelectorAll('[data-wall-length]')];
  const gap = document.getElementById('wall-gap');
  const fmt = (mm) => Math.round(mm).toLocaleString('en-US');
  const sync = () => {
    heights.forEach((input) => { input.value = byId(input.dataset.wallHeight).heightMM; });
    lengths.forEach((input) => { input.value = byId(input.dataset.wallLength).lengthMM; });
    gap.value = getWallGap();
    // 벽 크기에서 따라 나오는 값(합계, 외벽까지 남는 거리)
    const [w1, , w3] = WALLS;
    document.getElementById('wall-total').textContent = fmt(WALLS.reduce((s, w) => s + w.lengthMM, 0) + getWallGap());
    document.getElementById('space-wall01-window').textContent = fmt(ROOM_WIDTH_MM - w1.origin.x - w1.lengthMM);
    document.getElementById('space-wall03-bottom').textContent = fmt(ROOM_DEPTH_MM - w3.origin.z - w3.lengthMM);
  };
  // 도록 테이블은 Wall02·03 사이 문을 기준으로 놓이므로 벽 크기가 바뀌면 테이블·동선도 다시 짓는다.
  const apply = () => { sync(); updateSpaceRows(); recompute(); if (three) three.rebuildTables(); };
  heights.forEach((input) => {
    [input.min, input.max] = WALL_HEIGHT_LIMITS;
    input.addEventListener('change', () => { setWallHeight(input.dataset.wallHeight, input.value); apply(); });
  });
  lengths.forEach((input) => {
    input.addEventListener('change', () => { setWallLength(input.dataset.wallLength, input.value); apply(); });
  });
  gap.addEventListener('change', () => { setWallGap(gap.value); apply(); });
  document.getElementById('btn-wall-reset').addEventListener('click', () => {
    resetWallSizes();
    resetTableSettings(true); // 소개 벽·서문 벽
    syncTableInputs();
    apply();
    if (three) three.rebuildTables();
  });
  sync();
}

// 편집 화면: 지금 설정을 담은 보기 전용 링크를 만들어 복사한다.
// 보기 전용 화면: 수정 칸을 잠그고, 링크에 담긴 전시 버전을 고른다.
function wireViewOnly() {
  if (VIEW_ONLY) {
    document.body.classList.add('view-only');
    translateToEnglish(); // 기획자 공유용 화면은 메뉴를 영어로
    document.querySelectorAll('.tbl-input').forEach((input) => { input.readOnly = true; input.tabIndex = -1; });
    const ver = document.querySelector(`.ver-btn[data-ver="${VIEW_PARAMS.v}"]`);
    if (ver) ver.click();
    return;
  }
  const btn = document.getElementById('btn-share');
  const out = document.getElementById('share-link');
  btn.addEventListener('click', async () => {
    const link = makeViewLink({
      t: tableSettings,
      h: Object.fromEntries(WALLS.map((w) => [w.id, w.heightMM])),
      l: { ...Object.fromEntries(WALLS.map((w) => [w.id, w.lengthMM])), gap: getWallGap() },
      v: document.querySelector('.ver-btn.active')?.dataset.ver,
    });
    out.value = link;
    out.hidden = false;
    out.select();
    try { await navigator.clipboard.writeText(link); btn.textContent = '복사됨 — 기획자에게 이 링크를 보내세요'; }
    catch (e) { btn.textContent = '아래 링크를 복사해 보내세요'; }
    setTimeout(() => { btn.textContent = '보기 전용 링크 복사'; }, 3000);
  });
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
  wireRender();
  wireSceneToggles();
  wireTableSettings();
  wireWallSizes();
  updateSpaceRows();
  await loadPool();

  // 기본값: 3벽 모두 "꽉 채우기" 결과로 시작 (레퍼런스처럼 A0/A1/A2가 고르게 섞여 촘촘하게 채워짐)
  WALLS.forEach((wall) => {
    const filled = autoFillWallCounts(wall, state.pool, 1);
    state.perWallCounts[wall.id] = filled;
    writeCountsToDOM(wall.id, filled);
  });

  recompute();
  wireViewOnly(); // 3D 뷰가 만들어진 뒤라야 링크의 전시 버전을 적용할 수 있다
  document.getElementById('loading').hidden = true;
}

main();
