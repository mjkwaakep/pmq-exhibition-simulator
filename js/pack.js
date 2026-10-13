// ============================================================================
// 포스터 배치(패킹) 엔진 — mm 단위 실측 계산.
// 화면 표시는 축소하지만 이 파일 안의 모든 숫자는 실제 mm다.
//
// 각 벽은 완전히 독립된 면이다(한 벽이 넘치면 다른 벽으로 흘려보내지 않음).
//
// 순수 MaxRects(항상 "가장 낭비가 적은 딱 하나의 자리"를 고름)는 밀도는 높지만
// 결과가 격자처럼 규칙적으로 보인다. 그래서 같은 "빈 사각형(free rect)" 추적은
// 그대로 쓰되(밀도를 지켜주는 핵심 장치), 자리를 고르는 방식을 바꿨다:
//
//   1) A0/A1/A2를 하나의 리스트로 합쳐 순서를 완전히 무작위로 섞는다.
//   2) 포스터마다, 지금 들어갈 수 있는 여러 빈 사각형 각각에서 후보 위치를 뽑는다 —
//      사각형의 모서리(가장 낭비 없는 자리) 하나와, 거기서 조금씩 랜덤하게 벗어난
//      지점 몇 개(50mm 최소 간격은 지키되 그 이상 여백이 생기는 자리)를 함께 만든다.
//   3) 모든 후보를 (a) 주변에 다른 크기가 많을수록 +, 같은 크기가 많을수록 −
//      (b) 위/아래/왼쪽 경계선이 이미 있는 포스터와 나란히 맞춰지면 − 로 채점하고,
//   4) 유일한 최고점이 아니라 상위 후보들(top-K) 중 하나를 무작위로 고른다.
//   그러면 "이 자리가 기하학적으로 가장 빈틈없다"만으로 결정되지 않고, 매번 다른
//   모서리·다른 여백·다른 조합이 뽑혀서 격자처럼 보이지 않으면서도 빈 사각형이라는
//   실제로 밀도를 보장하는 자리 후보 안에서만 고르기 때문에 밀도가 크게 떨어지지
//   않는다.
//
// 간격은 포스터마다 GAP_MM/2씩 패딩을 둔 "확장 발자국"으로 계산해서, 어떤 두
// 포스터가 맞닿게 배치돼도 정확히 GAP_MM(50mm) — 그 이하로는 절대 가까워지지
// 않는다.
// ============================================================================
import { GAP_MM, MARGIN, WALLS, POSTER_SIZES, FILL_RATIO } from './constants.js';

const EPS = 1e-6;
const MIN_FREE_MM = 60;         // 이보다 작은 빈 사각형은(A2도 못 들어감) 정리 대상
const PACK_ATTEMPTS = 6;        // 전체 레이아웃 후보를 여러 개 만들어서 가장 점수 높은 것을 채택

const FREE_RECT_SAMPLE = 28;    // 후보를 뽑을 빈 사각형을 이 개수만큼만 무작위로 살펴봄(성능)
const JITTER_PER_RECT = 5;      // 사각형 하나당 모서리 + 이 개수만큼의 랜덤 지점
const JITTER_MAX_MM = 90;       // 모서리에서 벗어날 수 있는 최대 거리(그 이상 여백 생김)
const TOP_K = 6;                // 채점 후 이 안에서 무작위로 하나 선택
const NEAR_RADIUS_MM = 650;     // 이 거리 안의 포스터들을 "주변"으로 보고 크기 분산 채점
const ALIGN_TOL_MM = 35;        // 경계선이 "나란히 맞았다"고 볼 허용오차

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildWallItems(wall, counts, pool, startCursor) {
  let cursor = startCursor;
  const items = [];
  for (const sizeKey of Object.keys(counts)) {
    const size = POSTER_SIZES[sizeKey];
    for (let i = 0; i < counts[sizeKey]; i++) {
      const poster = pool[cursor % pool.length];
      cursor++;
      if (!poster) continue;
      items.push({ uid: `${wall.id}-${sizeKey}-${i}-${poster.id}`, sizeKey, w: size.w, h: size.h, poster });
    }
  }
  return { items, endCursor: cursor };
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}
function isContained(a, b) {
  return a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;
}

