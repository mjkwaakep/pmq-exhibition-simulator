// ============================================================================
// 가벽 높이 설정(mm) — 사이드바 "WALL SIZE"에서 바꾸는 값.
// constants.js의 WALLS[].heightMM을 직접 고쳐 쓰므로 LAYOUT·3D·치수선이 모두 같은 값을 본다.
// 포스터 시안 이미지는 원래 높이(imageHeightMM)대로 바닥에 맞춰 두고 늘이거나 줄이지 않는다.
// ============================================================================
import { WALLS, ROOM_HEIGHT_MM } from './constants.js';

export const WALL_HEIGHT_LIMITS = [1000, ROOM_HEIGHT_MM]; // 층고(5m)를 넘을 수 없다
const DEFAULTS = Object.fromEntries(WALLS.map((w) => [w.id, w.heightMM]));
const STORAGE_KEY = 'pmq-wall-heights';

function clamp(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(WALL_HEIGHT_LIMITS[1], Math.max(WALL_HEIGHT_LIMITS[0], n));
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(WALLS.map((w) => [w.id, w.heightMM]))));
  } catch (e) { /* 저장 불가 환경은 무시 */ }
}

export function setWallHeight(id, value) {
  const wall = WALLS.find((w) => w.id === id);
  wall.heightMM = clamp(value, wall.heightMM);
  save();
  return wall.heightMM;
}

export function resetWallHeights() {
  WALLS.forEach((w) => { w.heightMM = DEFAULTS[w.id]; });
  save();
}

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  WALLS.forEach((w) => { if (w.id in saved) w.heightMM = clamp(saved[w.id], w.heightMM); });
} catch (e) { /* 저장값이 깨졌으면 기본값 */ }
