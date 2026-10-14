// ============================================================================
// 보기 전용 링크 — 편집 화면의 현재 설정(벽·테이블 치수, 전시 버전)을 주소 뒤(#view=…)에 담는다.
// 그 주소로 열면 수정 칸이 잠기고, 이 브라우저의 저장값(localStorage) 대신 링크에 담긴 값만 쓴다.
// ============================================================================
export const VIEW_PARAMS = (() => {
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('view');
    return raw === null ? null : JSON.parse(raw || '{}');
  } catch (e) {
    return {}; // 링크가 깨졌으면 기본값으로 보기 전용
  }
})();
export const VIEW_ONLY = VIEW_PARAMS !== null;

export function makeViewLink(params) {
  return `${location.origin}${location.pathname}#view=${encodeURIComponent(JSON.stringify(params))}`;
}
