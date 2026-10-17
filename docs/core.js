'use strict';

// Manager・Agent 共通の土台（データの読み込み・復号・Google ドライブ・表示と配色・更新・タブ）
// データは利用者が操作したときだけ読み込む（ファイルを選ぶ、または Google ドライブから取得）。自動では取りに行かない。
// データ・合言葉・設定は、すべて端末内の IndexedDB（app-config.js の db）だけに保存する。
// 画面ごとの表示は各アプリの app.js が ESV.start({ render, describe }) で渡す。

const APP = self.ESV_APP;
const $ = (id) => document.getElementById(id);

let data = null;     // 読み込んだデータ（復号後）
let dataMeta = null; // { fileName, source, importedAt }
let ranks = { old: null, new: null }; // ランク表（旧・新）：{ ranks, startDate, generatedAt, fileName }
let hooks = { render() {}, describe() { return ''; } };

//--------------------------------------------------------------
// 表示用の小道具
//--------------------------------------------------------------
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const fmtAmount = (n) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 6 });
const fmtDate = (unix) => new Date(unix * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = (unix) => new Date(unix * 1000).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtJst = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
const fmtMonth = (m) => m.replace(/^(\d{4})-0?(\d+)$/, '$1年$2月');

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function kvRows(rows) {
  return rows.flatMap(([k, v]) => [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
}

//--------------------------------------------------------------
// 端末内の保存（IndexedDB。名前はアプリごとに別）
//--------------------------------------------------------------
const STORE = 'dataset';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP.db, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

const getSetting = (key) => dbRun('readonly', (s) => s.get(key));
const putSetting = (key, value) => dbRun('readwrite', (s) => s.put(value, key));
const delSetting = (key) => dbRun('readwrite', (s) => s.delete(key));

//--------------------------------------------------------------
// データファイル：読み込み・復号・保存
//--------------------------------------------------------------
const SCOPE_LABEL = { manager: 'Manager', agent: 'Agent' };

function validateData(d) {
  if (!d || d.format !== 'esv-data' || !d.generatedAt) throw new Error('EARN SPLIT VIEWER のデータファイルではありません');
  if (d.version !== 2) throw new Error('古い形式のデータファイルです。取得エクセルの［ビューア用ファイルを作成］で作り直してください');
  if (d.scope !== APP.dataScope) {
    throw new Error('このファイルは ' + (SCOPE_LABEL[d.scope] || d.scope) + ' 用のデータです。' + SCOPE_LABEL[APP.dataScope] + ' 用のファイルを選んでください');
  }
  if (!Array.isArray(d.transfers)) throw new Error('データファイルの形式が違います（transfers がありません）');
  return d;
}

function validateRank(d) {
  if (d.version !== 2 || !['old', 'new'].includes(d.kind) || !Array.isArray(d.ranks) || !d.ranks.length) throw new Error('ランク表の形式が違います');
  if (d.kind === 'new' && !/^\d{4}-\d{2}-\d{2}$/.test(d.startDate || '')) throw new Error('新ランク表に開始日がありません');
  return d;
}

// 暗号化ファイルの復号（取得プログラムと同じ方式：PBKDF2-SHA256 → AES-256-GCM）
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptData(enc, passphrase) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: enc.kdf.hash, salt: b64(enc.kdf.salt), iterations: enc.kdf.iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.cipher.iv) }, key, b64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function askPassphrase() {
  return new Promise((resolve) => {
    const dlg = $('passDlg');
    $('passInput').value = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? { pass: $('passInput').value, save: $('passSave').checked } : null), { once: true });
    dlg.showModal();
  });
}

// 暗号化されていれば復号する。保存済みの合言葉を先に試し、だめなら入力を求める。キャンセル時は null
async function decryptIfNeeded(json) {
  if (json.format !== 'esv-data-enc') return json;
  const saved = await getSetting('passphrase');
  if (saved) {
    try { return await decryptData(json, saved); } catch { /* 合言葉が変わった → 入力を求める */ }
  }
  for (;;) {
    const r = await askPassphrase();
    if (r == null) return null;
    $('status').textContent = '復号中…';
    try {
      const plain = await decryptData(json, r.pass);
      if (r.save) await putSetting('passphrase', r.pass);
      else await delSetting('passphrase');
      return plain;
    } catch {
      $('status').textContent = '';
      if (!confirm('合言葉が違うか、ファイルが壊れています。もう一度入力しますか？')) return null;
    }
  }
}

