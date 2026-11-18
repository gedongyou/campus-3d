import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { CAMPUS } from './config.js';
import {
  SITE, TRACK, ROADS, GATES, COURTS, ISLAND, LAKE, BUILDINGS,
} from './plan.js';
import { LOTS, DRIVES, WALK, STOPS } from './route.js';

/* =========================================================
   0. 基础环境
   ========================================================= */
const canvas = document.getElementById('scene');
// logarithmicDepthBuffer：手机 GPU 多为 16 位深度，near=1/far=3000 时
// 在 400m 高度处的深度精度只有约 2.4m —— 路面只比草地高 20cm，会被草地吞掉。
// 对数深度把精度按对数分配，远近都够用，这是"草地盖住路"的根治办法。
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9dce8, 900, 2100);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 4, 3000);
// 竖屏用更高更远的机位，横屏用默认机位
const VIEWPORT_TALL = innerWidth / innerHeight < 0.9;
const ov = VIEWPORT_TALL
  ? (CAMPUS.viewpoints.find(v => v.id === 'overview-tall') || CAMPUS.viewpoints[0])
  : CAMPUS.viewpoints[0];
camera.position.set(...ov.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.set(...ov.target);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 40;
controls.maxDistance = 1100;
controls.maxPolarAngle = Math.PI * 0.492;
controls.screenSpacePanning = false;
controls.zoomSpeed = 0.85;
controls.panSpeed = 0.75;
controls.update();

/* ---------- 天空 ---------- */
const skyUniforms = {
  topColor: { value: new THREE.Color('#5f96c4') },
  botColor: { value: new THREE.Color('#e2edf3') },
  offset: { value: 180 },
  expo: { value: 0.6 },
};
let skyFollowsCamera = false;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1000, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vW=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 botColor; uniform float offset; uniform float expo;
      varying vec3 vW;
      void main(){
        float h = normalize(vW + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(botColor, topColor, max(pow(max(h,0.0), expo), 0.0)), 1.0);
      }`,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1000;      // 最先画
sky.material.depthTest = false;  // 永远当背景，不参与深度
sky.material.depthWrite = false;
scene.add(sky);
// 天空球会跟着相机走（见 animate），否则镜头拉远时球面超出 camera.far 被裁掉，
// 露出 renderer 的默认黑底，就是那个"黑色大圆顶"。
skyFollowsCamera = true;
renderer.setClearColor(0xcfe0ec, 1);

/* ---------- 灯光 ---------- */
const hemi = new THREE.HemisphereLight(0xdbe9f4, 0x8b9179, 1.02);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2de, 2.75);
sun.position.set(230, 330, 210);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -430;
sun.shadow.camera.right = 430;
sun.shadow.camera.top = 430;
sun.shadow.camera.bottom = -430;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 1200;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.35;
scene.add(sun);
scene.add(sun.target);

const fill = new THREE.DirectionalLight(0xc2d8ea, 0.5);
fill.position.set(-260, 170, -220);
scene.add(fill);

/* =========================================================
   1. 工具：纹理 / 几何
   ========================================================= */
const anisotropy = renderer.capabilities.getMaxAnisotropy();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function mergeGeoms(geos) {
  let vCount = 0, iCount = 0;
  geos.forEach(g => {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  });
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  geos.forEach(g => {
    const p = g.attributes.position, n = g.attributes.normal;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const centroid = (poly) => {
  let x = 0, z = 0;
  poly.forEach(p => { x += p[0]; z += p[1]; });
  return [x / poly.length, z / poly.length];
};

/* 沿多边形边界拉出一圈"墙"，UV 以"窗格"为单位平铺 —— 窗洞自动按开间对齐 */
function wallBand(poly, y0, y1, tileW, tileH) {
  const pos = [], nor = [], uv = [], idx = [];
  const c = centroid(poly);
  let vi = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    let nx = dz / len, nz = -dx / len;
    const mx = (a[0] + b[0]) / 2 - c[0], mz = (a[1] + b[1]) / 2 - c[1];
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }

    const u1 = len / tileW;
    const va = y0 / tileH, vb = y1 / tileH;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uv.push(0, va, u1, va, u1, vb, 0, vb);
    idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
    vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* 多边形填充（XZ 平面，向上） */
function fillPoly(poly, y) {
  const pts = poly.map(p => new THREE.Vector2(p[0], p[1]));
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], nor = [], idx = [];
  pts.forEach(p => { pos.push(p.x, y, p.y); nor.push(0, 1, 0); });
  faces.forEach(f => idx.push(f[0], f[2], f[1]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* 闭合折线平滑：Catmull-Rom 加密 —— 描图得到的湖岸是折线，
   放大看是一段段直边；加密后才是自然岸线 */
function smoothClosed(poly, sub = 6) {
  const n = poly.length, out = [];
  const P = (i) => poly[((i % n) + n) % n];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/* 开放折线 → 竖直墙带（不闭合；弧形景墙、栏板用） */
function ribbonV(pts, y0, y1) {
  const pos = [], nor = [], idx = [];
  let vi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = dz / len, nz = -dx / len;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
    vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* 开放折线 → 水平带（不闭合；弧形观景台、栈道面用） */
function ribbonH(outer, inner, y) {
  const n = Math.min(outer.length, inner.length);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < n; i++) {
    pos.push(outer[i][0], y, outer[i][1], inner[i][0], y, inner[i][1]);
    nor.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = (i + 1) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* 环形条带（跑道分道、湖岸线） */
function ringBand(outer, inner, y) {
  const n = Math.min(outer.length, inner.length);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < n; i++) {
    const o = outer[i], q = inner[i];
    pos.push(o[0], y, o[1], q[0], y, q[1]);
    nor.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    // 逆时针（从 +Y 俯视）——否则法线朝下，正反面光照都会变暗
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* 点是否在多边形内 */
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* =========================================================
   2. 立面贴图（一个窗格 = 3.4m × 3.6m）
   ========================================================= */
const TILE_W = 3.4, TILE_H = 3.6;

function facadeTile(kind, tint) {
  const S = kind === 'teach' ? 320 : 160;
  const map = canvasTex(S, kind === 'teach' ? Math.round(S * 0.52) : S, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, tint);
    g.addColorStop(1, shade(tint, 0.94));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 楼板线
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,.06)';
    ctx.fillRect(0, 3, w, 2);

    if (kind === 'workshop') {
      // 厂房：下部压型钢板 + 上部高侧窗
      ctx.fillStyle = 'rgba(0,0,0,.05)';
      for (let x = 0; x < w; x += 10) ctx.fillRect(x, 0, 4, h);
      ctx.fillStyle = 'rgba(58,84,102,.9)';
      ctx.fillRect(w * 0.10, h * 0.16, w * 0.80, h * 0.30);
      ctx.strokeStyle = 'rgba(230,240,246,.55)';
      ctx.lineWidth = 2;
      for (let x = w * 0.10; x < w * 0.90; x += w * 0.10) {
        ctx.beginPath(); ctx.moveTo(x, h * 0.16); ctx.lineTo(x, h * 0.46); ctx.stroke();
      }
    } else if (kind === 'dorm') {
      // 宿舍：窗 + 阳台板
      ctx.fillStyle = 'rgba(44,64,80,.92)';
      ctx.fillRect(w * 0.22, h * 0.26, w * 0.56, h * 0.44);
      ctx.strokeStyle = 'rgba(255,255,255,.34)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.26); ctx.lineTo(w * 0.5, h * 0.70); ctx.stroke();
      ctx.fillStyle = 'rgba(240,238,230,.95)';
      ctx.fillRect(0, h * 0.80, w, h * 0.09);
      ctx.fillStyle = 'rgba(0,0,0,.10)';
      ctx.fillRect(0, h * 0.89, w, 3);
    } else if (kind === 'teach') {
      // 教学楼长立面（对照航拍照片）：
      //   米白墙 + 每开间 4 樘方窗的规则网格 + 白色层间腰线
      //   + 每 11.2m 一道窄的陶土红色壁柱
      // 一个 tile = 11.2m 宽 × 一层层高，所以壁柱间距正好 11.2m。
      const pierW = w * 0.070;
      ctx.fillStyle = '#9a4f36';
      ctx.fillRect(0, 0, pierW, h);
      ctx.fillStyle = 'rgba(255,255,255,.13)';
      ctx.fillRect(w * 0.008, 0, w * 0.012, h);

      const bx0 = pierW, bw = w - pierW;
      // 层间白腰线 + 腰线下的浅阴影（照片里每层都有一条明显的白带）
      ctx.fillStyle = 'rgba(252,250,244,.96)';
      ctx.fillRect(bx0, h * 0.028, bw, h * 0.030);
      ctx.fillStyle = 'rgba(128,104,84,.18)';
      ctx.fillRect(bx0, h * 0.058, bw, h * 0.011);

      const N = 4, slot = bw / N;
      const ww = slot * 0.56, wh = h * 0.44, wy = h * 0.185;
      for (let i = 0; i < N; i++) {
        const wx = bx0 + slot * (i + 0.5) - ww / 2;
        ctx.fillStyle = 'rgba(58,70,82,.95)';
        ctx.fillRect(wx, wy, ww, wh);
        const gg = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
        gg.addColorStop(0, 'rgba(190,212,228,.55)');
        gg.addColorStop(0.45, 'rgba(112,142,166,.28)');
        gg.addColorStop(1, 'rgba(216,232,242,.46)');
        ctx.fillStyle = gg;
        ctx.fillRect(wx, wy, ww, wh);
        // 白窗框
        ctx.strokeStyle = 'rgba(250,248,242,.96)';
        ctx.lineWidth = Math.max(2, w * 0.0042);
        ctx.strokeRect(wx, wy, ww, wh);
        // 一樘两扇
        ctx.lineWidth = Math.max(1.5, w * 0.0026);
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy);
        ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.stroke();
        // 窗台
        ctx.fillStyle = 'rgba(240,236,226,.94)';
        ctx.fillRect(wx - w * 0.006, wy + wh, ww + w * 0.012, h * 0.022);
      }
      ctx.fillStyle = 'rgba(150,138,120,.20)';
      ctx.fillRect(0, h * 0.945, w, h * 0.055);
    } else {
      // 教学 / 办公：一开间一窗
      ctx.fillStyle = 'rgba(46,68,86,.93)';
      ctx.fillRect(w * 0.20, h * 0.24, w * 0.60, h * 0.46);
      const gg = ctx.createLinearGradient(w * 0.20, h * 0.24, w * 0.80, h * 0.70);
      gg.addColorStop(0, 'rgba(255,255,255,.30)');
      gg.addColorStop(0.45, 'rgba(255,255,255,.05)');
      gg.addColorStop(1, 'rgba(255,255,255,.20)');
      ctx.fillStyle = gg;
      ctx.fillRect(w * 0.20, h * 0.24, w * 0.60, h * 0.46);
      ctx.strokeStyle = 'rgba(28,40,50,.65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.20, h * 0.24, w * 0.60, h * 0.46);
      ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.24); ctx.lineTo(w * 0.5, h * 0.70); ctx.stroke();
    }
  });

  const glow = canvasTex(S, S, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,214,152,.95)';
    if (kind === 'workshop') ctx.fillRect(w * 0.10, h * 0.16, w * 0.80, h * 0.30);
    else if (kind === 'dorm') ctx.fillRect(w * 0.22, h * 0.26, w * 0.56, h * 0.44);
    else if (kind === 'teach') {
      const bx0 = w * 0.070, bw = w - bx0, slot = bw / 4;
      const ww = slot * 0.56;
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(bx0 + slot * (i + 0.5) - ww / 2, h * 0.185, ww, h * 0.44);
      }
    } else ctx.fillRect(w * 0.20, h * 0.24, w * 0.60, h * 0.46);
  });

  return { map, glow };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

const TILE_CACHE = new Map();
function tilesFor(kind, tint) {
  const key = kind + tint;
  if (!TILE_CACHE.has(key)) TILE_CACHE.set(key, facadeTile(kind, tint));
  return TILE_CACHE.get(key);
}

const MAT = {
  roof: new THREE.MeshStandardMaterial({ color: 0xb3aea3, roughness: 0.95 }),
  parapet: new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.9 }),
  plinth: new THREE.MeshStandardMaterial({ color: 0xa5a196, roughness: 0.95 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xf4f1e9, roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x76838d, roughness: 0.5, metalness: 0.55 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x7fa3b8, roughness: 0.14, metalness: 0.4, transparent: true, opacity: 0.88 }),
  road: null,
  // 航拍里湖水是偏暗的青灰绿，不是亮蓝；粗糙度略高一点才不像塑料
  water: new THREE.MeshStandardMaterial({ color: 0x3f6e78, roughness: 0.22, metalness: 0.28 }),
};

const windowMats = [];   // 黄昏时点亮

/* =========================================================
   3. 场地：草地 / 道路 / 湖 / 跑道 / 球场
   ========================================================= */
const groundGroup = new THREE.Group();
scene.add(groundGroup);

const grassTex = canvasTex(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#8ba173';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4200; i++) {
    const g = 92 + Math.random() * 58;
    ctx.fillStyle = `rgba(${g * 0.72},${g},${g * 0.58},${Math.random() * 0.42})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 9 + 2, Math.random() * 6 + 2);
  }
});
grassTex.repeat.set(400, 400);
// 地面要远大于校区：镜头拉到最远（z≈1150）时 2600 见方的草地已经露出边，
// 地平线断在校区背后。放大到 9000 并靠雾把远处收敛掉。
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(24000, 24000),   // 远大于雾的 far，边缘永远被雾吃掉
  new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })
);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.35;   // 外围草地比校区地坪低一档，避免与路面共面
grass.receiveShadow = true;
groundGroup.add(grass);

