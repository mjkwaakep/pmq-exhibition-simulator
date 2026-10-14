// ============================================================================
// 3D PERSPECTIVE VIEW — 실제 geometry로 지은 L자형 3벽 구조 + 반투명 패널 재질.
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { ROOM_HEIGHT_MM, ROOM_WIDTH_MM, ROOM_DEPTH_MM } from './constants.js';
import { loadWallImage } from './wall-image.js';
import { buildDimensions, buildFlow, buildSite, buildColumns, buildExitZones } from './site-extras.js';
import { tableSettings } from './table-settings.js';

const MM2M = 0.001;
// 벽 시안 이미지에서 실제 벽 크기에 해당하는 부분만 보이게 한다(setPosters가 crop을 계산해 둔다).
function applyCrop(tex, mat) {
  const { u, v, offsetU } = mat.userData.crop;
  tex.repeat.set(u, v);
  tex.offset.set(offsetU, 0);
}
const ROOM_H = ROOM_HEIGHT_MM * MM2M; // 5m 층고
const ROOM_W = ROOM_WIDTH_MM * MM2M;  // 30m 가로(X) — 왼쪽 외벽(x=0) ~ 전면 창(x=ROOM_W)
const ROOM_D = ROOM_DEPTH_MM * MM2M;  // 20m 깊이(Z) — 상단 외벽(z=0) ~ 하단 외벽(z=ROOM_D)
const textureLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(url) {
  if (texCache.has(url)) return texCache.get(url);
  const t = textureLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(url, t);
  return t;
}

function makeRibTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 4;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#dfe8ea'); g.addColorStop(1, '#aebac0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 현장 사진처럼 미세한 결이 있는 회색 카펫 타일 텍스처(반복용). */
function makeCarpetTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5b5b58';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const len = 6 + Math.random() * 16;
    const v = 70 + Math.random() * 70; // 밝기 편차로 결 표현
    ctx.strokeStyle = `rgba(${v},${v},${v - 4},${0.18 + Math.random() * 0.22})`;
    ctx.lineWidth = 0.7 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * (0.7 + Math.random() * 0.3), y + (Math.random() - 0.5) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SCENE_BG = 0xe8e4da; // 레퍼런스 사진처럼 밝은 크림톤 배경(어두운 보이드 느낌 제거)

