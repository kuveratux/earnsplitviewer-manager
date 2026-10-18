'use strict';

// 画面の部品（Manager・Agent 共通）：取引タブ（分配の内訳・区分別の件数・取引一覧）
// core.js の後、各アプリの app.js の前に読み込む

const CLS_LABEL = { manager: 'Manager', agent: 'Agent', deposit: '預け入れ', receive: '受け取り', split: '分配' };
const CLS_ORDER = ['split', 'manager', 'agent', 'deposit', 'receive'];
const pct = (v) => Number((Number(v) * 100).toFixed(4)) + '%';

// アドレスの表示名（アドレス帳ができたら名前を返す。今は短縮表示）
let nameOf = (addr) => short(addr);

const clsTag = (cls) => el('span', { class: 'tag cls-' + cls }, CLS_LABEL[cls] || cls);

// 取引タブを描く
// opts：{ clsList（表示する区分）, amountOf（行 → 表示する枚数）, splitRows（分配の内訳 [[見出し, 値], …]）, explorer }
function renderTxTab(opts) {
  const rows = data.transfers;
  const sym = data.token.symbol;

  // 分配の内訳（分配は常に1件の想定）
  const split = rows.find((x) => x.cls === 'split');
  $('splitCard').replaceChildren(split
    ? el('div', { class: 'card' }, el('div', { class: 'sym' }, '預入（' + fmtDate(split.t) + '）'),
      el('div', { class: 'kv kv-plain' }, ...kvRows(opts.splitRows(split).map(([k, v]) => [k, v]))))
    : el('div', { class: 'card' }, el('div', { class: 'muted' }, '「分配」に仕分けた取引はありません。')));

  // 区分別（件数・受取・送付）
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  $('clsTable').replaceChildren(
    el('tr', {}, th('区分'), th('件数', 1), th('受取（' + sym + '）', 1), th('送付（' + sym + '）', 1)),
    ...opts.clsList.map((cls) => {
      const rs = rows.filter((x) => x.cls === cls);
      const sum = (dir) => rs.filter((x) => x.dir === dir).reduce((a, x) => a + Number(opts.amountOf(x)), 0);
      return el('tr', {}, el('td', {}, clsTag(cls)), td(String(rs.length), 1), td(fmtAmount(sum('in')), 1), td(fmtAmount(sum('out')), 1));
    }));

  // 絞り込みの選択肢
  const sel = $('clsSel');
  if (!sel.options.length) sel.replaceChildren(el('option', { value: '' }, 'すべて'), ...opts.clsList.map((c) => el('option', { value: c }, CLS_LABEL[c])));
  const cls = sel.value;
  const dir = $('dirSel').value;

  const list = rows.filter((x) => (!cls || x.cls === cls) && (!dir || x.dir === dir)).sort((a, b) => b.t - a.t);
  $('txCount').textContent = list.length + ' 件';
  $('txList').replaceChildren(...list.map((x) => {
    const link = data.dummy || !opts.explorer || !x.tx ? null :
      el('a', { class: 'tx-link', href: opts.explorer + '/tx/' + x.tx, target: '_blank', rel: 'noopener noreferrer' }, 'エクスプローラーで見る');
    return el('li', {},
      el('div', { class: 'tx-top' },
        el('span', { class: 'tx-date' }, fmtDate(x.t), clsTag(x.cls)),
        el('span', { class: 'tx-amt ' + x.dir }, (x.dir === 'in' ? '+' : '−') + fmtAmount(opts.amountOf(x)) + ' ' + sym)),
      el('button', { class: 'cp', type: 'button', onclick: () => openNameDialog(x.counterparty) },
        el('span', { class: 'cp-label' }, x.dir === 'in' ? '受取元：' : '送付先：'), nameOf(x.counterparty)),
      link ? el('div', {}, link) : null);
  }));
}

//--------------------------------------------------------------
// 報酬タブ（確定分のカードと、3年後までの見込みグラフ）
// who：[{ id, name, share（預入枚数） }]。Manager は2人分と合算、Agent は自分だけ。グラフの対象もこの並び
//--------------------------------------------------------------
let rewardMode = 'simple';

