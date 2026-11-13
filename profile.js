// Профиль игрока: монеты, рекорд, скины, прокачка.
// Гость хранит профиль в localStorage, вошедший игрок — в Firestore (users/{uid}).
import { firebaseConfig } from './firebase-config.js?v=3';

const FB_VER = '10.12.2';
const GUEST_KEY = 'rr_profile_guest';

// ---------- каталог магазина ----------
export const SKINS = [
  { id: 'classic', name: 'Классика', price: 0, c: { skin: 0xffcc99, shirt: 0xff5a36, pants: 0x2b4c9b, cap: 0x1fbf6b, pack: 0xffc23d, shoes: 0xffffff } },
  { id: 'ninja', name: 'Ниндзя', price: 600, c: { skin: 0xffcc99, shirt: 0x22262c, pants: 0x22262c, cap: 0xe63946, pack: 0x3a3f47, shoes: 0x111111 } },
  { id: 'neon', name: 'Неон', price: 1000, c: { skin: 0xffd6b0, shirt: 0x00e5ff, pants: 0x7c3aed, cap: 0xff2bd6, pack: 0xb6ff00, shoes: 0x00e5ff }, glow: 0x0a3a40 },
  { id: 'zombie', name: 'Зомби', price: 1500, c: { skin: 0x8bc34a, shirt: 0x6d4c41, pants: 0x37474f, cap: 0x558b2f, pack: 0x795548, shoes: 0x5d4037 } },
  { id: 'astro', name: 'Космонавт', price: 2500, c: { skin: 0xffcc99, shirt: 0xf1f5f9, pants: 0xdfe6ee, cap: 0xff6b35, pack: 0x94a3b8, shoes: 0x64748b } },
  { id: 'cyber', name: 'Кибер', price: 4000, c: { skin: 0x9ca3af, shirt: 0x111827, pants: 0x1f2937, cap: 0x22d3ee, pack: 0xef4444, shoes: 0x22d3ee }, glow: 0x0b3a44 },
  { id: 'gold', name: 'Золотой', price: 10000, c: { skin: 0xffd54f, shirt: 0xffc107, pants: 0xffb300, cap: 0xfff176, pack: 0xffa000, shoes: 0xfff59d }, glow: 0x5a4200 },
];

export const UPGRADES = {
  magnet: { base: 10 },
  jet: { base: 7 },
  boots: { base: 10 },
  x2: { base: 12 },
  slow: { base: 6 },
  shield: { base: 25 },
};
export const UPGRADE_COSTS = [300, 700, 1500, 3000, 6000];
export const MAX_LEVEL = UPGRADE_COSTS.length;
export const levelMult = (lvl) => 1 + 0.2 * lvl;

export const ITEMS = [
  { id: 'revives', icon: '❤️', name: 'Второй шанс', desc: 'Продолжить забег после удара', price: 400 },
  { id: 'startShields', icon: '🛡️', name: 'Стартовый щит', desc: 'Щит включится в начале забега', price: 250 },
];

// ---------- хранилище ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const blank = () => ({ nick: null, best: 0, coins: 0, games: 0, skin: 'classic', skins: ['classic'], upgrades: {}, revives: 0, startShields: 0 });

function normalize(p) {
  const d = blank();
  const out = { ...d, ...(p || {}) };
  out.best = Math.max(0, Math.floor(Number(out.best) || 0));
  out.coins = Math.max(0, Math.floor(Number(out.coins) || 0));
  out.games = Math.max(0, Math.floor(Number(out.games) || 0));
  out.revives = Math.max(0, Math.floor(Number(out.revives) || 0));
  out.startShields = Math.max(0, Math.floor(Number(out.startShields) || 0));
  if (!Array.isArray(out.skins)) out.skins = ['classic'];
  if (!out.skins.includes('classic')) out.skins.unshift('classic');
  if (!out.skins.includes(out.skin)) out.skin = 'classic';
  out.upgrades = { ...(out.upgrades || {}) };
  for (const k of Object.keys(UPGRADES)) out.upgrades[k] = clampLvl(out.upgrades[k]);
  return out;
}
const clampLvl = (v) => Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(v) || 0)));

function loadGuest() {
  let p = store.get(GUEST_KEY, null);
  if (!p) {
    // перенос со старой версии игры
    p = blank();
    p.best = store.get('rr_best', 0);
    p.coins = store.get('rr_bank', 0);
  }
  return normalize(p);
}

export const profile = loadGuest();
export let user = null; // { uid, nick } когда вошёл
export const onlineEnabled = !!firebaseConfig;

const listeners = new Set();
export function onProfileChange(fn) { listeners.add(fn); fn(); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

function replaceProfile(p) {
  for (const k of Object.keys(profile)) delete profile[k];
  Object.assign(profile, normalize(p));
}

// ---------- Firebase ----------
let fb = null;
let fbPromise = null;
let pendingNick = null;
let authWaiters = [];

function loadFirebase() {
  if (!firebaseConfig) return Promise.resolve(null);
  if (fbPromise) return fbPromise;
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  fbPromise = Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]).then(([appM, A, F]) => {
    const app = appM.initializeApp(firebaseConfig);
    const auth = A.getAuth(app);
    const db = F.getFirestore(app);
    fb = { auth, db, A, F };
    A.onAuthStateChanged(auth, async (u) => {
      try {
        if (u) await loadCloud(u);
        else { user = null; replaceProfile(loadGuest()); }
      } catch (e) {
        console.error('profile load failed', e);
      }
      emit();
      const w = authWaiters; authWaiters = [];
      w.forEach((fn) => fn(u));
    });
    return fb;
  }).catch((e) => {
    console.error('Firebase не загрузился', e);
    fbPromise = null;
    return null;
  });
  return fbPromise;
}