/* 原来这里还有一张 760×320 的"校内草坪"覆在草地上（颜色更亮），
   两张草地叠在一起、贴图密度也不同，俯视就是两种绿色互相压着，能看出矩形接缝。
   现在只保留一张草地：用同一张贴图，靠树、道路、铺装来区分校内外。 */

/* ---------- 铺装 ---------- */
const paveTex = canvasTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#cdc7b6';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${172 + Math.random() * 50},${166 + Math.random() * 50},${150 + Math.random() * 52},${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  }
  ctx.strokeStyle = 'rgba(142,136,120,.30)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i <= w; i += 40) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
  }
});

const paveMats = new Map();
function paveArea(x, z, w, d, y = 0.08, tint = 0xe0dbcb) {
  const key = Math.round(w / 10) + '_' + Math.round(d / 10) + '_' + tint;
  let m = paveMats.get(key);
  if (!m) {
    const t = paveTex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, w / 22), Math.max(1, d / 22));
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.98, color: tint });
    paveMats.set(key, m);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  groundGroup.add(mesh);
  return mesh;
}

/* ---------- 道路 ----------
   之前用一张带虚线的贴图平铺：竖直道路的 UV 是横着的，虚线变成横杠；
   而且沥青偏浅，拉远后和铺装糊成一片（就是"马路没出来"）。
   现在沥青用纯色 + 噪点，标线全部用真实网格画：两侧实线 + 中线虚线。
*/
const asphaltTex = canvasTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#4a4e52';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const a = 0.05 + Math.random() * 0.16;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
});
asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;

const MAT_ROAD = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.97, metalness: 0.0 });
MAT_ROAD.map = asphaltTex.clone();
MAT_ROAD.map.wrapS = MAT_ROAD.map.wrapT = THREE.RepeatWrapping;
MAT_ROAD.map.repeat.set(1, 1);
const MAT_CURB = new THREE.MeshStandardMaterial({ color: 0xc9c4b6, roughness: 1 });
const MAT_LINE = new THREE.MeshBasicMaterial({ color: 0xf2eee2 });
const MAT_SIDEWALK = new THREE.MeshStandardMaterial({ color: 0xc9c3b2, roughness: 1 });

/* 路口处理：
   原来每条路各铺一张沥青面片，十字路口处两张面片重叠。即使错开 2mm，远距离俯视时
   深度缓冲精度不够，重叠区仍会闪出深色条带；白色边线又直穿路口。
   现在先把所有路口算成方块，路身只铺"路口之间"的段落，路口单独铺一次，边线/虚线/路缘石
   也都按段落切，路口内一律不画。这样任何两处路面都不再有共面重叠。 */
const ROAD_Y = 0.20, LINE_Y = 0.212, WALK_Y = 0.12, CURB_Y = 0.10;
const _isH = (r) => Math.abs(r.z2 - r.z1) < 0.01;

const _spans = new Map();     // 路序号 -> [[a,b],...] 标线/路缘石要画的段落
const _junctions = [];        // 路口方块（只用于统计）

const _rect = (r, grow = 0) => {
  const g = grow;
  return _isH(r)
    ? { x1: Math.min(r.x1, r.x2), x2: Math.max(r.x1, r.x2),
        z1: r.z1 - r.w / 2 - g, z2: r.z1 + r.w / 2 + g }
    : { x1: r.x1 - r.w / 2 - g, x2: r.x1 + r.w / 2 + g,
        z1: Math.min(r.z1, r.z2), z2: Math.max(r.z1, r.z2) };
};

/* 路口：把每条路被"另一条垂直路"占掉的那一段挖掉，只用来画标线和路缘石
   （路面本身不再分段，见下面的并集绘制）。 */
ROADS.forEach((r, i) => {
  const h = _isH(r);
  const lo = h ? Math.min(r.x1, r.x2) : Math.min(r.z1, r.z2);
  const hi = h ? Math.max(r.x1, r.x2) : Math.max(r.z1, r.z2);
  const cuts = [];
  ROADS.forEach((q, j) => {
    if (i === j || _isH(q) === h) return;
    const a = _rect(r), b = _rect(q);
    const ox1 = Math.max(a.x1, b.x1), ox2 = Math.min(a.x2, b.x2);
    const oz1 = Math.max(a.z1, b.z1), oz2 = Math.min(a.z2, b.z2);
    if (ox2 - ox1 < 0.6 || oz2 - oz1 < 0.6) return;
    cuts.push(h ? [ox1, ox2] : [oz1, oz2]);
    if (i < j) _junctions.push({ x1: ox1, x2: ox2, z1: oz1, z2: oz2 });
  });
  cuts.sort((p, q) => p[0] - q[0]);
  const out = [];
  let cur = lo;
  for (const [a, b] of cuts) {
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
  }
  if (cur < hi) out.push([cur, hi]);
  _spans.set(i, out.filter(([a, b]) => b - a > 0.4));
});

/* ---------- 路面的"并集"绘制 ----------
   原来每条路各铺一张沥青面片，十字路口处两张面片共面叠在一起：
   深度缓冲分不清前后，就会闪出一条深色/浅色带，边线也直穿路口。
   这里先把所有路按坐标压缩成一张网格，求出并集，再贪心合并成矩形，
   一次性写成一张几何 —— 任何两处路面都不可能重叠。 */
function buildUnionMesh(rects, y, material, uvScale) {
  const xs = [...new Set(rects.flatMap(r => [r.x1, r.x2]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap(r => [r.z1, r.z2]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1;
  if (nx < 1 || nz < 1) return null;

  const grid = new Uint8Array(nx * nz);
  for (const r of rects) {
    for (let ix = 0; ix < nx; ix++) {
      if (xs[ix] < r.x1 - 1e-6 || xs[ix + 1] > r.x2 + 1e-6) continue;
      for (let iz = 0; iz < nz; iz++) {
        if (zs[iz] < r.z1 - 1e-6 || zs[iz + 1] > r.z2 + 1e-6) continue;
        grid[iz * nx + ix] = 1;
      }
    }
  }

  const used = new Uint8Array(nx * nz);
  const pos = [], uv = [], idx = [];
  let vi = 0;
  const pushQuad = (x1, z1, x2, z2) => {
    // v0(x1,z1) v1(x1,z2) v2(x2,z2) v3(x2,z1)：从 +Y 俯视逆时针，法线朝上
    pos.push(x1, y, z1, x1, y, z2, x2, y, z2, x2, y, z1);
    uv.push(x1 / uvScale, z1 / uvScale, x1 / uvScale, z2 / uvScale,
            x2 / uvScale, z2 / uvScale, x2 / uvScale, z1 / uvScale);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    vi += 4;
  };

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const k = iz * nx + ix;
      if (!grid[k] || used[k]) continue;
      // 先沿 X 拉长
      let w = 1;
      while (ix + w < nx && grid[k + w] && !used[k + w]) w++;
      // 再沿 Z 拉长（整行都空着才拉）
      let h = 1;
      outer: while (iz + h < nz) {
        for (let c = 0; c < w; c++) {
          const kk = (iz + h) * nx + ix + c;
          if (!grid[kk] || used[kk]) break outer;
        }
        h++;
      }
      for (let dz = 0; dz < h; dz++)
        for (let dx = 0; dx < w; dx++) used[(iz + dz) * nx + ix + dx] = 1;
      pushQuad(xs[ix], zs[iz], xs[ix + w], zs[iz + h]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  groundGroup.add(m);
  return m;
}

const _asphaltMat = new THREE.MeshStandardMaterial({
  map: (() => {
    const t = asphaltTex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  })(),
  roughness: 0.97,
});
buildUnionMesh(ROADS.map(r => _rect(r)), 0.20, _asphaltMat, 14);
buildUnionMesh(ROADS.map(r => _rect(r, 2.2)), 0.12, MAT_SIDEWALK, 14);

/* 标线 + 路缘石：只在路口之间的段落上画 */
function addRoad(r, idx) {
  const h = _isH(r);
  const W = r.w;
  const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;

  for (const [a, b] of _spans.get(idx)) {
    const segLen = b - a;
    if (segLen < 0.5) continue;
    const mid = (a + b) / 2;
    const scx = h ? mid : cx;
    const scz = h ? cz : mid;

    // 路缘石
    for (const sgn of [-1, 1]) {
      const cw = 0.55;
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(h ? segLen : cw, 0.30, h ? cw : segLen),
        MAT_CURB
      );
      curb.position.set(
        h ? scx : scx + sgn * (W / 2 + cw / 2),
        0.11,
        h ? scz + sgn * (W / 2 + cw / 2) : scz
      );
      curb.receiveShadow = true;
      groundGroup.add(curb);
    }

    // 两侧实线
    const half = W / 2 - 0.75;
    for (const off of [-half, half]) {
      _quad(h ? scx : scx + off, h ? scz + off : scz,
        h ? segLen : 0.28, h ? 0.28 : segLen, LINE_Y, MAT_LINE);
    }

    // 中线虚线
    const dashLen = 4, gapLen = 5;
    for (let d = -segLen / 2 + 2; d < segLen / 2 - 2; d += dashLen + gapLen) {
      _quad(h ? scx + d : scx, h ? scz : scz + d,
        h ? dashLen : 0.22, h ? 0.22 : dashLen, LINE_Y + 0.001, MAT_LINE);
    }
  }
}

function _quad(cx, cz, w, d, y, mat) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(cx, y, cz);
  m.receiveShadow = true;
  groundGroup.add(m);
  return m;
}

ROADS.forEach((r, i) => addRoad(r, i));

/* ---------- 匠心湖 ---------- */
const LAKE_C = centroid(LAKE);
(function lake() {
  const LAKE_S = smoothClosed(LAKE, 7);
  const LAKE_C2 = centroid(LAKE_S);

  // 岸线：外扩 2.4m 的卵石/汀步带（环形条带，不做法向偏移填充，避免凹多边形自交）
  const outer = LAKE_S.map(([x, z]) => {
    const dx = x - LAKE_C2[0], dz = z - LAKE_C2[1];
    const L = Math.hypot(dx, dz) || 1;
    return [x + (dx / L) * 2.4, z + (dz / L) * 2.4];
  });
  const bank = new THREE.Mesh(
    ringBand(outer, LAKE_S, 0.095),
    new THREE.MeshStandardMaterial({ color: 0xcac3ad, roughness: 1, side: THREE.DoubleSide })
  );
  bank.receiveShadow = true;
  groundGroup.add(bank);

  // 水面
  const water = new THREE.Mesh(fillPoly(LAKE_S, 0.2), MAT.water);
  water.receiveShadow = false;
  groundGroup.add(water);

  // 浅水过渡：紧贴岸线的一圈更浅的颜色，制造"近岸浅、中央深"的层次
  const inner = LAKE_S.map(([x, z]) => {
    const dx = x - LAKE_C2[0], dz = z - LAKE_C2[1];
    const L = Math.hypot(dx, dz) || 1;
    return [x - (dx / L) * 3.4, z - (dz / L) * 3.4];
  });
  const shallow = new THREE.Mesh(
    ringBand(LAKE_S, inner, 0.205),
    new THREE.MeshStandardMaterial({ color: 0x6f9f9e, roughness: 0.2, metalness: 0.28, transparent: true, opacity: 0.55 })
  );
  shallow.receiveShadow = false;
  groundGroup.add(shallow);

  // 湖心岛
  const ISLE_S = smoothClosed(ISLAND, 8);
  const isle = new THREE.Mesh(fillPoly(ISLE_S, 0.26), new THREE.MeshStandardMaterial({ color: 0x7f9c60, roughness: 1 }));
  groundGroup.add(isle);

  // ---- 折线栈桥（航拍照片里湖南北向的之字形木栈道）----
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xb08a5e, roughness: 0.88 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 0.7, metalness: 0.25 });
  const DECK_Y = 0.72, DECK_W = 3.0;

  const way = [
    [26, -2], [26, 8], [15, 12], [15, 22], [27, 26],
    [27, 34], [33, 38], [39, 40],
  ];
  // 立柱/桥墩数量多，收集后统一实例化（逐个 Mesh 会平白多出上百个 draw call）
  const posts = [];   // 栏杆立柱 [x,y,z]
  const piles = [];   // 桥墩 [x,y,z]
  const dummyBW = new THREE.Object3D();

  for (let i = 0; i < way.length - 1; i++) {
    const [ax, az] = way[i], [bx, bz] = way[i + 1];
    const len = Math.hypot(bx - ax, bz - az) + DECK_W * 0.6;
    const ang = Math.atan2(bz - az, bx - ax);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.28, DECK_W), deckMat);
    seg.position.set((ax + bx) / 2, DECK_Y, (az + bz) / 2);
    seg.rotation.y = -ang;
    seg.castShadow = true; seg.receiveShadow = true;
    groundGroup.add(seg);

    // 桥墩：每 4m 一根，插入水面（否则木栈道看起来是浮在空中的）
    const nPile = Math.max(2, Math.round(len / 4.0));
    for (let k = 0; k <= nPile; k++) {
      const t = k / nPile;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      if (!inPoly(px, pz, LAKE_S)) continue;
      for (const off of [-DECK_W * 0.32, DECK_W * 0.32]) {
        piles.push([px + Math.sin(ang) * off, DECK_Y - 1.1, pz - Math.cos(ang) * off]);
      }
    }

    // 栏杆（两侧，每 2.2m 一根立柱 + 上下横杆）
    const nPost = Math.max(2, Math.round(len / 2.2));
    for (const side of [-1, 1]) {
      const ox = Math.sin(ang) * side * (DECK_W / 2 - 0.12);
      const oz = -Math.cos(ang) * side * (DECK_W / 2 - 0.12);
      for (let k = 0; k <= nPost; k++) {
        const t = k / nPost;
        posts.push([ax + (bx - ax) * t + ox, DECK_Y + 0.66, az + (bz - az) * t + oz]);
      }
      const railSeg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), railMat);
      railSeg.position.set((ax + bx) / 2 + ox, DECK_Y + 1.16, (az + bz) / 2 + oz);
      railSeg.rotation.y = -ang;
      groundGroup.add(railSeg);
    }
  }

  // 栈桥中段观景平台（圆形）
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.3, 28), deckMat);
  plat.position.set(15, DECK_Y, 22);
  plat.castShadow = true; plat.receiveShadow = true;
  groundGroup.add(plat);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    posts.push([15 + Math.cos(a) * 4.1, DECK_Y + 0.66, 22 + Math.sin(a) * 4.1]);
  }
  for (const [ox, oz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6], [0, 0]]) {
    const px = 15 + ox, pz = 22 + oz;
    if (!inPoly(px, pz, LAKE_S)) continue;
    piles.push([px, DECK_Y - 1.1, pz]);
  }

  // 实例化栏杆立柱
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.05, 0.09), railMat, posts.length);
  posts.forEach((p, i) => {
    dummyBW.position.set(p[0], p[1], p[2]);
    dummyBW.rotation.set(0, 0, 0);
    dummyBW.scale.set(1, 1, 1);
    dummyBW.updateMatrix();
    postMesh.setMatrixAt(i, dummyBW.matrix);
  });
  postMesh.castShadow = true;
  groundGroup.add(postMesh);

  // 实例化桥墩
  if (piles.length) {
    const pileMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.26, 2.2, 8), deckMat, piles.length);
    piles.forEach((p, i) => {
      dummyBW.position.set(p[0], p[1], p[2]);
      dummyBW.updateMatrix();
      pileMesh.setMatrixAt(i, dummyBW.matrix);
    });
    groundGroup.add(pileMesh);
  }

  // ---- 湖东岸月牙形观景平台（照片里从东岸挑出水面的一弯白色平台）----
  // 圆心放在岸上（x=101），弧口朝西伸向水面；两端落在岸线内侧，
  // 这样它"长"在岸上而不是浮在水里。
  const moonMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
  const mcx = 101, mcz = 55;
  const A0 = Math.PI - 0.94, A1 = Math.PI + 0.94;
  const R_OUT = 15.6, R_IN = 10.4;
  const outerP = arcPts(mcx, mcz, R_OUT, A0, A1, 40);
  const innerP = arcPts(mcx, mcz, R_IN, A0, A1, 40);

  const deck2 = new THREE.Mesh(ribbonH(outerP, innerP, 0.66), moonMat);
  deck2.receiveShadow = true;
  groundGroup.add(deck2);

  // 外沿矮栏板
  const rimWall = new THREE.Mesh(ribbonV(outerP, 0.66, 1.62), moonMat);
  rimWall.castShadow = true;
  groundGroup.add(rimWall);
  const rimCap = new THREE.Mesh(ribbonH(outerP, arcPts(mcx, mcz, R_OUT - 0.5, A0, A1, 40), 1.64), moonMat);
  groundGroup.add(rimCap);

  // 两端封口
  for (const a of [A0, A1]) {
    const p1 = [mcx + Math.cos(a) * R_IN, mcz + Math.sin(a) * R_IN];
    const p2 = [mcx + Math.cos(a) * R_OUT, mcz + Math.sin(a) * R_OUT];
    const capW = new THREE.Mesh(ribbonV([p1, p2], 0.1, 0.66), moonMat);
    capW.castShadow = true;
    groundGroup.add(capW);
  }

  // 挑入水面的支撑柱
  for (let i = 0; i <= 10; i++) {
    const a = A0 + (A1 - A0) * (i / 10);
    const px = mcx + Math.cos(a) * (R_OUT - 2.4), pz = mcz + Math.sin(a) * (R_OUT - 2.4);
    if (!inPoly(px, pz, LAKE_S)) continue;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.0, 10), moonMat);
    col.position.set(px, -0.8, pz);
    groundGroup.add(col);
  }

  // ---- 岸边卵石与芦苇 ----
  const rockGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xa9a294, roughness: 0.96, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 120);
  const dummy = new THREE.Object3D();
  let ri = 0;
  for (let i = 0; i < LAKE.length && ri < 110; i++) {
    const a = LAKE[i], b = LAKE[(i + 1) % LAKE.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cnt = Math.max(1, Math.round(segLen / 6));
    for (let k = 0; k < cnt && ri < 110; k++) {
      const t = (k + 0.5) / cnt;
      const x = a[0] + (b[0] - a[0]) * t + (Math.random() - 0.5) * 1.4;
      const z = a[1] + (b[1] - a[1]) * t + (Math.random() - 0.5) * 1.4;
      const sc = 0.5 + Math.random() * 0.85;
      dummy.position.set(x, 0.12 + sc * 0.3, z);
      dummy.scale.set(sc, sc * 0.6, sc);
      dummy.rotation.set(Math.random(), Math.random() * 3, Math.random());
      dummy.updateMatrix();
      rocks.setMatrixAt(ri++, dummy.matrix);
    }
  }
  rocks.count = ri;
  rocks.castShadow = true;
  groundGroup.add(rocks);
})();