async function loadSavedData() {
  const saved = await getSetting('current');
  if (saved && saved.data && saved.data.version === 2) { data = saved.data; dataMeta = saved.meta; }
  ranks.old = (await getSetting('rankOld')) || null;
  ranks.new = (await getSetting('rankNew')) || null;
}

const RANK_LABEL = { old: '旧ランク表', new: '新ランク表' };

// 読み込んだ文字列（暗号化されていれば復号）を、データかランク表かを見分けて保存する
// 戻り値：表示するメッセージ。キャンセル時は null。失敗時は例外
async function importText(text, fileName, source) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 形式のファイルではありません'); }
  json = await decryptIfNeeded(json);
  if (!json) return null;

  if (json.format === 'esv-rank') {
    validateRank(json);
    const cur = ranks[json.kind];
    if (cur && source === 'drive' && cur.generatedAt === json.generatedAt) return RANK_LABEL[json.kind] + 'は最新です';
    ranks[json.kind] = { ranks: json.ranks, startDate: json.startDate || '', generatedAt: json.generatedAt, fileName };
    await putSetting(json.kind === 'old' ? 'rankOld' : 'rankNew', ranks[json.kind]);
    refreshAll();
    return RANK_LABEL[json.kind] + 'を読み込みました（' + json.ranks.length + ' ランク' + (json.startDate ? '、開始日 ' + json.startDate : '') + '）';
  }

  validateData(json);
  if (data && source === 'drive' && json.generatedAt === data.generatedAt) {
    return 'データは最新です（作成：' + fmtJst(json.generatedAt) + '）';
  }
  const meta = { fileName, source, importedAt: new Date().toISOString() };
  await putSetting('current', { data: json, meta });
  data = json;
  dataMeta = meta;
  refreshAll();
  return 'データを読み込みました（取引 ' + data.transfers.length + ' 件）';
}

// ファイルから読み込む（データ・ランク表のどれでも。まとめて選べる）
document.querySelectorAll('.dataFile').forEach((input) => input.addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const msgs = [];
  for (const file of files) {
    try {
      const msg = await importText(await file.text(), file.name, 'file');
      if (msg) msgs.push(msg);
    } catch (err) {
      msgs.push(file.name + '：読み込めませんでした（' + err.message + '）');
    }
  }
  showStatus();
  if (msgs.length) alert(msgs.join('\n'));
}));

//--------------------------------------------------------------
// Google ドライブから最新データを取得
//--------------------------------------------------------------
let driveBusy = false;

// 選んだファイル（データ・旧ランク表・新ランク表）をまとめて取得する。初回・選び直しはファイルを選ばせる
async function fetchFromDrive(forcePick) {
  if (driveBusy) return;
  if (!Drive.configured()) { alert('Google ドライブの連携が設定されていません。'); return; }
  driveBusy = true;
  const msgs = [];
  try {
    $('status').textContent = '準備中…';
    await Drive.ensureLoaded();
    let files = forcePick ? null : await getSetting('driveFiles');
    if (!files || !files.length) {
      $('status').textContent = 'ファイルを選択中…';
      files = await Drive.pick(SCOPE_LABEL[APP.dataScope] + ' 用のデータファイルと、ランク表（旧・新）の3つを選んでください', true);
      if (!files) return;
      await putSetting('driveFiles', files);
      renderDriveInfo();
    }
    for (const [i, file] of files.entries()) {
      $('status').textContent = '取得中…（' + (i + 1) + '/' + files.length + '）';
      try {
        const { meta, text } = await Drive.download(file.id);
        if (meta.name !== file.name) { file.name = meta.name; await putSetting('driveFiles', files); }
        const m = await importText(text, meta.name, 'drive');
        if (m) msgs.push(m);
      } catch (err) {
        if (err.repick) await delSetting('driveFiles');
        msgs.push(file.name + '：' + err.message);
        if (err.retry || err.repick) break;
      }
    }
    if (data && (!ranks.old || !ranks.new)) msgs.push('※ 報酬を計算するには、ランク表（旧・新）も必要です。「ファイルを選び直す」で3つを選んでください。');
  } catch (err) {
    msgs.push(err.message);
  } finally {
    driveBusy = false;
    renderDriveInfo();
    showStatus();
  }
  if (msgs.length) alert(msgs.join('\n'));
}