// 報酬タブの枚数は横幅を取らないよう切り捨てて表示する（ユーザー指示）
// 大きい数字は整数、小さくなりうる「1日あたり」「期間の報酬」は小数2桁まで。計算の誤差（7199.9999…）で1つ少なく出ないよう、わずかに足してから切り捨てる
const fmtInt = (v) => Math.floor(Number(v) + 1e-9).toLocaleString('ja-JP');
const fmtDec2 = (v) => (Math.floor(Number(v) * 100 + 1e-7) / 100).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
let rewardWho = '';

// showTotal：合計枚数と割合を表示するか（Manager は表示、Agent は表示しない）
function renderRewardTab(who, showTotal = true) {
  const sym = data.token.symbol;
  const split = data.transfers.find((x) => x.cls === 'split');
  const ok = split && ranks.old && ranks.new;
  $('rewardNote').hidden = !!ok;
  $('rewardNote').textContent = !split ? '「分配」に仕分けた取引がないため、報酬は計算していません。'
    : 'ランク表（旧・新）が読み込まれていないため、報酬を計算できません。「設定」で読み込んでください。';
  $('rewardBody').hidden = !ok;
  // 資産タブも同じ条件（預入とランク表がないと、枚数を計算できない）
  $('assetNote').hidden = !!ok;
  $('assetNote').textContent = $('rewardNote').textContent;
  $('assetBody').hidden = !ok;
  if (!ok) return;

  const now = Math.floor(Date.now() / 1000);
  const rk = { old: ranks.old, new: ranks.new };
  const s = Reward.settled(split, rk, now);
  const rankText = (r, rate) => (r ? r.name + ' ' + pct(rate) : 'ランク外 0%');
  $('rewardAsOf').textContent = '今日（' + fmtDay(now) + '）までの確定分です。預入の日時から24時間ごとに1日と数えます。新ランク表の開始日：' + ranks.new.startDate;

  $('rewardCards').replaceChildren(...who.map((w) => {
    const reward = w.share * s.factor;
    const rows = [
      ['預入枚数', fmtInt(w.share) + (showTotal && w.share !== s.total ? '（合計 ' + fmtInt(s.total) + ' の ' + pct(w.share / s.total) + '）' : '')],
      ['報酬枚数', fmtInt(reward) + '（1日 ' + fmtDec2(w.share * s.rateNow / 365) + '）'],
      ['　旧ランク表', rankText(s.rankOld, s.rateOld) + ' × ' + s.oldDays + ' 日'],
      ['　新ランク表', rankText(s.rankNew, s.rateNew) + ' × ' + s.newDays + ' 日'],
      ['経過日数', s.days + ' 日'],
      ['預入日時', fmtDate(split.t)],
    ];
    return el('div', { class: 'card wide' }, el('div', { class: 'sym' }, w.name + ' の枚数（預入＋報酬）'),
      el('div', { class: 'val' }, fmtInt(w.share + reward), el('small', {}, sym)),
      el('div', { class: 'bal-extra' }, ...rows.flatMap(([k, v]) => [el('span', {}, k), el('b', {}, v)])));
  }));

  renderAsset(who, s);

  // 見込み：対象（Manager は Manager 分・Agent 分・合算を切り替え）
  const targets = who;
  const sel = $('whoSel');
  sel.hidden = targets.length < 2;
  if (sel.options.length !== targets.length) sel.replaceChildren(...targets.map((t) => el('option', { value: t.id }, t.name)));
  if (!targets.some((t) => t.id === rewardWho)) rewardWho = targets[0].id;
  sel.value = rewardWho;
  const target = targets.find((t) => t.id === rewardWho);
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === rewardMode)));

  const proj = { simple: Reward.project(split, rk, now, 'simple'), compound: Reward.project(split, rk, now, 'compound') };
  const label = (p) => (p.month === 0 ? '今日' : p.month % 12 === 0 ? (p.month / 12) + '年後' : p.month + 'か月後') + '（' + fmtDay(p.t) + '）';
  const points = proj[rewardMode].map((p) => ({ v: target.share * p.g, label: label(p) }));
  drawLineChart($('rewardChart'), points, {
    unit: sym, fmt: fmtInt, xTicks: [[0, '今日'], [12, '1年後'], [24, '2年後'], [36, '3年後']],
    title: target.name + ' の枚数の見込み（' + (rewardMode === 'simple' ? '単利' : '複利') + '）',
  });

  // 表（グラフをなぞらなくても値が読めるように）
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  $('rewardTable').replaceChildren(
    el('tr', {}, th('時点'), th('単利（' + sym + '）', 1), th('複利（' + sym + '）', 1)),
    ...[0, 12, 24, 36].map((m) => el('tr', {}, td(label(proj.simple[m])), td(fmtInt(target.share * proj.simple[m].g), 1), td(fmtInt(target.share * proj.compound[m].g), 1))));
}

