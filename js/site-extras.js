// ============================================================================
// 3D 뷰에 덧붙이는 보조 레이어 — 기존 벽/테이블/책은 건드리지 않고 그룹만 추가한다.
//   buildDimensions : 스케치업처럼 화면에 띄우는 치수선(벽·통로·테이블·간격)
//   buildFlow       : 02_포스터월_위치표시.pdf에 표시된 관람 동선 화살표
//   buildSite       : Qube 현장 사진(04_현장사진4)처럼 보이게 하는 마감(카펫·검은 천장·커튼 등)
//   buildColumns    : 원본 도면(Qube information sheet)의 콘크리트 기둥 6개
//   buildExitZones  : 같은 도면의 "No Obstruction Emergency Exit" 구역(비워 둬야 하는 비상구 앞)
// 세 그룹 모두 "3D 옵션" 체크박스로 켜고 끈다.
// ============================================================================
import * as THREE from 'three';
import { ROOM_HEIGHT_MM, ROOM_WIDTH_MM, ROOM_DEPTH_MM, WALLS, FACADE_W_MM, FACADE_H_MM, FACADE_PANES_MM, FACADE_FIN_GAP_MM } from './constants.js';
import { tableSettings, bookTableZs } from './table-settings.js';

const W = ROOM_WIDTH_MM / 1000, D = ROOM_DEPTH_MM / 1000, H = ROOM_HEIGHT_MM / 1000;
const fmt = (m) => Math.round(m * 1000).toLocaleString('en-US');
const TEXT_LABEL_SIZE = 0.0105; // 3D 안의 글자 라벨(영어 표기) — 치수 숫자와 같은 크기

/** 항상 카메라를 바라보고 화면상 크기가 일정한 글자 라벨. */
function makeLabel(text, { fg = '#ffffff', size = 0.0105 } = {}) { // 치수 숫자 기본 크기(처음 0.015의 70%)
  // 박스 없이 글자만 — 어두운 카펫과 흰 벽 어디서도 읽히도록 얇은 어두운 외곽선을 두른다.
  const font = '500 44px "Helvetica Neue", Helvetica, Arial, sans-serif'; // Helvetica Medium
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  c.width = tw + 20; c.height = 64;
  ctx = c.getContext('2d');
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, c.width / 2, c.height / 2 + 2);
  ctx.fillStyle = fg;
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, fog: false, toneMapped: false }));
  sp.scale.set(size * c.width / c.height, size, 1);
  sp.renderOrder = 1000;
  return sp;
}