/* ---------- 圆弧采样 ---------- */
function arcPts(cx, cz, r, a0, a1, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

/* ---------- 400m 跑道 ---------- */
function stadiumPts(R, halfL, cx, cz, n = 40) {
  const pts = [];
  pts.push([cx + R, cz - halfL]);
  pts.push([cx + R, cz + halfL]);
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([cx + R * Math.cos(a), cz + halfL + R * Math.sin(a)]);
  }
  pts.push([cx - R, cz + halfL]);
  pts.push([cx - R, cz - halfL]);
  for (let i = 1; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push([cx + R * Math.cos(a), cz - halfL + R * Math.sin(a)]);
  }
  return pts;
}

(function track() {
  const { x, z, R, halfL, lanes, laneW } = TRACK;
  const R_OUT = R + lanes * laneW;

  // 红色塑胶面
  const surf = new THREE.Mesh(
    ringBand(stadiumPts(R_OUT, halfL, x, z), stadiumPts(R, halfL, x, z), 0.26),
    new THREE.MeshStandardMaterial({
      color: 0xc4402f, roughness: 0.88, metalness: 0.0,
      emissive: 0x3a0d08, emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    })
  );
  surf.receiveShadow = true;
  groundGroup.add(surf);

  // 分道线
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf1eade, transparent: true, opacity: 0.55 });
  for (let i = 1; i <= lanes; i++) {
    const r = R + i * laneW;
    const ln = new THREE.Mesh(
      ringBand(stadiumPts(r + 0.07, halfL, x, z), stadiumPts(r - 0.07, halfL, x, z), 0.268),
      lineMat
    );
    groundGroup.add(ln);
  }

  // 内场草皮（足球场）
  const infield = new THREE.Mesh(
    fillPoly(stadiumPts(R, halfL, x, z), 0.17),
    new THREE.MeshStandardMaterial({ color: 0x76965a, roughness: 1 })
  );
  infield.receiveShadow = true;
  groundGroup.add(infield);

  // 足球场白线
  const pitchLine = new THREE.MeshBasicMaterial({ color: 0xf2efe6, transparent: true, opacity: 0.7 });
  const pw = 50, pl = 76;
  const mkLine = (w, l, px, pz) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), pitchLine);
    m.rotation.x = -Math.PI / 2;
    m.position.set(px, 0.205, pz);
    groundGroup.add(m);
  };
  mkLine(pw, 0.22, x, z - pl / 2); mkLine(pw, 0.22, x, z + pl / 2);
  mkLine(0.22, pl, x - pw / 2, z); mkLine(0.22, pl, x + pw / 2, z);
  const circle = new THREE.Mesh(new THREE.RingGeometry(8.9, 9.1, 48), pitchLine);
  circle.rotation.x = -Math.PI / 2;
  circle.position.set(x, 0.205, z);
  groundGroup.add(circle);

  // 球门
  for (const sz of [-1, 1]) {
    const goal = new THREE.Group();
    const barMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.7 });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 7.3, 8), barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 2.44;
    goal.add(bar);
    for (const bx of [-3.65, 3.65]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.44, 8), barMat);
      post.position.set(bx, 1.22, 0);
      goal.add(post);
    }
    goal.position.set(x, 0.2, z + sz * (pl / 2));
    groundGroup.add(goal);
  }

  // 看台（跑道西侧）
  const standMat = new THREE.MeshStandardMaterial({ color: 0xc8c3b4, roughness: 0.95 });
  for (let i = 0; i < 4; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(13, 1.5 + i * 1.5, 58), standMat);
    st.position.set(x - R_OUT - 10 - i * 7.6, (1.5 + i * 1.5) / 2, z);
    st.castShadow = true;
    st.receiveShadow = true;
    groundGroup.add(st);
  }
})();

/* ---------- 篮球 / 排球场地 ---------- */
(function courts() {
  const { x, z, w, d, cols, rows, gap = 4 } = COURTS;
  const base = new THREE.MeshStandardMaterial({ color: 0x467a92, roughness: 0.92 });
  const line = new THREE.MeshBasicMaterial({ color: 0xf2efe6, transparent: true, opacity: 0.72 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a646b, roughness: 0.6, metalness: 0.4 });
  const nx = cols || 1, nz = rows || 1;
  const stepX = w + gap, stepZ = d + gap;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const cx = x + (i - (nx - 1) / 2) * stepX;
      const cz = z + (j - (nz - 1) / 2) * stepZ;
      const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), base);
      c.rotation.x = -Math.PI / 2;
      c.position.set(cx, 0.19, cz);
      c.receiveShadow = true;
      groundGroup.add(c);

      // 边界线
      const mkW = (lw, ll, px, pz) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, ll), line);
        m.rotation.x = -Math.PI / 2;
        m.position.set(px, 0.2, pz);
        groundGroup.add(m);
      };
      mkW(w - 0.8, 0.14, cx, cz - d / 2 + 0.4);
      mkW(w - 0.8, 0.14, cx, cz + d / 2 - 0.4);
      mkW(0.14, d - 0.8, cx - w / 2 + 0.4, cz);
      mkW(0.14, d - 0.8, cx + w / 2 - 0.4, cz);
      // 中圈 + 中线
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.7, 32), line);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cx, 0.2, cz);
      groundGroup.add(ring);
      mkW(w - 0.8, 0.13, cx, cz);
      // 篮架（短边两侧）
      for (const s2 of [-1, 1]) {
        const hoop = new THREE.Mesh(new THREE.BoxGeometry(1.7, 3.05, 0.32), postMat);
        hoop.position.set(cx + s2 * (w / 2 + 0.9), 1.52, cz);
        hoop.castShadow = true;
        groundGroup.add(hoop);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.05), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 }));
        board.position.set(cx + s2 * (w / 2 + 0.72), 3.05, cz);
        board.rotation.y = -s2 * Math.PI / 2;
        groundGroup.add(board);
      }
    }
  }
})();

/* ---------- 西区下沉广场：已按用户要求删除 ----------
   原来这里是三角形水面 + 三级弧形看台，就在电子信息实训楼（b7e）北侧。
   现在整段移除，那块地直接还给草地/道路。 */

/* ---------- 门前广场 / 步道 ---------- */
paveArea(-96, 108, 46, 62, 0.09);         // 学校主入口内侧广场（原行政入口已取消）
paveArea(-233, 134, 70, 42, 0.09);        // 实训区入口广场
paveArea(-96, 92, 24, 68, 0.09);          // 学生主入口通道
paveArea(-40, 40, 70, 26, 0.085);
paveArea(150, 20, 120, 26, 0.085);
paveArea(60, -60, 210, 22, 0.085);
paveArea(280, 120, 150, 26, 0.085);
paveArea(-250, -90, 120, 24, 0.085);
paveArea(-300, 40, 90, 22, 0.085);

/* ---------- 围墙与出入口 ---------- */
(function boundary() {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd0cabb, roughness: 0.95 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a1, roughness: 0.95 });
  const { x1, x2, z1, z2 } = SITE;
  const H = 2.6;

  const gates = GATES.map(g => g.x);
  const segX = (a, b, z) => {
    if (b - a < 2) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, H, 1.8), wallMat);
    m.position.set((a + b) / 2, H / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    groundGroup.add(m);
  };

  // 南侧围墙：只有一个门洞（市实训中心主入口）。
  // 门洞要按大门的实际宽度留（门廊 40m + 两侧各 4m），否则围墙会挡在景墙前面。
  const southGaps = [[-233, 48]];
  let cur = x1;
  southGaps.forEach(([gx, gw]) => {
    segX(cur, gx - gw / 2, z2);
    cur = gx + gw / 2;
  });
  segX(cur, x2, z2);

  // 北侧（沿晨丰公路，实墙 + 绿带）
  const north = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 3.4, 2.2), wallMat);
  north.position.set((x1 + x2) / 2, 1.7, z1);
  north.castShadow = true;
  groundGroup.add(north);

  // 东西两侧
  for (const [wx, wz, len, horiz] of [[x1, (z1 + z2) / 2, z2 - z1, false], [x2, (z1 + z2) / 2, z2 - z1, false]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, len), wallMat);
    m.position.set(wx, 1.4, wz);
    m.castShadow = true;
    groundGroup.add(m);
  }

  // 立柱（门洞范围内跳过）
  for (let x = x1; x <= x2; x += 24) {
    for (const z of [z1, z2]) {
      if (z === z2 && southGaps.some(([gx, gw]) => Math.abs(x - gx) < gw / 2 + 2)) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.6, 2.6), postMat);
      p.position.set(x, 1.8, z);
      p.castShadow = true;
      groundGroup.add(p);
    }
  }
})();