//--------------------------------------------------------------
// 資産タブ
// ・現在価格（1枚あたりの円）はデータに入っている値（取得エクセルの設定シートで入力。当面は固定）
// ・購入の記録もデータに入っている（Manager 用は Manager・Agent の両方、Agent 用は Agent の分だけ）
// ・購入分の平均単価＝購入金額の合計÷購入枚数の合計、総枚数の平均単価＝購入金額の合計÷総枚数（預入＋報酬）
// ・資産額＝総枚数×価格、含み損益＝資産額−購入金額の合計
// ・試算価格：価格が変わった場合の資産額・含み損益を見る（端末ごとに保存。空欄なら現在価格）
// ・［金額を表示］をオフにすると、円の金額を「＊＊＊」で隠す（枚数は表示したまま。端末ごとに保存）
// ・報酬（日・週・月・年）は今の年利で計算した目安。月＝年÷12
//--------------------------------------------------------------
let trialPrice = 0;
let showYen = true;
let assetPeriod = 'day';
const PERIODS = { day: { label: '1日', days: 1 }, week: { label: '1週', days: 7 }, month: { label: '1か月', days: 365 / 12 }, year: { label: '1年', days: 365 } };
const HIDDEN = '＊＊＊';
const yen = (v) => (showYen ? Math.round(v).toLocaleString('ja-JP') + ' 円' : HIDDEN + ' 円');
const yenUnit = (v) => (showYen ? Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' 円' : HIDDEN + ' 円');
const signedYen = (v) => (showYen ? (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)).toLocaleString('ja-JP') + ' 円' : HIDDEN + ' 円');
const signedPct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';

// 対象の購入の記録。id が total なら全員分。Agent 用のデータには対象（who）がない（すべて Agent の分）
function purchasesOf(id) {
  return (data.purchases || []).filter((p) => id === 'total' || (p.who ? p.who === id : true));
}

