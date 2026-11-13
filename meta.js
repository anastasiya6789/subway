// Меню вне забега: аккаунт, магазин, рейтинг.
import {
  profile, user, onlineEnabled, onProfileChange, SKINS, UPGRADES, UPGRADE_COSTS, MAX_LEVEL, levelMult, ITEMS,
  register, login, logout, fetchLeaderboard, fetchMyRank, buySkin, equipSkin, buyUpgrade, buyItem, NICK_RE, initOnline,
} from './profile.js?v=3';
import * as P from './profile.js?v=3';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');

let POWERS = {};
let onSkin = () => {};
let shopTab = 'skins';

export function isMetaOpen() { return !!document.querySelector('.overlay.meta:not(.hidden)'); }
function open(id) { $(id).classList.remove('hidden'); }
function close(id) { $(id).classList.add('hidden'); }

function mini(skin) {
  const c = skin.c;
  return `<div class="mini" style="--skin:${hex(c.skin)};--shirt:${hex(c.shirt)};--pants:${hex(c.pants)};--cap:${hex(c.cap)};--pack:${hex(c.pack)}">
    <i class="m-cap"></i><i class="m-head"></i><i class="m-torso"></i><i class="m-legs"></i></div>`;
}

// ---------- шапка меню ----------
function renderAccountRow() {
  const row = $('acctRow');
  const u = P.user;
  if (!onlineEnabled) {
    row.innerHTML = `<span class="muted">Гостевой режим</span>`;
  } else if (u) {
    row.innerHTML = `<span>👤 <b>${esc(profile.nick)}</b></span><button class="link" id="logoutBtn">Выйти</button>`;
    $('logoutBtn').onclick = async () => { await logout(); };
  } else {
    row.innerHTML = `<span class="muted">Гость</span><button class="link" id="loginOpenBtn">Войти / Регистрация</button>`;
    $('loginOpenBtn').onclick = () => openAuth('login');
  }
  $('bestMenu').textContent = fmt(profile.best);
  $('bankMenu').textContent = fmt(profile.coins);
}

