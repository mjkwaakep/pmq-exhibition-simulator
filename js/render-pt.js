// ============================================================================
// 실사 렌더 — 3D PERSPECTIVE의 "렌더" 버튼. 지금 카메라 그대로 경로 추적(path tracing)으로
// 빛이 튀고 번지는 것까지 계산해 점점 선명해지는 고화질 이미지를 만든다(three-gpu-pathtracer).
// 평소 미리보기는 가벼운 그대로 두고, 렌더하는 동안에만 아래를 바꿔 끼웠다가 끝나면 되돌린다.
//   - 빛: Wall02·03 맞은편 큰 창(Aberdeen Street 쪽)으로 들어오는 햇빛과 창밖 하늘빛,
//         포스터 벽을 비추는 천장 트랙 스팟, 천장 라인조명(실제로 빛을 낸다)
//   - 창밖: 빛을 내는 풍경 면(나무 · 건물)을 창에서 떨어뜨려 세운다
//   - 포스터: walls/hires/의 1px = 1mm 시안을 2.5m 안팎 조각으로 나눠 붙여 가까이서도 덜 깨진다
//   - 치수선 · 동선 화살표 · 비상구 구역 · 사람 실루엣은 숨긴다
// 참고: PMQ Qube 사진 — 검은 노출 천장(트랙 조명 · 라인조명), 둘레 검은 커튼,
// 회갈색 카펫, Aberdeen Street 쪽 통유리 창 너머 나무와 아파트.
// ============================================================================
import * as THREE from 'three';
import { ROOM_WIDTH_MM, ROOM_DEPTH_MM, ROOM_HEIGHT_MM, WALLS } from './constants.js';
import { removeBackground } from './wall-image.js';

const W = ROOM_WIDTH_MM / 1000, D = ROOM_DEPTH_MM / 1000, H = ROOM_HEIGHT_MM / 1000;
const TARGET_SAMPLES = 600;  // 이만큼 쌓이면 멈춘다(이후 저장해도 같은 이미지)
const TEXTURE_SIZE = 2048;   // 경로 추적기는 모든 텍스처를 이 크기로 맞춰 쓴다 — 포스터 조각 한 장 = 2.5m 안팎
const TILE_MAX_M = 2.5;      // 포스터 조각의 최대 폭(m)

// 렌더 조명 세기(경로 추적기 단위). 화면 노출은 EXPOSURE로 맞춘다.
const LIGHT = {
  sun: 3.2,          // 창으로 들어오는 직사광
  outside: 3.6,      // 창밖 풍경 면의 밝기(하늘빛)
  spot: 30,          // 포스터 벽 트랙 스팟 한 개
  ceilingLine: 3.0,  // 천장 라인조명
  sign: 2.0,         // 비상구 표시등
};
const EXPOSURE = 1.5;

// three r160의 Scene에는 아직 없는 값(r162부터) — 경로 추적기가 모든 Scene에서 읽으므로 기본값을 둔다.
if (!('backgroundRotation' in THREE.Scene.prototype)) THREE.Scene.prototype.backgroundRotation = new THREE.Euler();
if (!('environmentRotation' in THREE.Scene.prototype)) THREE.Scene.prototype.environmentRotation = new THREE.Euler();

let ptModule = null;
const loadPathTracer = () => (ptModule ||= import('../vendor/three-gpu-pathtracer.module.js'));

const hiresUrl = (url) => url.replace('walls/', 'walls/hires/').replace(/\.png$/, '.jpg');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    im.src = url;
  });
}

export class RealRender {
  constructor(view) {
    this.view = view;       // PosterWall3D
    this.active = false;
    this.onStatus = () => {};
    this._undo = [];        // 렌더가 끝나면 거꾸로 실행해 원래대로 되돌린다
    this._saveRequest = null;
  }

  get samples() { return this.pt ? Math.floor(this.pt.samples) : 0; }