export class PosterWall3D {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SCENE_BG);
    this.scene.fog = new THREE.Fog(SCENE_BG, 55, 130); // 아주 옅게 — 레퍼런스처럼 깨끗하고 밝게(30×20m 공간 기준)

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasContainer.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 34; // 방이 30×20m로 닫혀 있어 벽을 뚫고 나가지 않도록 제한
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this._buildStatic();
    this._buildProps();
    // 보조 레이어(치수선 · 동선 화살표 · 현장 재현) — 기존 요소 위에 덧붙이기만 한다.
    this.dimsGroup = buildDimensions(); this.scene.add(this.dimsGroup);
    this.flowGroup = buildFlow(); this.scene.add(this.flowGroup);
    this.siteGroup = buildSite(); this.scene.add(this.siteGroup);
    this.columnsGroup = buildColumns(); this.scene.add(this.columnsGroup);
    this.exitZonesGroup = buildExitZones(); this.scene.add(this.exitZonesGroup);
    this.setSiteVisible(true);
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._tween = null;
    this._animate();
  }

  setDimsVisible(v) { if (this.dimsGroup) this.dimsGroup.visible = v; }
  setFlowVisible(v) { if (this.flowGroup) this.flowGroup.visible = v; }
  setColumnsVisible(v) { if (this.columnsGroup) this.columnsGroup.visible = v; }
  setExitZonesVisible(v) { if (this.exitZonesGroup) this.exitZonesGroup.visible = v; }
  // 현장 재현을 켜면 기존의 밝은 창(위아래 흰 띠 포함)만 잠시 숨기고, 끄면 원래대로 되돌린다.
  setSiteVisible(v) {
    this._siteOn = v;
    if (this.siteGroup) this.siteGroup.visible = v;
    this._applyPerimeter();
  }
  // 가장 바깥 외벽(커튼·출입구·창 포함)을 켜고 끈다 — 끄면 밖에서 전시장 안이 그대로 보인다.
  setPerimeterVisible(v) { this._perimOn = v; this._applyPerimeter(); }
  _applyPerimeter() {
    const on = this._perimOn !== false;
    if (this.siteGroup) this.siteGroup.userData.perimeter.visible = on;
    (this._outerWalls || []).forEach((m) => { m.visible = on; });
    (this._winParts || []).forEach((m) => { m.visible = on && !this._siteOn; });
  }

  // 전시 소개 벽(입구에서 바로 보이는 타이틀 월). 입구 쪽(+Z) 면에 타이틀 그래픽을 붙인다.
  _buildIntroWall(cx, cz, len, h, t) {
    const g = new THREE.Group();
    // Wall02·03과 같은 반투명 골판 패널(setWalls의 재질과 같은 값).
    const ribTex = makeRibTexture();
    ribTex.repeat.set(Math.max(4, len * 1000 / 120), 1);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(len, h, t),
      new THREE.MeshPhysicalMaterial({
        color: 0xdcecf0, roughness: 0.28, metalness: 0, transmission: 0.68, thickness: 0.12, ior: 1.4,
        transparent: true, opacity: 0.5, map: ribTex, side: THREE.DoubleSide,
      })
    );
    body.position.set(cx, h / 2, cz);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    this.scene.add(g);
    this.introGroup = g;
  }

  // 서문 벽 그래픽(더미). 일반적인 전시 서문 구성 — 위에서부터 장소·기간, 타이틀, 국문/영문 개요 2단,
  // 맨 아래 크레딧. 글자 크기와 위치는 벽 크기와 무관하게 실제 치수(mm)로 잡는다: 본문 중심이 눈높이(약 1.45m).
  _makeForewordTexture(len, h) {
    const PX = 800; // 1m당 픽셀
    const c = document.createElement('canvas');
    c.width = Math.round(len * PX); c.height = Math.round(h * PX);
    const ctx = c.getContext('2d');
    const mm = (v) => v * PX / 1000;
    const yAt = (fromFloorMM) => c.height - mm(fromFloorMM); // 바닥에서 잰 높이 → 캔버스 y
    const latin = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    const hangul = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const margin = mm(180), innerW = c.width - margin * 2;
    // 낱말 단위로 줄바꿈하며 문단을 쓰고, 마지막 줄 아래 y를 돌려준다.
    const paragraph = (str, x, y, width, lineH) => {
      let line = '';
      str.split(' ').forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > width) { ctx.fillText(line, x, y); y += lineH; line = word; }
        else line = next;
      });
      if (line) { ctx.fillText(line, x, y); y += lineH; }
      return y;
    };

    ctx.font = `500 ${mm(26)}px ${latin}`;
    ctx.fillText('PMQ · Qube 2/F, Hong Kong      0000. 00. 00 — 00. 00', margin, yAt(2130));
    ctx.font = `700 ${mm(150)}px ${latin}`;
    ctx.fillText('EVERYDAY', margin, yAt(1930));
    ctx.fillText('PRACTICE', margin, yAt(1770));
    ctx.font = `700 ${mm(92)}px ${hangul}`;
    ctx.fillText('일상의실천', margin, yAt(1630));
    ctx.fillRect(margin, yAt(1560), innerW, Math.max(1, mm(3))); // 타이틀과 본문을 가르는 선

    const gutter = mm(90), colW = (innerW - gutter) / 2, top = yAt(1470), lineH = mm(42);
    const en = [
      'Everyday Practice is a graphic design studio based in Seoul. This exhibition brings together posters, books and digital works from the studio, and looks at how design meets the conditions of everyday life.',
      'This is placeholder copy for the exhibition overview. It marks the position, length and size of the wall text and will be replaced with the final foreword.',
    ];
    const ko = [
      '일상의실천은 서울을 기반으로 활동하는 그래픽 디자인 스튜디오입니다. 이 전시는 스튜디오가 만들어 온 포스터와 책, 디지털 작업을 한자리에 모아 디자인이 일상의 조건과 만나는 방식을 살펴봅니다.',
      '이 글은 전시 개요가 들어갈 자리와 분량, 글자 크기를 보여 주기 위한 더미 텍스트이며 최종 서문으로 교체됩니다.',
    ];
    ctx.font = `400 ${mm(27)}px ${latin}`;
    let y = top;
    en.forEach((p) => { y = paragraph(p, margin, y, colW, lineH) + lineH * 0.6; });
    ctx.font = `400 ${mm(26)}px ${hangul}`;
    y = top;
    ko.forEach((p) => { y = paragraph(p, margin + colW + gutter, y, colW, lineH) + lineH * 0.6; });

    ctx.font = `400 ${mm(18)}px ${latin}`;
    ctx.fillStyle = 'rgba(17,17,17,0.7)';
    ctx.fillText('Organised by 0000      Supported by 0000      Design: Everyday Practice', margin, yAt(420));

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  setTablesVisible(v) { if (this.tablesGroup) this.tablesGroup.visible = v; }

  // 벽 높이가 바뀌면 치수선만 다시 긋는다(벽·포스터는 app.js가 setWalls/setPosters로 다시 짓는다).
  rebuildDimensions() {
    const visible = this.dimsGroup.visible;
    this.scene.remove(this.dimsGroup);
    this.dimsGroup.traverse((o) => {
      if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
      else if (o.geometry) o.geometry.dispose();
    });
    this.dimsGroup = buildDimensions(); this.scene.add(this.dimsGroup);
    this.dimsGroup.visible = visible;
  }

  // TABLE SIZE 설정(table-settings.js)이 바뀌면 테이블·스툴·아이맥·도록과 치수선을 다시 짓는다.
  rebuildTables() {
    const dispose = (group) => {
      this.scene.remove(group);
      group.traverse((o) => {
        if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } // 치수 라벨(스프라이트는 공용 geometry)
        else if (o.geometry) o.geometry.dispose();
      });
    };
    const tablesVisible = this.tablesGroup.visible, dimsVisible = this.dimsGroup.visible;
    dispose(this.tablesGroup);
    this.introGroup.traverse((o) => { if (o.material && o.material.map) o.material.map.dispose(); });
    dispose(this.introGroup);
    dispose(this.dimsGroup);
    this._buildProps();
    this.tablesGroup.visible = tablesVisible;
    this.dimsGroup = buildDimensions(); this.scene.add(this.dimsGroup);
    this.dimsGroup.visible = dimsVisible;
  }

  // Wall01 입면 이미지를 현재 전시 버전에 맞게 바꿔 끼운다.
  _applyWall01Image() {
    const f = this._wall01Face;
    if (!f) return;
    const src = this._bookVersion === 'b' ? 'walls/wall01-b.png' : f.base;
    if (f.src === src) return;
    f.src = src;
    loadWallImage(src).then((canvas) => {
      if (f.src !== src) return; // 그 사이 다른 버전으로 바뀌었으면 버린다
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      applyCrop(tex, f.faceMat);
      if (f.faceMat.map) f.faceMat.map.dispose();
      f.faceMat.map = tex;
      f.faceMat.visible = true;
      f.faceMat.needsUpdate = true;
    });
  }

  // 검은 알루미늄 프레임 + 아크릴 판. frames-wall01.json은 인디자인 포스터 월(월25)에서
  // 고른 포스터의 위치(mm, 벽 왼쪽 위 모서리 기준)다.
  _buildFrames(wallH) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.35, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.13, depthWrite: false });
    const bar = 0.014, deep = 0.028, z0 = 0.068;
    fetch('frames-wall01.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : [])).then((list) => {
      list.forEach((f) => {
        const w = f.w / 1000, h = f.h / 1000;
        const cx = f.x / 1000 + w / 2, cy = wallH - f.y / 1000 - h / 2;
        const add = (bw, bh, x, y) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, deep), frameMat);
          m.position.set(x, y, z0 + deep / 2);
          this.framesGroup.add(m);
        };
        add(w + bar * 2, bar, cx, cy + h / 2 + bar / 2);
        add(w + bar * 2, bar, cx, cy - h / 2 - bar / 2);
        add(bar, h, cx - w / 2 - bar / 2, cy);
        add(bar, h, cx + w / 2 + bar / 2, cy);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
        glass.position.set(cx, cy, z0 + deep * 0.6);
        this.framesGroup.add(glass);
      });
    }).catch(() => {});
  }

  // 전시 버전 전환: 인디자인 레이아웃(mm 단위 — 테이블 왼쪽 위 모서리 기준)을 그대로 옮긴다.
  //   a = c와 같은 도록 배치 + Wall01 액자, b = 9~16쪽(기준선·번갈아), c = 17~24쪽(기준선·시리즈 같은 방향)
  // 표지 이미지가 있으면 윗면에 붙이고, 없으면 흰 책으로 둔다. 책 옆 소개글 종이도 함께 놓는다.
  // 페이지의 위쪽(y=0)이 Wall01 쪽(-Z), 왼쪽(x=0)이 테이블의 x1 쪽이다.
  setBookVersion(version) {
    if (!this.booksGroup) return;
    this._bookVersion = version;
    if (this.framesGroup) this.framesGroup.visible = version === 'a'; // 액자는 버전 A에만
    this._applyWall01Image();
    const { tableRuns, tableTopH, tableDepth } = this._tableGeom;
    const bookThick = 0.02;
    const plainMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.8 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.9 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    // x,y,w,h는 인디자인의 바운딩 박스(mm), rot은 인디자인 회전각(반시계 +).
    const place = (item, thick, mats) => {
      const run = tableRuns[item.table - 1];
      if (!run) return null;
      const side = item.rot === 90 || item.rot === 270;
      const w = (side ? item.h : item.w) / 1000, d = (side ? item.w : item.h) / 1000;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), mats);
      mesh.position.set(
        run.x1 + (item.x + item.w / 2) / 1000,
        tableTopH + thick / 2,
        run.z - tableDepth / 2 + (item.y + item.h / 2) / 1000,
      );
      mesh.rotation.y = (item.rot || 0) * Math.PI / 180; // 180 = 반대편에서 보도록 돌려 놓은 것
      this.booksGroup.add(mesh);
      return mesh;
    };
    fetch(`books-${version}.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).then((data) => {
      if (this._bookVersion !== version) return; // 그 사이 다른 버전을 눌렀으면 버린다
      while (this.booksGroup.children.length) {
        const old = this.booksGroup.children.pop();
        old.geometry.dispose();
      }
      (data.books || []).forEach((b) => {
        let topFace = plainMat;
        if (b.cover) {
          const tex = textureLoader.load(b.cover);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          topFace = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
        }
        // BoxGeometry 면 순서: +x, -x, +y(윗면), -y, +z, -z
        const mesh = place(b, bookThick, [edgeMat, edgeMat, topFace, edgeMat, edgeMat, edgeMat]);
        if (mesh) mesh.userData.book = b;
      });
      (data.papers || []).forEach((p) => place(p, 0.002, paperMat));
    }).catch(() => {});
  }
  setPeopleVisible(v) { if (this.peopleGroup) this.peopleGroup.visible = v; }
  setCeilingLightsVisible(v) { if (this._lightFrames) this._lightFrames.forEach((g) => { g.visible = v; }); }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _buildStatic() {
    const ceilingY = ROOM_H; // 5m 층고

    // 레퍼런스 사진처럼 부드럽고 밝은 스튜디오 조명 — 큰 소프트박스에서 오는 은은한
    // 확산광 위주로, 강한 스팟보다 전체적으로 고르게 밝다.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9a968c, 2.0);
    this.scene.add(hemi);
    const daylight = new THREE.DirectionalLight(0xfff9ef, 1.7); // 전면 창 쪽에서 오는 부드러운 주광(레퍼런스 그림자 방향)
    daylight.position.set(28, 14, 12);
    daylight.castShadow = true;
    daylight.shadow.mapSize.set(1024, 1024);
    daylight.shadow.camera.near = 0.5;
    daylight.shadow.camera.far = 60;
    daylight.shadow.radius = 4;
    this.scene.add(daylight);
    const fill = new THREE.DirectionalLight(0xeef2f5, 1.1);
    fill.position.set(6, 8, 18);
    this.scene.add(fill);
    const roomFill = new THREE.AmbientLight(0xffffff, 0.7); // 구석까지 고르게 밝혀주는 전역광
    this.scene.add(roomFill);

    // 바닥(회색 카펫 — 은은한 결/명암, 매끈한 렌더 느낌을 피함) — 레퍼런스처럼 밝게
    const carpetTex = makeCarpetTexture();
    const floorGeo = new THREE.PlaneGeometry(ROOM_W + 4, ROOM_D + 4);
    const floorMat = new THREE.MeshStandardMaterial({ map: carpetTex, color: 0xc9c6bc, roughness: 0.85, metalness: 0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ROOM_W / 2, 0, ROOM_D / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 천장 — 완전히 깨끗한 화이트(현장사진의 어두운 노출 천장/설비 재현하지 않음)
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W + 4, ROOM_D + 4),
      new THREE.MeshStandardMaterial({ color: 0xf5f3ec, roughness: 0.92, metalness: 0 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(ROOM_W / 2, ceilingY, ROOM_D / 2);
    this.scene.add(ceiling);

    // 천장 조명(길쭉한 사각 라인조명 3열) — Wall01 앞쪽 천장에, "형광등 표시" 체크박스로 켜고 끔
    this._lightFrames = [];
    const frameRuns = [
      { cx: 15.0, cz: 8, w: 5.5, d: 3.4 },
      { cx: 19.5, cz: 8, w: 5.5, d: 3.4 },
      { cx: 23.8, cz: 8, w: 5.0, d: 3.2 },
    ];
    frameRuns.forEach((f) => this._buildLightFrame(f.w, f.d, f.cx, f.cz, ceilingY));

    this._buildEnclosure(ceilingY);
  }

  /** 현장사진의 길쭉한 사각 라인조명(속은 어둡고 테두리만 밝은 프레임) 하나를 만든다. */
  _buildLightFrame(w, d, cx, cz, ceilingY) {
    const group = new THREE.Group();
    const barMat = new THREE.MeshStandardMaterial({ color: 0xfff8ea, emissive: 0xfff2d8, emissiveIntensity: 2.2, roughness: 0.5 });
    const t = 0.05;
    const mk = (bw, bd, x, z) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.03, bd), barMat);
      bar.position.set(cx + x, ceilingY - 0.03, cz + z);
      group.add(bar);
    };
    mk(w, t, 0, d / 2); mk(w, t, 0, -d / 2);
    mk(t, d, w / 2, 0); mk(t, d, -w / 2, 0);
    const glow = new THREE.PointLight(0xfff2d8, 3.2, 12, 2);
    glow.position.set(cx, ceilingY - 0.4, cz);
    group.add(glow);
    this.scene.add(group);
    this._lightFrames.push(group);
    return group;
  }

  /**
   * 전시장 전체(가로 30m × 깊이 20m × 층고 5m)를 사방이 막힌 방으로 짓는다.
   * 코너(Wall01↔Wall02)는 왼쪽 외벽에서 10m, 상단 외벽에서 2m 떨어진 (10,2).
   *   - 왼쪽 외벽: x=0, z:0..20 (Wall02/03의 후면 쪽, 10m 여백)
   *   - 상단 외벽: z=0, x:0..30 (Wall01의 후면 쪽, 2m 여백)
   *   - 하단 외벽: z=20, x:0..30 (Wall03 끝에서 2m 여백)
   *   - 전면 창: x=30, z:0..20 (Wall01 끝에서 5m 여백) — 얇은 실버 프레임 + 은은한 녹음 배경
   * 포스터 월(2.5m)이 실제 층고(5m)의 절반이라도, 각 벽 뒤에 실제 여백(2~10m)이 있는
   * 외벽이 따로 있으므로 예전처럼 포스터 월 바로 뒤에 별도 "백업 벽"을 덧세울 필요가 없다.
   */
  _buildEnclosure(ceilingY) {
    const plainMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.92, side: THREE.DoubleSide });

    // 왼쪽 외벽 (x=0, 법선 +X)
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ceilingY), plainMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(0, ceilingY / 2, ROOM_D / 2);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    // 상단 외벽 (z=0, 법선 +Z) — Wall01 뒤
    const topWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ceilingY), plainMat);
    topWall.position.set(ROOM_W / 2, ceilingY / 2, 0);
    topWall.receiveShadow = true;
    this.scene.add(topWall);

    // 하단 외벽 (z=ROOM_D, 법선 -Z) — Wall03 끝 쪽
    const bottomWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ceilingY), plainMat);
    bottomWall.rotation.y = Math.PI;
    bottomWall.position.set(ROOM_W / 2, ceilingY / 2, ROOM_D);
    bottomWall.receiveShadow = true;
    this.scene.add(bottomWall);
    this._outerWalls = [leftWall, topWall, bottomWall];

    // 전면 창 (x=ROOM_W, 법선 -X) — 바닥부터 천장까지 통유리 커튼월이 아니라,
    // 위/아래에 흰 벽 구조체를 두고 중간 큰 창만 얇은 실버 프레임으로 마감한다.
    const winGroup = new THREE.Group();
    const winX = ROOM_W;
    const headH = 0.7, sillH = 1.0;
    const glassH = ceilingY - headH - sillH;
    const glassCy = sillH + glassH / 2;

    const headBand = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, headH), plainMat);
    headBand.rotation.y = -Math.PI / 2;
    headBand.position.set(winX, ceilingY - headH / 2, ROOM_D / 2);
    this.scene.add(headBand);

    const sillBand = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, sillH), plainMat);
    sillBand.rotation.y = -Math.PI / 2;
    sillBand.position.set(winX, sillH / 2, ROOM_D / 2);
    this.scene.add(sillBand);

    // 창밖 풍경 — 은은하고 흐릿하게(메인 그래픽처럼 강하게 보이지 않도록 낮은 오파시티 + 밝은 톤)
    const outsideTex = loadTex('textures/outside.jpg');
    outsideTex.wrapS = THREE.RepeatWrapping;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_D, glassH),
      new THREE.MeshBasicMaterial({ map: outsideTex, fog: false, side: THREE.DoubleSide, transparent: true, opacity: 0.55, color: 0xf3f6ee })
    );
    backdrop.rotation.y = -Math.PI / 2;
    backdrop.position.set(winX + 1.4, glassCy, ROOM_D / 2);
    winGroup.add(backdrop);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xeef4f4, roughness: 0.08, metalness: 0, transmission: 0.92, thickness: 0.05,
      ior: 1.45, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, glassH), glassMat);
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(winX, glassCy, ROOM_D / 2);
    winGroup.add(glass);

    // 얇은 실버/그레이 창호 — 검은 세로 프레임 반복 없이, 큰 창을 자연스럽게만 분할
    const mullionMat = new THREE.MeshStandardMaterial({ color: 0xc7cbcd, roughness: 0.4, metalness: 0.55 });
    const nMullion = 5;
    for (let i = 0; i <= nMullion; i++) {
      const z = (i * ROOM_D) / nMullion;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, glassH, 0.05), mullionMat);
      bar.position.set(winX, glassCy, z);
      winGroup.add(bar);
    }
    const headBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, ROOM_D), mullionMat);
    headBar.position.set(winX, sillH + glassH, ROOM_D / 2);
    winGroup.add(headBar);
    const sillBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, ROOM_D), mullionMat);
    sillBar.position.set(winX, sillH, ROOM_D / 2);
    winGroup.add(sillBar);

    this.scene.add(winGroup);
    this._winParts = [winGroup, headBand, sillBand];
  }

  // 허리 높이(900mm)의 가늘고 긴 테이블 + 간단한 사람 모형(둘 다 옵션 토글용).
  // ㄱ자 안쪽 영역(x<0, z<0)에 도면의 "Modular Tables" 배치처럼 나란히 놓는다.
  _buildProps() {
    this.tablesGroup = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.55, metalness: 0.05 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.4, metalness: 0.6 });
    // 길이·폭·높이는 사이드바 TABLE SIZE 설정(table-settings.js, mm)을 따른다.
    const ts = tableSettings;
    // 도록 테이블: 기본 8,300 × 500mm 4개. Wall01(x 11.5~28.5m)의 가운데(x=20m)에 맞춰 나란히 놓고
    // 테이블 사이(가장자리 기준) 간격은 1,850mm.
    const tableTopH = ts.topH * MM2M, tableThick = 0.04, tableDepth = ts.bookDep * MM2M;
    const tableLen = ts.bookLen * MM2M, tableGap = 1.85, tableCount = 4;
    const tableCx = 20.0, tableZ0 = 5.35 + tableDepth / 2; // Wall01(z=2.6) ↔ 첫 테이블 가장자리 2,750mm
    const tableRuns = Array.from({ length: tableCount }, (_, i) => ({
      x1: tableCx - tableLen / 2,
      x2: tableCx + tableLen / 2,
      z: tableZ0 + i * (tableDepth + tableGap),
      depth: tableDepth,
    }));
    // 보조 테이블: 1,200 × 500mm 4개. Wall01 맞은편(하단 외벽) 쪽에 벽과 나란히 한 줄로 놓는다.
    // 벽에서 500mm 띄우고, 도록 테이블과 같은 폭(8.3m) 안에 고르게 나눈다.
    // 보조 테이블 뒤(하단 외벽 쪽)에 전시 소개 벽을 세우고, 테이블은 그 벽 앞(Wall01 쪽)으로 당겨 놓는다.
    // 소개 벽: 8,300 × 2,500 × 100mm, 입구 쪽 면이 하단 외벽(출입구 커튼벽)에서 2,750mm. 테이블 뒷변 ↔ 벽 150mm.
    const sideLen = ts.sideLen * MM2M, sideCount = 4, sideGap = ts.sideGap * MM2M, sideDepth = ts.sideDep * MM2M; // 보조(아이맥) 테이블 기본 1,000mm, 테이블 사이 900mm
    const introH = ts.introH * MM2M, introT = 0.1, introGap = 0.15;
    // 소개 벽의 뒷면(하단 외벽 쪽)을 하단 기둥이 끝나는 선(벽에서 1,310mm)에 맞춘다.
    const introFaceZ = ROOM_DEPTH_MM / 1000 - 1.31;
    const sideZ = introFaceZ - introT - introGap - sideDepth / 2;
    this._buildIntroWall(tableCx, introFaceZ - introT / 2, ts.introLen * MM2M, introH, introT);
    // 서문 벽: 소개 벽의 입구 쪽 끝(+X)에서 90도로 꺾여 전시장 안(-Z)으로 들어온다. 글은 입구 쪽 면(+X)에 올린다.
    // 바깥 면을 소개 벽의 끝점에 딱 맞춘다(끝 밖으로 튀어나오지 않음). 길이는 소개 벽 뒷면(모서리)에서 잰
    // 바깥 치수라서, 길이를 바꾸면 모서리는 그대로 있고 전시장 안쪽 끝만 움직인다.
    {
      const pLen = ts.prefaceLen * MM2M, pH = ts.prefaceH * MM2M;
      const preface = new THREE.Mesh(
        new THREE.BoxGeometry(introT, pH, pLen - introT),
        new THREE.MeshStandardMaterial({ color: 0xf4f3ef, roughness: 0.9 })
      );
      preface.position.set(tableCx + ts.introLen * MM2M / 2 - introT / 2, pH / 2, introFaceZ - introT - (pLen - introT) / 2);
      preface.castShadow = true; preface.receiveShadow = true;
      this.introGroup.add(preface);
      // 입구 쪽 면(+X)에 타이틀과 전시 개요를 올린다. 평면을 +90도 돌리면 왼쪽 끝이 모서리(+Z) 쪽이 된다.
      const faceLen = pLen - introT;
      const text = new THREE.Mesh(
        new THREE.PlaneGeometry(faceLen, pH),
        new THREE.MeshStandardMaterial({ map: this._makeForewordTexture(faceLen, pH), roughness: 0.9 })
      );
      text.rotation.y = Math.PI / 2;
      text.position.set(preface.position.x + introT / 2 + 0.002, pH / 2, preface.position.z);
      this.introGroup.add(text);
    }
    const sideStep = sideLen + sideGap;
    const sideX0 = tableCx - (sideCount * sideLen + (sideCount - 1) * sideGap) / 2; // 도록 테이블 중심에 맞춰 가운데 정렬
    const sideRuns = Array.from({ length: sideCount }, (_, i) => {
      const x1 = sideX0 + i * sideStep;
      return { x1, x2: x1 + sideLen, z: sideZ, depth: sideDepth };
    });
    [...tableRuns, ...sideRuns].forEach(({ x1, x2, z, depth }) => {
      const len = Math.abs(x2 - x1);
      const cx = (x1 + x2) / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, tableThick, depth), topMat);
      top.position.set(cx, tableTopH - tableThick / 2, z);
      this.tablesGroup.add(top);
      const legR = 0.02;
      [x1 + 0.15, x2 - 0.15].forEach((lx) => {
        [z - depth / 2 + 0.08, z + depth / 2 - 0.08].forEach((lz) => {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, tableTopH - tableThick, 10), legMat);
          leg.position.set(lx, (tableTopH - tableThick) / 2, lz);
          this.tablesGroup.add(leg);
        });
      });
    });
    // 리플렛 테이블: 모서리를 크게 굴린 직사각형 기본 6,000 × 900mm(모서리 반경 350mm), 상판 높이는 도록 테이블과 같다.
    // 전면 창 쪽(Wall01 끝과 창 사이) 가운데에 창과 나란히 둔다.
    {
      const rx = ROOM_WIDTH_MM / 1000 - 1.95, rz = ROOM_DEPTH_MM / 1000 / 2;
      const rLen = ts.leafLen * MM2M, rWid = ts.leafWid * MM2M; // 길이(Z 방향), 폭(X 방향)
      const rRad = Math.min(0.35, rWid / 2 - 0.001, rLen / 2 - 0.001); // 모서리 반경
      const hw = rWid / 2, hl = rLen / 2;
      const sh = new THREE.Shape();
      sh.moveTo(-hw + rRad, -hl);
      sh.lineTo(hw - rRad, -hl); sh.absarc(hw - rRad, -hl + rRad, rRad, -Math.PI / 2, 0, false);
      sh.lineTo(hw, hl - rRad); sh.absarc(hw - rRad, hl - rRad, rRad, 0, Math.PI / 2, false);
      sh.lineTo(-hw + rRad, hl); sh.absarc(-hw + rRad, hl - rRad, rRad, Math.PI / 2, Math.PI, false);
      sh.lineTo(-hw, -hl + rRad); sh.absarc(-hw + rRad, -hl + rRad, rRad, Math.PI, Math.PI * 1.5, false);
      const rGeo = new THREE.ExtrudeGeometry(sh, { depth: tableThick, bevelEnabled: false, curveSegments: 24 });
      rGeo.rotateX(Math.PI / 2); // 도형의 Y축 → 바닥의 Z축, 두께는 아래로
      const rTop = new THREE.Mesh(rGeo, topMat);
      rTop.position.set(rx, tableTopH, rz);
      rTop.castShadow = true; rTop.receiveShadow = true;
      this.tablesGroup.add(rTop);
      [-1, 1].forEach((sx) => { [-1, 0, 1].forEach((sz) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, tableTopH - tableThick, 10), legMat);
        leg.position.set(rx + sx * Math.max(hw - 0.2, hw / 2), (tableTopH - tableThick) / 2, rz + sz * (hl - 0.35));
        this.tablesGroup.add(leg);
      }); });
      // 리플렛 더미(A4)
      const colors = [0xff40b2, 0x3d75ff, 0xf7f729, 0x73e312, 0xff3d17, 0x7d3d99];
      colors.forEach((color, i) => {
        const stack = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.297), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
        stack.position.set(rx + (i % 2 ? 0.14 : -0.14), tableTopH + 0.015, rz + (i - 2.5) * rLen * 2 / 15);
        stack.rotation.y = Math.PI / 2 + (i % 2 ? 0.08 : -0.06);
        this.tablesGroup.add(stack);
      });
    }
    this.scene.add(this.tablesGroup);

    // 스툴: 보조 테이블(아이맥) 앞에 하나씩 놓는다.
    // 기본형 한 가지 — 둥근 나무 좌판에 곧은 다리 4개와 발걸이 링(좌판 높이 약 450mm).
    const seatMat = new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.6, metalness: 0.05 });
    const stoolLegMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.45, metalness: 0.5 });
    const makeStool = () => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 28), seatMat); seat.position.y = 0.435;
      g.add(seat);
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI / 4 + i * Math.PI / 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.42, 10), stoolLegMat);
        leg.position.set(Math.cos(ang) * 0.125, 0.21, Math.sin(ang) * 0.125);
        g.add(leg);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.008, 8, 28), stoolLegMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.14;
      g.add(ring);
      return g;
    };
    const zFar = sideZ - sideDepth / 2 - 0.55;       // 보조 테이블 바로 앞
    const stoolSpots = sideRuns.map((r) => [(r.x1 + r.x2) / 2, zFar]); // 보조 테이블 앞에만
    this.stoolsGroup = new THREE.Group();
    stoolSpots.forEach(([x, z]) => {
      const st = makeStool();
      st.position.set(x, 0, z);
      this.stoolsGroup.add(st);
    });
    this.tablesGroup.add(this.stoolsGroup);

    // 보조 테이블 위 아이맥 24인치(2023, M3): 본체 547 × 461 × 147mm, 화면 두께 11.5mm.
    // 벽을 등지고 화면이 전시장 안쪽(스툴 쪽, -Z)을 향하게 테이블마다 한 대씩 놓는다.
    const macBody = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.35, metalness: 0.7 });
    const macBezel = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.5, metalness: 0.1 });
    const macScreen = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.15, metalness: 0.3 });
    const macW = 0.547, macPanelH = 0.378, macThick = 0.0115, macTotalH = 0.461;
    const panelBottom = macTotalH - macPanelH; // 받침대 위로 화면 패널이 뜨는 높이
    sideRuns.forEach((r) => {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(macW, macPanelH, macThick), macBody);
      panel.position.y = panelBottom + macPanelH / 2;
      const bezel = new THREE.Mesh(new THREE.PlaneGeometry(macW - 0.004, macPanelH - 0.064), macBezel);   // 흰 테두리(아래 턱 60mm 제외)
      bezel.position.set(0, panelBottom + 0.062 + (macPanelH - 0.064) / 2, -macThick / 2 - 0.0004); bezel.rotation.y = Math.PI;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(macW - 0.026, macPanelH - 0.086), macScreen); // 4.5K 화면
      screen.position.set(0, panelBottom + 0.073 + (macPanelH - 0.086) / 2, -macThick / 2 - 0.0008); screen.rotation.y = Math.PI;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.13, panelBottom + 0.09, 0.008), macBody);
      neck.position.set(0, (panelBottom + 0.09) / 2, 0.012); neck.rotation.x = -0.12;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.006, 0.147), macBody);
      foot.position.set(0, 0.003, 0.0);
      g.add(panel, bezel, screen, neck, foot);
      g.position.set((r.x1 + r.x2) / 2, tableTopH, r.z + 0.08);
      this.tablesGroup.add(g);
    });

    // 테이블 위 도록 — 전시 버전별 배치 파일(books-a/b/c.json)을 바꿔 끼운다.
    this.booksGroup = new THREE.Group();
    this.tablesGroup.add(this.booksGroup);
    this._tableGeom = { tableRuns, tableTopH, tableDepth };
    this.setBookVersion(this._bookVersion || 'b');


    // 실제 사람 사진(반투명 실루엣 처리)을 카메라를 향하는 flat billboard로 세운다
    // — 건축 시각화에서 스케일감을 보여줄 때 흔히 쓰는 "cutout entourage" 방식.
    // 이미지 출처: skalgubbar.se (건축 시각화용 무료 컷아웃 인물, CC 라이선스).
    if (this.peopleGroup) return; // 테이블만 다시 지을 때(rebuildTables) 사람은 그대로 둔다
    this.peopleGroup = new THREE.Group();
    this._billboards = [];
    const peoplePlacements = [
      { file: 'person1.png', x: 16.0, z: 4.0, h: 1.68 },
      { file: 'person2.png', x: 18.7, z: 6.4, h: 1.62 },
      { file: 'person3.png', x: 14.1, z: 8.6, h: 1.8 },
      { file: 'person4.png', x: 20.1, z: 11.0, h: 1.78 },
      { file: 'person5.png', x: 12.7, z: 14.5, h: 1.66 },
      { file: 'person6.png', x: 17.5, z: 14.6, h: 1.76 },
    ];
    peoplePlacements.forEach(({ file, x, z, h }) => {
      const url = `people/${file}`;
      const tex = loadTex(url);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      // 임시로 정사각 비율로 세워두고, 실제 이미지 크기를 알게 되는 즉시(비율 왜곡 없이) 다시 맞춘다
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.5, h), mat);
      plane.position.set(x, h / 2, z);
      const probe = new Image();
      probe.onload = () => {
        const ratio = probe.naturalWidth / probe.naturalHeight;
        plane.geometry.dispose();
        plane.geometry = new THREE.PlaneGeometry(h * ratio, h);
      };
      probe.src = url;
      this._billboards.push(plane);
      this.peopleGroup.add(plane);
    });
    this.scene.add(this.peopleGroup);
  }

  setWalls(wallsConfig) {
    this._wallMeshes && this._wallMeshes.forEach((g) => this.scene.remove(g));
    this._wallMeshes = [];
    const ribTex = makeRibTexture();

    wallsConfig.forEach((wall) => {
      const group = new THREE.Group();
      const Lm = wall.lengthMM * MM2M, Hm = wall.heightMM * MM2M, depth = 0.08;
      const isOpaque = wall.material === 'opaque';

      let mat;
      if (isOpaque) {
        mat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.85, metalness: 0.02 });
      } else {
        ribTex.repeat.set(Math.max(4, wall.lengthMM / 120), 1);
        mat = new THREE.MeshPhysicalMaterial({
          color: 0xdcecf0,
          roughness: 0.28,
          metalness: 0,
          transmission: 0.68,
          thickness: 0.12,
          ior: 1.4,
          transparent: true,
          opacity: 0.5,
          map: ribTex,
          side: THREE.DoubleSide,
        });
      }
      const panel = new THREE.Mesh(new THREE.BoxGeometry(Lm, Hm, depth), mat);
      panel.position.set(Lm / 2, Hm / 2, 0);
      panel.castShadow = true;
      panel.receiveShadow = true;
      group.add(panel);

      // 금속 프레임 — 얇은 스테인리스 스틸 프로파일. 포스터가 붙는 전면(posterSign 쪽)이
      // 아니라 그 반대쪽(후면)에 둬서, 정면에서 보면 포스터 앞으로 프레임이 지나가지
      // 않고, 패널이 반투명한 곳(포스터가 없는 부분)에서만 후면 프레임이 은은히 비친다.
      const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.48, metalness: 0.72 });
      const fw = 0.022, fd = 0.045;
      const posterSign = wall.flip ? -1 : 1;
      const frameSign = -posterSign; // 포스터 반대쪽(후면)
      const mkBar = (w, h, x, y) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), frameMat);
        bar.position.set(x, y, frameSign * (depth / 2 + 0.012));
        group.add(bar);
      };
      mkBar(Lm, fw, Lm / 2, Hm - fw / 2);
      mkBar(Lm, fw, Lm / 2, fw / 2);
      mkBar(fw, Hm, fw / 2, Hm / 2);
      mkBar(fw, Hm, Lm - fw / 2, Hm / 2);
      if (!isOpaque) {
        for (let m = 1; m < wall.lengthMM / 1000; m++) mkBar(fw * 0.7, Hm, m, Hm / 2);
      }

      group.rotation.y = wall.rotationY;
      group.position.set(wall.origin.x * MM2M, 0, wall.origin.z * MM2M);

      // 세로 골이 실제 벽 방향으로 흐르도록 UV 반복은 로컬 X(=Lm)에 걸었으므로 회전 후에도 정상
      group.userData.wall = wall;
      // Wall01 포스터 일부에 씌우는 액자(전시 버전 A에서만 보인다). 좌표는 벽 로컬:
      // x = 벽 왼쪽 끝에서부터, y = 바닥에서부터, +z = 전시장 안쪽.
      if (wall.id === 'wall01') {
        this.framesGroup = new THREE.Group();
        this.framesGroup.visible = this._bookVersion === 'a';
        group.add(this.framesGroup);
        this._buildFrames((wall.imageHeightMM || wall.heightMM) * MM2M); // 액자는 시안 이미지 위치를 따른다
      }
      group.userData.posterGroup = new THREE.Group();
      group.add(group.userData.posterGroup);

      this.scene.add(group);
      this._wallMeshes.push(group);
    });
  }

  setPosters(layout) {
    this._wallMeshes.forEach((group) => {
      const pg = group.userData.posterGroup;
      while (pg.children.length) {
        const c = pg.children.pop();
        c.geometry.dispose();
        if (c.material.map) c.material.map.dispose?.();
        c.material.dispose();
      }
      const wall = group.userData.wall;
      const entry = layout.walls.find((w) => w.wall.id === wall.id);
      if (!entry) return;
      // flip=true 벽(Wall03)은 group 회전만으로는 반대쪽(안쪽)을 향하게 만들 수 없어
      // (span 방향과 법선 방향이 순수 Y회전으로는 독립적으로 못 골라짐) 포스터 개별
      // 메시를 로컬 -Z면에 놓고 180도 돌려서 안쪽(테이블 쪽)을 보게 만든다.
      const sign = wall.flip ? -1 : 1;
      const rotY = wall.flip ? Math.PI : 0;

      // 시안 이미지가 있는 벽: 입면 이미지 한 장을 벽 전면에 그대로 붙인다. flip 벽은
      // 평면을 180도 돌려 붙이므로 안쪽에서 볼 때 이미지가 좌우 반전 없이 보인다.
      if (wall.image) {
        // 이미지는 시안 기준 높이(imageHeightMM)대로 바닥에 맞춰 붙인다. 벽이 더 높으면 위가 비고,
        // 더 낮으면 이미지 윗부분을 잘라낸다(cropV = 보이는 비율) — 늘이거나 줄이지 않는다.
        // 길이도 같다: 벽의 시작점(origin)에 맞춰 붙이고, 벽이 짧으면 끝 쪽을 잘라낸다(cropU).
        const imgL = (wall.imageLengthMM || wall.lengthMM) * MM2M, imgH = (wall.imageHeightMM || wall.heightMM) * MM2M;
        const Lm = Math.min(wall.lengthMM * MM2M, imgL), Hm = Math.min(wall.heightMM * MM2M, imgH);
        const faceMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, alphaTest: 0.5, visible: false });
        // flip 벽은 평면을 180도 돌려 붙이므로 이미지의 오른쪽 끝이 벽의 시작점이다.
        faceMat.userData.crop = { u: Lm / imgL, v: Hm / imgH, offsetU: wall.flip ? 1 - Lm / imgL : 0 };
        const face = new THREE.Mesh(new THREE.PlaneGeometry(Lm, Hm), faceMat);
        face.position.set(Lm / 2, Hm / 2, sign * 0.065);
        face.rotation.y = rotY;
        pg.add(face);
        if (wall.id === 'wall01') {
          // Wall01은 전시 버전에 따라 다른 시안 이미지를 쓴다(B = 모니터 3대가 들어간 월25).
          this._wall01Face = { faceMat, base: wall.image, src: null };
          this._applyWall01Image();
          return;
        }
        loadWallImage(wall.image).then((canvas) => {
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
          applyCrop(tex, faceMat);
          faceMat.map = tex;
          faceMat.visible = true;
          faceMat.needsUpdate = true;
        });
        return;
      }

      entry.items.forEach((it) => {
        const wM = it.w * MM2M, hM = it.h * MM2M;
        const vBottom = wall.heightMM - it.vTop - it.h; // 바닥 기준으로 변환
        const cx = it.u * MM2M + wM / 2;
        const cy = vBottom * MM2M + hM / 2;

        // 흰 배경 매트
        const mat0 = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
        const mat = new THREE.Mesh(new THREE.PlaneGeometry(wM + 0.02, hM + 0.02), mat0);
        mat.position.set(cx, cy, sign * 0.06);
        mat.rotation.y = rotY;
        pg.add(mat);

        const tex = loadTex(`posters/${it.poster.file}`);
        const posterMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), posterMat);
        plane.position.set(cx, cy, sign * 0.065);
        plane.rotation.y = rotY;
        pg.add(plane);
      });
    });
  }

  // 카메라 프리셋: full / front / left / right
  // ㄱ자 구조: Wall01(화이트월, z=2, x 10~25) + Wall02(x=10, z 2~9) + 통로(2m) + Wall03(x=10, z 11~19)
  // 안쪽(사람이 서는 곳)은 x>10, z>2 쪽(전면 창·하단 외벽 방향). "정면"=Wall01, "왼쪽"=Wall02, "오른쪽"=Wall03.
  goTo(preset) {
    const presets = {
      full:  { pos: [28.5, 12, 18], target: [18.5, 1.8, 9] },
      front: { pos: [20, 2.1, 8], target: [20, 1.25, 2] },
      left:  { pos: [21, 2.1, 5.5], target: [11.5, 1.25, 5.5] },
      right: { pos: [21, 2.1, 15], target: [11.5, 1.25, 15] },
      entrance: { pos: [26.3, 1.6, 19.6], target: [20, 1.3, 13.0] }, // 전시 입구에 서서 서문 벽과 전시장 안쪽을 바라본 시점
    };
    const p = presets[preset] || presets.full;
    this._tween = { from: this.camera.position.clone(), to: new THREE.Vector3(...p.pos), fromT: this.controls.target.clone(), toT: new THREE.Vector3(...p.target), t: 0 };
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (this._tween) {
      this._tween.t += 0.045;
      const t = Math.min(1, this._tween.t);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.position.lerpVectors(this._tween.from, this._tween.to, ease);
      this.controls.target.lerpVectors(this._tween.fromT, this._tween.toT, ease);
      if (t >= 1) this._tween = null;
    }
    this.controls.update();
    // 사람 billboard는 항상 카메라를 정면으로 바라보게(Y축 회전만 — 발이 뜨지 않도록 기울지는 않음)
    if (this._billboards) {
      for (const b of this._billboards) {
        const dx = this.camera.position.x - b.position.x;
        const dz = this.camera.position.z - b.position.z;
        b.rotation.y = Math.atan2(dx, dz);
      }
    }
    if (this.siteGroup) this.siteGroup.userData.ceiling.visible = this.camera.position.y < ROOM_H;
    this.renderer.render(this.scene, this.camera);
  }
}