/* ---------- 校门（按照片重建） ----------
   照片依据：
   · 学校主入口（平安路边）＝ 一溜陶土红方柱 + 米白色横梁，横梁正面是金色校名，
     柱间装着推拉铁门，门前有草坪和一块刻字的景石 —— 照片里那道很长的"柱廊"。
   · 实训区主入口（福新路边）＝ 矮石墙 + 金色校名墙 + 推拉铁门；墙后立着那座
     巨大的陶土红「⊓」形门架（地下车库出入口的雨棚），中间夹一块草坪绿岛，
     两侧各一条车道 —— 这是实训区最醒目的一个体量。
   （之前把这俩搞反了：把高门架安在了学校主入口，所以看着粗糙又不像。）
*/
const GATE_MATS = {
  terra: new THREE.MeshStandardMaterial({ color: 0xab4a30, roughness: 0.86 }),
  terraDeep: new THREE.MeshStandardMaterial({ color: 0x96402a, roughness: 0.88 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xded7c2, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xcfc9b8, roughness: 0.93 }),
  paleStone: new THREE.MeshStandardMaterial({ color: 0xe2ddcd, roughness: 0.92 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.55, metalness: 0.6 }),
};

// 金色题字：透明底，直接贴在梁/墙面上（比做一整块牌匾更贴近照片）
function goldSign(text, wPx, hPx, fontPx) {
  return canvasTex(wPx, hPx, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    let fs = fontPx;
    do {
      ctx.font = `600 ${fs}px "Noto Serif CJK SC","Songti SC","STSong",serif`;
      fs -= 3;
    } while (ctx.measureText(text).width > w - 24 && fs > 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 字距拉开（照片里校名是均匀分布的）；先算含字距的总宽再居中，否则字会被裁掉
    const chars = [...text];
    const track = fs * 0.16;
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
    if (total > w - 24) {                        // 实在放不下就整体缩一点
      const k = (w - 24) / total;
      ctx.setTransform(k, 0, 0, 1, (1 - k) * w / 2, 0);
    }
    let cx = (w - total) / 2;
    chars.forEach((ch, i) => {
      const cw = widths[i];
      ctx.fillStyle = 'rgba(120,86,24,.55)';
      ctx.fillText(ch, cx + cw / 2 + 1.5, h / 2 + 2.5);
      ctx.fillStyle = '#c8a03a';
      ctx.fillText(ch, cx + cw / 2, h / 2);
      cx += cw + track;
    });
  });
}

// 推拉铁门：竖栅栏，用贴图做，省几何
const gateBarTex = canvasTex(64, 64, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#3f4548';
  ctx.fillRect(w * 0.30, 0, w * 0.055, h);
  ctx.fillRect(w * 0.62, 0, w * 0.055, h);
  ctx.fillRect(0, h * 0.08, w, h * 0.05);
  ctx.fillRect(0, h * 0.84, w, h * 0.05);
});

function addGateLeaves(parent, span, y0, hGate, zFront) {
  const t = gateBarTex.clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(6, Math.round(span / 1.1)), 1);
  const mat = new THREE.MeshStandardMaterial({
    map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
    roughness: 0.6, metalness: 0.45,
  });
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(span, hGate), mat);
  leaf.position.set(0, y0 + hGate / 2, zFront);
  parent.add(leaf);
}

GATES.forEach(g => {
  const grp = new THREE.Group();
  grp.position.set(g.x, 0, g.z);
  grp.rotation.y = g.dir === 'w' ? -Math.PI / 2 : 0;
  scene.add(grp);

  if (g.id === 'gate_s') {
    /* ===== 学校主入口：陶土红方柱 + 米白横梁 + 金色校名 ===== */
    const SPAN = 48;            // 柱廊总长
    const PIER_W = 2.3, PIER_D = 2.2, PIER_H = 7.2;
    const BEAM_H = 2.6, BEAM_D = 2.9;
    const n = 8;                // 柱子数
    const GAP = 10;             // 中间开口半宽：车行道从这里穿过，这里不能立柱
    for (let i = 0; i < n; i++) {
      const px = -SPAN / 2 + (SPAN / (n - 1)) * i;
      if (Math.abs(px) < GAP) continue;   // 原来柱子均匀排布，中间两根正好立在车行道上
      const pier = new THREE.Mesh(new THREE.BoxGeometry(PIER_W, PIER_H, PIER_D), GATE_MATS.terra);
      pier.position.set(px, PIER_H / 2, 0);
      pier.castShadow = true; pier.receiveShadow = true;
      grp.add(pier);
      // 柱脚（浅色石）
      const foot = new THREE.Mesh(new THREE.BoxGeometry(PIER_W + 0.35, 0.9, PIER_D + 0.35), GATE_MATS.paleStone);
      foot.position.set(px, 0.45, 0);
      foot.receiveShadow = true;
      grp.add(foot);
      // 柱顶小托
      const cap = new THREE.Mesh(new THREE.BoxGeometry(PIER_W + 0.3, 0.3, PIER_D + 0.3), GATE_MATS.terraDeep);
      cap.position.set(px, PIER_H - 0.15, 0);
      grp.add(cap);
    }

    // 横梁（米白），比柱子略出挑
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN + PIER_W + 1.4, BEAM_H, BEAM_D), GATE_MATS.cream);
    beam.position.set(0, PIER_H + BEAM_H / 2, 0);
    beam.castShadow = true; beam.receiveShadow = true;
    grp.add(beam);
    // 梁顶压边
    const beamTop = new THREE.Mesh(new THREE.BoxGeometry(SPAN + PIER_W + 1.9, 0.26, BEAM_D + 0.5), GATE_MATS.stone);
    beamTop.position.set(0, PIER_H + BEAM_H + 0.13, 0);
    grp.add(beamTop);
    // 梁底阴角线（深一点，读出厚度）
    const beamBot = new THREE.Mesh(new THREE.BoxGeometry(SPAN + PIER_W + 1.0, 0.22, BEAM_D + 0.16), GATE_MATS.stone);
    beamBot.position.set(0, PIER_H + 0.11, 0);
    grp.add(beamBot);

    // 金色校名（贴在梁的正面，朝平安路）
    const nameTex = goldSign(CAMPUS.name, 2048, 200, 96);
    const nameMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false });
    for (const zf of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 0.9, BEAM_H * 0.62), nameMat);
      sign.position.set(0, PIER_H + BEAM_H * 0.52, zf * (BEAM_D / 2 + 0.03));
      if (zf < 0) sign.rotation.y = Math.PI;
      grp.add(sign);
    }

    // 柱间推拉门（只做中间两跨，两侧留空当人行）
    // 推拉门做在开口两侧（车行道要通），不在正中间挡路
    for (const sgn of [-1, 1]) {
      addGateLeaves(grp, 9.0, 0.2, 2.0, 0.05);
      const leaf = grp.children[grp.children.length - 1];
      leaf.position.x = sgn * (GAP + 4.6);
    }

    // 门内原来铺了两块 19×11 的草坪。加了访客停车场和步道之后，
    // 这两块草坪正好压在车位西缘和步道上（俯视看就是草地盖住了路），
    // 索性整段删掉 —— 校门前是硬质铺装，本来也更接近照片里的样子。
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.5, 0), new THREE.MeshStandardMaterial({ color: 0x9c9689, roughness: 1 }));
    rock.position.set(SPAN * 0.30, 2.0, -11.2);
    rock.scale.set(1.9, 0.82, 0.9);
    rock.rotation.y = 0.5;
    rock.castShadow = true;
    grp.add(rock);
    const rockPad = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 5.2), GATE_MATS.paleStone);
    rockPad.position.set(SPAN * 0.30, 0.15, -11.2);
    rockPad.receiveShadow = true;
    grp.add(rockPad);

    // 门房（右侧，压到柱廊外侧）
    const booth = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.2, 4.4), GATE_MATS.cream);
    booth.position.set(-(SPAN / 2 + 3.0), 1.6, -4.5);
    booth.castShadow = true; booth.receiveShadow = true;
    grp.add(booth);
    const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.32, 5.2), GATE_MATS.stone);
    boothRoof.position.set(-(SPAN / 2 + 3.0), 3.36, -4.5);
    grp.add(boothRoof);

  } else {
    /* ===== 实训区主入口：矮石墙 + 金色校名墙 + 门后大「⊓」门架 ===== */
    const SPAN = 40;
    const WALL_H = 1.9, WALL_D = 0.9;

    // 两端矮墙（带压顶）
    for (const sgn of [-1, 1]) {
      const segW = 11;
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(segW, WALL_H, WALL_D), GATE_MATS.stone);
      w1.position.set(sgn * (SPAN / 2 - segW / 2), WALL_H / 2, 0);
      w1.castShadow = true; w1.receiveShadow = true;
      grp.add(w1);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(segW + 0.3, 0.18, WALL_D + 0.3), GATE_MATS.paleStone);
      cap.position.set(sgn * (SPAN / 2 - segW / 2), WALL_H + 0.09, 0);
      grp.add(cap);
    }

    // 中间校名墙（稍微抬高的实体墙，金色字贴在正面）
    const nameW = 18;
    const nameWall = new THREE.Mesh(new THREE.BoxGeometry(nameW, 2.5, 1.5), GATE_MATS.paleStone);
    nameWall.position.set(0, 1.25, 0);
    nameWall.castShadow = true; nameWall.receiveShadow = true;
    grp.add(nameWall);
    const nameCap = new THREE.Mesh(new THREE.BoxGeometry(nameW + 0.4, 0.2, 1.7), GATE_MATS.stone);
    nameCap.position.set(0, 2.6, 0);
    grp.add(nameCap);

    const txt = '张家港市中等专业学校';
    const t1 = goldSign(txt, 2048, 200, 100);
    const m1 = new THREE.MeshBasicMaterial({ map: t1, transparent: true, depthWrite: false });
    const sign1 = new THREE.Mesh(new THREE.PlaneGeometry(nameW - 1.0, 1.5), m1);
    sign1.position.set(0, 1.42, 0.78);
    grp.add(sign1);

    // 校名墙两侧的推拉铁门
    for (const sgn of [-1, 1]) {
      addGateLeaves(grp, 11 - 0.4, 0.15, 1.75, sgn * 0.02);
      const leaves = grp.children[grp.children.length - 1];
      leaves.position.x = sgn * (nameW / 2 + 5.5);
    }

    // 门后的大「⊓」门架（地下车库出入口雨棚）
    // 照片读数：开口很高（约占整体 85%），横梁是一条**薄**带子，梁上是下沉的
    // 屋面 + 两侧倾斜挡墙；两墩内侧面有细密竖棱（百叶），墩脚有浅色勒脚。
    const PZ = -38;                       // 退到校内 38m（照片上墙到门架约 1.5 个门架高）
    const PIER_W = 7.4, PIER_D = 8.5, PIER_H = 12.0;
    const INNER = 25;                     // 两墩净距（开口宽）
    const BEAM_H = 3.4;                   // 横梁（照片里约占总高 30%，不是细带子）
    const TERRA = GATE_MATS.terra;

    for (const sgn of [-1, 1]) {
      const px = sgn * (INNER / 2 + PIER_W / 2);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(PIER_W, PIER_H, PIER_D), TERRA);
      pier.position.set(px, PIER_H / 2, PZ);
      pier.castShadow = true; pier.receiveShadow = true;
      grp.add(pier);

      // 墩脚勒脚（浅灰石，约 0.9m）
      const base = new THREE.Mesh(new THREE.BoxGeometry(PIER_W + 0.4, 0.9, PIER_D + 0.4), GATE_MATS.paleStone);
      base.position.set(px, 0.45, PZ);
      base.receiveShadow = true;
      grp.add(base);

      // 内侧面竖棱（照片里开口两侧是竖条百叶）
      const ribMat = GATE_MATS.terraDeep;
      for (let z = -PIER_D / 2 + 0.9; z < PIER_D / 2 - 0.6; z += 0.62) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, PIER_H - 1.0, 0.22), ribMat);
        rib.position.set(px - sgn * (PIER_W / 2 + 0.06), (PIER_H - 1.0) / 2 + 0.9, PZ + z);
        grp.add(rib);
      }
      // 外侧面也带竖缝（照片里外侧是竖条纹的清水混凝土质感）
      for (let z = -PIER_D / 2 + 1.2; z < PIER_D / 2 - 0.8; z += 1.15) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.22, PIER_H - 1.2, 0.12), ribMat);
        rib.position.set(px + sgn * (PIER_W / 2 + 0.02), (PIER_H - 1.2) / 2 + 0.9, PZ + z);
        grp.add(rib);
      }
    }

    // 薄横梁：与墩子外皮齐平（不外挑），正面一条浅色压顶线
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(INNER + PIER_W * 2, BEAM_H, PIER_D),
      TERRA
    );
    beam.position.set(0, PIER_H + BEAM_H / 2, PZ);
    beam.castShadow = true; beam.receiveShadow = true;
    grp.add(beam);
    const beamCap = new THREE.Mesh(new THREE.BoxGeometry(INNER + PIER_W * 2 + 0.3, 0.22, PIER_D + 0.3), GATE_MATS.paleStone);
    beamCap.position.set(0, PIER_H + BEAM_H + 0.11, PZ);
    grp.add(beamCap);

    // 梁上：连续的陶土红屋面 + 两条台阶状台地 + 两端混凝土斜坡
    // （照片读数：顶上不是"凹院子"，而是一片大平屋面，被两道横向台地分成三段，
    //  左右两端各有一条上行的混凝土坡道，坡道内侧是浅灰抹面）
    const DECK_Y = PIER_H + BEAM_H + 0.22;
    const deckW = INNER + PIER_W * 2;
    const DECK_D = PIER_D + 1.2;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.35, DECK_D), TERRA);
    deck.position.set(0, DECK_Y, PZ);
    deck.castShadow = true; deck.receiveShadow = true;
    grp.add(deck);

    // 前檐口（屋面边缘一道浅色亮线）
    for (const zf of [-1, 1]) {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.2, 0.16, 0.30), GATE_MATS.paleStone);
      eave.position.set(0, DECK_Y + 0.20, PZ + zf * (DECK_D / 2 - 0.05));
      grp.add(eave);
    }

    // 两条横向台地（像台阶一样一层层抬起）
    for (const sgn of [-1, 1]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(deckW * 0.44, 0.55, DECK_D * 0.88),
        GATE_MATS.terraDeep
      );
      band.position.set(sgn * deckW * 0.20, DECK_Y + 0.45, PZ);
      band.castShadow = true; band.receiveShadow = true;
      grp.add(band);
      for (const zf of [-1, 1]) {
        const face = new THREE.Mesh(
          new THREE.BoxGeometry(deckW * 0.44, 0.5, 0.12),
          GATE_MATS.paleStone
        );
        face.position.set(sgn * deckW * 0.20, DECK_Y + 0.42, PZ + zf * (DECK_D * 0.44));
        grp.add(face);
      }
    }

    // 屋面围边（女儿墙）+ 两端浅灰坡面
    // 照片读数：屋顶轮廓是**平**的，外圈是一道浅色压顶的女儿墙；女儿墙里面，
    // 左右两端各有一片浅灰坡面朝后抬起（车库坡道顶盖），中间是两道横向百叶台地。
    // 之前把三角侧墙立在屋面两端，从正面看就是两片支棱出去的"白翅膀"，已重做。
    const PARA_H = 1.15, PARA_T = 0.32;
    for (const [pw, pd, px, pz] of [
      [deckW, PARA_T, 0, DECK_D / 2 - PARA_T / 2],
      [deckW, PARA_T, 0, -DECK_D / 2 + PARA_T / 2],
      [PARA_T, DECK_D, deckW / 2 - PARA_T / 2, 0],
      [PARA_T, DECK_D, -deckW / 2 + PARA_T / 2, 0],
    ]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(pw, PARA_H, pd), TERRA);
      w.position.set(px, DECK_Y + PARA_H / 2, PZ + pz);
      w.castShadow = true; w.receiveShadow = true;
      grp.add(w);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.1, 0.14, pd + 0.1), GATE_MATS.paleStone);
      cap.position.set(px, DECK_Y + PARA_H + 0.07, PZ + pz);
      grp.add(cap);
    }

    // 两端浅灰坡面：贴着屋面，从前往后抬起 1.4m，整体不超出女儿墙
    {
      const RAMP_W = 6.8, RAMP_D = DECK_D - PARA_T * 2;
      const RISE = 1.35;
      const ang = Math.atan2(RISE, RAMP_D);
      const plateLen = Math.hypot(RAMP_D, RISE);
      for (const sgn of [-1, 1]) {
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(RAMP_W, 0.22, plateLen),
          GATE_MATS.stone
        );
        plate.position.set(sgn * (deckW / 2 - PARA_T - RAMP_W / 2), DECK_Y + 0.18 + RISE / 2, PZ);
        plate.rotation.x = -ang;
        plate.castShadow = true; plate.receiveShadow = true;
        grp.add(plate);

        // 坡面两侧的红色挡边
        for (const zf of [-1, 1]) {
          const side = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, plateLen), TERRA);
          side.position.set(
            sgn * (deckW / 2 - PARA_T - RAMP_W / 2) + zf * 0,
            DECK_Y + 0.55,
            PZ
          );
          side.position.x = sgn * (deckW / 2 - PARA_T - RAMP_W / 2) + zf * (RAMP_W / 2 - 0.13);
          grp.add(side);
        }
      }
    }

    // 梁底顶棚：照片里洞口里面是压暗的，顶棚不该是浅米色，否则整块洞看着发白
    const soffit = new THREE.Mesh(
      new THREE.BoxGeometry(INNER, 0.24, PIER_D - 1.2),
      new THREE.MeshStandardMaterial({ color: 0x82878b, roughness: 0.95, emissive: 0x22262a, emissiveIntensity: 0.85 })
    );
    soffit.position.set(0, PIER_H - 0.12, PZ);
    grp.add(soffit);

    // 门架下方**不再做下沉坡道**。原来这里是一段 16m 长、下沉 3m 的地下车库坡道，
    // 但现在大门主轴要从地面笔直穿过门架一直往北通到实训区最深处（用户要求），
    // 坡道会把这条路挖断。改成：路面直接穿过去，门架只是一道横跨马路的构筑物，
    // 梁底做一块深色顶棚（soffit，已在上面建好），从下往上看到的是梁的阴影面。
    // 两侧红墩内侧加一道 0.9m 高的矮护墙收边，把墩和路面之间的缝补上。
    const railWhite = new THREE.MeshStandardMaterial({ color: 0xf0eee6, roughness: 0.6 });
    for (const sgn of [-1, 1]) {
      const kerbWall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, PIER_D), TERRA);
      kerbWall.position.set(sgn * (INNER / 2 + 0.35), 0.45, PZ);
      kerbWall.castShadow = true;
      grp.add(kerbWall);
      // 墩角的白色反光柱，夜间/黄昏时能看出这里是车行开口
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 10), railWhite);
      bollard.position.set(sgn * (INNER / 2 - 1.5), 0.55, PZ + PIER_D / 2 + 1.2);
      grp.add(bollard);
    }
  }
});