// ---------------------------------------------------------------- 치수선
export function buildDimensions() {
  const group = new THREE.Group();
  const pts = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // a→b 구간의 치수. off만큼 띄운 곳에 치수선을 긋고 양 끝에 보조선을 내린다.
  const dim = (a, b, off, text) => {
    const o = V(...off), A = V(...a), B = V(...b);
    const p = A.clone().add(o), q = B.clone().add(o);
    const over = o.clone().normalize().multiplyScalar(0.12);
    pts.push(A, p.clone().add(over), B, q.clone().add(over), p, q);
    const label = makeLabel(text || fmt(A.distanceTo(B)));
    label.position.copy(p).add(q).multiplyScalar(0.5);
    group.add(label);
  };

  const w1 = WALLS[0], w2 = WALLS[1], w3 = WALLS[2];
  const cx = w1.origin.x / 1000, cz = w1.origin.z / 1000;
  const L1 = w1.lengthMM / 1000, h1 = w1.heightMM / 1000;
  const L2 = w2.lengthMM / 1000, L3 = w3.lengthMM / 1000, h2 = w2.heightMM / 1000;
  const z2e = cz + L2, z3s = w3.origin.z / 1000, z3e = z3s + L3; // 통로 폭은 wall-settings.js가 Wall03 위치로 반영한다

  // 벽
  // 벽 길이 치수에는 벽 이름을 붙인다 — 예: Wall 02 (7,000)
  const named = (name, m) => `${name} (${fmt(m)})`;
  dim([cx, h1, cz], [cx + L1, h1, cz], [0, 0.35, 0], named('Wall 01', L1));            // Wall 01 길이
  dim([cx + L1, 0, cz], [cx + L1, h1, cz], [0.45, 0, 0]);        // Wall 01 높이
  dim([cx, h2, cz], [cx, h2, z2e], [0, 0.35, 0], named('Wall 02', L2));                // Wall 02 길이
  if (z3s > z2e) dim([cx, h2, z2e], [cx, h2, z3s], [0, 0.35, 0]); // 통로
  dim([cx, h2, z3s], [cx, h2, z3e], [0, 0.35, 0], named('Wall 03', L3));               // Wall 03 길이
  dim([cx, 0, z3e], [cx, h2, z3e], [0, 0, 0.3]);                 // Wall 02·03 높이

  // 도록 테이블 (view-3d.js _buildProps 와 같은 값)
  const ts = tableSettings; // 사이드바 TABLE SIZE 설정(mm)
  const tLen = ts.bookLen / 1000, tDep = ts.bookDep / 1000, tCx = 20.0, tZs = bookTableZs(), tH = ts.topH / 1000;
  const tx1 = tCx - tLen / 2, tx2 = tCx + tLen / 2;
  const tz = (i) => tZs[i];
  dim([tx1, tH, tz(0) - tDep / 2], [tx2, tH, tz(0) - tDep / 2], [0, 0, -0.4]);          // 길이
  dim([tx2, tH, tz(0) - tDep / 2], [tx2, tH, tz(0) + tDep / 2], [0.45, 0, 0]);          // 폭
  for (let i = 0; i < 3; i++) dim([tx2, tH, tz(i) + tDep / 2], [tx2, tH, tz(i + 1) - tDep / 2], [0.45, 0, 0]); // 테이블 간격
  dim([tx1, 0, tz(3) + tDep / 2], [tx1, tH, tz(3) + tDep / 2], [-0.35, 0, 0]);          // 상판 높이
  dim([cx, 0.03, tz(1)], [tx1, 0.03, tz(1)], [0, 0, 1.2]);                              // Wall 02·03 ↔ 테이블
  dim([tx1, 0.03, cz], [tx1, 0.03, tz(0) - tDep / 2], [-0.6, 0, 0]);                    // Wall 01 ↔ 테이블

  // 보조 테이블
  const sLen = ts.sideLen / 1000, sGap = ts.sideGap / 1000, sDep = ts.sideDep / 1000, introFaceZ = D - 1.31, introT = 0.1, introH = ts.introH / 1000;
  const ix1 = tCx - ts.introLen / 2000, ix2 = tCx + ts.introLen / 2000; // 소개 벽
  const sZ = introFaceZ - introT - 0.15 - sDep / 2; // view-3d.js _buildProps 와 같은 값
  const sX0 = tCx - (4 * sLen + 3 * sGap) / 2;
  dim([sX0, tH, sZ - sDep / 2], [sX0 + sLen, tH, sZ - sDep / 2], [0, 0, -0.35]);        // 길이
  if (sGap > 0) dim([sX0 + sLen, tH, sZ - sDep / 2], [sX0 + sLen + sGap, tH, sZ - sDep / 2], [0, 0, -0.35]); // 보조 테이블 간격
  dim([sX0 + 4 * sLen + 3 * sGap, tH, sZ - sDep / 2], [sX0 + 4 * sLen + 3 * sGap, tH, sZ + sDep / 2], [0.45, 0, 0]);                // 폭
  dim([ix2, 0.03, introFaceZ], [ix2, 0.03, D], [1.1, 0, 0]);                            // 소개 벽 ↔ 하단 외벽
  dim([ix1, introH, introFaceZ], [ix2, introH, introFaceZ], [0, 0.3, 0]);               // 소개 벽 길이
  dim([ix1, 0, introFaceZ], [ix1, introH, introFaceZ], [-0.35, 0, 0]);                  // 소개 벽 높이
  // 서문 벽(컴퓨터 벽 입구 쪽 끝에서 직각, 커튼 선에서 시작)
  const pLen = ts.prefaceLen / 1000, pH = ts.prefaceH / 1000, pX = ix2;
  const pS = D - 0.7;
  dim([pX, pH, pS - pLen], [pX, pH, pS], [0, 0.3, 0]);                                  // 서문 벽 길이
  dim([pX, 0, pS - pLen], [pX, pH, pS - pLen], [0, 0, -0.35]);                          // 서문 벽 높이
  dim([tx2, 0.03, tz(3) + tDep / 2], [tx2, 0.03, sZ - sDep / 2], [1.1, 0, 0]);          // 도록 ↔ 보조 테이블

  // 리플렛 테이블(전면 창 쪽, 모서리 굴린 직사각형) — view-3d.js _buildProps 와 같은 값
  const rX = W - 1.95, rHl = ts.leafLen / 2000, rHw = ts.leafWid / 2000;
  dim([rX - rHw, tH, D / 2 - rHl], [rX - rHw, tH, D / 2 + rHl], [-0.4, 0, 0]);          // 길이
  dim([rX - rHw, tH, D / 2 - rHl], [rX + rHw, tH, D / 2 - rHl], [0, 0, -0.4]);          // 폭
  dim([rX + rHw, 0.03, D / 2 + rHl], [W, 0.03, D / 2 + rHl], [0, 0, 0.5]);              // 테이블 ↔ 전면 창

  // 공간
  dim([0, 0.03, 0], [W, 0.03, 0], [0, 0, 0.9]);                                         // 가로
  dim([0, 0.03, 0], [0, 0.03, D], [4.5, 0, 0]);                                         // 깊이
  dim([W, 0, 0], [W, H, 0], [-0.4, 0, 0.4]);                                            // 층고
  dim([0, 0.03, cz], [cx, 0.03, cz], [0, 0, 2.6]);                                      // 왼쪽 외벽 ↔ Wall 01
  dim([cx + L1, 0.03, cz], [W, 0.03, cz], [0, 0, 1.4]);                                 // Wall 01 ↔ 전면 창
  dim([cx + 2, 0.03, 0], [cx + 2, 0.03, cz], [1.2, 0, 0]);                              // 상단 외벽 ↔ Wall 01
  dim([cx, 0.03, z3e], [cx, 0.03, D], [-0.9, 0, 0]);                                    // Wall 03 ↔ 하단 외벽

  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x00b4f0, depthTest: false, fog: false, toneMapped: false })
  );
  lines.renderOrder = 999;
  group.add(lines);
  return group;
}