/** 새로 배치한 사각형과 겹치는 빈 사각형들을 4방향 남은 조각으로 쪼갠 뒤, 서로 포함관계인 중복은 정리한다. */
function splitFreeRects(freeRects, placed) {
  const next = [];
  for (const fr of freeRects) {
    if (!rectsIntersect(fr, placed)) { next.push(fr); continue; }
    if (placed.x > fr.x + EPS) next.push({ x: fr.x, y: fr.y, w: placed.x - fr.x, h: fr.h });
    if (placed.x + placed.w < fr.x + fr.w - EPS) next.push({ x: placed.x + placed.w, y: fr.y, w: (fr.x + fr.w) - (placed.x + placed.w), h: fr.h });
    if (placed.y > fr.y + EPS) next.push({ x: fr.x, y: fr.y, w: fr.w, h: placed.y - fr.y });
    if (placed.y + placed.h < fr.y + fr.h - EPS) next.push({ x: fr.x, y: placed.y + placed.h, w: fr.w, h: (fr.y + fr.h) - (placed.y + placed.h) });
  }
  const kept = next.filter((r) => r.w >= MIN_FREE_MM && r.h >= MIN_FREE_MM);
  const pruned = [];
  for (let i = 0; i < kept.length; i++) {
    let contained = false;
    for (let j = 0; j < kept.length; j++) {
      if (i === j) continue;
      if (isContained(kept[i], kept[j]) && !(isContained(kept[j], kept[i]) && j < i)) { contained = true; break; }
    }
    if (!contained) pruned.push(kept[i]);
  }
  return pruned;
}

function collidesAny(fx, fy, fw, fh, footprints) {
  for (const p of footprints) {
    if (fx < p.fx + p.fw - EPS && fx + fw > p.fx + EPS && fy < p.fy + p.fh - EPS && fy + fh > p.fy + EPS) return true;
  }
  return false;
}

/** 후보 위치(실제 좌표 rx,ry — 벽 최종 좌표계) 하나를 채점한다. 높을수록 좋다. */
function scoreCandidate(rx, ry, item, placed, rng) {
  let sameNear = 0, diffNear = 0, localCount = 0, alignPenalty = 0;
  const rw = item.w, rh = item.h;
  for (const p of placed) {
    const dx = Math.max(rx - (p.u + p.w), p.u - (rx + rw), 0);
    const dy = Math.max(ry - (p.vTop + p.h), p.vTop - (ry + rh), 0);
    const dist = dx === 0 ? dy : (dy === 0 ? dx : Math.hypot(dx, dy));
    if (dist < NEAR_RADIUS_MM) {
      localCount++;
      if (p.sizeKey === item.sizeKey) sameNear++; else diffNear++;
    }
    if (Math.abs(ry - p.vTop) < ALIGN_TOL_MM) alignPenalty++;
    if (Math.abs((ry + rh) - (p.vTop + p.h)) < ALIGN_TOL_MM) alignPenalty++;
    if (Math.abs(rx - p.u) < ALIGN_TOL_MM) alignPenalty++;
  }
  return localCount * 2.2 + diffNear * 5 - sameNear * 6 - alignPenalty * 3.5 + rng() * 9;
}

/**
 * 자유배치(freeform) 랜덤 패킹. 빈 사각형 추적으로 밀도를 보장하면서, 사각형 안에서
 * 고르는 지점과 그 지점들 사이의 최종 선택을 무작위화해서 격자처럼 보이지 않게 한다.
 */