  async start() {
    if (this.active) return;
    const v = this.view;
    this.active = true;
    this._stopped = false;
    v.controls.enabled = false;
    this.onStatus({ phase: 'prepare', text: '렌더 준비 중…' });
    try {
      const { WebGLPathTracer } = await loadPathTracer();
      if (this._stopped) return;
      await this._dressScene();
      if (this._stopped) return;

      // 렌더마다 새로 만든다 — 이전 렌더의 장면 캐시(재질 번호)가 남아 있으면 재질이 엉킨다.
      if (this.pt) this.pt.dispose();
      this.pt = new WebGLPathTracer(v.renderer);
      const pt = this.pt;
      pt.tiles.set(2, 2);
      pt.bounces = 7;
      pt.transmissiveBounces = 6;
      pt.filterGlossyFactor = 0.5;
      pt.renderDelay = 0;
      pt.minSamples = 1;
      pt.fadeDuration = 0;
      pt.dynamicLowRes = false;
      pt.renderScale = 1;
      pt.textureSize.set(TEXTURE_SIZE, TEXTURE_SIZE);
      pt.pausePathTracing = false;

      this.onStatus({ phase: 'prepare', text: '장면 구조 계산 중…' });
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // 안내 문구가 먼저 보이게 한 프레임 쉰다
      pt.setScene(v.scene, v.camera); // 몇 초 걸릴 수 있다(BVH 계산)
      if (this._stopped) return;
      this._running = true;
      this.onStatus({ phase: 'render', text: '렌더 중', samples: 0, target: TARGET_SAMPLES });
    } catch (e) {
      console.error(e);
      this.onStatus({ phase: 'error', text: `렌더를 시작하지 못했습니다: ${e.message}` });
      this.stop();
    }
  }

  /** PosterWall3D._animate가 렌더 중에 매 프레임 부른다. */
  tick() {
    if (!this._running) {
      this.view.renderer.render(this.view.scene, this.view.camera); // 준비하는 동안은 미리보기 그대로
      return;
    }
    const pt = this.pt;
    if (pt.samples < TARGET_SAMPLES) pt.renderSample();
    else {
      if (!pt.pausePathTracing) { pt.pausePathTracing = true; this.onStatus({ phase: 'done', text: '렌더 완료', samples: this.samples, target: TARGET_SAMPLES }); }
      pt.renderSample(); // 멈춘 뒤에도 같은 결과를 화면에 그린다(저장용)
    }
    if (!pt.pausePathTracing) this.onStatus({ phase: 'render', text: '렌더 중', samples: this.samples, target: TARGET_SAMPLES });
    if (this._saveRequest) {
      const resolve = this._saveRequest;
      this._saveRequest = null;
      this.view.renderer.domElement.toBlob(resolve, 'image/png'); // 그린 직후에 읽어야 빈 화면이 안 나온다
    }
  }