/* ---------- 学校区的西侧围墙（沿平安路，中间留出柱廊主入口） ---------- */
(function westWall() {
  const wx = -93.5;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c0, roughness: 0.95 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xbdb7a6, roughness: 0.95 });
  const H = 2.5;
  const gateZ = 64, halfGap = 25;
  const segs = [[-150, gateZ - halfGap], [gateZ + halfGap, 148]];
  for (const [z1, z2] of segs) {
    if (z2 - z1 < 2) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, H, z2 - z1), wallMat);
    m.position.set(wx, H / 2, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true;
    groundGroup.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, z2 - z1), postMat);
    cap.position.set(wx, H + 0.1, (z1 + z2) / 2);
    groundGroup.add(cap);
  }
  for (let z = -150; z <= 148; z += 26) {
    if (Math.abs(z - gateZ) < halfGap + 3) continue;
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, 2.2), postMat);
    p.position.set(wx, 1.6, z);
    p.castShadow = true;
    groundGroup.add(p);
  }
})();

/* ---------- 升旗台（操场东侧，正对跑道中轴） ----------
   用户核对：G8 3#宿舍的位置没有宿舍楼，是一座居中于操场的升旗台。
   做法：抬高 1.0m 的石材平台 + 西侧三级踏步正对跑道 + 旗杆 + 东侧景墙。
*/
const FLAG = { x: 348, z: TRACK.z, w: 15, d: 21 };   // w 沿 x（进深），d 沿 z（面宽）
(function flagPlatform() {
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xdcd8cd, roughness: 0.9 });
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xcfcabd, roughness: 0.95 });
  const H = 1.0;
  const { x, z, w, d } = FLAG;

  // 台面
  const deck = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), stoneMat);
  deck.position.set(x, H / 2, z);
  deck.castShadow = true; deck.receiveShadow = true;
  scene.add(deck);

  // 台面铺装（比台面略小一圈，读得出边缘）
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(w - 1.2, d - 1.2), stepMat);
  pave.rotation.x = -Math.PI / 2;
  pave.position.set(x, H + 0.012, z);
  pave.receiveShadow = true;
  scene.add(pave);

  // 西侧三级踏步（朝跑道）
  for (let i = 0; i < 3; i++) {
    const sw = 3.2 - i * 0.9;   // 每级进深
    const sh = H * (i + 1) / 3;
    const st = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, d * 0.62), stepMat);
    st.position.set(x - w / 2 - sw / 2 + 0.05, sh / 2, z);
    st.castShadow = true; st.receiveShadow = true;
    scene.add(st);
  }

  // 东侧景墙（挡土 + 视线底）
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.4, d * 0.9), stoneMat);
  back.position.set(x + w / 2 - 0.6, 1.7, z);
  back.castShadow = true; back.receiveShadow = true;
  scene.add(back);

  // 旗杆（台面上，居中）
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.34, 22, 16),
    new THREE.MeshStandardMaterial({ color: 0xe0e0de, roughness: 0.3, metalness: 0.75 })
  );
  pole.position.set(x, H + 11, z);
  pole.castShadow = true;
  scene.add(pole);

  // 杆座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 0.55, 24), stoneMat);
  base.position.set(x, H + 0.28, z);
  base.castShadow = true; base.receiveShadow = true;
  scene.add(base);

  // 国旗
  const flagMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 5),
    new THREE.MeshStandardMaterial({ color: 0xc8382e, roughness: 0.86, side: THREE.DoubleSide })
  );
  flagMesh.position.set(x + 3.75, H + 19.4, z);
  scene.add(flagMesh);

  const pos = flagMesh.geometry.attributes.position;
  const baseArr = pos.array.slice();
  window.__animateFns = window.__animateFns || [];
  window.__animateFns.push((t) => {
    for (let i = 0; i < pos.count; i++) {
      const px = baseArr[i * 3];
      pos.array[i * 3 + 2] = Math.sin((px + 3.7) * 0.6 + t * 2.2) * 0.36 * ((px + 3.7) / 7.4);
    }
    pos.needsUpdate = true;
  });

  // 台前小广场（把升旗台和跑道连起来）
  paveArea(x - w / 2 - 9, z, 18, d * 0.9, 0.1);
})();

/* =========================================================
   4. 建筑：按真实轮廓挤出
   ========================================================= */
const buildingsGroup = new THREE.Group();
scene.add(buildingsGroup);
const pickables = [];
const buildingNodes = [];

const ROOF_ACCENT = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.9 });

function buildBuilding(b) {
  const grp = new THREE.Group();
  grp.userData.building = b;

  const tint = b.color;
  const isTeach = /^c1/.test(b.id);
  const kind = isTeach ? 'teach'
    : (b.kind === 'workshop' ? 'workshop' : (b.kind === 'dorm' ? 'dorm' : 'hall'));
  const { map, glow } = tilesFor(kind, tint);

  const wallMat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: glow,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
    roughness: 0.87,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  windowMats.push(wallMat);

  const h = b.h;
  const plinthH = b.kind === 'gate' ? 0 : 1.1;
  const parapetH = 1.15;
  // 一个窗格 = 一层：按实际层高换算，避免高层楼出现碎窗条
  const tileH = (h - plinthH) / Math.max(1, b.floors);
  const tileW = b.kind === 'workshop' ? 6.2 : (isTeach ? 11.2 : 3.8);   // 厂房屋面开间更大

  b.parts.forEach(poly => {
    // 基座
    if (plinthH > 0) {
      const base = new THREE.Mesh(wallBand(poly, 0, plinthH, tileW, tileH), MAT.plinth);
      base.castShadow = true; base.receiveShadow = true;
      grp.add(base);
    }
    // 主体
    const body = new THREE.Mesh(wallBand(poly, plinthH, h, tileW, tileH), wallMat);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.building = b;
    grp.add(body);
    pickables.push(body);

    // 女儿墙
    const par = new THREE.Mesh(wallBand(poly, h, h + parapetH, tileW, tileH), MAT.parapet);
    par.castShadow = true;
    grp.add(par);

    // 屋面
    const roof = new THREE.Mesh(fillPoly(poly, h + parapetH), MAT.roof);
    roof.receiveShadow = true;
    roof.userData.building = b;
    grp.add(roof);
    pickables.push(roof);

    // 屋顶设备
    const c = centroid(poly);
    const n = Math.max(1, Math.round((b.area / poly.length) / 260));
    for (let i = 0; i < n; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 3.6), ROOF_ACCENT);
      const ang = (i / n) * Math.PI * 2;
      ac.position.set(c[0] + Math.cos(ang) * 4, h + parapetH + 1.2, c[1] + Math.sin(ang) * 4);
      ac.castShadow = true;
      grp.add(ac);
    }
  });

  // 主入口雨棚（临南面的最长边）
  if (b.kind === 'hall' || b.kind === 'dorm') {
    const poly = b.parts[0];
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c2 = poly[(i + 1) % poly.length];
      const len = Math.hypot(c2[0] - a[0], c2[1] - a[1]);
      if (!best || len > best.len) best = { a, b: c2, len };
    }
    if (best && best.len > 10) {
      const mx = (best.a[0] + best.b[0]) / 2, mz = (best.a[1] + best.b[1]) / 2;
      const ang = Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]);
      const cw = Math.min(best.len * 0.44, 26);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.6, 7.5), MAT.trim);
      canopy.position.set(mx, 5.4, mz);
      canopy.rotation.y = -ang;
      canopy.castShadow = true;
      grp.add(canopy);
    }
  }

  buildingsGroup.add(grp);
  buildingNodes.push({ group: grp, building: b, mat: wallMat, mats: [wallMat] });
  return grp;
}

BUILDINGS.forEach(buildBuilding);

/* =========================================================
   5. 树 / 路灯 / 停车
   ========================================================= */