function nickToEmail(nick) {
  const bytes = new TextEncoder().encode(nick.toLowerCase());
  return 'u' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') + '@railrush.game';
}
function emailToNick(email) {
  try {
    const hex = email.split('@')[0].slice(1);
    const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
    return new TextDecoder().decode(bytes);
  } catch { return 'player'; }
}

async function loadCloud(u) {
  const { F, db } = fb;
  const ref = F.doc(db, 'users', u.uid);
  const snap = await F.getDoc(ref);
  if (snap.exists()) {
    replaceProfile(snap.data());
  } else {
    // новый аккаунт: забираем гостевой прогресс
    const guest = loadGuest();
    const nick = pendingNick || emailToNick(u.email || '');
    const p = normalize({ ...guest, nick });
    await F.setDoc(ref, { ...p, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
    store.set(GUEST_KEY, blank());
    replaceProfile(p);
  }
  pendingNick = null;
  user = { uid: u.uid, nick: profile.nick };
}

export const NICK_RE = /^[\p{L}\p{N}_-]{3,15}$/u;

function authError(e) {
  const code = e && e.code ? e.code : '';
  const map = {
    'auth/email-already-in-use': 'Такой ник уже занят',
    'auth/invalid-credential': 'Неверный ник или пароль',
    'auth/wrong-password': 'Неверный ник или пароль',
    'auth/user-not-found': 'Неверный ник или пароль',
    'auth/invalid-login-credentials': 'Неверный ник или пароль',
    'auth/weak-password': 'Пароль должен быть минимум 6 символов',
    'auth/network-request-failed': 'Нет соединения с интернетом',
    'auth/too-many-requests': 'Слишком много попыток, подожди немного',
    'auth/operation-not-allowed': 'В Firebase не включён вход по Email/паролю',
    'auth/invalid-email': 'Недопустимый ник',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Неверный apiKey в firebase-config.js',
  };
  return new Error(map[code] || 'Ошибка: ' + (code || e.message || e));
}

function waitAuth() { return new Promise((res) => authWaiters.push(res)); }

export async function register(nick, password) {
  nick = nick.trim();
  if (!NICK_RE.test(nick)) throw new Error('Ник: 3–15 символов, буквы, цифры, _ или -');
  if (password.length < 6) throw new Error('Пароль должен быть минимум 6 символов');
  const f = await loadFirebase();
  if (!f) throw new Error('Онлайн недоступен');
  pendingNick = nick;
  const wait = waitAuth();
  try {
    await f.A.createUserWithEmailAndPassword(f.auth, nickToEmail(nick), password);
  } catch (e) { pendingNick = null; throw authError(e); }
  await wait;
}

export async function login(nick, password) {
  nick = nick.trim();
  const f = await loadFirebase();
  if (!f) throw new Error('Онлайн недоступен');
  const wait = waitAuth();
  try {
    await f.A.signInWithEmailAndPassword(f.auth, nickToEmail(nick), password);
  } catch (e) { throw authError(e); }
  await wait;
}

export async function logout() {
  if (!fb) return;
  await fb.A.signOut(fb.auth);
}

// ---------- сохранение ----------
let saveTimer = null;
export function saveProfile() {
  emit();
  if (!user) { store.set(GUEST_KEY, profile); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const { F, db } = fb;
      await F.setDoc(F.doc(db, 'users', user.uid), { ...profile, updatedAt: F.serverTimestamp() }, { merge: true });
    } catch (e) { console.error('save failed', e); }
  }, 400);
}

// ---------- рейтинг ----------
export async function fetchLeaderboard(limitN = 50) {
  const f = await loadFirebase();
  if (!f) throw new Error('Рейтинг не настроен');
  const { F, db } = f;
  const q = F.query(F.collection(db, 'users'), F.orderBy('best', 'desc'), F.limit(limitN));
  const snap = await F.getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, nick: d.data().nick, best: d.data().best || 0, skin: d.data().skin || 'classic' })).filter((r) => r.best > 0);
}
export async function fetchMyRank() {
  if (!user || !fb || profile.best <= 0) return null;
  const { F, db } = fb;
  const q = F.query(F.collection(db, 'users'), F.where('best', '>', profile.best));
  const c = await F.getCountFromServer(q);
  return c.data().count + 1;
}

// ---------- покупки ----------
export function buySkin(id) {
  const s = SKINS.find((x) => x.id === id);
  if (!s || profile.skins.includes(id)) return false;
  if (profile.coins < s.price) return false;
  profile.coins -= s.price;
  profile.skins.push(id);
  profile.skin = id;
  saveProfile();
  return true;
}
export function equipSkin(id) {
  if (!profile.skins.includes(id)) return false;
  profile.skin = id; saveProfile(); return true;
}
export function buyUpgrade(type) {
  const lvl = profile.upgrades[type] || 0;
  if (lvl >= MAX_LEVEL) return false;
  const cost = UPGRADE_COSTS[lvl];
  if (profile.coins < cost) return false;
  profile.coins -= cost;
  profile.upgrades[type] = lvl + 1;
  saveProfile();
  return true;
}
export function buyItem(id) {
  const it = ITEMS.find((x) => x.id === id);
  if (!it || profile.coins < it.price) return false;
  profile.coins -= it.price;
  profile[id] = (profile[id] || 0) + 1;
  saveProfile();
  return true;
}

export function initOnline() { return loadFirebase(); }
