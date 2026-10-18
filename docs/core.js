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
let lastImportKind = null; // 直前に読み込んだファイルの種類（'data' | 'rankOld' | 'rankNew'）。ドライブのファイルを枠に振り分けるのに使う

// 読み込んだ文字列（暗号化されていれば復号）を、データかランク表かを見分けて保存する
// 戻り値：表示するメッセージ。キャンセル時は null。失敗時は例外
async function importText(text, fileName, source) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('JSON 形式のファイルではありません'); }
  json = await decryptIfNeeded(json);
  if (!json) return null;

  if (json.format === 'esv-rank') {
    validateRank(json);
    lastImportKind = json.kind === 'old' ? 'rankOld' : 'rankNew';
    const cur = ranks[json.kind];
    if (cur && source === 'drive' && cur.generatedAt === json.generatedAt) return RANK_LABEL[json.kind] + 'は最新です';
    ranks[json.kind] = { ranks: json.ranks, startDate: json.startDate || '', generatedAt: json.generatedAt, fileName, importedAt: new Date().toISOString() };
    await putSetting(json.kind === 'old' ? 'rankOld' : 'rankNew', ranks[json.kind]);
    refreshAll();
    return RANK_LABEL[json.kind] + 'を読み込みました（' + json.ranks.length + ' ランク' + (json.startDate ? '、開始日 ' + json.startDate : '') + '）';
  }

  validateData(json);
  lastImportKind = 'data';
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

// ドライブのファイルは、データ・旧ランク表・新ランク表の3つの枠に1つずつ覚える（'driveSlots'）
// 足りない枠があれば、取得のときに1つずつ選んでもらう。選び直しは枠ごと
const SLOTS = [
  { key: 'data', label: () => SCOPE_LABEL[APP.dataScope] + ' 用のデータ', hint: () => 'esv_' + APP.dataScope + '_latest.json' },
  { key: 'rankOld', label: () => '旧ランク表', hint: () => 'esv_' + APP.dataScope + '_rank_old.json' },
  { key: 'rankNew', label: () => '新ランク表', hint: () => 'esv_' + APP.dataScope + '_rank_new.json' },
];
const slotOf = (key) => SLOTS.find((x) => x.key === key);

// ファイル名に、このアプリの名前（manager / agent）が入っているか。入っていなければ開く前に断る
// （他方の合言葉で暗号化されたファイルを開こうとして、合言葉を聞かれたり、保存した合言葉が置き換わったりしないように）
const nameFits = (name) => String(name || '').toLowerCase().includes(APP.dataScope);
const nameError = (name) => '「' + name + '」は ' + SCOPE_LABEL[APP.dataScope] + ' 用のファイルではないようです（ファイル名に ' + APP.dataScope + ' が入っていません）。' +
  SCOPE_LABEL[APP.dataScope] + ' フォルダのファイル（例：esv_' + APP.dataScope + '_rank_old.json）を選んでください。'

async function getSlots() {
  return (await getSetting('driveSlots')) || {};
}

// ファイルを1つ取得して読み込む。戻り値：{ msg, kind }。失敗時は例外
async function driveImportOne(file) {
  const { meta, text } = await Drive.download(file.id);
  lastImportKind = null;
  const msg = await importText(text, meta.name, 'drive');
  return { msg, kind: lastImportKind, name: meta.name };
}

// 1つの枠のファイルを選んで読み込む。キャンセル時は null
async function pickSlot(key, msgs) {
  const slot = slotOf(key);
  $('status').textContent = slot.label() + 'を選択中…';
  const picked = await Drive.pick(slot.label() + 'のファイル（' + slot.hint() + '）を選んでください', false, 'esv_' + APP.dataScope);
  if (!picked || !picked.length) return null;
  const file = picked[0];
  if (!nameFits(file.name)) { msgs.push(nameError(file.name)); return 'cancel'; }
  $('status').textContent = slot.label() + 'を取得中…';
  const r = await driveImportOne(file);
  if (!r.kind) return 'cancel'; // 合言葉の入力をやめた
  const slots = await getSlots();
  slots[r.kind] = { id: file.id, name: r.name };
  await putSetting('driveSlots', slots);
  if (r.msg) msgs.push(r.msg);
  if (r.kind !== key) msgs.push('※ 選んだファイルは「' + slotOf(r.kind).label() + '」でした。そちらとして覚えました。「' + slot.label() + '」は、もう一度選んでください。');
  return r.kind;
}