async function renderDriveInfo() {
  const ok = Drive.configured();
  document.querySelectorAll('.driveOnly').forEach((e) => { e.hidden = !ok; });
  if (!ok) return;
  const files = await getSetting('driveFiles');
  const pass = await getSetting('passphrase');
  $('driveInfo').textContent = '選んだファイル：' + (files && files.length ? files.map((f) => f.name).join('、') : '未選択（初回に、データとランク表（旧・新）の3つを選びます）');
  $('forgetPassBtn').hidden = !pass;
}

document.querySelectorAll('.driveFetch').forEach((b) => b.addEventListener('click', () => fetchFromDrive(false)));
$('drivePickBtn').addEventListener('click', () => fetchFromDrive(true));
$('driveSignOutBtn').addEventListener('click', async () => {
  Drive.signOut();
  await delSetting('driveFiles');
  renderDriveInfo();
  alert('Google との連携を解除しました（次回はログインとファイルの選択からやり直します）');
});
$('forgetPassBtn').addEventListener('click', async () => {
  await delSetting('passphrase');
  renderDriveInfo();
  alert('保存していた合言葉を削除しました');
});

function showStatus() {
  $('status').textContent = data
    ? '作成：' + new Date(data.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'データ未読み込み';
}

//--------------------------------------------------------------
// 表示と配色（表示名・アイコン・配色）。反映の処理は appearance.js
//--------------------------------------------------------------
let look = Object.assign({}, APPEARANCE_DEFAULT);

async function saveLook() {
  await putSetting('appearance', look);
  cacheAppearance(look);
  applyAppearance(look);
  renderLook();
}

function renderLook() {
  if (document.activeElement !== $('lookName')) $('lookName').value = look.name || '';
  $('lookName').placeholder = APP_NAME_DEFAULT;
  $('lookTheme').value = look.theme || 'auto';
  const opts = ICON_PRESETS.map((p) => ({ icon: { type: 'preset', id: p.id }, label: p.label }));
  if (look.icon && look.icon.type === 'custom') opts.push({ icon: look.icon, label: '選んだ画像' });
  const same = (a, b) => a.type === b.type && (a.type === 'custom' || a.id === b.id);
  $('lookIcons').replaceChildren(...opts.map((o) => el('button', { type: 'button', class: 'icon-opt', 'aria-pressed': String(same(o.icon, look.icon || APPEARANCE_DEFAULT.icon)), onclick: async () => { look.icon = o.icon; await saveLook(); } },
    el('img', { src: iconUrl(o.icon), alt: '' }), o.label)));
}

$('lookName').addEventListener('change', async () => { look.name = $('lookName').value.trim(); await saveLook(); });
$('lookTheme').addEventListener('change', async () => { look.theme = $('lookTheme').value; await saveLook(); });
$('lookReset').addEventListener('click', async () => { look = Object.assign({}, APPEARANCE_DEFAULT); await saveLook(); });

// 手持ちの画像：中央を正方形に切り抜き、180×180 の PNG にして端末に保存する
$('lookIconFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    // CSP で blob: の画像は許可していないので、data: URL にして読み込む（選択を消すのは読み終えてから）
    const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('画像を読み込めませんでした')); r.readAsDataURL(file); });
    e.target.value = '';
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('画像を読み込めませんでした（対応していない形式の可能性があります）')); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 180, 180);
    look.icon = { type: 'custom', data: c.toDataURL('image/png') };
    await saveLook();
  } catch (err) {
    alert(err.message);
  }
});