function packWallFreeform(items, wall, rng) {
  const usableW = wall.lengthMM - MARGIN.side * 2;
  const usableH = wall.heightMM - MARGIN.top - MARGIN.bottom;

  const order = shuffled(items, rng); // STEP 1+2: 하나의 리스트로 합쳐 완전히 무작위로 섞기
  let freeRects = [{ x: 0, y: 0, w: usableW, h: usableH }];
  const placed = [];       // 최종 좌표(u, vTop = MARGIN 포함) 리스트
  const footprints = [];   // 충돌 검사용 발자국(GAP 포함, MARGIN 미포함, usable 상대좌표)
  const leftover = [];

  for (const item of order) {
    const fw = item.w + GAP_MM, fh = item.h + GAP_MM;
    if (fw > usableW || fh > usableH) { leftover.push(item); continue; }

    const fitting = freeRects.filter((fr) => fr.w + EPS >= fw && fr.h + EPS >= fh);
    if (fitting.length === 0) { leftover.push(item); continue; }

    const sample = shuffled(fitting, rng).slice(0, FREE_RECT_SAMPLE);
    const candidates = [];
    for (const fr of sample) {
      // 모서리(가장 낭비 없는 자리)
      candidates.push({ fx: fr.x, fy: fr.y, jitter: 0 });
      // 모서리에서 랜덤하게 벗어난 지점들(그만큼 여백이 더 생김) — 사각형 범위 안에서만.
      // 벗어난 거리(jitter)를 기록해둬서 채점할 때 "너무 헐렁한" 후보에 작게 감점한다.
      for (let k = 0; k < JITTER_PER_RECT; k++) {
        const maxJx = Math.min(JITTER_MAX_MM, fr.w - fw);
        const maxJy = Math.min(JITTER_MAX_MM, fr.h - fh);
        const jx = maxJx > 0 ? rng() * maxJx : 0;
        const jy = maxJy > 0 ? rng() * maxJy : 0;
        candidates.push({ fx: fr.x + jx, fy: fr.y + jy, jitter: jx + jy });
      }
    }
    const valid = candidates.filter((c) => !collidesAny(c.fx, c.fy, fw, fh, footprints));
    if (valid.length === 0) { leftover.push(item); continue; }

    const scored = valid.map((c) => ({
      ...c,
      score: scoreCandidate(c.fx + GAP_MM / 2 + MARGIN.side, c.fy + GAP_MM / 2 + MARGIN.top, item, placed, rng)
        - c.jitter * 0.25, // 헐렁할수록 아주 조금씩 감점(밀도 유지) — 그래도 다양성 점수가 크면 뒤집힘
    }));
    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, Math.min(TOP_K, scored.length));
    const chosen = topK[Math.floor(rng() * topK.length)];

    const u = chosen.fx + GAP_MM / 2 + MARGIN.side;
    const vTop = chosen.fy + GAP_MM / 2 + MARGIN.top;
    placed.push({ ...item, u, vTop });
    footprints.push({ fx: chosen.fx, fy: chosen.fy, fw, fh });
    freeRects = splitFreeRects(freeRects, { x: chosen.fx, y: chosen.fy, w: fw, h: fh });
  }

  return { items: placed, leftover };
}

/**
 * 완성된 레이아웃 하나를 평가한다: 점유율은 높을수록, 같은 사이즈가 맞닿은 비율은
 * 낮을수록 좋은 점수. packWallBest가 여러 후보 중 이 점수로 고른다.
 */