// ---------------------------------------------------------------- 동선 화살표
export function buildFlow() {
  const group = new THREE.Group();
  const Y = 0.02;
  const mats = {};
  const mat = (color) => mats[color] || (mats[color] = new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false, side: THREE.DoubleSide }));
  // 바닥에 깔리는 점선 + 끝 화살촉. path = [[x,z], ...]
  // 빨간 관람 동선은 파란 화살표의 절반 크기로 더 섬세하게 그린다.
  const arrow = (path, color = 0xff3b30, k = color === 0xff3b30 ? 0.5 : 1) => {
    const m = mat(color);
    const headL = 0.3 * k, headW = 0.11 * k, lineW = 0.03 * k, dash = 0.28 * k, gapL = 0.2 * k;
    for (let i = 0; i < path.length - 1; i++) {
      const a = new THREE.Vector2(...path[i]), b = new THREE.Vector2(...path[i + 1]);
      const last = i === path.length - 2;
      const dir = b.clone().sub(a);
      const len = dir.length() - (last ? headL : 0);
      dir.normalize();
      const ang = Math.atan2(dir.y, dir.x);
      for (let s = 0; s < len; s += dash + gapL) {
        const l = Math.min(dash, len - s);
        const g = new THREE.Mesh(new THREE.PlaneGeometry(l, lineW), m);
        g.rotation.set(-Math.PI / 2, 0, -ang);
        g.position.set(a.x + dir.x * (s + l / 2), Y, a.y + dir.y * (s + l / 2));
        group.add(g);
      }
      if (last) {
        const n = new THREE.Vector2(-dir.y, dir.x);
        const base = b.clone().sub(dir.clone().multiplyScalar(headL));
        const tri = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(b.x, Y, b.y),
          new THREE.Vector3(base.x + n.x * headW, Y, base.y + n.y * headW),
          new THREE.Vector3(base.x - n.x * headW, Y, base.y - n.y * headW),
        ]);
        group.add(new THREE.Mesh(tri, m));
      }
    }
  };

  // 도면 기준: 입구(하단 외벽 오른쪽) → 디지털 존 앞 → Wall 03·02를 따라 위로 → Wall 01을 따라
  // 오른쪽으로 → 테이블 사이를 지그재그 → 다시 입구로(출구 = 입구).
  const ts = tableSettings, tx1 = 20.0 - ts.bookLen / 2000, tx2 = 20.0 + ts.bookLen / 2000;
  const tZs = bookTableZs(), half = ts.bookDep / 2000, wall01Z = WALLS[0].origin.z / 1000;
  // Wall01~테이블1, 테이블 사이 3곳(가운데가 문과 같은 선), 테이블4 아래
  const aisle = [(wall01Z + tZs[0] - half) / 2, ...[0, 1, 2].map((i) => (tZs[i] + tZs[i + 1]) / 2), tZs[3] + half + 1.25];
  arrow([[25.5, D - 0.6], [25.5, 15.4]]);                         // 입구 ↑
  arrow([[25.5, aisle[4]], [21.1, aisle[4]]]);                    // 테이블4 아래 ←
  arrow([[tx1 + 0.1, aisle[4]], [18.7, aisle[4]], [18.7, 16.4]]); // 디지털 존으로 ↓
  arrow([[13.7, 18.6], [13.7, 11.4]]);                            // Wall 03 앞 ↑
  arrow([[13.7, 9.4], [13.7, 5.0]]);                              // Wall 02 앞 ↑
  arrow([[tx1 + 0.1, aisle[0]], [18.7, aisle[0]]]);               // Wall 01 앞 →
  arrow([[20.3, aisle[0]], [26.8, aisle[0]]]);                    // Wall 01 앞 →
  arrow([[26.8, 5.0], [26.8, 8.8]]);                              // 테이블 오른쪽 ↓
  arrow([[tx1 + 0.1, aisle[1]], [18.7, aisle[1]]]);               // 테이블 1·2 사이 →
  arrow([[tx2 - 0.1, aisle[2]], [21.1, aisle[2]]]);               // 테이블 2·3 사이 ←
  arrow([[tx1 + 0.1, aisle[3]], [18.7, aisle[3]]]);               // 테이블 3·4 사이 →
  arrow([[27.2, 15.4], [27.2, D - 0.6]]);                         // 출구 ↓
  arrow([[9.9, 3.2], [9.9, 7.0]], 0x2f6bff);                      // 리테일 구역 입구(파란 화살표)

  // 입구 표시(도면의 초록 원)
  const spot = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 48),
    new THREE.MeshBasicMaterial({ color: 0x5be04a, transparent: true, opacity: 0.55, fog: false, toneMapped: false })
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(26.3, 0.015, D - 1.3);
  group.add(spot);

  const tag = (text, x, y, z, border) => {
    const l = makeLabel(text, { fg: border, size: TEXT_LABEL_SIZE });
    l.position.set(x, y, z);
    group.add(l);
  };
  tag('Entrance · Exit', 26.3, 0.6, D - 1.3, '#7dff6b');
  tag('Entrance to Retail Area', 9.9, 0.6, 5.0, '#8fb4ff');
  return group;
}