//--------------------------------------------------------------
// 保存の持続化・インストール
//--------------------------------------------------------------
async function showStorageInfo() {
  if (!navigator.storage || !navigator.storage.persist) return;
  const persisted = await navigator.storage.persisted() || await navigator.storage.persist();
  $('storageInfo').textContent = persisted
    ? '保存の持続化：有効（容量不足でも自動で消されにくくなっています）'
    : '保存の持続化：未許可（データは「最新データを取得」でいつでも取り直せます）';
}

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('installBtn').hidden = false;
});
$('installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('installBtn').hidden = true;
});

//--------------------------------------------------------------
// タブ切り替え・全体
//--------------------------------------------------------------
document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + btn.dataset.tab; });
}));

function refreshAll() {
  document.querySelectorAll('.whenEmpty').forEach((e) => { e.hidden = !!data; });
  document.querySelectorAll('.whenData').forEach((e) => { e.hidden = !data; });
  $('dummyNote').hidden = !(data && data.dummy);
  hooks.render();
  for (const f of ESV.renderers) f();
  $('dataInfo').textContent = (data
    ? 'データ：' + dataMeta.fileName + '（作成 ' + fmtJst(data.generatedAt) + '、読み込み ' + fmtJst(dataMeta.importedAt) + '）' + hooks.describe()
    : 'データ：まだ読み込んでいません。') +
    '　旧ランク表：' + (ranks.old ? ranks.old.fileName : '未読み込み') +
    '　新ランク表：' + (ranks.new ? ranks.new.fileName + '（開始日 ' + ranks.new.startDate + '）' : '未読み込み');
  renderLook();
  renderDriveInfo();
  showStatus();
}

//--------------------------------------------------------------
// バージョンと更新
//--------------------------------------------------------------
$('appVersion').textContent = self.APP_VERSION;
// 保管庫（画面のファイル）を消してから再読み込みし、確実に新しい版を取り直す
// 同じドメインの他アプリ（取引ビューアなど）の保管庫は残し、自分の接頭辞のものだけを削除する
async function applyUpdate() {
  try {
    for (const k of await caches.keys()) if (k.startsWith(APP.cachePrefix)) await caches.delete(k);
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch { /* 失敗しても再読み込みで取り直す */ }
  location.reload();
}
$('reloadBtn').addEventListener('click', applyUpdate);

if ('serviceWorker' in navigator) {
  // 新しい版の Service Worker に切り替わったら、再読み込みを促す（初回のインストール時は除く）
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('updateNote').hidden = false; });
}

$('updateBtn').addEventListener('click', async () => {
  const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
  if (!reg) { alert('更新を確認できませんでした'); return; }
  $('updateBtn').disabled = true;
  try {
    await reg.update();
    const res = await fetch('version.js', { cache: 'no-store' });
    const latest = ((await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (latest && latest !== self.APP_VERSION) {
      if (confirm('新しいバージョン（' + latest + '）があります。更新しますか？')) await applyUpdate();
    } else {
      alert('最新のバージョンです（' + self.APP_VERSION + '）');
    }
  } catch {
    alert('更新を確認できませんでした（通信を確認してください）');
  } finally {
    $('updateBtn').disabled = false;
  }
});

// 各アプリの app.js から呼ぶ。init：保存済みの設定を読む処理（任意）
const ESV = {
  loaders: [],   // 起動時に保存済みのものを読む処理（book.js など）
  renderers: [], // 画面を描き直すときに一緒に呼ぶ処理
  async start(h) {
    hooks = Object.assign(hooks, h);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
    await loadSavedData();
    look = Object.assign({}, APPEARANCE_DEFAULT, (await getSetting('appearance')) || {});
    cacheAppearance(look);
    applyAppearance(look);
    for (const f of ESV.loaders) await f();
    if (h.init) await h.init();
    refreshAll();
    showStorageInfo();
  },
};