function scoreLayout(placedItems, wall) {
  const usableW = wall.lengthMM - MARGIN.side * 2;
  const usableH = wall.heightMM - MARGIN.top - MARGIN.bottom;
  const usableArea = usableW * usableH;
  const fillArea = placedItems.reduce((s, it) => s + it.w * it.h, 0);
  const fillRatio = fillArea / usableArea;

  let touchingPairs = 0, sameSizeTouching = 0;
  for (let i = 0; i < placedItems.length; i++) {
    const a = placedItems[i];
    for (let j = i + 1; j < placedItems.length; j++) {
      const b = placedItems[j];
      const dx = Math.max(a.u - (b.u + b.w), b.u - (a.u + a.w), 0);
      const dy = Math.max(a.vTop - (b.vTop + b.h), b.vTop - (a.vTop + a.h), 0);
      const dist = dx === 0 ? dy : (dy === 0 ? dx : Math.hypot(dx, dy));
      if (dist <= 60) {
        touchingPairs++;
        if (a.sizeKey === b.sizeKey) sameSizeTouching++;
      }
    }
  }
  const sameSizeRatio = touchingPairs > 0 ? sameSizeTouching / touchingPairs : 0;

  return fillRatio * 100 - sameSizeRatio * 18;
}

function packWallBest(wall, counts, pool, seed, startCursor) {
  const { items, endCursor } = buildWallItems(wall, counts, pool, startCursor);
  const wallSalt = hashStr(wall.id);
  let best = null;
  for (let a = 0; a < PACK_ATTEMPTS; a++) {
    const rng = mulberry32((seed ^ wallSalt ^ Math.imul(a + 1, 0x2545f4)) >>> 0);
    const { items: placed, leftover } = packWallFreeform(items, wall, rng);
    const score = leftover.length === 0 ? scoreLayout(placed, wall) : -1e9 - leftover.length;
    if (!best || score > best.score) best = { placed, leftover, score };
  }
  return { ...(best || { placed: [], leftover: [] }), endCursor };
}

/**
 * 전체 레이아웃 생성 — 3개 벽을 각각 독립적으로 채운다.
 * @param {object} opts
 * @param {Record<string,{A0:number,A1:number,A2:number}>} opts.perWallCounts
 * @param {Array} opts.pool
 * @param {number} opts.seed
 */
export function buildLayout({ perWallCounts, pool, seed = 1 }) {
  const seedRng = mulberry32(seed >>> 0);
  let cursor = Math.floor(seedRng() * pool.length);

  const wallResults = WALLS.map((wall) => {
    const counts = perWallCounts[wall.id] || { A0: 0, A1: 0, A2: 0 };
    const { placed, leftover, endCursor } = packWallBest(wall, counts, pool, seed, cursor);
    cursor = endCursor;
    return { wall, counts, items: placed, unplaced: leftover };
  });

  return { seed, perWallCounts, walls: wallResults };
}

export function countsSummary(layout) {
  return layout.walls.map(({ wall, counts, items, unplaced }) => ({
    id: wall.id,
    name: wall.name,
    counts,
    requested: counts.A0 + counts.A1 + counts.A2,
    placed: items.length,
    unplaced: unplaced.length,
  }));
}

/**
 * 한 벽을 "꽉 채우는" 수량을 실제로 패킹을 반복 시도해서 찾아낸다(추정치가 아니라
 * 진짜 패킹 결과 기준). FILL_RATIO 비율의 배수(scale)를 이분 탐색해서 넘치지 않는
 * 최대 배수를 찾고, 그다음 낱개 단위로 A2 → A1 → A0 순으로 한 번 더 욱여넣어 본다.
 */
export function autoFillWallCounts(wall, pool, seed = 1) {
  const step = FILL_RATIO;
  const countsAt = (k) => ({ A0: step.A0 * k, A1: step.A1 * k, A2: step.A2 * k });
  const fits = (c) => packWallBest(wall, c, pool, seed, 0).leftover.length === 0;

  let lo = 0, hi = 1;
  while (fits(countsAt(hi)) && hi < 4096) hi *= 2;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(countsAt(mid))) lo = mid; else hi = mid;
  }
  let counts = countsAt(lo);

  for (const k of ['A2', 'A1', 'A0']) {
    let g = 0;
    while (g++ < 60) {
      const next = { ...counts, [k]: counts[k] + 1 };
      if (fits(next)) counts = next; else break;
    }
  }
  return counts;
}