// ---------------------------------------------------------------- 현장 재현
function carpetTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2927';
  ctx.fillRect(0, 0, 512, 512);
  // 창 쪽(X 방향)으로 흐르는 가는 결 — 현장 카펫 타일의 줄무늬
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const len = 14 + Math.random() * 60;
    const v = 48 + Math.random() * 62;
    ctx.strokeStyle = `rgba(${v + 8},${v + 2},${v - 2},${0.14 + Math.random() * 0.3})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 17);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function curtainTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 8;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 256; x++) {
    const v = 14 + Math.round(13 * (0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 2 * 8)) + Math.random() * 3);
    ctx.fillStyle = `rgb(${v},${v},${v + 1})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSite() {
  const group = new THREE.Group();
  const curtainH = 3.4; // 커튼 상단(그 위는 밝은 벌크헤드가 보인다)

  // 바닥: 어두운 줄무늬 카펫
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W + 4, D + 4),
    new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0.004, D / 2);
  floor.receiveShadow = true;
  group.add(floor);

  // 천장: 검은 노출 천장
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, D + 4), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(W / 2, H - 0.012, D / 2);
  group.add(ceil);

  // 천장 설비는 따로 묶어 둔다 — 카메라가 천장 위로 올라가면(전체 보기) 숨긴다.
  const ceilGroup = new THREE.Group();
  group.add(ceilGroup);
  group.userData.ceiling = ceilGroup;

  // 천장 라인조명: 방 폭을 가로지르는 길쭉한 사각 루프
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xfff6e6, fog: false });
  const loop = (cxm, wx, dz) => {
    const t = 0.05, y = H - 0.05, czm = D / 2;
    [[wx, t, 0, dz / 2], [wx, t, 0, -dz / 2], [t, dz, wx / 2, 0], [t, dz, -wx / 2, 0]].forEach(([bw, bd, ox, oz]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.03, bd), ledMat);
      bar.position.set(cxm + ox, y, czm + oz);
      ceilGroup.add(bar);
    });
  };
  [3.6, 11.4, 19.2, 27.0].forEach((x) => loop(x, 4.6, 13.5));

  // 트랙 조명: 검은 레일 + 스팟
  const railMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6, metalness: 0.4 });
  [7.5, 15.3, 23.1].forEach((x) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 13), railMat);
    rail.position.set(x, H - 0.12, D / 2);
    ceilGroup.add(rail);
    for (let i = 0; i < 7; i++) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 12), railMat);
      can.position.set(x, H - 0.24, D / 2 - 6 + i * 2);
      can.rotation.z = 0.35;
      ceilGroup.add(can);
    }
  });

  // 가장 바깥 둘레(커튼·출입문·창 쪽)는 따로 묶어 둔다 — "외벽·커튼·출입구 표시" 체크박스로 켜고 끈다.
  const perim = new THREE.Group();
  group.add(perim);
  group.userData.perimeter = perim;

  // 커튼(양쪽 긴 변 + 왼쪽 짧은 변). 하단 외벽 쪽은 출입문 자리만 비운다.
  const curtainBase = curtainTexture();
  const curtain = (len, x, z, rotY, h = curtainH) => {
    const tex = curtainBase.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 1.6, 1);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(len, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, side: THREE.DoubleSide })
    );
    m.rotation.y = rotY;
    m.position.set(x, h / 2, z);
    perim.add(m);
  };
  const doorX1 = 24.8, doorX2 = 27.8, pierW = 1.2; // 출입문 — 원본 도면의 EXIT A(왼쪽 커튼에서 약 26.4m)
  curtain(W - pierW, (W - pierW) / 2, 0.07, 0);                                   // 상단 외벽
  // 하단 외벽: 가운데 구간(x 5.8~24.0m)의 커튼은 벽에서 700mm 앞에 걸려 있고, 양 끝 구간은 벽에 붙어 있다
  // (Qube 커튼 깊이 도면). 왼쪽 끝 구간에는 EXIT B(Lift 2 옆 외여닫이문) 자리를 비운다.
  const exitB1 = 3.3, exitB2 = 4.25, midX1 = 5.8, midX2 = 24.0, midOff = 0.7;
  const bottomRun = (x1, x2, off = 0.07) => curtain(x2 - x1, (x1 + x2) / 2, D - off, Math.PI);
  bottomRun(0, exitB1);
  bottomRun(exitB2, midX1);
  bottomRun(midX1, midX2, midOff);
  bottomRun(midX2, doorX1);                                                       // 하단 외벽(문 왼쪽)
  [midX1, midX2].forEach((x) => curtain(midOff - 0.07, x, D - (midOff + 0.07) / 2, Math.PI / 2)); // 앞으로 나온 구간의 양 끝 막음
  curtain(W - pierW - doorX2, (doorX2 + W - pierW) / 2, D - 0.07, Math.PI);       // 하단 외벽(문 오른쪽)
  curtain(D, 0.07, D / 2, Math.PI / 2);                                           // 왼쪽 외벽

  // 출입문: 유리 양여닫이문 두 짝을 바깥(로비 쪽, +Z)으로 90도 활짝 열어 둔다 + 초록 EXIT 표시
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc0, roughness: 0.4, metalness: 0.6 });
  const doorGlass = new THREE.MeshStandardMaterial({ color: 0xcfd6d8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
  const doorH = 2.3, doorW = doorX2 - doorX1;
  const wallAbove = new THREE.Mesh(new THREE.PlaneGeometry(doorW, curtainH - doorH), new THREE.MeshStandardMaterial({ color: 0xdcdad4, roughness: 0.9 }));
  wallAbove.rotation.y = Math.PI;
  wallAbove.position.set((doorX1 + doorX2) / 2, doorH + (curtainH - doorH) / 2, D - 0.05);
  perim.add(wallAbove);
  const leafW = doorW / 2 - 0.04;
  [[doorX1, 1], [doorX2, -1]].forEach(([hx, dir]) => {
    // 경첩 쪽 기둥에 붙어 바깥으로 열린 문짝(유리 + 테두리)
    const leaf = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(leafW - 0.08, doorH - 0.08), doorGlass);
    glass.position.set(0, doorH / 2, 0);
    leaf.add(glass);
    [[leafW, 0.04, 0, doorH - 0.02], [leafW, 0.04, 0, 0.02], [0.04, doorH, -leafW / 2 + 0.02, doorH / 2], [0.04, doorH, leafW / 2 - 0.02, doorH / 2]].forEach(([w, h, x, y]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frameMat);
      bar.position.set(x, y, 0);
      leaf.add(bar);
    });
    leaf.rotation.y = -dir * Math.PI / 2;                // 바깥(+Z)으로 90도
    leaf.position.set(hx + dir * 0.03, 0, D + leafW / 2 + 0.03);
    perim.add(leaf);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorH, 0.06), frameMat);
    post.position.set(hx, doorH / 2, D - 0.05);
    perim.add(post);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.06, 0.06), frameMat);
  lintel.position.set((doorX1 + doorX2) / 2, doorH, D - 0.05);
  perim.add(lintel);
  const exitSign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.04), new THREE.MeshBasicMaterial({ color: 0x1fbf5a, fog: false }));
  exitSign.position.set((doorX1 + doorX2) / 2, doorH + 0.22, D - 0.1);
  perim.add(exitSign);

  // EXIT B: 외여닫이 문 한 짝 + 초록 EXIT 표시
  {
    const bW = exitB2 - exitB1, bCx = (exitB1 + exitB2) / 2, bH = 2.1;
    const above = new THREE.Mesh(new THREE.PlaneGeometry(bW, curtainH - bH), new THREE.MeshStandardMaterial({ color: 0xdcdad4, roughness: 0.9 }));
    above.rotation.y = Math.PI;
    above.position.set(bCx, bH + (curtainH - bH) / 2, D - 0.05);
    perim.add(above);
    const leafB = new THREE.Mesh(new THREE.PlaneGeometry(bW - 0.08, bH - 0.04), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.7, metalness: 0.2 }));
    leafB.rotation.y = Math.PI;
    leafB.position.set(bCx, bH / 2, D - 0.05);
    perim.add(leafB);
    [exitB1, exitB2].forEach((x) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, bH, 0.06), frameMat);
      post.position.set(x, bH / 2, D - 0.05);
      perim.add(post);
    });
    const lintelB = new THREE.Mesh(new THREE.BoxGeometry(bW, 0.06, 0.06), frameMat);
    lintelB.position.set(bCx, bH, D - 0.05);
    perim.add(lintelB);
    const signB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.04), new THREE.MeshBasicMaterial({ color: 0x1fbf5a, fog: false }));
    signB.position.set(bCx, bH + 0.22, D - 0.1);
    perim.add(signB);
  }

  // 전면 창 쪽: 실측 유리 파사드(폭 16,987 × 높이 6,930mm, 판 14장)를 창 벽 가운데에 두고 양옆은 벽기둥.
  // 창밖 풍경은 보이지 않아도 되므로 어둑한 단색으로 두어 흰 창 그래픽(view-3d.js)이 읽히게 한다.
  const x = W - 0.03;
  const pierMat = new THREE.MeshStandardMaterial({ color: 0xcfcdc7, roughness: 0.9, side: THREE.DoubleSide });
  const fw = FACADE_W_MM / 1000, fh = FACADE_H_MM / 1000, fz1 = (D - fw) / 2, fz2 = fz1 + fw;
  const panel = (z1, z2, y1, y2, mat, dx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(z2 - z1, y2 - y1), mat);
    m.rotation.y = -Math.PI / 2;
    m.position.set(x + dx, (y1 + y2) / 2, (z1 + z2) / 2);
    perim.add(m);
    return m;
  };
  panel(0, fz1, 0, H, pierMat);
  panel(fz2, D, 0, H, pierMat);
  if (H > fh) panel(fz1, fz2, fh, H, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9, side: THREE.DoubleSide }));
  panel(fz1, fz2, 0, fh, new THREE.MeshBasicMaterial({ color: 0x34383c, fog: false }), 0.9); // 창밖(단색) — 실내 쪽 면만 그려 밖에서 볼 때는 가리지 않는다
  // 판 사이 유리 리브 13줄 — 도면의 실측 판 폭대로. 창 그래픽(view-3d.js)은 밖에서 읽히도록 좌우 반전해 붙이므로
  // 그래픽 속 리브 선과 맞도록 도면의 왼쪽 끝을 높은 z(fz2) 쪽에 둔다.
  let acc = 0;
  FACADE_PANES_MM.slice(0, -1).forEach((pw, i) => {
    acc += pw + (i > 0 ? FACADE_FIN_GAP_MM : 0);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, fh, 0.03), frameMat);
    bar.position.set(x, fh / 2, fz2 - (acc + FACADE_FIN_GAP_MM / 2) / 1000);
    perim.add(bar);
  });

  // 컨트롤 부스 — 원본 도면 왼쪽 위(왼쪽 커튼에서 약 5.9~11.3m, 상단 벽에서 약 2.6m 돌출). 도면에서 잰 근삿값.
  const booth = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 2.6, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.85, transparent: true, opacity: 0.85 })
  );
  booth.position.set(8.6, 1.3, 0.1 + 1.25);
  group.add(booth);

  // 왼쪽 계단 개구부 난간(창 가까운 상단 외벽 쪽)
  const railing = new THREE.Group();
  const rl = 3.2, rh = 1.05;
  [rh, rh * 0.5].forEach((y) => {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, rl, 10), frameMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, y, 0);
    railing.add(bar);
  });
  for (let i = 0; i <= 4; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, rh, 10), frameMat);
    p.position.set(-rl / 2 + (rl * i) / 4, rh / 2, 0);
    railing.add(p);
  }
  railing.position.set(W - 3.4, 0, 1.3);
  group.add(railing);

  return group;
}

