// ============================================================================
// 테이블·전시 소개 벽 치수 설정(mm) — 사이드바 "TABLE SIZE"에서 바꾸는 값.
// view-3d.js(_buildProps)와 site-extras.js(buildDimensions)가 같은 객체를 읽는다.
// ============================================================================
import { WALLS } from './constants.js';
import { VIEW_ONLY, VIEW_PARAMS } from './share.js';

export const TABLE_DEFAULTS = {
  bookLen: 8300, bookDep: 500,   // 도록 테이블 4개
  bookAisle: 2000,               // 도록 테이블 가운데 통로 — Wall02·03 사이 문과 같은 선
  sideLen: 1000, sideDep: 500,   // 보조(아이맥) 테이블 4개
  sideGap: 900,                  // 보조 테이블 사이 간격
  leafLen: 6000, leafWid: 900,   // 리플렛 테이블(창 쪽 1개)
  topH: 900,                     // 상판 높이(모든 테이블 공통)
  introLen: 8300, introH: 2500,  // 전시 소개 벽(보조 테이블 뒤) — 낮추면 파티션이 된다
  prefaceLen: 2500, prefaceH: 2400, // 서문 벽 — 소개 벽의 입구 쪽 끝에서 직각으로 꺾여 전시장 안으로 들어온다
};

// 입력 범위 — 방(31 × 20m) 안에 들어가고 다리·상판이 뒤집히지 않는 선.
export const TABLE_LIMITS = {
  bookLen: [1000, 16000], bookDep: [300, 1500],
  bookAisle: [500, 5000],
  sideLen: [500, 3000], sideDep: [300, 1500],
  sideGap: [0, 3000],
  leafLen: [1000, 16000], leafWid: [300, 2500],
  topH: [400, 1500],
  introLen: [1000, 16000], introH: [300, 5000],
  prefaceLen: [500, 6000], prefaceH: [300, 5000],
};

const STORAGE_KEY = 'pmq-table-settings';

export const tableSettings = { ...TABLE_DEFAULTS };

export function clampTableValue(key, value) {
  const [min, max] = TABLE_LIMITS[key];
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return tableSettings[key];
  return Math.min(max, Math.max(min, n));
}

export function setTableValue(key, value) {
  tableSettings[key] = clampTableValue(key, value);
  saveTableSettings();
  return tableSettings[key];
}

// 도록 테이블 4개의 중심 z(m). Wall02·03 사이 문(통로)의 가운데를 기준으로 왼쪽(Wall01 쪽)에 2개,
// 오른쪽(입구 쪽)에 2개를 놓고, 두 묶음 사이에 문과 같은 선으로 가운데 통로(bookAisle)를 둔다.
// 묶음 안의 테이블 사이 간격은 1,850mm. view-3d.js(테이블), site-extras.js(치수선·동선)가 함께 쓴다.
export const BOOK_TABLE_GAP = 1.85;
export function bookTableZs() {
  const [, w2, w3] = WALLS;
  const doorZ = (w2.origin.z + w2.lengthMM + w3.origin.z) / 2000;
  const d = tableSettings.bookDep / 1000, half = tableSettings.bookAisle / 2000, g = BOOK_TABLE_GAP;
  return [doorZ - half - d * 1.5 - g, doorZ - half - d / 2, doorZ + half + d / 2, doorZ + half + d * 1.5 + g];
}

// 사이드바에서 소개 벽·서문 벽은 WALL SIZE에, 나머지는 TABLE SIZE에 있다 — 되돌리기 버튼도 따로 논다.
export const WALL_KEYS = ['introLen', 'introH', 'prefaceLen', 'prefaceH'];

export function resetTableSettings(walls = false) {
  Object.keys(TABLE_DEFAULTS).forEach((k) => { if (WALL_KEYS.includes(k) === walls) tableSettings[k] = TABLE_DEFAULTS[k]; });
  saveTableSettings();
}

function saveTableSettings() {
  if (VIEW_ONLY) return; // 보기 전용 링크에서는 저장하지 않는다
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tableSettings)); } catch (e) { /* 저장 불가 환경은 무시 */ }
}

try {
  const saved = VIEW_ONLY ? (VIEW_PARAMS.t || {}) : JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  Object.keys(TABLE_DEFAULTS).forEach((k) => { if (k in saved) tableSettings[k] = clampTableValue(k, saved[k]); });
} catch (e) { /* 저장값이 깨졌으면 기본값 */ }