(function trees() {
  const blocked = [];
  BUILDINGS.forEach(b => b.parts.forEach(p => blocked.push(p)));
  const onRoad = (x, z) => ROADS.some(r => {
    const horizontal = Math.abs(r.z2 - r.z1) < 0.01;
    if (horizontal) return Math.abs(z - r.z1) < r.w / 2 + 2.5 && x > Math.min(r.x1, r.x2) && x < Math.max(r.x1, r.x2);
    return Math.abs(x - r.x1) < r.w / 2 + 2.5 && z > Math.min(r.z1, r.z2) && z < Math.max(r.z1, r.z2);
  });
  const onTrack = (x, z) => {
    const { x: tx, z: tz, R, halfL, lanes, laneW } = TRACK;
    const R_OUT = R + lanes * laneW + 4;
    const dx = x - tx, dz = z - tz;
    const cz = Math.max(-halfL, Math.min(halfL, dz));
    return Math.hypot(dx, dz - cz) < R_OUT;
  };
  const onLake = (x, z) => inPoly(x, z, LAKE) || inPoly(x, z, ISLAND);
  // 校门前广场：别让树挡住门（柱廊前后各留一片空地）
  // 门洞前方与门架下方都不能种树：门架退到校内 38m，原来只清 30m，
  // 结果门架正好落在树带里，几棵树从屋面后支出来。
  const onGate = (x, z) => GATES.some(g => {
    const d = g.dir === 'w' ? Math.abs(x - g.x) : Math.abs(z - g.z);
    const along = g.dir === 'w' ? Math.abs(z - g.z) : Math.abs(x - g.x);
    // 大门外侧只清 18m；内侧要清到门架之后再留 20m，否则行道树会长进门洞
    const inboard = g.dir === 's' ? (z < g.z) : false;
    return d < 27 && along < (inboard ? 96 : 18);
  });
  // 升旗台 + 台前广场，别让树种上去
  const onFlag = (x, z) =>
    Math.abs(x - FLAG.x) < FLAG.w / 2 + 12 && Math.abs(z - FLAG.z) < FLAG.d / 2 + 4;
  // 游览路线与停车场：树不能种在步道、车位和站点上
  // （俯视图上能一眼看出一棵树长在停车场正中间，比什么都刺眼）
  const onRoute = (x, z) => {
    for (let i = 0; i < WALK.pts.length - 1; i++) {
      const a2 = WALK.pts[i], b2 = WALK.pts[i + 1];
      const vx = b2[0] - a2[0], vz = b2[1] - a2[1];
      const L2 = vx * vx + vz * vz;
      let t = L2 > 0 ? ((x - a2[0]) * vx + (z - a2[1]) * vz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (a2[0] + vx * t), z - (a2[1] + vz * t)) < 5.5) return true;
    }
    for (let i = 0; i < LOTS.length; i++) {
      const L = LOTS[i];
      if (Math.abs(x - L.cx) < L.w / 2 + 3 && Math.abs(z - L.cz) < L.d / 2 + 3) return true;
    }
    for (let i = 0; i < STOPS.length; i++) {
      if (Math.hypot(x - STOPS[i].at[0], z - STOPS[i].at[1]) < 7) return true;
    }
    return false;
  };
  const inCourt = (x, z) => {
    const gap = COURTS.gap || 4;
    const halfX = (COURTS.cols * COURTS.w + (COURTS.cols - 1) * gap) / 2 + 3.5;
    const halfZ = (COURTS.rows * COURTS.d + (COURTS.rows - 1) * gap) / 2 + 3.5;
    return Math.abs(x - COURTS.x) < halfX && Math.abs(z - COURTS.z) < halfZ;
  };

  const spots = [];
  const push = (x, z, sc) => {
    if (x < SITE.x1 + 4 || x > SITE.x2 - 4 || z < SITE.z1 + 4 || z > SITE.z2 - 4) return;
    if (onRoad(x, z) || onTrack(x, z) || onLake(x, z) || inCourt(x, z) ||
        onFlag(x, z) || onGate(x, z) || onRoute(x, z)) return;
    if (blocked.some(p => inPoly(x, z, p))) return;
    spots.push([x, z, sc]);
  };

  // 沿路行道树
  ROADS.forEach(r => {
    if (r.w > 12) return;
    const horizontal = Math.abs(r.z2 - r.z1) < 0.01;
    if (horizontal) {
      for (let x = Math.min(r.x1, r.x2) + 8; x < Math.max(r.x1, r.x2) - 4; x += 16) {
        push(x, r.z1 - r.w / 2 - 4, 0.95);
        push(x, r.z1 + r.w / 2 + 4, 0.95);
      }
    } else {
      for (let z = Math.min(r.z1, r.z2) + 8; z < Math.max(r.z1, r.z2) - 4; z += 16) {
        push(r.x1 - r.w / 2 - 4, z, 0.95);
        push(r.x1 + r.w / 2 + 4, z, 0.95);
      }
    }
  });

  // 湖岸、跑道周边成组
  for (let i = 0; i < LAKE.length; i++) {
    const a = LAKE[i], b2 = LAKE[(i + 1) % LAKE.length];
    const len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
    const n = Math.floor(len / 12);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a[0] + (b2[0] - a[0]) * t, z = a[1] + (b2[1] - a[1]) * t;
      const dx = x - LAKE_C[0], dz = z - LAKE_C[1];
      const L = Math.hypot(dx, dz) || 1;
      push(x + (dx / L) * 7, z + (dz / L) * 7, 1.02);
    }
  }

  // 围墙内绿带
  for (let x = SITE.x1 + 10; x < SITE.x2 - 6; x += 17) {
    push(x, SITE.z1 + 8, 1.1);
    push(x, SITE.z2 - 8, 1.0);
  }
  for (let z = SITE.z1 + 10; z < SITE.z2 - 6; z += 17) {
    push(SITE.x1 + 8, z, 1.0);
    push(SITE.x2 - 8, z, 1.0);
  }

  // 随机补白
  for (let i = 0; i < 260; i++) {
    push(SITE.x1 + 12 + Math.random() * (SITE.x2 - SITE.x1 - 24),
      SITE.z1 + 12 + Math.random() * (SITE.z2 - SITE.z1 - 24),
      0.78 + Math.random() * 0.3);
  }

  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.55, 5.6, 6);
  trunkGeo.translate(0, 2.8, 0);

  const blobs = [];
  const blob = (r, x, y, z, d = 1) => {
    const g = new THREE.IcosahedronGeometry(r, d);
    g.translate(x, y, z);
    blobs.push(g);
  };
  blob(3.3, 0, 7.6, 0);
  blob(2.5, -1.5, 9.2, 0.8);
  blob(2.3, 1.6, 8.8, -0.7);
  blob(2.0, 0.4, 10.2, 0.4);
  const leafGeo = mergeGeoms(blobs);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5744, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
  trunks.castShadow = true;
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  const GREENS = ['#5f8348', '#6d9052', '#7d9d5f', '#547a41', '#87a369'];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
  spots.forEach(([x, z, sc], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    const hs = sc * (0.85 + Math.random() * 0.32);
    pv.set(x, 0, z);
    sv.set(sc * (0.9 + Math.random() * 0.22), hs, sc * (0.9 + Math.random() * 0.22));
    m.compose(pv, q, sv);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
    col.set(GREENS[(Math.random() * GREENS.length) | 0]);
    leaves.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks, leaves);
  console.log('trees:', spots.length);
})();

(function lamps() {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x414b53, roughness: 0.6, metalness: 0.45 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xdedacd, roughness: 0.5, emissive: 0xffe2ab, emissiveIntensity: 0,
  });

  const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 7, 8);
  poleGeo.translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(2.2, 0.2, 0.2);
  armGeo.translate(1.0, 6.9, 0);
  const headGeo = new THREE.BoxGeometry(1.4, 0.28, 0.62);
  headGeo.translate(1.95, 6.76, 0);

  const spots = [];
  ROADS.forEach(r => {
    const horizontal = Math.abs(r.z2 - r.z1) < 0.01;
    const step = r.w > 12 ? 34 : 28;
    if (horizontal) {
      for (let x = Math.min(r.x1, r.x2) + 12; x < Math.max(r.x1, r.x2); x += step) {
        spots.push([x, r.z1 - r.w / 2 - 2.2, 1]);
      }
    } else {
      for (let z = Math.min(r.z1, r.z2) + 12; z < Math.max(r.z1, r.z2); z += step) {
        spots.push([r.x1 + r.w / 2 + 2.2, z, -1]);
      }
    }
  });

  const poles = new THREE.InstancedMesh(mergeGeoms([poleGeo, armGeo]), poleMat, spots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
  poles.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
    sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  spots.forEach(([x, z, dir], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir > 0 ? 0 : Math.PI);
    pv.set(x, 0, z);
    m.compose(pv, q, sc);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  scene.add(poles, heads);
  window.__lampHeads = heads;
})();

/* 北侧停车位（沿晨丰公路） */
(function parking() {
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d8, transparent: true, opacity: 0.6 });
  const carColors = ['#c9cdd2', '#313d4a', '#8f2f2f', '#3e5a76', '#d8d5cd', '#4a5b4a', '#8d8478'];
  let idx = 0;
  for (let row = 0; row < 2; row++) {
    const pz = SITE.z1 + 14 + row * 20;
    paveArea(150, pz, 250, 17, 0.09, 0x6a6e73);
    for (let x = 40; x < 330; x += 6) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 5), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(x, 0.10, pz - 3);
      groundGroup.add(l);
    }
    for (let x = 46; x < 330; x += 18) {
      if (Math.random() < 0.35) continue;
      const car = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 1.2, 1.8),
        new THREE.MeshStandardMaterial({ color: carColors[idx++ % carColors.length], roughness: 0.42, metalness: 0.35 })
      );
      body.position.y = 0.9;
      body.castShadow = true;
      car.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.8, 1.62),
        new THREE.MeshStandardMaterial({ color: 0x2b3a46, roughness: 0.18, metalness: 0.5 })
      );
      cabin.position.set(-0.1, 1.78, 0);
      car.add(cabin);
      car.position.set(x, 0, pz);
      groundGroup.add(car);
    }
  }
})();


/* ---------- 游览停车路线 ----------
   两层要分开画，不能混：
   · 车行线（DRIVES）沿路面走，画在沥青面之上、标线之下（y=0.207），用虚线，
     因为它和真路是重合的 —— 画成实色会把路盖住。
   · 步行线（WALK）不走车行道，穿广场、绕湖、沿楼前，画在铺装之上（y=0.235），
     用实线 + 白色描边，远看是一条能跟着走的带子。
   线的绕障坐标是在 tools/plan_route.py 里用 2.6m 净距的栅格 A* 算出来的，
   不是目测画上去的（见 js/route.js 顶部注释）。
*/
// 车行线原来压在 0.207 —— 只比沥青高 7 毫米，还低于车道线（0.212），
// 俯视时和路面打架，蓝虚线碎成一段一段的。抬到 0.218（在标线之上）并改成不透明。
const ROUTE_Y_DRIVE = 0.218;
const ROUTE_Y_WALK = 0.235;
// 路线单独放一个组：侧栏里"游览路线"开关一次就是整组显隐，
// 不用挨个记 mesh 引用，也不会误伤到路面和铺装。
const routeGroup = new THREE.Group();
routeGroup.name = 'routes';
scene.add(routeGroup);

function ribbonLine(pts, w, y, color, opacity = 1, order = 3) {
  // 折线 → 等宽带子，拐角用「圆角（round join）」。
  // 之前用 miter：急转弯处两条边的偏移点会甩出去很远，俯视看是一坨楔形尖角；
  // 用独立四边形不补角：转弯外侧又会豁开一个口子。圆角两头都不犯。
  const pos = [], idx = [];
  const half = w / 2;
  const pushQuad = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) return;
    const nx = -(dz / L) * half, nz = (dx / L) * half;
    const vi = pos.length / 3;
    pos.push(a[0] + nx, y, a[1] + nz,
             a[0] - nx, y, a[1] - nz,
             b[0] - nx, y, b[1] - nz,
             b[0] + nx, y, b[1] + nz);
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  };
  const SEG = 10;
  const pushDisc = (c) => {
    const vi = pos.length / 3;
    pos.push(c[0], y, c[1]);
    for (let k = 0; k <= SEG; k++) {
      const t = (k / SEG) * Math.PI * 2;
      pos.push(c[0] + Math.cos(t) * half, y, c[1] + Math.sin(t) * half);
    }
    for (let k = 0; k < SEG; k++) idx.push(vi, vi + 1 + k, vi + 2 + k);
    // 反面再补一遍，省掉 DoubleSide 的背面剔除问题
    for (let k = 0; k < SEG; k++) idx.push(vi, vi + 2 + k, vi + 1 + k);
  };
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) pushQuad(pts[i], pts[i + 1]);
  for (let i = 1; i < n - 1; i++) pushDisc(pts[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(
    new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: false, opacity: 1, depthWrite: true, side: THREE.DoubleSide,
  }));
  m.renderOrder = order;
  routeGroup.add(m);
  return m;
}

/* 虚线：先按等距重采样整条折线，再按 dash/gap 切段。
   原来的写法逐段各自从 s=0 开始切，拐角处两段的切口对不上，
   直角拐弯会甩出一片斜三角。重采样之后每一段虚线都是连续折线，
   直接交给 ribbonLine 画，拐角自带圆角。 */
