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
  if (!ok) return;

  const now = Math.floor(Date.now() / 1000);
  const rk = { old: ranks.old, new: ranks.new };
  const s = Reward.settled(split, rk, now);
  const rankText = (r, rate) => (r ? r.name + ' ' + pct(rate) : 'ランク外 0%');
  $('rewardAsOf').textContent = '今日（' + fmtDay(now) + '）までの確定分です。預入の日時から24時間ごとに1日と数えます。新ランク表の開始日：' + ranks.new.startDate;

  $('rewardCards').replaceChildren(...who.map((w) => {
    const reward = w.share * s.factor;
    const rows = [
      ['預入枚数', fmtAmount(w.share) + (showTotal && w.share !== s.total ? '（合計 ' + fmtAmount(s.total) + ' の ' + pct(w.share / s.total) + '）' : '')],
      ['報酬枚数', fmtAmount(reward)],
      ['　旧ランク表', rankText(s.rankOld, s.rateOld) + ' × ' + s.oldDays + ' 日'],
      ['　新ランク表', rankText(s.rankNew, s.rateNew) + ' × ' + s.newDays + ' 日'],
      ['経過日数', s.days + ' 日（1日目：' + fmtDate(s.firstDay) + '）'],
      ['預入日時', fmtDate(split.t)],
    ];
    return el('div', { class: 'card wide' }, el('div', { class: 'sym' }, w.name + ' の枚数（預入＋報酬）'),
      el('div', { class: 'val' }, fmtAmount(w.share + reward), el('small', {}, sym)),
      el('div', { class: 'bal-extra' }, ...rows.flatMap(([k, v]) => [el('span', {}, k), el('b', {}, v)])));
  }));

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
    unit: sym, xTicks: [[0, '今日'], [12, '1年後'], [24, '2年後'], [36, '3年後']],
    title: target.name + ' の枚数の見込み（' + (rewardMode === 'simple' ? '単利' : '複利') + '）',
  });

  // 表（グラフをなぞらなくても値が読めるように）
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  $('rewardTable').replaceChildren(
    el('tr', {}, th('時点'), th('単利（' + sym + '）', 1), th('複利（' + sym + '）', 1)),
    ...[0, 12, 24, 36].map((m) => el('tr', {}, td(label(proj.simple[m])), td(fmtAmount(target.share * proj.simple[m].g), 1), td(fmtAmount(target.share * proj.compound[m].g), 1))));
}

document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { rewardMode = b.dataset.mode; refreshAll(); }));
$('whoSel').addEventListener('change', () => { rewardWho = $('whoSel').value; refreshAll(); });
// 画面の幅が変わったらグラフを描き直す（タブを開いたときも）
let rewardResize = null;
window.addEventListener('resize', () => { clearTimeout(rewardResize); rewardResize = setTimeout(() => { if (!$('tab-reward').hidden) refreshAll(); }, 200); });
document.querySelector('[data-tab=reward]').addEventListener('click', () => setTimeout(refreshAll, 0));