// ---------------------------------------------------------------- 기둥 · 비상구 확보 구역
// 치수 출처: Qube_information_sheet_update_V3.pdf. x는 왼쪽 벽면, z는 상단 벽면에서 잰 값(m)이고
// 치수가 적혀 있지 않은 값(기둥 깊이·z 위치, 왼쪽 비상구 z)은 도면에서 잰 근삿값(±0.1m)이다.
const COLUMNS = [ // [x1, x2, z1, z2] — 600(500) × 약 1,200, 벽에서 약 1.3m 떨어져 서 있다
  [5.59, 6.19, 1.26, 2.45], [14.614, 15.214, 1.26, 2.45], [28.171, 28.771, 1.26, 2.45],          // 상단 벽 쪽
  [5.551, 6.051, D - 2.5, D - 1.31], [14.544, 15.144, D - 2.5, D - 1.31], [28.057, 28.657, D - 2.5, D - 1.31], // 하단 벽 쪽
];
const EXIT_ZONES = [ // [x1, x2, z1, z2]
  [11.034, 12.534, 0, 2.7],        // 컨트롤 부스 옆 출구 1,500 × 2,700
  [20.67, 28.17, 0, 1.37],         // 경사로(RAMPS) 7,500 × 1,370
  [28.771, W, 0, 2.45],            // 오른쪽 위 출구 2,240 폭
  [24.657, 28.057, D - 1.5, D],    // Staunton 출입구 3,400 × 1,500
  [0, 1.5, 11.3, 12.8],            // 왼쪽 Marketplace 출입구 1,500 × 1,500
];

