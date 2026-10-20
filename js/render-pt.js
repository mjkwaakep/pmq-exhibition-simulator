// ============================================================================
// 실사 렌더 — 3D PERSPECTIVE의 "렌더" 버튼. 지금 카메라 그대로 경로 추적(path tracing)으로
// 빛이 튀고 번지는 것까지 계산해 점점 선명해지는 이미지를 만든다(three-gpu-pathtracer).
// 평소 미리보기는 가벼운 그대로 두고, 렌더하는 동안에만 아래를 바꿔 끼웠다가 끝나면 되돌린다.
// 렌더 중에도 카메라를 움직일 수 있고, 움직이면 그 자리에서 다시 쌓기 시작한다.
//   - 빛: JAGDA PMQ 전시 사진처럼 밝고 고른 중성광 — 천장에서 내려오는 넓은 스팟, 창 안쪽 위의 넓은 스팟
//         (= 중정 확산광), 약한 햇빛, 천장 라인조명. 그림자는 부드럽지만 윤곽이 남게.
//   - 창: 실측 통유리(04_Glass Facade — 16,987 × 6,930mm, 판 14장 · 유리 리브 · 볼트 · 위쪽 검은 커튼)
//   - 창밖: 실내 사진에서 잘라 낸 PMQ 중정(흰 건물 · 유리 지붕 · 큰 나무)을 배경 파노라마로
//   - 포스터: walls/hires/의 1px = 1mm 시안을 2.5m 안팎 조각으로 나눠 붙여 가까이서도 덜 깨진다
//   - 치수선 · 동선 화살표 · 비상구 구역 · 사람 실루엣은 숨긴다
// ============================================================================
import * as THREE from 'three';
import { ROOM_WIDTH_MM, ROOM_DEPTH_MM, ROOM_HEIGHT_MM, WALLS } from './constants.js';
import { removeBackground } from './wall-image.js';

const W = ROOM_WIDTH_MM / 1000, D = ROOM_DEPTH_MM / 1000, H = ROOM_HEIGHT_MM / 1000;
const TARGET_SAMPLES = 200;  // 이만큼 쌓이면 멈춘다(이후 저장해도 같은 이미지)
const MAX_RENDER_PIXELS = 1.8e6; // 렌더 해상도 상한(약 1650×1100) — 레티나 화면에서 4배 픽셀을 다 계산하지 않게
const TEXTURE_SIZE = 2048;   // 경로 추적기는 모든 텍스처를 이 크기로 맞춰 쓴다 — 포스터 조각 한 장 = 2.5m 안팎
const TILE_MAX_M = 2.5;      // 포스터 조각의 최대 폭(m)

// 렌더 조명 세기(경로 추적기 단위). 화면 노출은 EXPOSURE로 맞춘다.
// JAGDA 전시(국립신미술관)처럼 천장 전체에서 고르게 내려오는 밝은 빛이 주광이고, 그림자는 옅게.
const LIGHT = {
  ceilingSoft: 70,   // 천장에서 내려오는 넓은 스팟 하나(6개) — 전시장 전체를 고르게 밝힌다
  window: 120,       // 창 안쪽 위 넓은 스팟 하나(4개) = 중정에서 들어오는 확산광
  sun: 1.1,          // 창으로 들어오는 직사광 — 창 앞에 또렷한 그림자를 만든다
  ceilingLine: 2.0,  // 천장 라인조명
  sign: 1.5,         // 비상구 표시등
};
const NEUTRAL_WHITE = 0xfffaf3; // 4500K 안팎 — 따뜻한 노란빛을 뺀 전시장 흰빛
const EXPOSURE = 1.6;

// three r160의 Scene에는 아직 없는 값(r162부터) — 경로 추적기가 모든 Scene에서 읽으므로 기본값을 둔다.
if (!('backgroundRotation' in THREE.Scene.prototype)) THREE.Scene.prototype.backgroundRotation = new THREE.Euler();
if (!('environmentRotation' in THREE.Scene.prototype)) THREE.Scene.prototype.environmentRotation = new THREE.Euler();