function renderAsset(who, s) {
  const sym = data.token.symbol;
  const price = Number(data.price) || 0;
  const per = PERIODS[assetPeriod];
  const na = '—';
  // 一番上：資産額（Manager は合算、Agent は自分）と目のマーク
  const eye = $('eyeBtn');
  eye.innerHTML = showYen ? EYE_ON : EYE_OFF; // 固定の図形だけ（データは入れない）
  eye.setAttribute('aria-pressed', String(showYen));
  eye.setAttribute('aria-label', showYen ? '金額を隠す' : '金額を表示する');
  {
    const w = who[0];
    const coins = w.share * (1 + s.factor);
    const cost = purchasesOf(w.id).reduce((a, p) => a + Number(p.amount), 0);
    $('heroLabel').textContent = who.length > 1 ? '資産額（合算）' : '資産額';
    $('heroValue').textContent = price ? yen(coins * price) : '—';
    $('heroSub').textContent = !price ? '現在価格が未設定のため、資産額は表示できません'
      : cost > 0 ? '含み損益 ' + signedYen(coins * price - cost) + '（' + signedPct((coins * price - cost) / cost) + '）' : '購入の記録はありません';
  }
  if (document.activeElement !== $('trialInput')) $('trialInput').value = trialPrice || '';
  $('trialInput').placeholder = price ? String(price) : '例：20';
  document.querySelectorAll('#periodSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === assetPeriod)));
  $('assetPrice').textContent = '現在価格：' + (price ? yenUnit(price) : '未設定（Manager が設定すると表示されます）') +
    '　今の年利：' + (s.rankNow ? s.rankNow.name + ' ' + pct(s.rateNow) : 'ランク外 0%');

  const trial = trialPrice > 0 ? trialPrice : 0;
  // スマホ幅でもはみ出さないよう、対象ごとに縦に並べる
  $('assetList').replaceChildren(...who.map((w) => {
    const coins = w.share * (1 + s.factor);
    const buys = purchasesOf(w.id);
    const qty = buys.reduce((a, p) => a + Number(p.qty), 0);
    const cost = buys.reduce((a, p) => a + Number(p.amount), 0);
    const reward = w.share * s.rateNow / 365 * per.days;
    const gain = (pr) => (cost > 0 ? signedYen(coins * pr - cost) + '（' + signedPct((coins * pr - cost) / cost) + '）' : na);
    const rows = [
      ['総枚数（預入＋報酬）', fmtInt(coins) + ' ' + sym],
      ['購入枚数', buys.length ? fmtInt(qty) + ' ' + sym + '（' + buys.length + ' 件）' : '購入の記録なし'],
      ['購入金額', buys.length ? yen(cost) : na],
      ['購入分の平均単価', qty > 0 ? yenUnit(cost / qty) : na],
      ['総枚数の平均単価', coins > 0 && buys.length ? yenUnit(cost / coins) : na],
      ['資産額', price ? yen(coins * price) : na],
      ['含み損益', price ? gain(price) : na],
    ];
    if (trial) {
      rows.push(['試算：資産額（' + yenUnit(trial) + '）', yen(coins * trial)]);
      rows.push(['試算：含み損益', gain(trial)]);
    }
    rows.push(['報酬（' + per.label + '）', fmtDec2(reward) + ' ' + sym + (price ? '（' + yen(reward * price) + '）' : '')]);
    return el('div', { class: 'asset-item' }, el('div', { class: 'asset-name' }, w.name), el('div', { class: 'kv kv-plain' }, ...kvRows(rows)));
  }));

  // 購入履歴の一覧（Agent アプリだけ。Manager アプリには一覧の欄がない）
  if ($('buyList')) {
    const list = [...(data.purchases || [])].sort((x, y) => y.date.localeCompare(x.date));
    $('buySummary').textContent = '購入履歴（' + list.length + ' 件）';
    const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
    const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
    $('buyList').replaceChildren(
      el('tr', {}, th('購入日'), th('枚数', 1), th('単価', 1), th('購入金額', 1)),
      ...(list.length ? list.map((p) => el('tr', {}, td(p.date.replace(/-/g, '/')), td(fmtInt(p.qty), 1), td(yenUnit(p.unit), 1), td(yen(p.amount), 1)))
        : [el('tr', {}, el('td', { colspan: '4' }, '購入の記録はありません'))]));
  }
}

// 目のマーク：押すたびに、タブ内の円の金額の表示・非表示を切り替える
const EYE_ON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2 12s3.6-7 10-7c2 0 3.8.7 5.3 1.7M22 12s-3.6 7-10 7c-2 0-3.8-.7-5.3-1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
$('eyeBtn').addEventListener('click', async () => { showYen = !showYen; await putSetting('showYen', showYen); refreshAll(); });
$('trialInput').addEventListener('change', async () => {
  const v = Number($('trialInput').value);
  trialPrice = Number.isFinite(v) && v > 0 ? v : 0;
  await putSetting('trialPrice', trialPrice);
  refreshAll();
});
document.querySelectorAll('#periodSeg button').forEach((b) => b.addEventListener('click', () => { assetPeriod = b.dataset.period; refreshAll(); }));
ESV.loaders.push(async () => {
  trialPrice = Number(await getSetting('trialPrice')) || 0;
  const v = await getSetting('showYen');
  showYen = v !== false;
  delSetting('price').catch(() => { /* 以前の「1枚あたりの金額」の入力値は使わない（現在価格はデータから） */ });
});

document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { rewardMode = b.dataset.mode; refreshAll(); }));
$('whoSel').addEventListener('change', () => { rewardWho = $('whoSel').value; refreshAll(); });
// 画面の幅が変わったらグラフを描き直す（タブを開いたときも）
let rewardResize = null;
window.addEventListener('resize', () => { clearTimeout(rewardResize); rewardResize = setTimeout(() => { if (!$('tab-reward').hidden) refreshAll(); }, 200); });
document.querySelector('[data-tab=reward]').addEventListener('click', () => setTimeout(refreshAll, 0));