export function buildColumns() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb4b2ab, roughness: 0.9, metalness: 0 });
  COLUMNS.forEach(([x1, x2, z1, z2]) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, H, z2 - z1), mat);
    col.position.set((x1 + x2) / 2, H / 2, (z1 + z2) / 2);
    col.castShadow = true; col.receiveShadow = true;
    group.add(col);
  });
  return group;
}

export function buildExitZones() {
  const group = new THREE.Group();
  const Y = 0.03;
  const fill = new THREE.MeshBasicMaterial({ color: 0xff2d20, transparent: true, opacity: 0.28, fog: false, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
  const pts = [];
  EXIT_ZONES.forEach(([x1, x2, z1, z2]) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), fill);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((x1 + x2) / 2, Y, (z1 + z2) / 2);
    group.add(plane);
    const a = new THREE.Vector3(x1, Y, z1), b = new THREE.Vector3(x2, Y, z1), c = new THREE.Vector3(x2, Y, z2), d = new THREE.Vector3(x1, Y, z2);
    pts.push(a, b, b, c, c, d, d, a, a, c, b, d); // 테두리 + 도면과 같은 X 표시
    const label = makeLabel('Emergency Exit · Keep Clear', { fg: '#ff8a80', size: TEXT_LABEL_SIZE });
    label.position.set((x1 + x2) / 2, 0.5, (z1 + z2) / 2);
    group.add(label);
  });
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xff2d20, fog: false, toneMapped: false })
  );
  group.add(lines);
  return group;
}