// pickKey：選び直す枠（省略時は、覚えている枠を取得し、足りない枠を1つずつ選ばせる）
async function fetchFromDrive(pickKey) {
  if (driveBusy) return;
  if (!Drive.configured()) { alert('Google ドライブの連携が設定されていません。'); return; }
  // ログイン画面は、ほかの処理より先に開く（iPhone の Safari で開けなくならないように）
  let auth = null;
  try { auth = Drive.authorizeNow(); } catch { auth = null; }
  driveBusy = true;
  const msgs = [];
  try {
    $('status').textContent = '準備中…';
    const loadedNow = await Drive.ensureLoaded();
    if (auth) { $('status').textContent = 'ログイン中…'; await auth; }
    else if (loadedNow) $('status').textContent = '準備ができました…';
    await delSetting('driveFiles'); // 以前の「まとめて選ぶ」形の記録は使わない
    if (pickKey) {
      await pickSlot(pickKey, msgs);
    } else {
      // 覚えている枠を取得
      const slots = await getSlots();
      for (const slot of SLOTS) {
        const file = slots[slot.key];
        if (!file) continue;
        if (!nameFits(file.name)) {
          // 以前に選んだ、名前の合わないファイル（例：名前を分ける前の esv_rank_old.json）は外して選び直してもらう
          delete slots[slot.key];
          await putSetting('driveSlots', slots);
          msgs.push(slot.label() + '：' + nameError(file.name));
          continue;
        }
        $('status').textContent = slot.label() + 'を取得中…';
        try {
          const r = await driveImportOne(file);
          if (r.msg) msgs.push(r.msg);
          if (r.name !== file.name) { slots[slot.key] = { id: file.id, name: r.name }; await putSetting('driveSlots', slots); }
        } catch (err) {
          if (err.repick) { delete slots[slot.key]; await putSetting('driveSlots', slots); }
          msgs.push(file.name + '：' + err.message);
          if (err.retry) return; // ログインからやり直し（finally でメッセージを出す）
        }
      }
      // 足りない枠を1つずつ選ぶ（キャンセルしたらそこでやめる）
      for (let guard = 0; guard < 6; guard++) {
        const cur = await getSlots();
        const missing = SLOTS.find((x) => !cur[x.key]);
        if (!missing) break;
        if (!confirm(missing.label() + 'のファイルがまだ選ばれていません。今選びますか？')) break;
        const r = await pickSlot(missing.key, msgs);
        if (!r || r === 'cancel') break;
      }
    }
  } catch (err) {
    msgs.push(err.message);
  } finally {
    driveBusy = false;
    renderDriveInfo();
    showStatus();
    if (msgs.length) alert(msgs.join('\n'));
  }
}

// 読み込んであるデータ・ランク表の作成日時と読み込み日時（ドライブの欄のファイル名の下に出す）
const fmtShortJst = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function slotTimes(key) {
  const x = key === 'data' ? (data && dataMeta ? { g: data.generatedAt, i: dataMeta.importedAt } : null)
    : key === 'rankOld' ? (ranks.old ? { g: ranks.old.generatedAt, i: ranks.old.importedAt } : null)
    : (ranks.new ? { g: ranks.new.generatedAt, i: ranks.new.importedAt } : null);
  if (!x) return '';
  return '作成 ' + fmtShortJst(x.g) + (x.i ? '　読込 ' + fmtShortJst(x.i) : '');
}

async function renderDriveInfo() {
  const ok = Drive.configured();
  document.querySelectorAll('.driveOnly').forEach((e) => { e.hidden = !ok; });
  if (!ok) return;
  const slots = await getSlots();
  const pass = await getSetting('passphrase');
  $('driveSlots').replaceChildren(...SLOTS.map((slot) => el('li', {},
    el('div', { class: 'slot-text' }, el('span', { class: 'muted' }, slot.label()), el('b', {}, slots[slot.key] ? slots[slot.key].name : '未選択'),
      slotTimes(slot.key) ? el('span', { class: 'slot-meta' }, slotTimes(slot.key)) : null),
    el('button', { type: 'button', onclick: () => fetchFromDrive(slot.key) }, slots[slot.key] ? '選び直す' : '選ぶ'))));
  $('forgetPassBtn').hidden = !pass;
}

