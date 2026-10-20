// ============================================================================
// PMQ 포스터 월 시뮬레이터 — 물리 상수
// 이 파일의 숫자는 실제 도면/현장 치수를 기준으로 한다. 절대 임의로 바꾸지 말 것.
// ============================================================================

export const GAP_MM = 50;          // 포스터 사이 기본 간격 (좌우/상하 공통)
export const WALL_HEIGHT_MM = 2500; // Wall01(화이트월) 높이
export const TRANSLUCENT_WALL_HEIGHT_MM = 2500; // Wall02·03(반투명벽) 높이 — A1 두 줄 중심을 바닥에서 1,450에 맞춘 시안 기준
export const ROOM_HEIGHT_MM = 5000; // 3D 공간의 실제 층고(실측값 없어 5m 기준) — 포스터 월은 이 절반

// 설치 여백(포스터를 바닥/천장/모서리에 바짝 붙이지 않기 위한 안전 여백).
// 스펙에 명시되지 않은 값이라 합리적인 기본값으로 고정한다. 필요하면 이 값만 바꾸면 된다.
export const MARGIN = { top: 150, bottom: 150, side: 100 };

// 전시장 전체 공간 — 실측값이 없어 도면 비례 + 포스터 월 치수를 기준으로 잡은
// 시뮬레이션용 기준 공간(가로 31m × 깊이 20m × 층고 5m) — 가로는 Qube 원본도면의 커튼 안쪽 치수, 깊이는 C–D 기준선 20,000.
export const ROOM_WIDTH_MM = 31000;  // 가로(X)
export const ROOM_DEPTH_MM = 20000;  // 깊이(Z) — 원본 도면의 C–D 기준선 간격 20,000

// ㄱ자(L자) 구조 — 코너 하나만 있는 형태.
//   Wall01 (불투명, 17.3m)            — 한쪽 다리
//   Wall02 (반투명, 7m) + 통로 2m + Wall03 (반투명, 8m) — 나머지 한 다리(같은 직선,
//     사람이 다니는 2m 통로로 갈라져 있을 뿐 90도로 더 꺾이지 않음)
// Wall02/03을 합친 다리 길이 7+2+8=17m.
//
// 각 벽의 image는 인디자인 포스터 월 시안을 그대로 내보낸 입면 이미지(벽 안쪽에서
// 정면으로 바라본 모습). image가 있으면 자동 패킹 대신 이 이미지를 벽에 그대로 붙인다.
// posterCount는 그 시안에 들어간 포스터 수(표시용).
export const GAP_BETWEEN_TRANSLUCENT_MM = 1400;

// 좌표계: X-Z 바닥 평면(mm), Y 위. 왼쪽 외벽 = x:0, 상단 외벽 = z:0,
// 하단 외벽 = z:ROOM_DEPTH_MM, 전면 창 = x:ROOM_WIDTH_MM.
// 코너(Wall01↔Wall02)는 왼쪽 외벽에서 11.5m, 상단 외벽에서 2.6m 떨어진 지점 = (11500, 2600).
// (컨트롤 부스가 왼쪽 커튼에서 약 11.3m까지 튀어나와 있어 전시 전체를 창 쪽으로 1.5m 옮김)
//   Wall01: 코너에서 +X로 17.3m(→ 오른쪽 전면 창까지 2.2m 남음), 법선 = world +X... 아니 +Z(안쪽)
//   Wall02: 코너에서 +Z로 7m,                                법선 = world +X(안쪽)
//   Wall03: 통로(1.4m) 건너 Wall02와 같은 직선으로 8m 이어짐(→ 하단 외벽까지 1m 남음)
// 상단 벽 쪽 기둥(벽에서 약 1.26~2.45m)을 피하려고 Wall01을 상단 외벽에서 2.6m로 당겼다. Wall03은 그대로 두고 통로를 2m → 1.4m로 줄임.
const CORNER = { x: 11500, z: 2600 };
export const WALLS = [
  {
    id: 'wall01',
    name: 'Wall 01',
    shortLabel: '화이트월 (불투명)',
    lengthMM: 17300,
    imageLengthMM: 17300,            // 시안 이미지를 만든 기준 길이 — 고정
    heightMM: WALL_HEIGHT_MM,        // 길이·높이는 사이드바 WALL SIZE에서 바꿀 수 있다(wall-settings.js)
    imageHeightMM: WALL_HEIGHT_MM,   // 시안 이미지(image)를 만든 기준 높이 — 고정
    material: 'opaque',
    origin: { x: CORNER.x, z: CORNER.z },
    rotationY: 0,
    flip: false,
    image: 'walls/wall01.png',
    posterCount: 94,
  },
  {
    id: 'wall02',
    name: 'Wall 02',
    shortLabel: '반투명벽 1',
    lengthMM: 7000,
    imageLengthMM: 7000,
    heightMM: TRANSLUCENT_WALL_HEIGHT_MM,
    imageHeightMM: TRANSLUCENT_WALL_HEIGHT_MM,
    material: 'translucent',
    origin: { x: CORNER.x, z: CORNER.z },
    rotationY: -Math.PI / 2,
    flip: true,
    image: 'walls/wall02.png',
    posterCount: 20,
  },
  {
    id: 'wall03',
    name: 'Wall 03',
    shortLabel: '반투명벽 2',
    lengthMM: 8000,
    imageLengthMM: 8000,
    heightMM: TRANSLUCENT_WALL_HEIGHT_MM,
    imageHeightMM: TRANSLUCENT_WALL_HEIGHT_MM,
    material: 'translucent',
    // Wall02 끝(코너에서 7000mm)에서 통로 1400mm를 건너 이어짐
    origin: { x: CORNER.x, z: CORNER.z + 7000 + GAP_BETWEEN_TRANSLUCENT_MM },
    rotationY: -Math.PI / 2,
    flip: true,
    image: 'walls/wall03.png',
    posterCount: 25,
  },
];

// 통로를 포함한 포스터 월 전체 구간 길이. 실제 벽 재료 길이는 이보다
// GAP_BETWEEN_TRANSLUCENT_MM(1.4m)만큼 짧다.
export const TOTAL_WALL_MATERIAL_MM = WALLS.reduce((s, w) => s + w.lengthMM, 0); // 32300
export const TOTAL_SPAN_MM = TOTAL_WALL_MATERIAL_MM + GAP_BETWEEN_TRANSLUCENT_MM; // 33700

// A0/A1/A2 실제 규격 (mm, 세로형 포스터 기준 width × height)
export const POSTER_SIZES = {
  A0: { key: 'A0', w: 841, h: 1189 },
  A1: { key: 'A1', w: 594, h: 841 },
  A2: { key: 'A2', w: 420, h: 594 },
};

// 벽을 "꽉 채울" 기본 수량을 계산할 때 사용하는 크기 비율(작은 포스터를 더 많이 —
// 레퍼런스 이미지처럼 크기가 계속 변하는 리듬감을 위해). pack.js에서 사용.
export const FILL_RATIO = { A0: 1, A1: 3, A2: 6 };