function dashedLine(pts, w, y, color, dash = 7, gap = 5, opacity = 1, order = 5) {
  // 1) 等距重采样（步长 1m，短段也至少取两点）
  const dense = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      dense.push([a[0] + dx * t, a[1] + dz * t]);
    }
    acc += L;
  }
  dense.push(pts[pts.length - 1]);

  // 2) 沿累积长度切 dash / gap
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * t,
            dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * t];
  };
  for (let s0 = 0; s0 < total; s0 += dash + gap) {
    const s1 = Math.min(total, s0 + dash);
    if (s1 - s0 < 0.8) continue;
    const seg = [at(s0)];
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] > s0 && cum[i] < s1) seg.push(dense[i]);
    }
    seg.push(at(s1));
    ribbonLine(seg, w, y, color, opacity, order);
  }
}

/* 停车场：铺装 + 车位线 + 几辆占位车 */
const carColors = ['#c9cdd2', '#313d4a', '#8f2f2f', '#3e5a76', '#d8d5cd', '#4a5b4a', '#8d8478'];
let carIdx = 0;

function buildLot(lot) {
  const { cx, cz, w, d, stallW, stallD, rows } = lot;
  const pad = paveArea(cx, cz, w, d, 0.14, 0x8d9095);
  routeGroup.remove(pad);   // 从 groundGroup 挪到 routeGroup（paveArea 默认加在 groundGroup）
  routeGroup.add(pad);

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2eee2, transparent: true, opacity: 0.85 });
  const addLine = (x, z, lw, ld) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.16, z);
    m.renderOrder = 2;
    routeGroup.add(m);
  };

  // 每一排车位的纵向范围
  const rowD = d / rows;
  for (let r = 0; r < rows; r++) {
    const z0 = cz - d / 2 + r * rowD;
    const zc = z0 + rowD / 2;
    const n = Math.max(1, Math.floor((w - 4) / stallW));
    const x0 = cx - (n * stallW) / 2;
    for (let i = 0; i <= n; i++) {
      addLine(x0 + i * stallW, zc, 0.16, stallD);
    }
    addLine(cx, z0 + 0.4, w - 2, 0.16);
    addLine(cx, z0 + rowD - 0.4, w - 2, 0.16);
    // 占位车。车头朝外、车身沿车位进深方向（z）摆，
    // 尺寸不能超过车位：小车 1.8 × 4.2、大巴 2.5 × 11（宽 × 长）
    const isBus = stallD > 8;
    const bodyW = isBus ? 2.5 : 1.8;          // x 向 = 车宽
    const bodyL = isBus ? 11.0 : 4.2;         // z 向 = 车长
    const bodyH = isBus ? 2.9 : 1.32;
    for (let i = 0; i < stalls.length; i++) {
      if (stalls[i].row !== r) continue;
      const car = new THREE.Group();
      const paint = carColors[carIdx++ % carColors.length];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW, bodyH, bodyL),
        new THREE.MeshStandardMaterial({ color: paint, roughness: 0.42, metalness: 0.35 })
      );
      body.position.y = bodyH / 2 + 0.18;
      body.castShadow = true;
      car.add(body);
      if (isBus) {
        // 大巴：车窗带一条深色腰线 + 车顶稍微收进
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW + 0.06, 0.95, bodyL * 0.86),
          new THREE.MeshStandardMaterial({ color: 0x27323c, roughness: 0.22, metalness: 0.45 })
        );
        band.position.set(0, bodyH * 0.72, 0);
        car.add(band);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW - 0.25, 0.16, bodyL - 0.7),
          new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.55, metalness: 0.2 })
        );
        roof.position.set(0, bodyH + 0.22, 0);
        car.add(roof);
      } else {
        // 小车：上半截是座舱，前后各收一点，别做成一个整方盒
        const cabin = new THREE.Mesh(
          new THREE.BoxGeometry(bodyW - 0.16, 0.62, bodyL * 0.52),
          new THREE.MeshStandardMaterial({ color: 0x2b3a46, roughness: 0.18, metalness: 0.5 })
        );
        cabin.position.set(0, bodyH + 0.16, -0.1);
        car.add(cabin);
      }
      // 车身长边沿 z（车位进深方向），不要再转 90 度 —— 转了就又横过来了
      car.position.set(x0 + stalls[i].slot * stallW + stallW / 2, 0, zc);
      routeGroup.add(car);
    }
  }
}

/* 每个停车场里摆几辆车（只影响观感，不影响任何逻辑） */
const stalls = [];
LOTS.forEach(lot => {
  const n = Math.max(1, Math.floor((lot.w - 4) / lot.stallW));
  const count = Math.min(n, Math.round(n * 0.55));
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let slot = Math.floor(Math.random() * n);
    let guard = 0;
    while (used.has(slot) && guard++ < 40) slot = Math.floor(Math.random() * n);
    used.add(slot);
    stalls.push({ lot: lot.id, row: i % lot.rows, slot });
  }
});

LOTS.forEach(buildLot);

/* 车行线（虚线，蓝色）+ 步行线（实线，暖橙 + 白描边） */
DRIVES.forEach(dr => dashedLine(dr.pts, 3.6, ROUTE_Y_DRIVE, dr.color, 8, 6, 1));
// 白描边在下、橙色主线在上。原来白带比橙带高 4mm 又更宽，正俯视时白带整个把橙色盖住，
// 远看就是一条白线 —— 描边必须是底不是面。
ribbonLine(WALK.pts, 4.0, ROUTE_Y_WALK, 0xffffff, 0.92, 3);
ribbonLine(WALK.pts, 2.9, ROUTE_Y_WALK + 0.006, 0xd8724a, 0.96, 4);

/* 站点圆点：小圆柱 + 白圈，编号由 HTML 标签标（见 makeRouteLabels） */
const stopMeshes = [];
const routePickables = [];   // 射线拾取用：点站点圆点就飞过去
STOPS.forEach(s => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 0.12, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
  );
  ring.position.y = 0.30;
  g.add(ring);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 1.9, 0.16, 24),
    new THREE.MeshStandardMaterial({ color: 0xd8724a, roughness: 0.7 })
  );
  core.position.y = 0.34;
  g.add(core);
  g.position.set(s.at[0], 0, s.at[1]);
  routeGroup.add(g);
  ring.userData.stop = s;
  core.userData.stop = s;
  routePickables.push(ring, core);
  stopMeshes.push({ stop: s, mesh: g, core });
});

/* =========================================================
   6. 交互
   ========================================================= */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
let selected = null;
let pointerDownAt = null;
let duskMode = false;

function setPointer(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.building : null;
}

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  const b = hit ? hit.object.userData.building : null;
  if (b !== hovered) {
    hovered = b;
    buildingNodes.forEach(({ building, mat }) => {
      if (building === selected) return;
      mat.emissiveIntensity = building === b ? 0.22 : (duskMode ? 1.0 : 0);
    });
    canvas.style.cursor = b ? 'pointer' : 'grab';
  }
  if (routeOn && !b) {
    const hs = raycaster.intersectObjects(routePickables, false)[0];
    if (hs) canvas.style.cursor = 'pointer';
  }
});

canvas.addEventListener('pointerdown', (e) => { pointerDownAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownAt) return;
  const moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
  pointerDownAt = null;
  if (moved > 6) return;
  setPointer(e);
  // 站点圆点优先：它压在楼前广场上，不能让楼的拾取抢走
  if (routeOn) {
    raycaster.setFromCamera(pointer, camera);
    const h = raycaster.intersectObjects(routePickables, false)[0];
    if (h && h.object.userData.stop) { flyToStop(h.object.userData.stop); return; }
  }
  const b = pick();
  if (b) selectBuilding(b);
  else deselect();
});

/* =========================================================
   7. 相机飞行
   ========================================================= */
let flight = null;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function flyTo(pos, target, dur = 1250) {
  flight = {
    t0: performance.now(), dur,
    fromPos: camera.position.clone(), toPos: new THREE.Vector3(...pos),
    fromTar: controls.target.clone(), toTar: new THREE.Vector3(...target),
  };
  controls.enabled = false;
}

function flyToBuilding(b) {
  const dist = Math.max(b.w, b.d) * 1.5 + 55;
  const y = b.h * 0.85 + 26;
  flyTo([b.x + dist * 0.5, y, b.z + dist], [b.x, b.h * 0.3, b.z], 1350);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  if (flight) {
    const k = Math.min(1, (performance.now() - flight.t0) / flight.dur);
    const e = easeInOutCubic(k);
    camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
    controls.target.lerpVectors(flight.fromTar, flight.toTar, e);
    camera.lookAt(controls.target);
    if (k >= 1) { flight = null; controls.enabled = true; controls.update(); }
  } else {
    controls.update();
  }

  if (skyFollowsCamera) sky.position.copy(camera.position);
  if (window.__animateFns) window.__animateFns.forEach(f => f(t));

  updateLabels();
  renderer.render(scene, camera);
}

/* =========================================================
   8. 楼栋标签
   ========================================================= */
const labelLayer = document.getElementById('labels');
const labelEls = new Map();
const tmpV = new THREE.Vector3();

function makeLabels() {
  BUILDINGS.forEach(b => {
    const el = document.createElement('div');
    el.className = 'blabel';
    el.textContent = b.name;   // 名字里已经不带楼号了
    labelLayer.appendChild(el);
    labelEls.set(b.id, el);
  });
  makeRoadLabels();
}

/* ---------- 路名标签 ---------- */
// 名称来自用户提供的校园示意图（匠远路 / 匠诚路 / 匠行路 / 匠心路 / 匠德路 为横向，
// 匠能大道 / 匠运大道 / 领航大道 / 团结大道 为纵向）。没有名字的连接路不标。
const roadEls = [];

function makeRoadLabels() {
  ROADS.forEach(r => {
    if (!r.name) return;
    const horizontal = Math.abs(r.z2 - r.z1) < 0.01;
    const len = horizontal ? Math.abs(r.x2 - r.x1) : Math.abs(r.z2 - r.z1);
    if (len < 60) return;                 // 太短的路段标上去会挤成一团
    const el = document.createElement('div');
    el.className = 'rlabel' + (r.main ? ' main' : '');
    el.textContent = r.name;
    labelLayer.appendChild(el);
    roadEls.push({
      el,
      x: (r.x1 + r.x2) / 2,
      z: (r.z1 + r.z2) / 2,
      len,
      vertical: !horizontal,
    });
  });
}

function updateRoadLabels() {
  const scale = innerWidth < 820 ? 0.72 : 1;
  roadEls.forEach(o => {
    tmpV.set(o.x, 0.4, o.z);
    const dist = camera.position.distanceTo(tmpV);
    tmpV.project(camera);
    // 路名比楼名淡：太远就收掉，免得俯视远景糊成一片
    if (tmpV.z > 1 || dist > 900) { o.el.style.display = 'none'; return; }
    // 镜头压得很低时水平路面会变成一条线，字也压扁，这时收掉
    if (dist > 40 && camera.position.y < 22) { o.el.style.display = 'none'; return; }
    o.el.style.display = '';
    const x = (tmpV.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmpV.y * 0.5 + 0.5) * innerHeight;
    // 纵向道路用竖排（writing-mode），不是把整行转 90°——那样字是躺着的
    o.el.classList.toggle('vert', o.vertical);
    o.el.style.transform = `translate(-50%,-50%) translate3d(${x}px,${y}px,0)`;
    // 衰减要缓：俯视总览时镜头离地 500~600m，按老公式只剩 0.29，等于看不见
    o.el.style.opacity = Math.max(0.62, 0.96 - dist / 2600);
    o.el.style.fontSize = `${10.5 * scale}px`;
  });
}

function updateLabels() {
  const scale = innerWidth < 820 ? 0.74 : 1;
  BUILDINGS.forEach((b) => {
    const el = labelEls.get(b.id);
    if (!el) return;
    tmpV.set(b.x, b.h + 10, b.z);
    const dist = camera.position.distanceTo(tmpV);
    tmpV.project(camera);
    if (tmpV.z > 1 || dist > 950) { el.style.display = 'none'; return; }
    el.style.display = '';
    const x = (tmpV.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmpV.y * 0.5 + 0.5) * innerHeight;
    el.style.transform = `translate(-50%,-100%) translate3d(${x}px,${y}px,0)`;
    el.style.opacity = Math.max(0.12, 1 - dist / 1000);
    el.classList.toggle('far', dist > 560);
    el.classList.toggle('sel', selected && selected.id === b.id);
    el.style.fontSize = `${11 * scale}px`;
  });
  updateRoadLabels();
  updateRouteLabels();
}

/* =========================================================
   9. UI
   ========================================================= */
const detail = document.getElementById('detail');
const areaList = document.getElementById('area-list');
const vpBar = document.getElementById('viewpoints');

const TAG_COLOR = { '中心区': '#c4a35a', '教学区': '#b98b5e', '实训区': '#5f8ea8', '生活区': '#8aa06b' };
const TAGS = ['中心区', '教学区', '实训区', '生活区'];

const areas = [{ id: 'all', name: '全部建筑', tag: null }].concat(TAGS.map(t => ({ id: t, name: t, tag: t })));
let areaFilter = 'all';

function renderAreas() {
  areaList.innerHTML = '';
  areas.forEach(a => {
    const n = a.tag ? BUILDINGS.filter(b => b.tag === a.tag).length : BUILDINGS.length;
    const el = document.createElement('div');
    el.className = 'area' + (areaFilter === a.id ? ' active' : '');
    el.innerHTML = `<span class="dot" style="background:${a.tag ? TAG_COLOR[a.tag] : '#7b8794'}"></span>
      <span>${a.name}</span><span class="cnt">${n}</span>`;
    el.onclick = () => {
      areaFilter = a.id;
      renderAreas();
      highlightArea();
      const list = a.tag ? BUILDINGS.filter(b => b.tag === a.tag) : BUILDINGS;
      const cx = list.reduce((s, b) => s + b.x, 0) / list.length;
      const cz = list.reduce((s, b) => s + b.z, 0) / list.length;
      const spread = a.tag ? 190 : 300;
      flyTo([cx + spread * 0.5, spread * 1.05, cz + spread * 1.1], [cx, 0, cz], 1250);
    };
    areaList.appendChild(el);
  });
}