document.querySelectorAll('.driveFetch').forEach((b) => b.addEventListener('click', () => fetchFromDrive()));
$('driveSignOutBtn').addEventListener('click', async () => {
  Drive.signOut();
  await delSetting('driveSlots');
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
  // ヘッダの右側はアプリのバージョン（取得中などは、そのときだけ「取得中…」などを出す）
  const st = $('status');
  st.textContent = 'Version：' + self.APP_VERSION;
  st.title = data ? 'データの作成日時：' + fmtJst(data.generatedAt) : 'データはまだ読み込んでいません';
}

//--------------------------------------------------------------
// 保存の持続化・インストール
//--------------------------------------------------------------
async function showStorageInfo() {
  if (!navigator.storage || !navigator.storage.persist) return;
  if (!$('storageInfo')) { navigator.storage.persist().catch(() => {}); return; } // 表示の欄はなくした（持続化の依頼だけする）
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
// 設定タブを開いたら、Google の部品を前もって読み込む（「最新データを取得」を押したときに、すぐログイン画面を開けるように）
document.querySelector('[data-tab=settings]').addEventListener('click', () => Drive.preload());
document.querySelectorAll('.tabs button').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + btn.dataset.tab; });
}));

// 横にスワイプすると隣のタブへ（左へスワイプで右隣、右へで左隣）。ページは指についてきて、離すと次のページが横から滑り込む
// 少しだけ動かしたときは元に戻る。両端のタブでは重く動いて戻る
// 入力欄・グラフ・横にスクロールできる表の上、アドレス一覧を開いているときは動かさない
(() => {
  const SLIDE_MS = 220;
  let sx = 0, sy = 0, st = 0, armed = false, mode = '', dx = 0, page = null, busy = false;
  const scrollsX = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; } return false; };
  const btns = () => [...document.querySelectorAll('.tabs button')];
  const curIndex = () => btns().findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const move = (el, x, ms) => { el.style.transition = ms ? 'transform ' + ms + 'ms ease-out' : 'none'; el.style.transform = x ? 'translateX(' + x + 'px)' : ''; };
  const after = (ms) => new Promise((r) => setTimeout(r, ms + 20));
  document.addEventListener('touchstart', (ev) => {
    armed = false; mode = ''; dx = 0;
    if (busy || ev.touches.length !== 1 || !$('tab-book').hidden) return;
    const t = ev.target;
    if (t.closest('input, select, textarea, dialog, .ch-wrap, .tabs') || scrollsX(t)) return;
    sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; st = Date.now(); armed = true;
    page = document.querySelector('.tab:not([hidden])');
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!armed || !page) return;
    const mx = ev.touches[0].clientX - sx, my = ev.touches[0].clientY - sy;
    if (!mode) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      mode = Math.abs(mx) > Math.abs(my) * 1.5 ? 'x' : 'y'; // 最初の動きで、横（タブ移動）か縦（スクロール）かを決める
    }
    if (mode !== 'x') return;
    ev.preventDefault(); // 横に動かしている間は、縦にスクロールさせない
    const j = curIndex() + (mx < 0 ? 1 : -1);
    dx = j >= 0 && j < btns().length ? mx : mx / 4; // 端のタブでは重く
    move(page, dx, 0);
  }, { passive: false });
  document.addEventListener('touchend', async () => {
    if (!armed || mode !== 'x' || !page) { armed = false; return; }
    armed = false;
    const cur = page, w = window.innerWidth;
    const j = curIndex() + (dx < 0 ? 1 : -1);
    const fast = Math.abs(dx) > 30 && Date.now() - st < 250; // すばやく払ったときは短くても移る
    if (j < 0 || j >= btns().length || (Math.abs(dx) < w * 0.25 && !fast)) { move(cur, 0, SLIDE_MS); await after(SLIDE_MS); move(cur, 0, 0); return; }
    busy = true;
    const dir = dx < 0 ? -1 : 1;
    move(cur, dir * w, SLIDE_MS); // 今のページを外へ
    await after(SLIDE_MS);
    move(cur, 0, 0);
    btns()[j].click();
    window.scrollTo(0, 0);
    const next = document.querySelector('.tab:not([hidden])');
    if (next) { move(next, -dir * w, 0); next.getBoundingClientRect(); move(next, 0, SLIDE_MS); await after(SLIDE_MS); move(next, 0, 0); } // 次のページを反対側から
    busy = false;
  });
  document.addEventListener('touchcancel', () => { if (armed && page) move(page, 0, SLIDE_MS); armed = false; });
})();