// 렌더 결과를 화면에 그릴 때 거치는 가벼운 노이즈 제거 — 샘플이 적어 생기는 흰 점·검은 점을 걸러 낸다.
//   1) 이웃 8칸 밝기 범위 밖으로 혼자 튀는 점은 그 범위로 눌러 주고
//   2) 밝기가 비슷한 이웃끼리만 섞는 5×5 블러(가장자리 · 포스터 글자는 지킨다)
function makeDenoiser() {
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, texel: { value: new THREE.Vector2(1, 1) }, opacity: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform vec2 texel;
      uniform float opacity;
      varying vec2 vUv;
      float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      void main() {
        vec4 c0 = texture2D(map, vUv);
        vec3 lo = vec3(1e9), hi = vec3(-1e9);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          if (x == 0 && y == 0) continue;
          vec3 c = texture2D(map, vUv + vec2(float(x), float(y)) * texel).rgb;
          lo = min(lo, c); hi = max(hi, c);
        }
        vec3 center = clamp(c0.rgb, lo, hi);
        float lc = log(lum(center) + 1e-3);
        vec3 sum = center; float wsum = 1.0;
        for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
          if (x == 0 && y == 0) continue;
          vec3 c = texture2D(map, vUv + vec2(float(x), float(y)) * texel).rgb;
          float d = log(lum(c) + 1e-3) - lc;
          float w = exp(-float(x * x + y * y) / 4.5 - d * d / 0.06);
          sum += c * w; wsum += w;
        }
        gl_FragColor = vec4(sum / wsum, c0.a * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return (target, renderer, quad) => {
    material.uniforms.map.value = target.texture;
    material.uniforms.texel.value.set(1 / target.width, 1 / target.height);
    material.uniforms.opacity.value = quad.material.opacity;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(mesh, camera);
    renderer.autoClear = autoClear;
  };
}

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
    this.onStatus({ phase: 'prepare', text: '렌더 준비 중…' });
    try {
      const { WebGLPathTracer } = await loadPathTracer();
      if (this._stopped) return;
      await this._dressScene();
      if (this._stopped) return;

      // 렌더마다 새로 만든다 — 이전 렌더의 장면 캐시(재질 번호)가 남아 있으면 재질이 엉킨다.
      if (this.pt) {
        // 이 버전의 dispose()는 없는 필드를 건드려 오류가 나서, 렌더 타깃만 직접 정리한다.
        try { this.pt._pathTracer.dispose(); this.pt._lowResPathTracer.dispose(); } catch (e) { /* 무시 */ }
      }
      this.pt = new WebGLPathTracer(v.renderer);
      const pt = this.pt;
      // 가볍게: 빛 반사 5번, 해상도 상한, 카메라를 움직이는 동안에는 1/4 해상도로 빠르게 미리 보여 준다.
      pt.tiles.set(1, 1);
      pt.bounces = 5;
      // 투명 반사 횟수를 4 미만으로 줄이면 이 버전에서 픽셀 일부가 0(검은 점)으로 굳는다 — 5로 둔다.
      pt.transmissiveBounces = 5;
      pt.filterGlossyFactor = 0.6;
      pt.renderDelay = 0;
      pt.minSamples = 2;
      pt.fadeDuration = 0;
      pt.dynamicLowRes = true;
      pt.lowResScale = 0.25;
      const c = v.renderer.domElement;
      pt.renderScale = Math.min(1, Math.sqrt(MAX_RENDER_PIXELS / (c.width * c.height)));
      pt.textureSize.set(TEXTURE_SIZE, TEXTURE_SIZE);
      this._denoise = this._denoise || makeDenoiser();
      pt.renderToCanvasCallback = this._denoise;
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
    const pt = this.pt, cam = this.view.camera;
    // 카메라가 천장 위아래를 넘나들면(천장을 숨길지 말지가 바뀌면) 장면을 다시 꾸며 처음부터 렌더한다.
    if ((cam.position.y > H - 0.05) !== this._ceilingHidden) { this.restart(); return; }
    // 렌더 중에도 카메라를 움직일 수 있다 — 움직이면 그 자리에서 다시 쌓기 시작한다.
    cam.updateMatrixWorld();
    if (!this._lastCam) this._lastCam = cam.matrixWorld.clone();
    if (!this._lastCam.equals(cam.matrixWorld) || this._lastFov !== cam.fov || this._lastAspect !== cam.aspect) {
      this._lastCam.copy(cam.matrixWorld);
      this._lastFov = cam.fov; this._lastAspect = cam.aspect;
      pt.updateCamera();
      pt.pausePathTracing = false;
    }
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

  async restart() {
    if (this._restarting) return;
    this._restarting = true;
    const onStatus = this.onStatus;
    this.stop();
    this.onStatus = onStatus;
    await this.start();
    this._restarting = false;
  }

  stop() {
    this._stopped = true;
    this._lastCam = null;
    this._running = false;
    if (this.pt) this.pt.pausePathTracing = true;
    while (this._undo.length) {
      try { this._undo.pop()(); } catch (e) { console.error(e); }
    }
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

    await this._buildFacade(rig, setVisible);
    this._buildSoftCeiling(rig);
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

  /**
   * 창 — 실측(04_Glass Facade/PMQ_Qube facade spec): 폭 16,987 × 높이 6,930mm 통유리(1.19m 안팎 판 14장,
   * 판 사이 유리 리브 + 볼트 고정구), 위쪽에 검은 커튼 자락. 창밖은 PMQ 중정(유리 지붕 아래 초록 창틀의 흰 건물)이고
   * 유리 지붕을 거친 밝은 확산광이 들어온다. 미리보기의 창(위아래 막힌 3.6m 창)은 렌더하는 동안만 숨긴다.
   */
  async _buildFacade(rig, setVisible) {
    const v = this.view;
    const glassW = 16.987, z1 = (D - glassW) / 2, z2 = z1 + glassW, x = W - 0.02;
    // 미리보기의 창 쪽 마감(벽기둥 · 위쪽 검은 판 · 젖힌 커튼 · 창호 · 창밖 사진)을 숨긴다
    const perim = v.siteGroup && v.siteGroup.userData.perimeter;
    if (perim) {
      const p = new THREE.Vector3();
      perim.children.forEach((m) => { m.getWorldPosition(p); if (p.x > W - 1.2) setVisible(m, false); });
    }
    const pierMat = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.9 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x9aa6a3, roughness: 0.2, metalness: 0.1 }); // 유리 리브의 옆면(약간 어두운 청록 회색)
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.4, metalness: 0.7 });
    const valMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1 });
    // 양옆 벽기둥(유리 밖 구간)
    [[0, z1], [z2, D]].forEach(([a, b]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, H), pierMat);
      m.rotation.y = -Math.PI / 2;
      m.position.set(x, H / 2, (a + b) / 2);
      rig.add(m);
    });
    // 판 사이 유리 리브(창 안쪽으로 300mm) + 볼트 고정구
    const panels = 14, pw = glassW / panels;
    for (let i = 1; i < panels; i++) {
      const z = z1 + i * pw;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, 0.02), finMat);
      fin.position.set(x - 0.15, H / 2, z);
      rig.add(fin);
      [1.0, 2.6, 4.2].forEach((y) => {
        const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.08), boltMat);
        bolt.position.set(x - 0.03, y, z);
        rig.add(bolt);
      });
    }
    // 위쪽 검은 커튼 자락
    const val = new THREE.Mesh(new THREE.PlaneGeometry(glassW + 1, 0.5), valMat);
    val.rotation.y = -Math.PI / 2;
    val.position.set(x - 0.4, H - 0.25, D / 2);
    rig.add(val);

    // 중정 확산광 — 창 바로 안쪽 위에서 실내 쪽으로 비스듬히 내려오는 넓은 스팟 4개(반지름 1.4m라 빛이 부드럽다).
    for (let i = 0; i < 4; i++) {
      const z = z1 + ((i + 0.5) / 4) * glassW;
      const l = new THREE.SpotLight(0xf3f6fa, LIGHT.window, 0, 1.2, 1, 2);
      l.radius = 1.4;
      l.position.set(x - 0.6, H - 0.6, z);
      const t = new THREE.Object3D();
      t.position.set(W - 11, 0.3, z);
      l.target = t;
      rig.add(l, t);
    }

    // 창밖 풍경은 "배경"으로 둔다 — 카메라에만 보이고 빛 계산에는 섞이지 않는다.
    // (빛을 내는 면으로 세우면 그 빛이 실내 곳곳에 흰 점 노이즈로 튄다.)
    // 배경은 방향으로 찾는 파노라마(equirect)라서 창 방향(+X)을 가운데 두고 사진을 펼친다:
    //   왼쪽(-Z 쪽) = 유리 지붕 아래 흰 PMQ 건물(courtyard.jpg), 가운데~오른쪽 = 큰 나무와 맞은편 아파트(courtyard-tree.jpg).
    //   둘 다 04_Glass Facade의 실내 사진에서 잘라 냈다.
    try {
      const [left, tree] = await Promise.all([loadImage('textures/courtyard.jpg'), loadImage('textures/courtyard-tree.jpg')]);
      const PW = 4096, PH = 2048;
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      const ctx = c.getContext('2d');
      const sky = ctx.createLinearGradient(0, 0, 0, PH);
      sky.addColorStop(0, '#d9e2ea'); sky.addColorStop(0.5, '#eef0ee'); sky.addColorStop(0.5, '#bdb9b0'); sky.addColorStop(1, '#a29f98');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, PW, PH);
      const deg = Math.PI / 180;
      const uOf = (az) => (az / (2 * Math.PI) + 0.5) * PW; // 방위각(+X에서 +Z 쪽으로, 실내에서 보면 오른쪽) → 가로
      const yOf = (el) => (1 - (el / Math.PI + 0.5)) * PH;  // 올려본 각 → 세로(위가 하늘)
      const put = (im, az0, az1, el0, el1, flip) => {
        const x0 = uOf(az0 * deg), x1 = uOf(az1 * deg), y0 = yOf(el1 * deg), y1 = yOf(el0 * deg);
        ctx.save();
        if (flip) { ctx.translate(x1, 0); ctx.scale(-1, 1); ctx.drawImage(im, 0, y0, x1 - x0, y1 - y0); }
        else ctx.drawImage(im, x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
      };
      ctx.filter = 'brightness(110%)';
      put(left, -80, -42, -24, 52, true);  // 맨 왼쪽: 흰 건물(뒤집어 이어 붙임)
      put(left, -42, -8, -24, 52, false);  // 왼쪽: 흰 건물 + 유리 지붕
      put(tree, -8, 62, -24, 22, false);   // 가운데~오른쪽: 나무와 아파트
      put(left, -8, 62, 22, 52, true);     // 나무 위: 유리 지붕(흰 건물 사진의 윗부분)
      put(left, 62, 90, -24, 52, false);   // 맨 오른쪽: 흰 건물
      const bg = new THREE.CanvasTexture(c);
      bg.colorSpace = THREE.SRGBColorSpace;
      bg.mapping = THREE.EquirectangularReflectionMapping;
      v.scene.background = bg;
      v.scene.backgroundIntensity = 1.2;
      this._undo.push(() => { bg.dispose(); v.scene.backgroundIntensity = 1; });
    } catch (e) { console.warn(e.message); }

    // 햇빛 — 유리 지붕을 거쳐 약하게. 창 앞 바닥에 옅은 빛 자국만 생긴다.
    const sun = new THREE.DirectionalLight(0xfff6ea, LIGHT.sun);
    const dir = new THREE.Vector3(1, 0.72, 0.38).normalize();
    const target = new THREE.Object3D();
    target.position.set(W - 6, 0, D / 2);
    sun.position.copy(target.position).addScaledVector(dir, 40);
    sun.target = target;
    rig.add(target, sun);
  }

  /**
   * 천장에서 아래로 고르게 내려오는 빛 — 크기(반지름)가 있는 넓은 스팟을 ㄱ자 안쪽 위에 격자로 둔다.
   * (면광원 RectAreaLight는 이 버전의 경로 추적기에서 샘플을 쌓아도 사라지지 않는 노이즈를 만들어 쓰지 않는다.)
   * 반지름이 클수록 그림자가 부드럽다 — 0.7m는 흐리멍덩하지 않게 윤곽이 남는 정도.
   */
  _buildSoftCeiling(rig) {
    const y = H - 0.35;
    const x1 = WALLS[0].origin.x / 1000 + 2.5, x2 = W - 3, z1 = WALLS[0].origin.z / 1000 + 2.5, z2 = D - 3.5;
    const nx = 3, nz = 2;
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const px = x1 + ((i + 0.5) / nx) * (x2 - x1), pz = z1 + ((k + 0.5) / nz) * (z2 - z1);
        const l = new THREE.SpotLight(NEUTRAL_WHITE, LIGHT.ceilingSoft, 0, 1.15, 1, 2);
        l.radius = 0.7;
        l.position.set(px, y, pz);
        const t = new THREE.Object3D();
        t.position.set(px, 0, pz);
        l.target = t;
        rig.add(l, t);
      }
    }
  }

  /** 포스터 벽을 비추는 천장 트랙 스팟(검은 레일 + 조명 머리)을 벽마다 3.4m 간격으로 단다. */
  _buildTrackSpots(rig) {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.5 });
    const headGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 16);
    const y = H - 0.3, offset = 2.3, aimY = 1.45, step = 3.4; // 스팟이 많으면 노이즈가 늘어 3.4m 간격
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
        // 조명 기구 모양만 단다 — 실제 스팟 빛을 넣으면 광원 수만큼 경로 추적 노이즈가 늘어(샘플마다 광원 하나만 고른다)
        // 벽면 빛은 천장 · 창 면광원이 맡는다.
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
