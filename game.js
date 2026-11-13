import * as THREE from 'three';
import { profile, saveProfile, user, onlineEnabled, SKINS, UPGRADES, levelMult } from './profile.js';
import { initMeta, isMetaOpen, openAuthFromGame } from './meta.js';

// ================== CONSTANTS ==================
const LANE_W = 2.6;
const LANES = [-LANE_W, 0, LANE_W];
const TRACK_HALF = LANE_W * 1.5 + 0.6;
const SPAWN_Z = -170;
const DESPAWN_Z = 20;
const GRAVITY = 40;
const JUMP_V = 13;
const SUPER_JUMP_V = 18.5;
const TRAIN_H = 3.3;
const TRAIN_W = 2.3;
const PLAYER_H = 1.9;
const ROLL_H = 0.8;
const PLAYER_HALF_W = 0.42;
const PLAYER_HALF_D = 0.4;
const JET_Y = 7.5;
const BASE_SPEED = 18;
const MAX_SPEED = 46;

const POWERS = {
  magnet: { icon: '🧲', name: 'Магнит', desc: 'тянет монеты', dur: 10, color: '#ff4d6d' },
  jet:    { icon: '🚀', name: 'Джетпак', desc: 'полёт над поездами', dur: 7, color: '#ff9f1c' },
  boots:  { icon: '👟', name: 'Пружинки', desc: 'прыжок на крыши', dur: 10, color: '#3ddc84' },
  x2:     { icon: 'x2', name: 'Очки x2', desc: 'двойные очки', dur: 12, color: '#ffd84a' },
  slow:   { icon: '⏳', name: 'Слоу-мо', desc: 'замедляет время', dur: 6, color: '#b07cff' },
  shield: { icon: '🛡️', name: 'Щит', desc: 'спасает от удара', dur: 25, color: '#4db5ff' },
  mystery:{ icon: '🎁', name: 'Сюрприз', desc: 'случайный приз', color: '#ff66cc' },
};
const TIMED = ['magnet', 'jet', 'boots', 'x2', 'slow', 'shield'];

// ================== UTILS ==================
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function weighted(entries) {
  let s = 0;
  for (const [, w] of entries) s += Math.max(0, w);
  let r = Math.random() * s;
  for (const [k, w] of entries) { r -= Math.max(0, w); if (r <= 0) return k; }
  return entries[0][0];
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const $ = (id) => document.getElementById(id);

// ================== AUDIO ==================
let actx = null;
let soundOn = store.get('rr_sound', true);
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(freq, dur, type = 'square', vol = 0.06, slideTo = 0, delay = 0) {
  if (!soundOn || !actx) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.2) {
  if (!soundOn || !actx) return;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource();
  const g = actx.createGain();
  g.gain.value = vol;
  src.buffer = buf; src.connect(g).connect(actx.destination); src.start();
}
const sfx = {
  coin() { tone(1320, 0.07, 'square', 0.035); tone(1760, 0.09, 'square', 0.035, 0, 0.05); },
  jump() { tone(320, 0.18, 'triangle', 0.08, 640); },
  roll() { tone(220, 0.15, 'sawtooth', 0.04, 110); },
  lane() { tone(500, 0.05, 'triangle', 0.03, 380); },
  power() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'square', 0.045, 0, i * 0.06)); },
  bump() { tone(140, 0.2, 'sawtooth', 0.08, 70); noise(0.12, 0.12); },
  crash() { noise(0.5, 0.35); tone(200, 0.5, 'sawtooth', 0.1, 40); },
  shield() { tone(900, 0.3, 'sine', 0.08, 200); noise(0.15, 0.15); },
};

// ================== RENDERER / SCENE ==================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_COLOR = 0xbfe4ff;
scene.fog = new THREE.Fog(FOG_COLOR, 55, 165);

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  return t;
}

scene.background = canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2f7fd6');
  gr.addColorStop(0.45, '#8ccfff');
  gr.addColorStop(0.62, '#bfe4ff');
  gr.addColorStop(1, '#ffe7c4');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, false);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 320);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(6, 12, 8);
scene.add(sun);