function highlightArea() {
  buildingNodes.forEach(({ building, mat }) => {
    const dim = areaFilter !== 'all' && building.tag !== areaFilter;
    mat.color.setScalar(dim ? 0.66 : 1);
    if (!duskMode) mat.emissiveIntensity = 0;
  });
}

/* ---------- 游览路线：站点标签 ---------- */
const stopEls = [];
let routeOn = true;

function makeRouteLabels() {
  STOPS.forEach(s => {
    const el = document.createElement('div');
    el.className = 'nlabel';
    el.innerHTML = `<b>${s.no}</b><span>${s.name}</span>`;
    labelLayer.appendChild(el);
    stopEls.push({ el, stop: s });
  });
}

function updateRouteLabels() {
  const scale = innerWidth < 820 ? 0.7 : 1;
  stopEls.forEach(o => {
    if (!routeOn) { o.el.style.display = 'none'; return; }
    tmpV.set(o.stop.at[0], 2.6, o.stop.at[1]);
    const dist = camera.position.distanceTo(tmpV);
    tmpV.project(camera);
    if (tmpV.z > 1 || dist > 860) { o.el.style.display = 'none'; return; }
    o.el.style.display = '';
    // 夹进视口：站点常常贴在图边，不夹的话「6 运动场」会被裁掉半个字
    const pad = 56;
    const x = Math.min(innerWidth - pad, Math.max(pad, (tmpV.x * 0.5 + 0.5) * innerWidth));
    const y = Math.min(innerHeight - 90, Math.max(60, (-tmpV.y * 0.5 + 0.5) * innerHeight));
    o.el.style.transform = `translate(-50%,-100%) translate3d(${x}px,${y}px,0)`;
    o.el.style.opacity = Math.max(0.55, 1 - dist / 1500);
    o.el.style.fontSize = `${10 * scale}px`;
  });
}

/* 飞到某一站：停在站点斜上方，同时把视角压到人眼高度附近，像站在那儿 */
function flyToStop(s) {
  stopTour();
  deselect();
  const [x, z] = s.at;
  const r = 46;
  flyTo([x + r * 0.72, 26, z + r * 0.86], [x, 3, z], 1400);
  markStop(s.no);
}

function markStop(no) {
  document.querySelectorAll('#route-list .rstop').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.no) === no);
  });
}

function renderRoute() {
  const box = document.getElementById('route-list');
  box.innerHTML = '';
  STOPS.forEach(s => {
    const el = document.createElement('div');
    el.className = 'rstop';
    el.dataset.no = s.no;
    el.innerHTML = `<span class="no">${s.no}</span>` +
                   `<span><span class="nm">${s.name}</span><span class="tg">${s.tag}</span></span>`;
    el.onclick = () => flyToStop(s);
    box.appendChild(el);
  });
}

/* 整组显隐 */
const sidebarEl = document.getElementById('sidebar');
const routeBtn = document.getElementById('btn-route');

function setRoute(on) {
  routeOn = on;
  routeGroup.visible = on;
  routeBtn.classList.toggle('on', on);
  // 路线列表就在侧栏里，关掉时把那一节收起来（分区列表照旧可用）
  sidebarEl.classList.toggle('hide-route', !on);
  stopEls.forEach(o => { if (!on) o.el.style.display = 'none'; });
}

routeBtn.onclick = () => setRoute(!routeOn);
document.getElementById('btn-route-close').onclick = () => setRoute(false);

function renderViewpoints() {
  vpBar.innerHTML = '';
  // 竖屏专用的那套机位不单独做按钮，只参与初始视角
  const list = CAMPUS.viewpoints.filter(v => v.id !== 'overview-tall');
  list.forEach(v => {
    const b = document.createElement('button');
    b.className = 'vp' + (v.id === 'overview' ? ' active' : '');
    b.dataset.vp = v.id;
    b.textContent = v.name;
    b.onclick = () => {
      stopTour();
      markVp(v.id);
      flyTo(v.pos, v.target, 1300);
    };
    vpBar.appendChild(b);
  });
}

function selectBuilding(b) {
  stopTour();
  selected = b;
  buildingNodes.forEach(({ building, mat }) => {
    mat.emissiveIntensity = building === b ? 0.5 : (duskMode ? 1.0 : 0);
  });

  document.getElementById('d-tag').textContent = `${b.tag}${b.code ? ' · ' + b.code : ''} ｜ ${b.sub}`;
  document.getElementById('d-name').textContent = b.name;
  document.getElementById('d-sub').textContent = `${b.floors} 层 · 高 ${b.h} 米 · 占地约 ${b.area.toLocaleString()} ㎡`;
  document.getElementById('d-desc').textContent = b.desc || '';

  const mWrap = document.getElementById('d-majors-wrap');
  const mBox = document.getElementById('d-majors');
  mBox.innerHTML = '';
  if (b.majors && b.majors.length) {
    mWrap.style.display = '';
    b.majors.forEach(mj => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = mj;
      mBox.appendChild(c);
    });
  } else {
    mWrap.style.display = 'none';
  }

  const ul = document.getElementById('d-spots');
  const swrap = document.getElementById('d-spots-wrap');
  ul.innerHTML = '';
  (b.spots || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    ul.appendChild(li);
  });
  swrap.style.display = (b.spots && b.spots.length) ? '' : 'none';

  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');

  document.getElementById('btn-fly').onclick = () => flyToBuilding(b);
  document.getElementById('btn-near').onclick = () => {
    const r = Math.max(b.w, b.d) * 1.25 + 45;
    flyTo([b.x + r * 0.75, b.h * 1.05 + 22, b.z + r * 0.75], [b.x, b.h * 0.35, b.z], 1500);
  };
}

function deselect() {
  selected = null;
  detail.classList.remove('open');
  detail.setAttribute('aria-hidden', 'true');
  buildingNodes.forEach(({ mat }) => { mat.emissiveIntensity = duskMode ? 1.0 : 0; });
}

document.getElementById('btn-close').onclick = deselect;

/* ---------- 自动巡游 ---------- */
// 巡游只用底部那排视角按钮对应的机位（竖屏专用机位 overview-tall 不参与），
// 否则按钮高亮会和实际飞行到的机位错位。
let tourTimer = null;
let tourIdx = 0;
const tourBtn = document.getElementById('btn-tour');
const tourList = () => CAMPUS.viewpoints.filter(v => v.id !== 'overview-tall');

// 高亮按 id 找按钮，不靠下标——按钮顺序将来变了也不会错位
function markVp(id) {
  [...vpBar.children].forEach(c => c.classList.toggle('active', c.dataset.vp === id));
}

function startTour() {
  // 从"离当前机位最近的那一站"的下一站开始，否则第一段会飞回你正站着的地方，白等 6 秒
  const list = tourList();
  const p = camera.position;
  let nearest = 0, best = Infinity;
  list.forEach((v, i) => {
    const d = (v.pos[0] - p.x) ** 2 + (v.pos[1] - p.y) ** 2 + (v.pos[2] - p.z) ** 2;
    if (d < best) { best = d; nearest = i; }
  });
  tourIdx = nearest + 1;
  tourBtn.classList.add('on');
  tourBtn.textContent = '停止巡游';
  stepTour();
  // 稍长于飞行时长，避免上一次还没停稳就起飞，画面像在抽帧
  tourTimer = setInterval(stepTour, 6200);
}
function stepTour() {
  const list = tourList();
  const v = list[tourIdx % list.length];
  tourIdx++;
  markVp(v.id);
  flyTo(v.pos, v.target, 5000);
}
function stopTour() {
  if (tourTimer) clearInterval(tourTimer);
  tourTimer = null;
  tourBtn.classList.remove('on');
  tourBtn.textContent = '自动巡游';
}
tourBtn.onclick = () => (tourTimer ? stopTour() : startTour());

// 任何手动操作都中止巡游，不然飞行会把镜头抢回去、用户拖不动
function interruptTour() {
  if (tourTimer) stopTour();
}
canvas.addEventListener('pointerdown', interruptTour);
canvas.addEventListener('wheel', interruptTour, { passive: true });

/* ---------- 黄昏 ---------- */
const lightBtn = document.getElementById('btn-light');
function applyDusk(on) {
  duskMode = on;
  if (on) {
    skyUniforms.topColor.value.set('#3d4c66');
    skyUniforms.botColor.value.set('#cb8f66');
    skyUniforms.expo.value = 0.78;
    hemi.color.set('#909db6'); hemi.groundColor.set('#6f6653'); hemi.intensity = 0.98;
    sun.color.set('#ffb277'); sun.intensity = 1.3; sun.position.set(280, 120, 230);
    fill.color.set('#8298bb'); fill.intensity = 0.46;
    scene.fog.color.set('#c28c6d');
    renderer.toneMappingExposure = 1.15;
    document.body.style.background = '#cb8f66';
    renderer.setClearColor(0xcb8f66, 1);
  } else {
    skyUniforms.topColor.value.set('#5f96c4');
    skyUniforms.botColor.value.set('#e2edf3');
    skyUniforms.expo.value = 0.6;
    hemi.color.set('#dbe9f4'); hemi.groundColor.set('#8b9179'); hemi.intensity = 1.02;
    sun.color.set('#fff2de'); sun.intensity = 2.75; sun.position.set(230, 330, 210);
    fill.color.set('#c2d8ea'); fill.intensity = 0.5;
    scene.fog.color.set('#c9dce8');
    renderer.toneMappingExposure = 0.98;
    document.body.style.background = '#c9dce8';
    renderer.setClearColor(0xcfe0ec, 1);
  }
  windowMats.forEach(m => { m.emissiveIntensity = on ? 1.0 : 0; });
  if (window.__lampHeads) window.__lampHeads.material.emissiveIntensity = on ? 2.4 : 0;
  if (selected) selectBuilding(selected);
  else highlightArea();
  lightBtn.textContent = on ? '日景' : '黄昏';
}
lightBtn.onclick = () => applyDusk(!duskMode);

document.getElementById('btn-reset').onclick = () => {
  stopTour();
  deselect();
  areaFilter = 'all'; renderAreas(); highlightArea();
  flyTo(CAMPUS.viewpoints[0].pos, CAMPUS.viewpoints[0].target, 1200);
};

document.getElementById('btn-sidebar').onclick = () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
};

document.getElementById('btn-disclaimer').onclick = () => {
  document.getElementById('disclaimer').classList.add('hide');
};

/* ---------- 操作说明 ---------- */
const helpEl = document.getElementById('help');
const hintEl = document.getElementById('hint');

function openHelp() {
  helpEl.hidden = false;
  hintEl.classList.add('hide');
  interruptTour();
  // 面板是模态的：打开时把焦点移进来，键盘用户不用再 Tab 半天
  document.getElementById('btn-help-close').focus();
}
function closeHelp() {
  helpEl.hidden = true;
  hintEl.classList.remove('hide');
}
function toggleHelp() { helpEl.hidden ? openHelp() : closeHelp(); }

document.getElementById('btn-help').onclick = openHelp;
document.getElementById('hint-help').onclick = openHelp;
document.getElementById('btn-help-close').onclick = closeHelp;
document.getElementById('btn-help-ok').onclick = closeHelp;
// 点面板外的灰色遮罩也关掉，但点卡片里面不关
helpEl.addEventListener('pointerdown', (e) => { if (e.target === helpEl) closeHelp(); });

addEventListener('keydown', (e) => {
  // 在输入框里按快捷键不该触发这些（虽然现在没有输入框，留着以后加搜索用）
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();

  if (k === 'escape') {
    if (!helpEl.hidden) { closeHelp(); return; }
    deselect();
    stopTour();
    return;
  }
  // 打开说明时，其它快捷键一律不响应，免得边看说明边把镜头飞走
  if (!helpEl.hidden && k !== 'h') return;

  if (k === 'h') { toggleHelp(); return; }
  if (k === 't') { tourTimer ? stopTour() : startTour(); return; }
  if (k === 'd') { applyDusk(!duskMode); return; }
  if (k === 'r') { document.getElementById('btn-reset').click(); return; }
  if (k === 'l') { setRoute(!routeOn); return; }

  // 1–8 对应底部八个视角（含最后的"游览路线"）
  if (/^[1-8]$/.test(k)) {
    const list = CAMPUS.viewpoints.filter(v => v.id !== 'overview-tall');
    const v = list[Number(k) - 1];
    if (!v) return;
    stopTour(); markVp(v.id);
    flyTo(v.pos, v.target, 1300);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* =========================================================
   10. 启动
   ========================================================= */
// 手机上侧栏默认收起，避免遮挡画面
if (innerWidth < 820) document.getElementById('sidebar').classList.add('collapsed');

makeLabels();
makeRouteLabels();
makeRouteLabels && renderRoute();
renderAreas();
renderViewpoints();
animate();

// loader 等"真的画出了两帧"再收；慢机器上固定延时会让遮罩糊在半空
(function hideLoaderWhenDrawn() {
  const el = document.getElementById('loader');
  const t0 = performance.now();
  const tick = () => {
    if (renderer.info.render.frame >= 2 || performance.now() - t0 > 3000) {
      el.classList.add('hide');
      setTimeout(() => { el.style.display = 'none'; }, 600);
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
})();

window.__campus = {
  scene, camera, controls, flyTo, selectBuilding, CAMPUS, BUILDINGS, SITE,
  routeGroup, LOTS, DRIVES, WALK, STOPS, setRoute, flyToStop,
};
