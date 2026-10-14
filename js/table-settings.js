// ============================================================================
// 테이블 치수 설정(mm) — 사이드바 "TABLE SIZE"에서 바꾸는 값.
// view-3d.js(_buildProps)와 site-extras.js(buildDimensions)가 같은 객체를 읽는다.
// ============================================================================

export const TABLE_DEFAULTS = {
  bookLen: 8300, bookDep: 500,   // 도록 테이블 4개
  sideLen: 1000, sideDep: 500,   // 보조(아이맥) 테이블 4개
  sideGap: 900,                  // 보조 테이블 사이 간격
  leafLen: 6000, leafWid: 900,   // 리플렛 테이블(창 쪽 1개)
  topH: 900,                     // 상판 높이(모든 테이블 공통)
};

// 입력 범위 — 방(31 × 20m) 안에 들어가고 다리·상판이 뒤집히지 않는 선.
export const TABLE_LIMITS = {
  bookLen: [1000, 16000], bookDep: [300, 1500],
  sideLen: [500, 3000], sideDep: [300, 1500],
  sideGap: [0, 3000],
  leafLen: [1000, 16000], leafWid: [300, 2500],
  topH: [400, 1500],
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

export function resetTableSettings() {
  Object.assign(tableSettings, TABLE_DEFAULTS);
  saveTableSettings();
}

function saveTableSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tableSettings)); } catch (e) { /* 저장 불가 환경은 무시 */ }
}

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  Object.keys(TABLE_DEFAULTS).forEach((k) => { if (k in saved) tableSettings[k] = clampTableValue(k, saved[k]); });
} catch (e) { /* 저장값이 깨졌으면 기본값 */ }
