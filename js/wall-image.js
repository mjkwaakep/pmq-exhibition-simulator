// ============================================================================
// 벽 입면 이미지 로더 — 인디자인에서 내보낸 포스터 월 시안(walls/*.png)을 읽어
// 포스터 바깥의 회색 배경만 투명하게 걷어낸 캔버스로 돌려준다. 그래야 LAYOUT에서는
// 벽 색이, 3D에서는 반투명 패널이 포스터 사이로 그대로 보인다.
// 배경은 이미지 가장자리에서 이어진 영역만 지우므로(flood fill) 포스터 안쪽의
// 비슷한 회색은 건드리지 않는다.
// ============================================================================
const BG_TOLERANCE = 14; // 배경색과의 채널별 허용 오차(압축 노이즈 흡수용)
const cache = new Map();

function removeBackground(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const bg = [d[0], d[1], d[2]]; // 좌상단 모서리 = 벽 배경색
  const isBg = (p) => {
    const i = p * 4;
    return Math.abs(d[i] - bg[0]) <= BG_TOLERANCE
      && Math.abs(d[i + 1] - bg[1]) <= BG_TOLERANCE
      && Math.abs(d[i + 2] - bg[2]) <= BG_TOLERANCE;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (!seen[p] && isBg(p)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    d[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  ctx.putImageData(img, 0, 0);
}

/** @returns {Promise<HTMLCanvasElement>} 배경이 투명해진 벽 이미지 */
export function loadWallImage(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0);
        removeBackground(c);
        resolve(c);
      };
      im.onerror = () => reject(new Error(`벽 이미지를 불러오지 못했습니다: ${url}`));
      im.src = url;
    }));
  }
  return cache.get(url);
}