// ================== TEXTURES ==================
const trackTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#7d7268'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = randi(80, 150);
    g.fillStyle = `rgb(${v},${v - 8},${v - 16})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.fillStyle = '#5d3f27'; g.fillRect(16, 44, 96, 40);
  g.fillStyle = '#6f4d31'; g.fillRect(16, 44, 96, 8);
  g.fillStyle = '#4a311e'; g.fillRect(16, 78, 96, 6);
});
trackTex.repeat.set(3, 200);

const groundTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#c9bfae'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    const v = randi(170, 215);
    g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
    g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  }
  g.strokeStyle = 'rgba(90,80,70,.35)'; g.lineWidth = 2;
  g.strokeRect(0, 0, w, h);
});
groundTex.repeat.set(30, 100);

const windowTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5b6b85'; g.fillRect(12, 12, 40, 34);
  g.fillStyle = '#8fa6c9'; g.fillRect(12, 12, 40, 10);
  g.fillStyle = '#d9d9d9'; g.fillRect(8, 48, 48, 4);
});

const stripeTex = canvasTex(64, 16, (g, w, h) => {
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#e63946';
    g.beginPath();
    g.moveTo(i * 8 - 8, h); g.lineTo(i * 8 + 8, 0); g.lineTo(i * 8 + 16, 0); g.lineTo(i * 8, h);
    g.fill();
  }
  g.fillStyle = '#e63946';
  g.fillRect(0, 0, w, h); // base
  for (let i = -2; i < 10; i++) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(i * 12, h); g.lineTo(i * 12 + 6, h); g.lineTo(i * 12 + 22, 0); g.lineTo(i * 12 + 16, 0);
    g.fill();
  }
});

function emojiTex(text, color) {
  return canvasTex(128, 128, (g, w, h) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (text === 'x2') {
      g.font = '900 72px system-ui, sans-serif';
      g.lineWidth = 10; g.strokeStyle = '#7a4b00'; g.strokeText('x2', w / 2, h / 2 + 4);
      g.fillStyle = color; g.fillText('x2', w / 2, h / 2 + 4);
    } else {
      g.font = '88px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.fillText(text, w / 2, h / 2 + 6);
    }
  }, false);
}

// ================== SHARED GEOMETRY / MATERIALS ==================
const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function lambert(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return matCache.get(key);
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  return m;
}

// ================== STATIC WORLD ==================
const TRACK_LEN = 400;
const track = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 3, TRACK_LEN), new THREE.MeshLambertMaterial({ map: trackTex }));
track.rotation.x = -Math.PI / 2; track.position.set(0, 0.01, -150);
scene.add(track);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, TRACK_LEN), new THREE.MeshLambertMaterial({ map: groundTex }));
ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -150);
scene.add(ground);
const railMat = new THREE.MeshPhongMaterial({ color: 0xb8c0cc, shininess: 90, specular: 0xffffff });
for (const lx of LANES) {
  for (const s of [-0.72, 0.72]) scene.add(box(0.12, 0.14, TRACK_LEN, railMat, lx + s, 0.08, -150));
}
for (const s of [-1, 1]) {
  scene.add(box(0.5, 1.1, TRACK_LEN, lambert(0x9aa3ad), s * (TRACK_HALF + 0.25), 0.55, -150));
  scene.add(box(0.6, 0.12, TRACK_LEN, lambert(0xd1d6dc), s * (TRACK_HALF + 0.25), 1.16, -150));
}

// --- recycling scenery chains ---
const chains = [];
function makeChain(count, build, gap, recycle) {
  const ch = { items: [], cursor: 15, gap, recycle };
  for (let i = 0; i < count; i++) {
    const obj = build();
    scene.add(obj);
    const it = { obj, half: 0.5 };
    recycle(it);
    const g = typeof gap === 'function' ? gap() : gap;
    obj.position.z = ch.cursor - g - it.half;
    ch.cursor = obj.position.z - it.half;
    ch.items.push(it);
  }
  chains.push(ch);
  return ch;
}
function updateChains(dz) {
  for (const ch of chains) {
    ch.cursor += dz;
    for (const it of ch.items) {
      it.obj.position.z += dz;
      if (it.obj.position.z - it.half > DESPAWN_Z) {
        ch.recycle(it);
        const g = typeof ch.gap === 'function' ? ch.gap() : ch.gap;
        it.obj.position.z = ch.cursor - g - it.half;
        ch.cursor = it.obj.position.z - it.half;
      }
    }
  }
}
const BUILDING_COLORS = [0xf4a261, 0xe76f51, 0x8ecae6, 0xa8dadc, 0xffd6a5, 0xcdb4db, 0xb5e48c, 0xf7b7a3, 0x90be6d, 0xffafcc];
for (const side of [-1, 1]) {
  makeChain(14, () => {
    const g = new THREE.Group();
    const tex = windowTex.clone(); tex.needsUpdate = true;
    const body = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ map: tex }));
    const roof = new THREE.Mesh(BOX, lambert(0x6b7280));
    g.add(body, roof);
    g.userData = { body, roof, tex };
    return g;
  }, () => rand(1, 4), (it) => {
    const { body, roof, tex } = it.obj.userData;
    const w = rand(5, 9), h = rand(7, 24), d = rand(7, 13);
    body.scale.set(w, h, d); body.position.y = h / 2;
    roof.scale.set(w + 0.4, 0.5, d + 0.4); roof.position.y = h + 0.25;
    body.material.color.setHex(pick(BUILDING_COLORS));
    tex.repeat.set(Math.max(1, Math.round(d / 2.5)), Math.max(1, Math.round(h / 2.5)));
    it.obj.position.x = side * (TRACK_HALF + 3.5 + w / 2 + rand(0, 3));
    it.half = d / 2;
  });
  // lamp posts
  makeChain(10, () => {
    const g = new THREE.Group();
    g.add(box(0.15, 5, 0.15, lambert(0x444c56), 0, 2.5, 0));
    g.add(box(1.0, 0.12, 0.15, lambert(0x444c56), -side * 0.45, 5, 0));
    g.add(box(0.4, 0.15, 0.3, lambert(0xfff3c4, { emissive: 0xffe08a }), -side * 0.85, 4.92, 0));
    g.position.x = side * (TRACK_HALF + 1.4);
    return g;
  }, 18, (it) => { it.half = 0.1; });
}
// overhead gantries
makeChain(4, () => {
  const g = new THREE.Group();
  const m = lambert(0x5c677d);
  g.add(box(0.3, 11, 0.3, m, -(TRACK_HALF + 0.9), 5.5, 0));
  g.add(box(0.3, 11, 0.3, m, TRACK_HALF + 0.9, 5.5, 0));
  g.add(box(TRACK_HALF * 2 + 2.2, 0.35, 0.35, m, 0, 11, 0));
  return g;
}, 46, (it) => { it.half = 0.2; });

// ================== PLAYER ==================
const player = new THREE.Group();
const body = new THREE.Group();
body.position.y = 0.95;
player.add(body);
const skin = new THREE.MeshLambertMaterial(), shirt = new THREE.MeshLambertMaterial(), pants = new THREE.MeshLambertMaterial();
const shoeMat = new THREE.MeshLambertMaterial();
const capMat = new THREE.MeshLambertMaterial();
const packMat = new THREE.MeshLambertMaterial();
let skinShoes = 0xffffff;
function applySkin() {
  const s = SKINS.find((x) => x.id === profile.skin) || SKINS[0];
  skin.color.setHex(s.c.skin); shirt.color.setHex(s.c.shirt); pants.color.setHex(s.c.pants);
  capMat.color.setHex(s.c.cap); packMat.color.setHex(s.c.pack);
  skinShoes = s.c.shoes;
  if (!(power.boots > 0)) shoeMat.color.setHex(skinShoes);
  const glow = s.glow || 0x000000;
  shirt.emissive.setHex(glow); capMat.emissive.setHex(glow); packMat.emissive.setHex(glow);
}
body.add(box(0.72, 0.78, 0.42, shirt, 0, 0.27, 0));
body.add(box(0.5, 0.5, 0.48, skin, 0, 0.92, 0));
body.add(box(0.55, 0.16, 0.54, capMat, 0, 1.2, 0));
body.add(box(0.48, 0.05, 0.28, capMat, 0, 1.13, -0.36));
body.add(box(0.5, 0.55, 0.22, packMat, 0, 0.3, 0.3)); // backpack
function limb(x, y, w, h, mat, footMat) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(w, h, w, mat, 0, -h / 2, 0));
  if (footMat) pivot.add(box(w + 0.04, 0.14, w + 0.18, footMat, 0, -h + 0.02, -0.06));
  body.add(pivot);
  return pivot;
}
const armL = limb(-0.47, 0.6, 0.2, 0.62, shirt);
const armR = limb(0.47, 0.6, 0.2, 0.62, shirt);
armL.children[0].material = skin; // bare arms look nicer
armR.children[0].material = skin;
const legL = limb(-0.18, -0.12, 0.26, 0.78, pants, shoeMat);
const legR = limb(0.18, -0.12, 0.26, 0.78, pants, shoeMat);

const jetpack = new THREE.Group();
jetpack.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 10), lambert(0xd0d4dc)));
jetpack.children[0].position.set(-0.18, 0.3, 0.48);
jetpack.add(jetpack.children[0].clone()); jetpack.children[1].position.x = 0.18;
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0.9 });
for (const x of [-0.18, 0.18]) {
  const f = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 8), flameMat);
  f.rotation.x = Math.PI; f.position.set(x, -0.35, 0.48);
  jetpack.add(f);
}
jetpack.visible = false;
body.add(jetpack);

const shieldBubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.25, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x4db5ff, transparent: true, opacity: 0.3, depthWrite: false })
);
shieldBubble.position.y = 0.95;
shieldBubble.visible = false;
player.add(shieldBubble);
scene.add(player);

const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

// ================== GAME STATE ==================
let state = 'menu'; // menu | playing | paused | dying | over
let speed = BASE_SPEED, runTime = 0, travelled = 0, nextRowAt = 0;
let score = 0, coinCount = 0, revivesUsed = 0, reviveT = 0;
let lane = 1, targetLane = 1, prevLane = 1, px = 0, py = 0, vy = 0, grounded = true;
let rolling = 0, queueRoll = false, jumpBuffer = 0, invuln = 0, lastStumble = -99, sideCooldown = 0;
let animTime = 0, runPhase = 0, dieT = 0, shake = 0, camX = 0, camY = 0;
let jetLane = 1, nextJetCoinAt = 0;
const power = {};
const powerMax = {};
const laneFree = [0, 0, 0];
const laneBlock = [0, 0, 0];
const obstacles = [];
const coins = [];
const pickups = [];

// ================== OBSTACLE BUILDERS ==================
const TRAIN_COLORS = [0x2a9d8f, 0xe63946, 0x3a86ff, 0xf4a261, 0x8338ec, 0x06a77d];
const winMat = lambert(0x1e2a3a);
const darkMat = lambert(0x2b2d31);
const whiteMat = lambert(0xf1f1f1);
const headOn = lambert(0xfff6c2, { emissive: 0xfff0a0 });
const headRed = lambert(0xffd166, { emissive: 0xffb703 });
const rampMat = lambert(0x6c757d);
const rampStripe = lambert(0xffd60a);

function rampGeometry(len) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(len, 0); s.lineTo(0, TRAIN_H); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: TRAIN_W, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(TRAIN_W / 2, 0, 0);
  return g;
}
const rampGeoCache = {};

function buildTrain(len, ramp, moving) {
  const g = new THREE.Group();
  const col = lambert(pick(TRAIN_COLORS));
  const H = TRAIN_H;
  g.add(box(TRAIN_W - 0.3, 0.45, len - 0.6, darkMat, 0, 0.25, 0));
  g.add(box(TRAIN_W, H - 0.45, len, col, 0, 0.45 + (H - 0.45) / 2, 0));
  g.add(box(TRAIN_W - 0.2, 0.12, len - 0.2, lambert(0xdfe3e8), 0, H + 0.04, 0));
  for (const s of [-1, 1]) {
    g.add(box(0.04, 0.7, len - 1.2, winMat, s * (TRAIN_W / 2 + 0.01), 2.25, 0));
    g.add(box(0.04, 0.18, len - 0.4, whiteMat, s * (TRAIN_W / 2 + 0.01), 1.35, 0));
  }
  // front face (towards player = +z)
  const fz = len / 2 + 0.02;
  g.add(box(TRAIN_W - 0.5, 0.9, 0.04, winMat, 0, 2.3, fz));
  g.add(box(TRAIN_W - 0.3, 0.18, 0.04, whiteMat, 0, 1.35, fz));
  for (const s of [-1, 1]) g.add(box(0.35, 0.22, 0.06, moving ? headRed : headOn, s * 0.7, 0.9, fz));
  if (ramp) {
    if (!rampGeoCache[ramp]) rampGeoCache[ramp] = rampGeometry(ramp);
    const r = new THREE.Mesh(rampGeoCache[ramp], rampMat);
    r.position.z = len / 2;
    g.add(r);
    const ang = Math.atan2(TRAIN_H, ramp);
    const hyp = Math.hypot(TRAIN_H, ramp);
    for (const s of [-1, 1]) {
      const st = box(0.18, 0.04, hyp, rampStripe, s * (TRAIN_W / 2 - 0.2), 0, 0);
      st.rotation.x = ang;
      st.position.set(s * (TRAIN_W / 2 - 0.2), TRAIN_H / 2 + 0.03, len / 2 + ramp / 2);
      g.add(st);
    }
  }
  return g;
}
const barrierStripeMat = new THREE.MeshLambertMaterial({ map: stripeTex });
function buildLow() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.14, 1.0, 0.14, lambert(0x555b66), s * 1.0, 0.5, 0));
  g.add(box(TRAIN_W, 0.42, 0.14, barrierStripeMat, 0, 0.75, 0));
  g.add(box(TRAIN_W - 0.2, 0.08, 0.1, lambert(0x555b66), 0, 0.35, 0));
  return g;
}
function buildHigh() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.16, 2.7, 0.16, lambert(0x555b66), s * 1.08, 1.35, 0));
  g.add(box(TRAIN_W + 0.1, 0.9, 0.16, barrierStripeMat, 0, 1.65, 0));
  g.add(box(TRAIN_W + 0.1, 0.12, 0.2, lambert(0x333840), 0, 2.15, 0));
  const lamp = box(0.22, 0.22, 0.22, lambert(0xff3b30, { emissive: 0xff2010 }), 0, 2.35, 0);
  g.add(lamp);
  return g;
}

function addObstacle(kind, ln, opts = {}) {
  let mesh, len, yb, yt;
  const ramp = opts.ramp || 0;
  if (kind === 'train') {
    len = opts.len; mesh = buildTrain(len, ramp, !!opts.extra); yb = 0; yt = TRAIN_H;
  } else if (kind === 'low') {
    len = 0.4; mesh = buildLow(); yb = 0; yt = 1.05;
  } else {
    len = 0.4; mesh = buildHigh(); yb = 1.15; yt = 2.6;
  }
  const z = SPAWN_Z - len / 2;
  mesh.position.set(LANES[ln], 0, z);
  scene.add(mesh);
  const o = { kind, lane: ln, z, prevZ: z, len, ramp, extra: opts.extra || 0, mesh, yb, yt };
  obstacles.push(o);
  // clear coins that would be inside it
  const zMin = z - len / 2 - 1, zMax = z + len / 2 + ramp + 1;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.lane === ln && c.z > zMin && c.z < zMax && c.y < TRAIN_H) removeCoin(i);
  }
  return o;
}

// ================== COINS & PICKUPS ==================
const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshPhongMaterial({ color: 0xffc928, emissive: 0x6b4400, shininess: 100, specular: 0xffffcc });
function addCoin(ln, z, y) {
  const m = new THREE.Mesh(coinGeo, coinMat);
  m.position.set(LANES[ln], y, z);
  scene.add(m);
  coins.push({ mesh: m, lane: ln, x: LANES[ln], y, z, mag: false });
}
function removeCoin(i) { scene.remove(coins[i].mesh); coins.splice(i, 1); }

const pickupTex = {};
const ringGeo = new THREE.TorusGeometry(0.7, 0.08, 8, 28);
function addPickup(type, ln, z, y = 1.3) {
  if (!pickupTex[type]) pickupTex[type] = emojiTex(POWERS[type].icon, POWERS[type].color);
  const g = new THREE.Group();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pickupTex[type], fog: true }));
  sp.scale.set(1.15, 1.15, 1);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: POWERS[type].color }));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.66, 24), new THREE.MeshBasicMaterial({ color: POWERS[type].color, transparent: true, opacity: 0.3, depthWrite: false }));
  g.add(glow, ring, sp);
  g.userData.ring = ring;
  g.position.set(LANES[ln], y, z);
  scene.add(g);
  pickups.push({ mesh: g, type, lane: ln, y, z });
}

// ================== SPAWNING ==================
function difficulty() { return clamp((speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED), 0, 1); }

function canBlock(ln, blocked) {
  if (blocked.has(ln)) return false;
  const next = new Set(blocked); next.add(ln);
  if (next.size >= 3) return false;
  // middle blocked + an edge blocked can trap the player on that edge
  if (blocked.has(1) && ln !== 1) return false;
  return true;
}

function spawnRow() {
  const t = travelled;
  const d = difficulty();
  const blocked = new Set([0, 1, 2].filter((l) => laneBlock[l] > t));
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  const maxObs = d < 0.25 ? 2 : 3;
  let placed = 0;
  const kinds = [null, null, null];

  for (const ln of lanes) {
    if (laneFree[ln] > t) { kinds[ln] = 'busy'; continue; }
    if (placed >= maxObs) { kinds[ln] = 'empty'; continue; }
    let k = weighted([
      ['empty', 0.34 - 0.12 * d],
      ['low', 0.15],
      ['high', 0.14],
      ['train', 0.2 + 0.05 * d],
      ['ramp', 0.12],
      ['moving', 0.02 + 0.1 * d],
    ]);
    if ((k === 'train' || k === 'moving') && !canBlock(ln, blocked)) k = Math.random() < 0.5 ? 'ramp' : 'empty';
    if (k === 'moving') {
      const conflict = obstacles.some((o) => o.lane === ln && o.z - o.len / 2 < -95);
      if (conflict) k = 'empty';
    }
    kinds[ln] = k;
    if (k === 'empty') continue;
    placed++;
    if (k === 'low') { addObstacle('low', ln); laneFree[ln] = t + 6; }
    else if (k === 'high') { addObstacle('high', ln); laneFree[ln] = t + 6; }
    else if (k === 'train') {
      const len = pick([12, 16, 20, 24]);
      addObstacle('train', ln, { len });
      laneFree[ln] = t + len + 8; laneBlock[ln] = t + len + 10; blocked.add(ln);
    } else if (k === 'ramp') {
      const len = pick([16, 20, 28, 36]);
      addObstacle('train', ln, { len, ramp: 6 });
      laneFree[ln] = t + len + 8; laneBlock[ln] = t + len + 10; blocked.add(ln);
      // coins up the ramp and along the roof
      if (!power.jet && Math.random() < 0.75) {
        const zMax = SPAWN_Z;
        for (let zz = zMax + 5; zz > zMax - len + 1; zz -= 2.2) {
          const h = zz > zMax ? TRAIN_H * (1 - (zz - zMax) / 6) : TRAIN_H;
          addCoin(ln, zz, h + 0.8);
        }
      }
    } else if (k === 'moving') {
      const len = pick([12, 16]);
      addObstacle('train', ln, { len, extra: rand(10, 14) });
      laneFree[ln] = t + len + 45; laneBlock[ln] = t + len + 30; blocked.add(ln);
      for (let i = coins.length - 1; i >= 0; i--) if (coins[i].lane === ln && coins[i].z < -40) removeCoin(i);
    }
  }

  if (power.jet) return; // sky coins handled separately

  // coins
  const free = [0, 1, 2].filter((l) => kinds[l] === 'empty');
  const lowLanes = [0, 1, 2].filter((l) => kinds[l] === 'low');
  const highLanes = [0, 1, 2].filter((l) => kinds[l] === 'high');
  if (lowLanes.length && Math.random() < 0.5) {
    const ln = pick(lowLanes);
    for (let i = -3; i <= 3; i++) addCoin(ln, SPAWN_Z + i * 1.4, 0.8 + 1.4 * Math.cos((i / 3) * (Math.PI / 2)));
  } else if (highLanes.length && Math.random() < 0.4) {
    const ln = pick(highLanes);
    for (let i = -2; i <= 2; i++) addCoin(ln, SPAWN_Z + i * 1.6, 0.5);
  } else if (free.length && Math.random() < 0.6) {
    const ln = pick(free);
    const n = randi(5, 9);
    for (let i = 0; i < n; i++) addCoin(ln, SPAWN_Z - i * 2.3, 0.8);
  }

  // power-ups
  if (free.length && Math.random() < 0.1) {
    const ln = pick(free);
    const type = weighted([['magnet', 1.2], ['jet', 0.8], ['boots', 1], ['x2', 1], ['slow', 0.7], ['shield', 0.9], ['mystery', 0.8]]);
    addPickup(type, ln, SPAWN_Z - 2);
  }
}

function spawnJetCoins() {
  while (travelled >= nextJetCoinAt) {
    nextJetCoinAt += 2.6;
    if (power.jet * speed < 180) continue; // stop before jetpack ends
    if (Math.random() < 0.06) jetLane = clamp(jetLane + pick([-1, 1]), 0, 2);
    addCoin(jetLane, SPAWN_Z, JET_Y + 1);
  }
}

// ================== POWER-UPS ==================
function activate(type) {
  sfx.power();
  if (type === 'mystery') {
    if (Math.random() < 0.4) {
      const n = randi(30, 120);
      coinCount += n; score += n * 10;
      toast(`+${n} монет!`, '#ffd84a');
      return;
    }
    type = pick(TIMED);
  }
  const P = POWERS[type];
  power[type] = powerDur(type);
  powerMax[type] = power[type];
  toast(`${P.icon} ${P.name.toUpperCase()}!`, P.color);
  if (type === 'jet') {
    grounded = false; vy = 0; rolling = 0; queueRoll = false;
    jetLane = targetLane; nextJetCoinAt = travelled + 8;
    for (let i = pickups.length - 1; i >= 0; i--) { scene.remove(pickups[i].mesh); pickups.splice(i, 1); }
  }
  if (type === 'boots') shoeMat.color.setHex(0x3ddc84);
  renderPowerHud(true);
}
function powerDur(type) {
  const lvl = (profile.upgrades && profile.upgrades[type]) || 0;
  return (UPGRADES[type] ? UPGRADES[type].base : POWERS[type].dur) * levelMult(lvl);
}
function tickPowers(dt) {
  for (const k of TIMED) {
    if (power[k] > 0) {
      power[k] -= dt;
      if (power[k] <= 0) {
        power[k] = 0;
        if (k === 'jet') { grounded = false; vy = 0; invuln = Math.max(invuln, 2); }
        if (k === 'boots') shoeMat.color.setHex(skinShoes);
        renderPowerHud(true);
      }
    }
  }
}

// ================== PHYSICS HELPERS ==================
function groundAt(x) {
  let g = 0;
  for (const o of obstacles) {
    if (o.kind !== 'train') continue;
    if (Math.abs(x - LANES[o.lane]) > TRAIN_W / 2 + 0.15) continue;
    const zMin = o.z - o.len / 2, zMax = o.z + o.len / 2;
    if (zMin <= 0 && zMax >= 0) g = Math.max(g, TRAIN_H);
    else if (o.ramp && zMax < 0 && zMax + o.ramp > 0) g = Math.max(g, TRAIN_H * (zMax + o.ramp) / o.ramp);
  }
  return g;
}

function overlapX(x, o) { return Math.abs(x - LANES[o.lane]) < TRAIN_W / 2 + PLAYER_HALF_W - 0.2; }
function overlapZ(z, o) { return z - o.len / 2 < PLAYER_HALF_D && z + o.len / 2 > -PLAYER_HALF_D; }

function checkCollisions(prevPx) {
  if (power.jet > 0) return;
  const ph = rolling > 0 ? ROLL_H : PLAYER_H;
  for (const o of obstacles) {
    if (!overlapX(px, o) || !overlapZ(o.z, o)) continue;
    const top = o.kind === 'train' ? o.yt - 0.55 : o.yt;
    if (!(py < top && py + ph > o.yb)) continue;
    if (invuln > 0) continue;
    const wasX = overlapX(prevPx, o), wasZ = overlapZ(o.prevZ, o);
    if (wasZ && !wasX) { if (sideCooldown <= 0) sideBump(); }
    else { frontHit(o); return; }
  }
}

function sideBump() {
  sideCooldown = 0.35;
  targetLane = prevLane;
  shake = 0.25;
  sfx.bump();
  if (animTime - lastStumble < 3.5) {
    if (power.shield > 0) { power.shield = 0; invuln = 1.5; sfx.shield(); toast('🛡️ ЩИТ СПАС!', '#4db5ff'); renderPowerHud(true); }
    else { die(); return; }
  } else toast('Осторожно!', '#ffffff');
  lastStumble = animTime;
}

function frontHit() {
  if (power.shield > 0) {
    power.shield = 0; invuln = 1.6; shake = 0.4;
    sfx.shield(); toast('🛡️ ЩИТ СПАС!', '#4db5ff');
    renderPowerHud(true);
    return;
  }
  die();
}

function die() {
  state = 'dying'; dieT = 0; shake = 0.6;
  sfx.crash();
  $('hud').classList.add('hidden');
}

// ================== INPUT ==================
function act(a) {
  ensureAudio();
  if (state === 'menu' || state === 'over') { if (a === 'jump' || a === 'start') startGame(); return; }
  if (state === 'revive') { if (a === 'start') doRevive(); else if (a === 'pause') finishRun(); return; }
  if (state === 'paused') { if (a === 'pause' || a === 'start') resume(); return; }
  if (state !== 'playing') return;
  if (a === 'pause') { pauseGame(); return; }
  if (a === 'left' || a === 'right') {
    const nl = clamp(targetLane + (a === 'left' ? -1 : 1), 0, 2);
    if (nl !== targetLane) { prevLane = targetLane; targetLane = nl; sfx.lane(); }
    else { shake = 0.1; }
  } else if (a === 'jump') {
    if (power.jet > 0) return;
    if (grounded) doJump();
    else jumpBuffer = 0.18;
  } else if (a === 'roll') {
    if (power.jet > 0) return;
    if (grounded) { if (rolling <= 0) sfx.roll(); rolling = 0.65; }
    else { vy = Math.min(vy, -28); queueRoll = true; jumpBuffer = 0; }
  }
}
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump', KeyS: 'roll', ArrowDown: 'roll',
  KeyP: 'pause', Escape: 'pause', Enter: 'start',
};
window.addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (!a) return;
  if (isMetaOpen() || (e.target && e.target.tagName === 'INPUT')) return;
  e.preventDefault();
  if (e.repeat) return;
  act(a);
});

let touch = null;
window.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touch = { x: t.clientX, y: t.clientY, used: false };
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (state === 'playing') e.preventDefault();
  if (!touch || touch.used) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
  touch.used = true;
  if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
  else act(dy < 0 ? 'jump' : 'roll');
}, { passive: false });
window.addEventListener('touchend', () => { touch = null; }, { passive: true });

$('playBtn').addEventListener('click', () => { ensureAudio(); startGame(); });
$('againBtn').addEventListener('click', () => { ensureAudio(); startGame(); });
$('resumeBtn').addEventListener('click', resume);
$('pauseBtn').addEventListener('click', pauseGame);
$('menuBtn1').addEventListener('click', toMenu);
$('menuBtn2').addEventListener('click', toMenu);
$('reviveBtn').addEventListener('click', doRevive);
$('reviveSkip').addEventListener('click', finishRun);
$('guestHintBtn').addEventListener('click', openAuthFromGame);
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn; store.set('rr_sound', soundOn); ensureAudio(); updateSoundBtn();
});
function updateSoundBtn() { $('soundBtn').textContent = soundOn ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; }
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });

// ================== UI ==================
function toast(text, color = '#fff') {
  const el = $('toast');
  el.textContent = text; el.style.color = color;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
let hudKey = '';
function renderPowerHud(force) {
  const active = TIMED.filter((k) => power[k] > 0);
  const key = active.join(',');
  const box = $('powers');
  if (force || key !== hudKey) {
    hudKey = key;
    box.innerHTML = active.map((k) => `<div class="power" data-k="${k}"><span class="ic" style="color:${POWERS[k].color}">${POWERS[k].icon}</span><div class="bar" style="--c:${POWERS[k].color}"><i></i></div></div>`).join('');
  }
  for (const el of box.children) {
    const k = el.dataset.k;
    el.querySelector('i').style.width = `${clamp(power[k] / (powerMax[k] || POWERS[k].dur), 0, 1) * 100}%`;
  }
  $('mult').classList.toggle('hidden', !(power.x2 > 0));
}
let lastScoreTxt = '', lastCoinTxt = '';
function updateHud() {
  const s = String(Math.floor(score));
  if (s !== lastScoreTxt) { $('score').textContent = s; lastScoreTxt = s; }
  const c = String(coinCount);
  if (c !== lastCoinTxt) { $('coinsVal').textContent = c; lastCoinTxt = c; }
  renderPowerHud(false);
}
updateSoundBtn();
initMeta({ powers: POWERS, onSkin: applySkin });

// ================== FLOW ==================
function clearWorld() {
  for (const o of obstacles) scene.remove(o.mesh);
  for (const c of coins) scene.remove(c.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  obstacles.length = coins.length = pickups.length = 0;
}
function resetRun() {
  clearWorld();
  speed = BASE_SPEED; runTime = 0; travelled = 0; nextRowAt = 30;
  score = 0; coinCount = 0; revivesUsed = 0;
  lane = targetLane = prevLane = 1; px = 0; py = 0; vy = 0; grounded = true;
  rolling = 0; queueRoll = false; jumpBuffer = 0; invuln = 0; lastStumble = -99; sideCooldown = 0; dieT = 0;
  for (const k of TIMED) power[k] = 0;
  laneFree.fill(0); laneBlock.fill(0);
  applySkin();
  body.rotation.set(0, 0, 0); body.position.y = 0.95; body.scale.set(1, 1, 1);
  player.rotation.set(0, 0, 0); player.visible = true;
  renderPowerHud(true);
}
function startGame() {
  resetRun();
  state = 'playing';
  for (const id of ['menu', 'over', 'pause', 'reviveOv']) $(id).classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (profile.startShields > 0) {
    profile.startShields--; saveProfile();
    setTimeout(() => { if (state === 'playing') activate('shield'); }, 400);
  }
}
function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  $('pause').classList.remove('hidden');
}
function resume() {
  if (state !== 'paused') return;
  state = 'playing';
  $('pause').classList.add('hidden');
  last = performance.now();
}
function toMenu() {
  resetRun();
  state = 'menu';
  for (const id of ['over', 'pause', 'hud', 'reviveOv']) $(id).classList.add('hidden');
  $('menu').classList.remove('hidden');
}
const REVIVE_TIME = 5;
const MAX_REVIVES = 2;
function gameOver() {
  if (profile.revives > 0 && revivesUsed < MAX_REVIVES) {
    state = 'revive'; reviveT = REVIVE_TIME;
    $('reviveLeft').textContent = profile.revives;
    $('reviveOv').classList.remove('hidden');
    return;
  }
  finishRun();
}
function doRevive() {
  if (state !== 'revive' || profile.revives <= 0) return;
  profile.revives--; revivesUsed++; saveProfile();
  $('reviveOv').classList.add('hidden');
  // убираем всё, что рядом, и даём неуязвимость
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    if (o.z - o.len / 2 < 15 && o.z + o.len / 2 + o.ramp > -45) { scene.remove(o.mesh); obstacles.splice(i, 1); }
  }
  laneBlock.fill(0);
  py = 0; vy = 0; grounded = true; rolling = 0; queueRoll = false; jumpBuffer = 0;
  invuln = 2.5; lastStumble = -99; dieT = 0;
  state = 'playing';
  $('hud').classList.remove('hidden');
  toast('❤️ ПОЕХАЛИ!', '#ff4d6d');
  sfx.power();
}
function finishRun() {
  if (state !== 'revive' && state !== 'dying') return;
  state = 'over';
  $('reviveOv').classList.add('hidden');
  const fs = Math.floor(score);
  const isRecord = fs > profile.best;
  if (isRecord) profile.best = fs;
  profile.coins += coinCount;
  profile.games++;
  saveProfile();
  $('finalScore').textContent = fs;
  $('finalCoins').textContent = coinCount;
  $('finalBest').textContent = profile.best;
  $('newRecord').classList.toggle('hidden', !isRecord);
  $('guestHint').classList.toggle('hidden', !(onlineEnabled && !user));
  $('over').classList.remove('hidden');
}

// ================== UPDATE ==================
function updatePlayer(dt) {
  const prevPx = px;
  const tx = LANES[targetLane];
  px += (tx - px) * Math.min(1, dt * 16);
  if (Math.abs(tx - px) < 0.01) { px = tx; lane = targetLane; }

  if (rolling > 0) rolling -= dt;
  if (invuln > 0) invuln -= dt;
  if (sideCooldown > 0) sideCooldown -= dt;
  if (jumpBuffer > 0) jumpBuffer -= dt;

  const g = groundAt(px);
  if (power.jet > 0) {
    py += (JET_Y - py) * Math.min(1, dt * 3);
    vy = 0; grounded = false;
  } else {
    if (grounded) {
      if (g >= py - 0.05 && g - py < 1.0) py = g;
      else if (g < py - 0.05) { grounded = false; vy = 0; }
    }
    if (!grounded) {
      const prevPy = py;
      vy -= GRAVITY * dt;
      py += vy * dt;
      if (vy <= 0) {
        if (py <= g && prevPy >= g - 1.0) land(g);
        else if (py <= 0) land(0);
      }
    }
  }
  checkCollisions(prevPx);
}
function doJump() {
  vy = power.boots > 0 ? SUPER_JUMP_V : JUMP_V;
  grounded = false; rolling = 0; queueRoll = false; jumpBuffer = 0;
  sfx.jump();
}
function land(y) {
  py = y; vy = 0; grounded = true;
  if (jumpBuffer > 0) { doJump(); return; }
  if (queueRoll) { queueRoll = false; rolling = 0.6; sfx.roll(); }
}

function animatePlayer(dt) {
  player.position.set(px, py, 0);
  const runRate = state === 'menu' ? 9 : 7 + speed * 0.28;
  runPhase += dt * runRate;
  const s = Math.sin(runPhase);
  body.position.y = 0.95; body.scale.set(1, 1, 1);

  if (state === 'dying' || state === 'over' || state === 'revive') {
    const k = Math.min(1, dieT * 3);
    body.rotation.x = k * 1.35;
    body.position.y = 0.95 - k * 0.5;
    armL.rotation.x = armR.rotation.x = -2.6 * k;
    legL.rotation.x = -0.4 * k; legR.rotation.x = 0.4 * k;
    return;
  }
  if (rolling > 0) {
    body.rotation.x -= dt * 16;
    body.position.y = 0.5; body.scale.set(0.7, 0.62, 0.7);
    armL.rotation.x = armR.rotation.x = -1.2; legL.rotation.x = legR.rotation.x = -1.4;
  } else {
    body.rotation.x = 0;
    if (power.jet > 0) {
      legL.rotation.x = 0.25 + s * 0.1; legR.rotation.x = 0.1 - s * 0.1;
      armL.rotation.x = armR.rotation.x = -0.6;
    } else if (!grounded) {
      legL.rotation.x = -0.9; legR.rotation.x = 0.5;
      armL.rotation.x = -2.4; armR.rotation.x = -2.0;
    } else {
      legL.rotation.x = s * 0.95; legR.rotation.x = -s * 0.95;
      armL.rotation.x = -s * 0.85; armR.rotation.x = s * 0.85;
      body.position.y = 0.95 + Math.abs(Math.cos(runPhase)) * 0.06;
    }
  }
  player.rotation.z = (px - LANES[targetLane]) * 0.12;
  player.rotation.y = (LANES[targetLane] - px) * -0.1;

  jetpack.visible = power.jet > 0;
  if (jetpack.visible) {
    flameMat.opacity = 0.6 + Math.random() * 0.4;
    jetpack.children[2].scale.y = jetpack.children[3].scale.y = 0.8 + Math.random() * 0.6;
  }
  shieldBubble.visible = power.shield > 0;
  if (shieldBubble.visible) shieldBubble.material.opacity = 0.28 + Math.sin(animTime * 6) * 0.08;
  player.visible = invuln > 0 ? Math.floor(animTime * 14) % 2 === 0 : true;

  const g = groundAt(px);
  blob.position.set(px, g + 0.03, 0);
  const sc = 1 / (1 + Math.max(0, py - g) * 0.25);
  blob.scale.set(sc, sc, sc);
}

function moveWorld(dz, wdt) {
  trackTex.offset.y += dz / 2;
  groundTex.offset.y += dz / 4;
  updateChains(dz);
  const movingAllowed = state === 'playing' ? 1 : 0;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.prevZ = o.z;
    o.z += dz + o.extra * wdt * movingAllowed;
    o.mesh.position.z = o.z;
    if (o.z - o.len / 2 > DESPAWN_Z) { scene.remove(o.mesh); obstacles.splice(i, 1); }
  }
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.z += dz;
    p.mesh.position.z = p.z;
    p.mesh.position.y = p.y + Math.sin(animTime * 4 + p.z) * 0.15;
    p.mesh.userData.ring.rotation.y += wdt * 3;
    if (p.z > DESPAWN_Z) { scene.remove(p.mesh); pickups.splice(i, 1); }
  }
}

function updateCoins(dz, dt) {
  const ph = rolling > 0 ? ROLL_H : PLAYER_H;
  const cy = py + ph / 2;
  const magnet = power.magnet > 0;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (c.mag) {
      const k = Math.min(1, dt * 14);
      c.x += (px - c.x) * k; c.y += (cy - c.y) * k; c.z += (0 - c.z) * k;
    } else {
      c.z += dz;
      if (magnet && state === 'playing' && c.z > -28 && c.z < 1.5) c.mag = true;
    }
    c.mesh.position.set(c.x, c.y, c.z);
    c.mesh.rotation.y += dt * 5;
    if (state === 'playing') {
      const hit = c.mag
        ? Math.hypot(c.x - px, c.y - cy, c.z) < 0.9
        : Math.abs(c.x - px) < 0.9 && Math.abs(c.z) < 0.85 && Math.abs(c.y - cy) < 1.3;
      if (hit) {
        coinCount++;
        score += 10 * (power.x2 > 0 ? 2 : 1);
        sfx.coin();
        removeCoin(i);
        continue;
      }
    }
    if (c.z > 10) removeCoin(i);
  }
}

function updatePickups() {
  if (state !== 'playing') return;
  const ph = rolling > 0 ? ROLL_H : PLAYER_H;
  const cy = py + ph / 2;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (Math.abs(LANES[p.lane] - px) < 1.0 && Math.abs(p.z) < 1.0 && Math.abs(p.y - cy) < 1.5) {
      scene.remove(p.mesh); pickups.splice(i, 1);
      activate(p.type);
    }
  }
}

function update(dt) {
  if (state === 'paused') return;
  animTime += dt;
  const ts = power.slow > 0 ? 0.55 : 1;
  const wdt = dt * ts;
  let curSpeed;
  if (state === 'playing') {
    runTime += dt;
    speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (1 - Math.exp(-runTime / 140));
    curSpeed = speed;
  } else if (state === 'dying') {
    dieT += dt;
    curSpeed = speed * Math.max(0, 1 - dieT * 4);
    if (dieT > 1.1) gameOver();
  } else if (state === 'revive') {
    curSpeed = 0;
    reviveT -= dt;
    $('reviveTimer').style.width = `${clamp(reviveT / REVIVE_TIME, 0, 1) * 100}%`;
    if (reviveT <= 0) finishRun();
  } else if (state === 'over') curSpeed = 0;
  else curSpeed = 9;

  const dz = curSpeed * wdt;
  moveWorld(dz, wdt);

  if (state === 'playing') {
    travelled += dz;
    score += dz * 0.4 * (power.x2 > 0 ? 2 : 1);
    while (travelled >= nextRowAt) {
      spawnRow();
      nextRowAt += Math.max(22, speed * rand(0.85, 1.2));
    }
    if (power.jet > 0) spawnJetCoins();
    tickPowers(dt);
    updatePlayer(dt);
    updatePickups();
  }
  updateCoins(dz, dt);
  animatePlayer(dt);
  if (state === 'playing') updateHud();
}

function updateCamera(dt) {
  camX += (px * 0.7 - camX) * Math.min(1, dt * 6);
  const targetY = power.jet > 0 ? py * 0.75 : Math.min(py, TRAIN_H + 1) * 0.55;
  camY += (targetY - camY) * Math.min(1, dt * 4);
  let sx = 0, sy = 0;
  if (shake > 0) { shake -= dt; sx = (Math.random() - 0.5) * shake * 1.2; sy = (Math.random() - 0.5) * shake * 1.2; }
  const portrait = camera.aspect < 1;
  const camZ = portrait ? 7.6 + (1 - camera.aspect) * 7 : 7.6;
  const camH = portrait ? 5.4 + (1 - camera.aspect) * 2 : 4.6;
  camera.position.set(camX * (portrait ? 0.4 : 1) + sx, camH + camY + sy, camZ);
  camera.lookAt(camX * (portrait ? 0.35 : 0.85), 1.3 + camY * 0.9, -10);
  const baseFov = portrait ? 70 : 60;
  const fov = baseFov + (state === 'playing' ? difficulty() * 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 2); camera.updateProjectionMatrix(); }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 70 : 60;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const steps = dt > 0.022 ? 2 : 1;
  for (let i = 0; i < steps; i++) update(dt / steps);
  updateCamera(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
