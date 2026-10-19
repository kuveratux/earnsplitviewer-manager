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
// opts.rewardWho：保有枚数のカードに出す対象（順番どおり）、opts.assetWho：資産タブに出す対象。省略時は who のすべて
// 運用シミュレーション・シミュレーションの対象の選択には、常に who のすべてを出す
const labelOf_ = (w) => (w.id === 'total' ? '合算' : w.name);
function renderRewardTab(who, showTotal = true, opts = {}) {
  const sym = data.token.symbol;
  const split = data.transfers.find((x) => x.cls === 'split');
  const ok = split && ranks.old && ranks.new;
  $('rewardNote').hidden = !!ok;
  $('rewardNote').textContent = !split ? '「分配」に仕分けた取引がないため、報酬は計算していません。'
    : 'ランク表が読み込まれていないため、報酬を計算できません。「設定」の［最新データを取得］で、新しいデータを読み込んでください。';
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

  // 保有枚数（預入＋報酬）のカード。数字は資産タブの資産額と同じ大きさ。内訳は折りたたみ（最初は閉じる）
  const multi = APP.id === 'manager'; // Manager は対象名を添える
  const rewardList = opts.rewardWho || who;
  const newStart = Date.parse(ranks.new.startDate + 'T00:00:00+09:00') / 1000;
  // 旧ランク表の最終日・新ランク表の開始日（内訳の見出しを短くするため、月/日だけ。年は預入日時でわかる）
  const md = (unix) => { const d = new Date((unix + 9 * 3600) * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
  const oldLast = md(newStart - Reward.DAY);
  const newFirst = md(newStart);
  $('rewardCards').replaceChildren(...(rewardList.length ? [] : [el('div', { class: 'card' }, el('p', { class: 'muted' }, '表示する対象がありません。「設定」の「保有枚数の表示」で選んでください。'))]), ...rewardList.map((w) => {
    const reward = w.share * s.factor;
    const rows = [
      ['預入枚数', fmtInt(w.share) + ' ' + sym + (showTotal && w.share !== s.total ? '（' + pct(w.share / s.total) + '）' : '')],
      // 報酬枚数：1行目に枚数、2行目に1日あたり
      ['報酬枚数', el('span', {}, fmtInt(reward) + ' ' + sym, el('br'), el('span', { class: 'per-day' }, fmtDec2(w.share * s.rateNow / 365) + ' ' + sym + '/日'))],
      ['預入日時', fmtDate(split.t)],
      ['経過日数', s.days + ' 日'],
      ['　旧ランク（〜' + oldLast + '）', rankText(s.rankOld, s.rateOld) + '（' + s.oldDays + ' 日）'],
      ['　新ランク（' + newFirst + '〜）', rankText(s.rankNew, s.rateNew) + '（' + s.newDays + ' 日）'],
    ];
    const key = 'reward-' + w.id;
    const d = el('details', { class: 'fold' },
      el('summary', {}, el('span', {}, '内訳')),
      el('div', { class: 'fold-body' }, el('div', { class: 'kv kv-plain' }, ...kvRows(rows))));
    d.open = openFolds.has(key);
    d.addEventListener('toggle', () => { if (d.open) openFolds.add(key); else openFolds.delete(key); });
    return el('div', { class: 'card asset-hero' },
      el('div', { class: 'sym' }, multi ? '保有枚数（' + labelOf_(w) + '）' : '保有枚数'),
      el('div', { class: 'hero-row' }, coinIcons[w.id] ? el('img', { class: 'coin-icon', src: coinIcons[w.id], alt: '' }) : null,
        el('span', { class: 'hero-val' }, fmtInt(w.share + reward) + ' ' + sym)),
      el('div', { class: 'hero-folds' }, d));
  }));

  // 資産タブのシミュレーションの対象も「資産タブの表示」に合わせる（何も選んでいなければ全員）
  renderAsset(opts.assetWho || who, s, opts.assetWho && opts.assetWho.length ? opts.assetWho : who);

  // 見込み：対象（Manager は Manager 分・Agent 分・合算を切り替え）
  // 運用シミュレーションの対象は「保有枚数の表示」に合わせる（何も選んでいなければ全員）
  const targets = rewardList.length ? rewardList : who;
  const sel = $('whoSel');
  sel.hidden = targets.length < 2;
  const tnames = targets.map((t) => t.name).join('|');
  if (sel.dataset.names !== tnames) { sel.replaceChildren(...targets.map((t) => el('option', { value: t.id }, t.name))); sel.dataset.names = tnames; }
  if (!targets.some((t) => t.id === rewardWho)) rewardWho = targets[0].id;
  sel.value = rewardWho;
  const target = targets.find((t) => t.id === rewardWho);
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === rewardMode)));

  // 運用シミュレーション：期間（1・3・5・10年）、引出し（TUX価格と年間希望報酬〔円〕から年間の枚数を出し、日・週・月・年のタイミングで引く）
  document.querySelectorAll('#yearsSeg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.years) === simYears)));
  document.querySelectorAll('#wdFreqSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.freq === wdFreq)));
  const holding = target.share * (1 + s.factor); // 今日の保有枚数
  const nowPrice = Number(data.price) || 0; // データの現在価格
  const wdUnitPrice = wdPrice > 0 ? wdPrice : nowPrice; // 空欄なら現在価格
  if (document.activeElement !== $('wdPrice')) $('wdPrice').value = wdPrice > 0 ? wdPrice : (nowPrice || '');
  if (document.activeElement !== $('wdYen')) $('wdYen').value = wdYen || '';
  const withdraw = wdYen > 0 && wdUnitPrice > 0 ? wdYen / wdUnitPrice : 0; // 年間の枚数
  const perYear = { day: 365, week: 52, month: 12, year: 1 }[wdFreq];
  const freqJa = { day: '1日', week: '1週', month: '1か月', year: '1年' }[wdFreq];
  $('wdInfo').replaceChildren(...(!(wdYen > 0) ? ['年間希望報酬を入れると、必要な枚数を計算して引き出します。']
    : !(wdUnitPrice > 0) ? ['TUX価格を入力してください。']
    : ['必要な枚数：年間 ' + fmtDec2(withdraw) + ' ' + sym + (holding > 0 ? '（今日の保有枚数の ' + (withdraw / holding * 100).toFixed(1) + '%）' : ''), el('br'),
      freqJa + 'に ' + fmtDec2(withdraw / perYear) + ' ' + sym]));
  const months = simYears * 12;
  const w = target.share > 0 ? withdraw / target.share : 0;
  const proj = { simple: Reward.project(split, rk, now, 'simple', months, w, wdFreq), compound: Reward.project(split, rk, now, 'compound', months, w, wdFreq) };
  const label = (p) => (p.month === 0 ? '今日' : p.month % 12 === 0 ? (p.month / 12) + '年後' : p.month + 'か月後') + '（' + fmtDay(p.t) + '）';
  const points = proj[rewardMode].map((p) => ({ v: target.share * p.g, label: label(p) }));
  const step = simYears <= 1 ? 3 : simYears <= 5 ? 12 : 24; // 目盛り（1年は3か月ごと、5年までは1年ごと、10年は2年ごと）
  const ticks = [];
  for (let m = 0; m <= months; m += step) ticks.push([m, m === 0 ? '今日' : m % 12 === 0 ? (m / 12) + '年後' : m + 'か月']);
  drawLineChart($('rewardChart'), points, {
    unit: sym, fmt: fmtInt, xTicks: ticks,
    title: target.name + ' の枚数の見込み（' + (rewardMode === 'simple' ? '単利' : '複利') + '・' + simYears + '年）',
  });

  // 一覧：今日と、1年後〜選んだ年数後まで1年ごと
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  const rows = [];
  for (let y = 0; y <= simYears; y++) rows.push(y * 12);
  $('rewardTable').replaceChildren(
    el('tr', {}, th('時点'), th('単利', 1), th('複利', 1)),
    ...rows.map((m) => el('tr', {}, td(label(proj.simple[m])), td(fmtInt(target.share * proj.simple[m].g) + ' ' + sym, 1), td(fmtInt(target.share * proj.compound[m].g) + ' ' + sym, 1))));
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
const signedPct = (v) => (showYen ? (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%' : HIDDEN + '%'); // 金額を隠すときは％も隠す

// 対象の購入の記録。id が total なら全員分。Agent 用のデータには対象（who）がない（すべて Agent の分）
function purchasesOf(id) {
  return (data.purchases || []).filter((p) => id === 'total' || (p.who ? p.who === id : true));
}

let simWho = '';
const openFolds = new Set(); // 開いている内訳（描き直しても開いたままにする）

// who：一番上と内訳に出す対象（順番どおり。一番上はその1番目）、all：シミュレーションの対象の選択に出す対象
function renderAsset(who, s, all = who) {
  const sym = data.token.symbol;
  const price = Number(data.price) || 0;
  const per = PERIODS[assetPeriod];
  // 試算価格：空欄なら「例」の価格（現在価格の2倍。現在価格がなければ 20 円）で計算する（2026-10 ユーザー指示）
  const examplePrice = price ? Math.round(price * 2 * 100) / 100 : 20;
  const trial = trialPrice > 0 ? trialPrice : examplePrice;
  const na = '—';
  // 対象ごとの数字
  const calc = (w) => {
    const coins = w.share * (1 + s.factor);
    const buys = purchasesOf(w.id);
    const qty = buys.reduce((a, p) => a + Number(p.qty), 0);
    const cost = buys.reduce((a, p) => a + Number(p.amount), 0);
    return { w, coins, buys, qty, cost, reward: w.share * s.rateNow / 365 * per.days };
  };
  const gain = (c, pr) => (c.cost > 0 ? signedYen(c.coins * pr - c.cost) + '（' + signedPct((c.coins * pr - c.cost) / c.cost) + '）' : na);

  // 一番上：資産額（Manager は合算、Agent は自分）と目のマーク
  const eye = $('eyeBtn');
  eye.innerHTML = showYen ? EYE_ON : EYE_OFF; // 固定の図形だけ（データは入れない）
  eye.setAttribute('aria-pressed', String(showYen));
  eye.setAttribute('aria-label', showYen ? '金額を隠す' : '金額を表示する');
  if (!who.length) {
    $('heroLabel').textContent = '資産額';
    $('heroValue').textContent = '—';
    $('heroSub').textContent = '表示する対象がありません。「設定」の「ホームの表示」で選んでください。';
  } else {
    const c = calc(who[0]);
    $('heroLabel').textContent = APP.id === 'manager' ? '資産額（' + labelOf_(who[0]) + '）' : '資産額';
    $('heroValue').textContent = price ? yen(c.coins * price) : '—';
    $('heroSub').textContent = !price ? '現在価格が未設定のため、資産額は表示できません'
      : c.cost > 0 ? '含み損益 ' + gain(c, price) : '購入の記録はありません';
  }

  // 資産額の内訳（対象ごとに折りたたみ。最初は閉じる）
  $('assetList').replaceChildren(...who.map((w) => {
    const c = calc(w);
    const rows = [
      ['総枚数（預入＋報酬）', fmtInt(c.coins) + ' ' + sym],
      ['報酬枚数', fmtInt(w.share * s.factor) + ' ' + sym],
      ['購入枚数', c.buys.length ? fmtInt(c.qty) + ' ' + sym : '購入の記録なし'],
      ['購入金額', c.buys.length ? yen(c.cost) : na],
      ['購入分の平均単価', c.qty > 0 ? yenUnit(c.cost / c.qty) : na],
      ['総枚数の平均単価', c.coins > 0 && c.buys.length ? yenUnit(c.cost / c.coins) : na],
    ];
    // 見出し：Manager は対象の名前と資産額、Agent は「内訳」だけ（一番上の資産額と同じなので）
    const multi = APP.id === 'manager';
    const d = el('details', { class: 'fold' },
      el('summary', {}, el('span', {}, multi ? w.name : '内訳'), multi ? el('span', { class: 'fold-val' }, price ? yen(c.coins * price) : fmtInt(c.coins) + ' ' + sym) : null),
      el('div', { class: 'fold-body' }, el('div', { class: 'kv kv-plain' }, ...kvRows(rows))));
    d.open = openFolds.has(w.id);
    d.addEventListener('toggle', () => { if (d.open) openFolds.add(w.id); else openFolds.delete(w.id); });
    return d;
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

  // シミュレーション：縦に 資産額・含み損益・報酬、横に 現在価格・試算価格
  if (document.activeElement !== $('trialInput')) $('trialInput').value = trialPrice || '';
  $('trialInput').placeholder = '例：' + String(examplePrice);
  document.querySelectorAll('#periodSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === assetPeriod)));
  $('assetPrice').textContent = '現在価格：' + (price ? yenUnit(price) : '未設定');
  $('rateNow').textContent = s.rankNow ? s.rankNow.name + ' ' + pct(s.rateNow) : 'ランク外 0%';
  if ($('simSel')) {
    // 名前が変わったときにも作り直す
    const names = all.map((w) => w.name).join('|');
    if ($('simSel').dataset.names !== names) { $('simSel').replaceChildren(...all.map((w) => el('option', { value: w.id }, w.name))); $('simSel').dataset.names = names; }
    if (!all.some((w) => w.id === simWho)) simWho = all[0].id;
    $('simSel').value = simWho;
  }
  const target = all.find((w) => w.id === simWho) || all[0];
  const c = calc(target);
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const cell = (main, sub) => el('td', { class: 'n' }, main, sub ? el('div', { class: 'sim-sub' }, sub) : null);
  const col = (pr) => pr
    ? [cell(yen(c.coins * pr)), cell(c.cost > 0 ? signedYen(c.coins * pr - c.cost) : na, c.cost > 0 ? signedPct((c.coins * pr - c.cost) / c.cost) : null), cell(yen(c.reward * pr), fmtDec2(c.reward) + ' ' + sym)]
    : [cell(na), cell(na), cell(na, fmtDec2(c.reward) + ' ' + sym)];
  const now = col(price);
  const tri = col(trial);
  // 期間のボタンとランクは、含み損益と報酬の行の間に置く（ボタンは左、ランクは表の右端）。画面に1つずつある部品を、行に移して使う
  const ctl = el('tr', { class: 'sim-ctl' }, el('td', { colspan: '3' }, el('div', { class: 'sim-ctl-in' }, $('periodSeg'), $('rateNow'))));
  $('simTable').replaceChildren(
    el('tr', {}, th(''), th('現在価格', 1), th(trialPrice > 0 ? '試算価格' : '試算価格（例）', 1)),
    el('tr', {}, el('th', {}, '資産額'), now[0], tri[0]),
    el('tr', {}, el('th', {}, '含み損益'), now[1], tri[1]),
    ctl,
    el('tr', {}, el('th', {}, '報酬（' + per.label + '）'), now[2], tri[2]));
  // ボタンを移したあと、空になった元の置き場は隠す（Manager は対象の選択が残る）
  document.querySelectorAll('#tab-asset .chart-controls').forEach((d) => { d.hidden = !d.querySelector('select'); });
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
if ($('simSel')) $('simSel').addEventListener('change', () => { simWho = $('simSel').value; refreshAll(); });
ESV.loaders.push(async () => {
  trialPrice = Number(await getSetting('trialPrice')) || 0;
  const v = await getSetting('showYen');
  showYen = v !== false;
  delSetting('price').catch(() => { /* 以前の「1枚あたりの金額」の入力値は使わない（現在価格はデータから） */ });
});

document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { rewardMode = b.dataset.mode; refreshAll(); }));
// 運用シミュレーションの期間と引出し（TUX価格・年間希望報酬・タイミング。端末ごとに保存）
let simYears = 3;
let wdPrice = 0;   // TUX価格（円）。0＝現在価格を使う
let wdYen = 0;     // 年間希望報酬（円）
let wdFreq = 'month';
document.querySelectorAll('#yearsSeg button').forEach((b) => b.addEventListener('click', async () => { simYears = Number(b.dataset.years); await putSetting('simYears', simYears); refreshAll(); }));
const numIn = (id) => { const v = Number($(id).value); return Number.isFinite(v) && v > 0 ? v : 0; };
$('wdPrice').addEventListener('change', async () => { wdPrice = numIn('wdPrice'); if (wdPrice && data && wdPrice === Number(data.price)) wdPrice = 0; await putSetting('wdPrice', wdPrice); refreshAll(); });
$('wdYen').addEventListener('change', async () => { wdYen = numIn('wdYen'); await putSetting('wdYen', wdYen); refreshAll(); });
document.querySelectorAll('#wdFreqSeg button').forEach((b) => b.addEventListener('click', async () => { wdFreq = b.dataset.freq; await putSetting('wdFreq', wdFreq); refreshAll(); }));
// ---- コインのアイコン（報酬タブの保有枚数の数値の前。スマホの中の画像を選んで設定し、この端末の中だけに保存）
// Manager は 合算・Manager・Agent の3つ、Agent は自分の1つ。画像は元の形のまま、長い辺を 160px に縮めた PNG（データ URL）で持つ
let coinIcons = {};
let coinPick = null; // 画像を選んでいる枠
const COIN_MAX = 160;
const coinSlots = () => (APP.id === 'manager'
  ? [['total', '合算'], ['manager', (typeof memberName === 'function' && data ? memberName('manager') : 'Manager')], ['agent', (typeof memberName === 'function' && data ? memberName('agent') : 'Agent')]]
  : [['agent', '保有枚数']]);
function renderCoinIcons() {
  const ul = $('coinIconList');
  if (!ul) return;
  ul.replaceChildren(...coinSlots().map(([id, label]) => el('li', {},
    el('span', { class: 'coin-prev' }, coinIcons[id] ? el('img', { src: coinIcons[id], alt: '' }) : el('span', { class: 'muted' }, 'なし')),
    el('div', { class: 'slot-text' }, el('b', {}, label)),
    el('button', { type: 'button', onclick: () => { coinPick = id; $('coinIconFile').value = ''; $('coinIconFile').click(); } }, coinIcons[id] ? '選び直す' : '画像を選ぶ'),
    coinIcons[id] ? el('button', { type: 'button', onclick: async () => { delete coinIcons[id]; await putSetting('coinIcons', coinIcons); refreshAll(); } }, '削除') : null)));
}
// 選んだ画像を縮めて PNG のデータ URL に（blob: は CSP で使えないので FileReader で読む）
const readAsDataUrl = (file) => new Promise((ok, ng) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ng(r.error); r.readAsDataURL(file); });
async function shrinkImage(file) {
  const img = new Image();
  img.src = await readAsDataUrl(file);
  await img.decode();
  const k = Math.min(1, COIN_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
if ($('coinIconFile')) $('coinIconFile').addEventListener('change', async () => {
  const f = $('coinIconFile').files[0];
  if (!f || !coinPick) return;
  try {
    coinIcons[coinPick] = await shrinkImage(f);
    await putSetting('coinIcons', coinIcons);
    refreshAll();
  } catch (e) {
    alert('この画像は読み込めませんでした（' + (e && e.message ? e.message : '形式が違います') + '）。JPEG や PNG の画像を選んでください。');
  }
});
ESV.renderers.push(renderCoinIcons);
ESV.loaders.push(async () => {
  const v = await getSetting('coinIcons');
  coinIcons = v && typeof v === 'object' ? v : {};
});

ESV.loaders.push(async () => {
  simYears = [1, 3, 5, 10].includes(Number(await getSetting('simYears'))) ? Number(await getSetting('simYears')) : 3;
  wdPrice = Number(await getSetting('wdPrice')) || 0;
  wdYen = Number(await getSetting('wdYen')) || 0;
  const f = await getSetting('wdFreq');
  wdFreq = ['day', 'week', 'month', 'year'].includes(f) ? f : 'month';
  delSetting('withdraw').catch(() => { /* 以前の「年間取り崩し（枚数）」は使わない */ });
});
$('whoSel').addEventListener('change', () => { rewardWho = $('whoSel').value; refreshAll(); });
// 画面の幅が変わったらグラフを描き直す（タブを開いたときも）
let rewardResize = null;
window.addEventListener('resize', () => { clearTimeout(rewardResize); rewardResize = setTimeout(() => { if (!$('tab-reward').hidden) refreshAll(); }, 200); });
document.querySelector('[data-tab=reward]').addEventListener('click', () => setTimeout(refreshAll, 0));