  /** 지금까지 쌓인 렌더 결과를 PNG로 내려받는다. */
  save() {
    if (!this._running) return;
    new Promise((resolve) => { this._saveRequest = resolve; }).then((blob) => {
      if (!blob) return;
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `PMQ-render-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  stop() {
    this._stopped = true;
    this._running = false;
    if (this.pt) this.pt.pausePathTracing = true;
    while (this._undo.length) {
      try { this._undo.pop()(); } catch (e) { console.error(e); }
    }
    this.view.controls.enabled = true;
    this.active = false;
    this.onStatus({ phase: 'idle' });
  }

  // ----------------------------------------------------------------------------------------
  // 렌더용 장면 꾸미기 — 바꾼 것은 모두 _undo에 되돌리는 함수를 남긴다.
  async _dressScene() {
    const v = this.view, scene = v.scene, renderer = v.renderer;
    const undo = (fn) => this._undo.push(fn);
    const setVisible = (obj, vis) => {
      if (!obj || obj.visible === vis) return;
      const prev = obj.visible;
      obj.visible = vis;
      undo(() => { obj.visible = prev; });
    };

    // 화면 설정
    const prevExposure = renderer.toneMappingExposure, prevFog = scene.fog, prevBg = scene.background, prevEnv = scene.environment;
    renderer.toneMappingExposure = EXPOSURE;
    scene.fog = null;
    scene.background = new THREE.Color(0x000000);
    scene.environment = null;
    undo(() => { renderer.toneMappingExposure = prevExposure; scene.fog = prevFog; scene.background = prevBg; scene.environment = prevEnv; });

    // 카메라가 천장 위(탑뷰 · 45도 뷰)에 있으면 천장 판과 천장 설비를 숨겨 안이 보이게 한다 — 미리보기와 같은 방식.
    if (v.camera.position.y > H - 0.05) {
      scene.traverse((o) => {
        if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry') {
          const p = new THREE.Vector3(); o.getWorldPosition(p);
          const n = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
          if (Math.abs(p.y - H) < 0.05 && n.y < -0.9) setVisible(o, false);
        }
      });
      if (v.siteGroup && v.siteGroup.userData.ceiling) setVisible(v.siteGroup.userData.ceiling, false);
      (v._lightFrames || []).forEach((g) => setVisible(g, false));
    }
    this._ceilingHidden = v.camera.position.y > H - 0.05;

    // 보조 표시는 숨긴다
    [v.dimsGroup, v.flowGroup, v.exitZonesGroup, v.peopleGroup].forEach((g) => setVisible(g, false));
    if (!this._ceilingHidden && v.siteGroup && v.siteGroup.userData.ceiling) setVisible(v.siteGroup.userData.ceiling, true);

    // 미리보기용 조명(반구광 · 전역광 · 방향광)은 끄고 렌더 전용 조명을 단다
    scene.traverse((o) => {
      if (o.isDirectionalLight || o.isHemisphereLight || o.isAmbientLight) setVisible(o, false);
    });

    // 창밖 풍경 사진 면(창 바로 뒤)과 창유리는 숨기고, 더 멀리 빛을 내는 풍경 면을 새로 세운다
    // — 가까운 사진 면이 직사광을 막지 않게.
    let outsideTex = null;
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = o.material;
      const src = m && m.map && m.map.image && m.map.image.src;
      if (src && src.includes('outside.jpg')) { outsideTex = outsideTex || m.map; setVisible(o, false); }
      else if (m && m.isMeshPhysicalMaterial && m.transmission > 0.85) setVisible(o, false); // 전면 창유리
    });

    // 빛을 내야 하는 재질(천장 라인조명 · 비상구 표시등 등 MeshBasic)은 발광 재질로 바꾼다
    const swaps = [];
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.material || Array.isArray(o.material)) return;
      const m = o.material;
      if (!m.isMeshBasicMaterial) return;
      const c = m.color.clone();
      const isSign = c.g > c.r * 2;
      const em = new THREE.MeshStandardMaterial({
        color: 0x000000, emissive: c, emissiveIntensity: isSign ? LIGHT.sign : LIGHT.ceilingLine,
        emissiveMap: m.map || null, roughness: 1, side: m.side,
      });
      swaps.push([o, m]);
      o.material = em;
    });
    undo(() => swaps.forEach(([o, m]) => { o.material.dispose(); o.material = m; }));

    const rig = new THREE.Group();
    rig.name = 'render-rig';
    scene.add(rig);
    undo(() => {
      scene.remove(rig);
      rig.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); if (o.material.emissiveMap && o.material.emissiveMap !== outsideTex) o.material.emissiveMap.dispose(); o.material.dispose(); }
      });
    });

    this._buildDaylight(rig, outsideTex);
    this._buildTrackSpots(rig);
    this._atlasBookCovers(undo);
    this.onStatus({ phase: 'prepare', text: '포스터 고해상도 이미지 불러오는 중…' });
    await this._buildHiresWalls(rig, undo);
    this._mergeMaterials(undo);
    this._splitMultiMaterialMeshes(undo);
  }

  /**
   * 재질이 여러 개인 메시(면마다 재질이 다른 책 상자 등)를 재질별 메시로 쪼갠다.
   * 이 버전의 경로 추적기는 메시 하나에 재질 하나라고 가정하고 재질 번호를 매겨서,
   * 재질 배열을 가진 메시가 섞이면 그 뒤의 모든 물체 재질이 한 칸씩 밀린다(색·텍스처가 엉뚱하게 나온다).
   */
  _splitMultiMaterialMeshes(undo) {
    const targets = [];
    this.view.scene.traverseVisible((o) => { if (o.isMesh && Array.isArray(o.material)) targets.push(o); });
    targets.forEach((mesh) => {
      const src = mesh.geometry;
      const index = src.index;
      const parts = [];
      const groups = src.groups.length ? src.groups : [{ start: 0, count: index ? index.count : src.attributes.position.count, materialIndex: 0 }];
      groups.forEach((g) => {
        const mat = mesh.material[g.materialIndex];
        if (!mat || !mat.visible) return;
        const geo = src.clone();
        geo.clearGroups();
        if (index) geo.setIndex(Array.from(index.array.slice(g.start, g.start + g.count)));
        const part = new THREE.Mesh(geo, mat);
        part.position.copy(mesh.position);
        part.quaternion.copy(mesh.quaternion);
        part.scale.copy(mesh.scale);
        mesh.parent.add(part);
        parts.push(part);
      });
      mesh.visible = false;
      undo(() => {
        parts.forEach((p) => { p.parent.remove(p); p.geometry.dispose(); });
        mesh.visible = true;
      });
    });
  }

  /**
   * 값이 같은 재질을 하나로 합친다. 장면에는 재질 객체가 650개 넘게 있지만 실제로 다른 것은 70여 개뿐이고,
   * 경로 추적기는 재질이 255개를 넘으면 재질 번호를 잘못 읽어 텍스처·색이 빠진다.
   */
  _mergeMaterials(undo) {
    const keyOf = (m) => {
      const parts = [m.type, m.color && m.color.getHexString(), m.emissive && m.emissive.getHexString(), m.emissiveIntensity,
        m.roughness, m.metalness, m.transmission, m.thickness, m.ior, m.opacity, m.transparent, m.alphaTest, m.side, m.visible];
      ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach((k) => {
        const t = m[k];
        if (t) parts.push(k, t.source ? t.source.uuid : t.uuid, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation, t.flipY);
      });
      return parts.join('|');
    };
    const canon = new Map();
    const pick = (m) => {
      if (!m) return m;
      const k = keyOf(m);
      if (!canon.has(k)) canon.set(k, m);
      return canon.get(k);
    };
    const changed = [];
    this.view.scene.traverseVisible((o) => {
      if (!o.isMesh || !o.material) return;
      const prev = o.material;
      const next = Array.isArray(prev) ? prev.map(pick) : pick(prev);
      if (Array.isArray(prev) ? next.some((m, i) => m !== prev[i]) : next !== prev) {
        changed.push([o, prev]);
        o.material = next;
      }
    });
    undo(() => changed.forEach(([o, m]) => { o.material = m; }));
  }

  /** 창밖: 창에서 8m 떨어진 곳에 빛을 내는 풍경 면 + 창으로 비스듬히 들어오는 햇빛. */
  _buildDaylight(rig, outsideTex) {
    const winX = W;
    // 창밖 사진은 채도를 낮추고 밝게 — 그대로 쓰면 잎의 초록빛이 실내 그늘을 초록으로 물들인다.
    let tex = null;
    if (outsideTex && outsideTex.image) {
      const im = outsideTex.image;
      const c = document.createElement('canvas');
      c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
      const ctx = c.getContext('2d');
      ctx.filter = 'saturate(35%) brightness(118%)';
      ctx.drawImage(im, 0, 0);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(2, 1);
    }
    // 풍경 면 윗변(5.5m)은 햇빛이 지나가는 높이(창 윗변 3.6m에서 8m 밖 = 약 9m)보다 낮게 둬서 빛을 막지 않는다.
    const viewW = 34, viewTop = 5.5, viewBottom = -1, dist = 8;
    const view = new THREE.Mesh(
      new THREE.PlaneGeometry(viewW, viewTop - viewBottom),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: LIGHT.outside, side: THREE.DoubleSide }),
    );
    view.rotation.y = -Math.PI / 2;
    view.position.set(winX + dist, (viewTop + viewBottom) / 2, D / 2);
    rig.add(view);

    // 햇빛 — 창 쪽(+X) 위에서 약 35도로 비스듬히. 창 앞 바닥과 테이블에 빛 자국이 생긴다.
    const sun = new THREE.DirectionalLight(0xfff0d8, LIGHT.sun);
    const dir = new THREE.Vector3(1, 0.72, 0.38).normalize();
    const target = new THREE.Object3D();
    target.position.set(W - 6, 0, D / 2);
    sun.position.copy(target.position).addScaledVector(dir, 40);
    sun.target = target;
    rig.add(target, sun);
  }

  /** 포스터 벽을 비추는 천장 트랙 스팟(검은 레일 + 조명 머리)을 벽마다 2.2m 간격으로 단다. */
  _buildTrackSpots(rig) {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.5 });
    const headGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 16);
    const y = H - 0.3, offset = 2.3, aimY = 1.45, step = 2.2;
    WALLS.forEach((wall) => {
      const len = wall.lengthMM / 1000;
      const ox = wall.origin.x / 1000, oz = wall.origin.z / 1000;
      // 벽 진행 방향(along)과 전시장 안쪽 법선(inward)
      const along = wall.rotationY === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const inward = wall.rotationY === 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const n = Math.max(1, Math.round(len / step));
      const railLen = len;
      const railCenter = new THREE.Vector3(ox, y + 0.06, oz).addScaledVector(along, len / 2).addScaledVector(inward, offset);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(along.x ? railLen : 0.035, 0.035, along.z ? railLen : 0.035),
        railMat,
      );
      rail.position.copy(railCenter);
      rig.add(rail);
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) * (len / n);
        const pos = new THREE.Vector3(ox, y, oz).addScaledVector(along, s).addScaledVector(inward, offset);
        const aim = new THREE.Vector3(ox, aimY, oz).addScaledVector(along, s);
        const spot = new THREE.SpotLight(0xffe2bd, LIGHT.spot, 0, 0.5, 0.75, 2);
        spot.position.copy(pos);
        const t = new THREE.Object3D();
        t.position.copy(aim);
        spot.target = t;
        rig.add(spot, t);
        const head = new THREE.Mesh(headGeo, railMat);
        head.position.copy(pos);
        head.lookAt(aim);
        head.rotateX(Math.PI / 2);
        rig.add(head);
      }
    });
  }

  /** 도록 표지 50여 장을 텍스처 한 장(아틀라스)에 모은다 — 경로 추적기는 텍스처마다 같은 크기로 메모리를 잡는다. */
  _atlasBookCovers(undo) {
    const group = this.view.booksGroup;
    if (!group) return;
    const books = group.children.filter((m) => Array.isArray(m.material) && m.material[2] && m.material[2].map && m.material[2].map.image);
    if (!books.length) return;
    const cols = Math.ceil(Math.sqrt(books.length)), cell = Math.floor(TEXTURE_SIZE / cols);
    const c = document.createElement('canvas');
    c.width = c.height = cell * cols;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const atlasMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    books.forEach((mesh, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      try { ctx.drawImage(mesh.material[2].map.image, col * cell, row * cell, cell, cell); } catch (e) { /* 아직 안 불러온 표지는 흰 책으로 */ }
      const geo = mesh.geometry.clone();
      const uv = geo.attributes.uv;
      for (let k = 8; k < 12; k++) { // BoxGeometry 윗면(+y) 꼭짓점 4개
        uv.setXY(k, (col + uv.getX(k)) / cols, 1 - (row + 1) / cols + uv.getY(k) / cols);
      }
      uv.needsUpdate = true;
      const prevGeo = mesh.geometry, prevMat = mesh.material;
      const mats = prevMat.slice();
      mats[2] = atlasMat;
      mesh.geometry = geo;
      mesh.material = mats;
      undo(() => { mesh.geometry = prevGeo; mesh.material = prevMat; geo.dispose(); });
    });
    tex.needsUpdate = true;
    undo(() => { tex.dispose(); atlasMat.dispose(); });
  }

  /** 벽 시안을 1px = 1mm 고해상도로 불러와 2.5m 안팎 조각으로 나눠 붙인다(미리보기 면은 숨긴다). */
  async _buildHiresWalls(rig, undo) {
    const v = this.view;
    for (const group of v._wallMeshes || []) {
      const wall = group.userData.wall;
      const pg = group.userData.posterGroup;
      if (!wall || !wall.image || !pg) continue;
      const face = pg.children.find((c) => c.material && c.material.userData && c.material.userData.crop);
      let img;
      try { img = await loadImage(hiresUrl(wall.image)); } catch (e) { console.warn(e.message); continue; }
      if (this._stopped) return;
      // 배경(벽 회색)을 투명하게 — 미리보기와 같은 방법을 1/4 크기 사본에 돌려 마스크로 쓴다
      // (1px = 1mm 원본 전체에 돌리면 메모리가 너무 많이 든다).
      const mask = document.createElement('canvas');
      mask.width = Math.round(img.naturalWidth / 4); mask.height = Math.round(img.naturalHeight / 4);
      mask.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, mask.width, mask.height);
      removeBackground(mask);

      const imgL = (wall.imageLengthMM || wall.lengthMM) / 1000, imgH = (wall.imageHeightMM || wall.heightMM) / 1000;
      const Lm = Math.min(wall.lengthMM / 1000, imgL), Hm = Math.min(wall.heightMM / 1000, imgH);
      const flip = !!wall.flip, sign = flip ? -1 : 1;
      const a0 = flip ? imgL - Lm : 0; // 보이는 이미지 구간(이미지 왼쪽 끝에서 m)
      const n = Math.max(1, Math.ceil(Lm / TILE_MAX_M));
      const tw = Lm / n;
      const pxPerM = img.naturalWidth / imgL, maskScale = mask.width / img.naturalWidth;
      const sy = img.naturalHeight * (1 - Hm / imgH), sh = img.naturalHeight * (Hm / imgH);
      const tiles = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const s0 = a0 + i * tw, s1 = s0 + tw;
        const c = document.createElement('canvas');
        c.width = c.height = TEXTURE_SIZE;
        const ctx = c.getContext('2d');
        const sx = s0 * pxPerM, sw = tw * pxPerM;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
        ctx.globalCompositeOperation = 'destination-in'; // 마스크의 투명한 배경만 걷어낸다
        ctx.drawImage(mask, sx * maskScale, sy * maskScale, sw * maskScale, sh * maskScale, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = v.renderer.capabilities.getMaxAnisotropy();
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(tw, Hm),
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0, alphaTest: 0.5 }),
        );
        const cx = flip ? imgL - (s0 + s1) / 2 : (s0 + s1) / 2;
        mesh.position.set(cx, Hm / 2, sign * 0.066);
        mesh.rotation.y = flip ? Math.PI : 0;
        tiles.add(mesh);
      }
      pg.add(tiles);
      if (face) {
        const prev = face.visible;
        face.visible = false;
        undo(() => { face.visible = prev; });
      }
      undo(() => {
        pg.remove(tiles);
        tiles.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map.dispose(); o.material.dispose(); } });
      });
    }
  }
}