function refreshAll() {
  document.querySelectorAll('.whenEmpty').forEach((e) => { e.hidden = !!data; });
  document.querySelectorAll('.whenData').forEach((e) => { e.hidden = !data; });
  $('dummyNote').hidden = !(data && data.dummy);
  hooks.render();
  for (const f of ESV.renderers) f();
  if ($('dataInfo')) $('dataInfo').textContent = (data
    ? 'データ：' + dataMeta.fileName + '（作成 ' + fmtJst(data.generatedAt) + '、読み込み ' + fmtJst(dataMeta.importedAt) + '）' + hooks.describe()
    : 'データ：まだ読み込んでいません。') +
    '　旧ランク表：' + (ranks.old ? ranks.old.fileName : '未読み込み') +
    '　新ランク表：' + (ranks.new ? ranks.new.fileName + '（開始日 ' + ranks.new.startDate + '）' : '未読み込み');
  renderDriveInfo();
  showStatus();
}

//--------------------------------------------------------------
// バージョンと更新
//--------------------------------------------------------------
$('appVersion').textContent = self.APP_VERSION;
// 新しい版の Service Worker に入れ替わるまで待ってから再読み込みする（最大 15 秒）
// 先に保管庫を消すと、入れ替わる前に古い版の Service Worker が古いファイルを取り直してしまうことがあるため、消さない
// （古い版の保管庫は、新しい版の Service Worker が入れ替わるときに消す。消すのは自分の接頭辞のものだけ）
// 戻り値：入れ替わったら true（再読み込みする）。入れ替わらなければ false
function waitForNewWorker(reg, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    navigator.serviceWorker.addEventListener('controllerchange', () => finish(true), { once: true });
    const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'activated') finish(true); if (w.state === 'redundant') finish(false); });
    watch(reg.installing); watch(reg.waiting);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    if (reg.waiting) reg.waiting.postMessage('skipWaiting');
    setTimeout(() => finish(false), ms);
  });
}

async function applyUpdate() {
  $('status').textContent = '更新中…';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      const waiting = waitForNewWorker(reg, 15000);
      await reg.update();
      const ok = await waiting;
      if (!ok && !(await newerVersion())) {
        showStatus();
        alert('新しいバージョンの準備ができませんでした。公開の直後は、反映まで数分かかることがあります。少し待ってから、もう一度お試しください。');
        return;
      }
    }
  } catch { /* 失敗しても再読み込みで取り直す */ }
  location.reload();
}
// 「新しいバージョンがあります［更新する］」は、新しい版に入れ替わったあとに出るので、すぐ再読み込みする
$('reloadBtn').addEventListener('click', () => location.reload());

// 公開サイトの一時保管（最大 10 分）を通さずに、最新の版の番号を読む。今より新しければその番号、同じなら null
async function newerVersion() {
  const res = await fetch('version.js?t=' + Date.now(), { cache: 'no-store' });
  const latest = ((await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  return latest && latest !== self.APP_VERSION ? latest : null;
}

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
    const latest = await newerVersion();
    if (latest) {
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
    // 表示と配色の設定はなくした（2026-10 ユーザー指示）。以前に端末で変えていた設定は消して、標準に戻す
    applyAppearance(APPEARANCE_DEFAULT);
    delSetting('appearance').catch(() => { /* なくてもよい */ });
    for (const f of ESV.loaders) await f();
    if (h.init) await h.init();
    refreshAll();
    showStorageInfo();
  },
};
