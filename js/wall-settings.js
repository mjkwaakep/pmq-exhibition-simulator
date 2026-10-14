// ============================================================================
// 가벽 크기 설정(mm) — 사이드바 "WALL SIZE"에서 바꾸는 길이·높이·통로 폭.
// constants.js의 WALLS[]를 직접 고쳐 쓰므로 LAYOUT·3D·치수선이 모두 같은 값을 본다.
// 포스터 시안 이미지는 원래 크기(imageLengthMM × imageHeightMM)대로 벽의 시작점(origin)·바닥에
// 맞춰 두고 늘이거나 줄이지 않는다 — 벽이 커지면 빈 벽이 남고, 작아지면 이미지가 잘린다.
// ============================================================================
import { WALLS, ROOM_HEIGHT_MM, ROOM_WIDTH_MM, ROOM_DEPTH_MM, GAP_BETWEEN_TRANSLUCENT_MM } from './constants.js';
import { VIEW_ONLY, VIEW_PARAMS } from './share.js';

const [W1, W2, W3] = WALLS;
const MIN_LEN = 1000;
export const WALL_HEIGHT_LIMITS = [1000, ROOM_HEIGHT_MM]; // 층고(5m)를 넘을 수 없다
export const WALL_GAP_LIMITS = [0, 5000];

const DEFAULT_H = Object.fromEntries(WALLS.map((w) => [w.id, w.heightMM]));
const DEFAULT_L = Object.fromEntries(WALLS.map((w) => [w.id, w.lengthMM]));
const HEIGHT_KEY = 'pmq-wall-heights', LENGTH_KEY = 'pmq-wall-lengths';
let gapMM = GAP_BETWEEN_TRANSLUCENT_MM;

const num = (value, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? n : fallback; };
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
// Wall02 + 통로 + Wall03이 코너에서 하단 외벽까지(방 깊이)를 넘지 않게 한다.
const legRoom = () => ROOM_DEPTH_MM - W1.origin.z;

function place() { W3.origin.z = W2.origin.z + W2.lengthMM + gapMM; }

function save() {
  if (VIEW_ONLY) return; // 보기 전용 링크에서는 저장하지 않는다
  try {
    localStorage.setItem(HEIGHT_KEY, JSON.stringify(Object.fromEntries(WALLS.map((w) => [w.id, w.heightMM]))));
    localStorage.setItem(LENGTH_KEY, JSON.stringify({ ...Object.fromEntries(WALLS.map((w) => [w.id, w.lengthMM])), gap: gapMM }));
  } catch (e) { /* 저장 불가 환경은 무시 */ }
}

export function getWallGap() { return gapMM; }

export function setWallHeight(id, value) {
  const wall = WALLS.find((w) => w.id === id);
  wall.heightMM = clamp(num(value, wall.heightMM), ...WALL_HEIGHT_LIMITS);
  save();
  return wall.heightMM;
}

export function setWallLength(id, value) {
  const wall = WALLS.find((w) => w.id === id);
  const max = wall === W1
    ? ROOM_WIDTH_MM - W1.origin.x                                   // 전면 창까지
    : legRoom() - gapMM - (wall === W2 ? W3 : W2).lengthMM;          // 하단 외벽까지
  wall.lengthMM = clamp(num(value, wall.lengthMM), MIN_LEN, Math.max(MIN_LEN, max));
  place();
  save();
  return wall.lengthMM;
}

export function setWallGap(value) {
  const max = Math.min(WALL_GAP_LIMITS[1], legRoom() - W2.lengthMM - W3.lengthMM);
  gapMM = clamp(num(value, gapMM), WALL_GAP_LIMITS[0], Math.max(0, max));
  place();
  save();
  return gapMM;
}

export function resetWallSizes() {
  WALLS.forEach((w) => { w.heightMM = DEFAULT_H[w.id]; w.lengthMM = DEFAULT_L[w.id]; });
  gapMM = GAP_BETWEEN_TRANSLUCENT_MM;
  place();
  save();
}

try {
  const h = VIEW_ONLY ? (VIEW_PARAMS.h || {}) : JSON.parse(localStorage.getItem(HEIGHT_KEY) || '{}');
  WALLS.forEach((w) => { if (w.id in h) w.heightMM = clamp(num(h[w.id], w.heightMM), ...WALL_HEIGHT_LIMITS); });
  const l = VIEW_ONLY ? (VIEW_PARAMS.l || {}) : JSON.parse(localStorage.getItem(LENGTH_KEY) || '{}');
  const lens = WALLS.map((w) => clamp(num(l[w.id], w.lengthMM), MIN_LEN, ROOM_WIDTH_MM));
  const gap = clamp(num(l.gap, gapMM), ...WALL_GAP_LIMITS);
  // 저장값이 방을 벗어나면(직접 고친 경우 등) 통째로 버리고 기본값을 쓴다.
  if (lens[0] <= ROOM_WIDTH_MM - W1.origin.x && lens[1] + gap + lens[2] <= legRoom()) {
    WALLS.forEach((w, i) => { w.lengthMM = lens[i]; });
    gapMM = gap;
    place();
  }
} catch (e) { /* 저장값이 깨졌으면 기본값 */ }