// ---------- авторизация ----------
let authMode = 'login';
function openAuth(mode) {
  authMode = mode;
  renderAuth();
  open('authOv');
  setTimeout(() => $('authNick').focus(), 50);
}
function renderAuth() {
  $('authTabLogin').classList.toggle('active', authMode === 'login');
  $('authTabReg').classList.toggle('active', authMode === 'register');
  $('authSubmit').textContent = authMode === 'login' ? 'ВОЙТИ' : 'СОЗДАТЬ АККАУНТ';
  $('authHint').textContent = authMode === 'register'
    ? 'Ник виден в рейтинге. Монеты и покупки гостя перейдут в новый аккаунт.'
    : '';
  $('authPass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('authErr').textContent = '';
}
async function submitAuth(e) {
  e.preventDefault();
  const nick = $('authNick').value.trim();
  const pass = $('authPass').value;
  const err = $('authErr');
  err.textContent = '';
  if (authMode === 'register' && !NICK_RE.test(nick)) { err.textContent = 'Ник: 3–15 символов, буквы, цифры, _ или -'; return; }
  const btn = $('authSubmit');
  btn.disabled = true; btn.textContent = '...';
  try {
    if (authMode === 'login') await login(nick, pass); else await register(nick, pass);
    $('authPass').value = '';
    close('authOv');
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false; renderAuth(); err.textContent = err.textContent || '';
  }
}

// ---------- магазин ----------
function openShop(tab) {
  if (tab) shopTab = tab;
  renderShop();
  open('shopOv');
}
function renderShop() {
  $('shopCoins').textContent = fmt(profile.coins);
  for (const t of ['skins', 'upgrades', 'items']) $('tab-' + t).classList.toggle('active', shopTab === t);
  const list = $('shopList');
  if (shopTab === 'skins') {
    list.innerHTML = SKINS.map((s) => {
      const owned = profile.skins.includes(s.id);
      const on = profile.skin === s.id;
      let btn;
      if (on) btn = `<button class="buy on" disabled>Надето</button>`;
      else if (owned) btn = `<button class="buy" data-equip="${s.id}">Надеть</button>`;
      else btn = `<button class="buy" data-skin="${s.id}" ${profile.coins < s.price ? 'disabled' : ''}><span class="coin-dot sm"></span>${fmt(s.price)}</button>`;
      return `<div class="shop-item skin ${on ? 'equipped' : ''}">${mini(s)}<div class="si-name">${s.name}</div>${btn}</div>`;
    }).join('');
    list.className = 'shop-grid';
  } else if (shopTab === 'upgrades') {
    list.className = 'shop-rows';
    list.innerHTML = Object.keys(UPGRADES).map((k) => {
      const p = POWERS[k];
      const lvl = profile.upgrades[k] || 0;
      const base = UPGRADES[k].base;
      const cur = Math.round(base * levelMult(lvl));
      const next = lvl < MAX_LEVEL ? Math.round(base * levelMult(lvl + 1)) : null;
      const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'f' : ''}" style="--c:${p.color}"></i>`).join('');
      const btn = next == null
        ? `<button class="buy on" disabled>МАКС</button>`
        : `<button class="buy" data-up="${k}" ${profile.coins < UPGRADE_COSTS[lvl] ? 'disabled' : ''}><span class="coin-dot sm"></span>${fmt(UPGRADE_COSTS[lvl])}</button>`;
      return `<div class="shop-row"><span class="ic" style="color:${p.color}">${p.icon}</span>
        <div class="sr-main"><div class="sr-title">${p.name} <small>${p.desc}</small></div>
        <div class="pips">${pips}</div>
        <div class="sr-sub">${cur} с${next != null ? ` → <b>${next} с</b>` : ''}</div></div>${btn}</div>`;
    }).join('') + `<div class="shop-note">🎁 Сюрприз: случайный бонус или до 120 монет</div>`;
  } else {
    list.className = 'shop-rows';
    list.innerHTML = ITEMS.map((it) => `<div class="shop-row"><span class="ic">${it.icon}</span>
      <div class="sr-main"><div class="sr-title">${it.name}</div><div class="sr-sub">${it.desc}</div>
      <div class="sr-sub">Есть: <b>${profile[it.id] || 0}</b></div></div>
      <button class="buy" data-item="${it.id}" ${profile.coins < it.price ? 'disabled' : ''}><span class="coin-dot sm"></span>${fmt(it.price)}</button></div>`).join('');
  }
}
function shopClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  let ok = false;
  if (b.dataset.skin) ok = buySkin(b.dataset.skin);
  else if (b.dataset.equip) ok = equipSkin(b.dataset.equip);
  else if (b.dataset.up) ok = buyUpgrade(b.dataset.up);
  else if (b.dataset.item) ok = buyItem(b.dataset.item);
  if (ok) { onSkin(); renderShop(); flash(b); }
}
function flash(b) {
  const el = $('shopCoins').parentElement;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

// ---------- рейтинг ----------
async function openLeaderboard() {
  open('lbOv');
  const list = $('lbList');
  const me = $('lbMe');
  if (!onlineEnabled) {
    list.innerHTML = `<div class="lb-empty">Онлайн-рейтинг ещё не подключён.<br><small>Владелец игры должен вставить Firebase-конфиг в <code>firebase-config.js</code>.</small></div>`;
    me.innerHTML = '';
    return;
  }
  list.innerHTML = `<div class="lb-empty">Загрузка…</div>`;
  me.innerHTML = P.user ? '' : `<button class="link" id="lbLogin">Войди, чтобы попасть в рейтинг</button>`;
  if (!P.user) $('lbLogin').onclick = () => { close('lbOv'); openAuth('register'); };
  try {
    const rows = await fetchLeaderboard(50);
    if (!rows.length) { list.innerHTML = `<div class="lb-empty">Пока пусто. Стань первым!</div>`; }
    else {
      list.innerHTML = rows.map((r, i) => {
        const s = SKINS.find((x) => x.id === r.skin) || SKINS[0];
        const medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
        const mine = P.user && r.uid === P.user.uid;
        return `<div class="lb-row ${mine ? 'me' : ''}"><span class="lb-pos">${medal}</span>${mini(s)}<span class="lb-nick">${esc(r.nick || '???')}</span><b>${fmt(r.best)}</b></div>`;
      }).join('');
    }
    if (P.user) {
      const rank = await fetchMyRank();
      me.innerHTML = rank ? `Твоё место: <b>#${rank}</b> · рекорд <b>${fmt(profile.best)}</b>` : `Сыграй забег, чтобы попасть в рейтинг`;
    }
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="lb-empty">Не удалось загрузить рейтинг.<br><small>${esc(e.message || e)}</small></div>`;
  }
}

// ---------- init ----------
export function initMeta(opts) {
  POWERS = opts.powers;
  onSkin = opts.onSkin || onSkin;

  $('shopBtn').onclick = () => openShop();
  $('lbBtn').onclick = openLeaderboard;
  $('overShopBtn').onclick = () => openShop();
  $('overLbBtn').onclick = openLeaderboard;
  for (const t of ['skins', 'upgrades', 'items']) $('tab-' + t).onclick = () => { shopTab = t; renderShop(); };
  $('shopList').addEventListener('click', shopClick);
  $('authTabLogin').onclick = () => { authMode = 'login'; renderAuth(); };
  $('authTabReg').onclick = () => { authMode = 'register'; renderAuth(); };
  $('authForm').addEventListener('submit', submitAuth);
  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => close(b.dataset.close); });
  document.querySelectorAll('.overlay.meta').forEach((ov) => ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); }));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isMetaOpen()) {
      document.querySelectorAll('.overlay.meta:not(.hidden)').forEach((o) => o.classList.add('hidden'));
      e.stopImmediatePropagation();
    }
  }, true);

  onProfileChange(() => {
    renderAccountRow();
    onSkin();
    if (!$('shopOv').classList.contains('hidden')) renderShop();
  });
  initOnline();
}

export function openAuthFromGame() { openAuth('register'); }
