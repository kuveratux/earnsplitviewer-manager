'use strict';

// 画面の部品（Manager・Agent 共通）：取引タブ（分配の内訳・区分別の件数・取引一覧）
// core.js の後、各アプリの app.js の前に読み込む

const CLS_LABEL = { manager: 'Manager', agent: 'Agent', deposit: '預け入れ', receive: '受け取り', split: 'EARN' }; // 区分「分配」は 2026-10 に「EARN」へ改名（内部の値は split のまま）
const CLS_ORDER = ['split', 'manager', 'agent', 'deposit', 'receive'];
const pct = (v) => Number((Number(v) * 100).toFixed(4)) + '%';

// アドレスの表示名（アドレス帳ができたら名前を返す。今は短縮表示）
let nameOf = (addr) => short(addr);

const clsTag = (cls) => el('span', { class: 'tag cls-' + cls }, CLS_LABEL[cls] || cls);

// 取引タブを描く
// 取引タブは2つの折りたたみ：配布先の取引（タイトルはランキングでの表示名）と、コントラクト全体の直近取引（2026-10）
// opts：{ clsList（表示する区分）, amountOf（行 → 表示する枚数）, mineName（配布先の取引のタイトルに使う名前）, explorer }
function renderTxTab(opts) {
  const rows = data.transfers;
  const sym = data.token.symbol;
  $('mineTitle').textContent = opts.mineName + 'の取引';

  // 区分別（件数・受取・送付）
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  $('clsTable').replaceChildren(
    el('tr', {}, th('区分'), th('件数', 1), th('受取', 1), th('送付', 1)),
    ...opts.clsList.map((cls) => {
      const rs = rows.filter((x) => x.cls === cls);
      const sum = (dir) => rs.filter((x) => x.dir === dir).reduce((a, x) => a + Number(opts.amountOf(x)), 0);
      return el('tr', {}, el('td', {}, clsTag(cls)), td(String(rs.length), 1), td(hid(fmtDec1(sum('in'))), 1), td(hid(fmtDec1(sum('out'))), 1));
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
        el('span', { class: 'tx-amt ' + x.dir }, (x.dir === 'in' ? '+' : '−') + hid(fmtDec1(opts.amountOf(x))) + ' ' + sym)),
      el('button', { class: 'cp', type: 'button', onclick: () => openNameDialog(x.counterparty) },
        el('span', { class: 'cp-label' }, x.dir === 'in' ? '受取元：' : '送付先：'), nameOf(x.counterparty)),
      link ? el('div', {}, link) : null);
  }));
  renderRecent(opts);
}

// 取引タブの枚数（区分別の表・配布先の取引・直近取引）は小数第1位まで（切り捨て。2026-10 ユーザー指示）
const fmtDec1 = (v) => (Math.floor(Number(v) * 10 + 1e-7) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 });

// コントラクト全体の直近取引（保有者ランキングを取得した時点の新しい 100 件）。まず 10 件、［さらに10件］で 10 件ずつ増やす
let recentShown = 10;
function renderRecent(opts) {
  const sym = data.token.symbol;
  const rg = data.ranking;
  const list = (rg && rg.recent) || [];
  $('recentTitle').textContent = sym + 'の直近取引';
  $('recentNote').textContent = !rg ? 'このデータには保有者ランキングが入っていないため、直近取引はありません。'
    : !list.length ? 'このデータには直近取引が入っていません（保有者ランキングを取得し直すと入ります）。'
    : ''; // 取引があるときの説明は出さない（2026-10 ユーザー指示）
  $('recentNote').hidden = !$('recentNote').textContent;
  const self = (rg && rg.self) || '';
  const community = new Set(((rg && rg.source && rg.source.community) || []).map((a) => a.toLowerCase()));
  const ZERO = '0x' + '0'.repeat(40);
  // アドレスの見せ方：配布先は名前、運営は Community の名前、0x000…（発行・焼却）はそのことがわかるように、ほかは短縮
  const who = (a, zeroText) => (a === self ? opts.mineName : a === ZERO ? zeroText : community.has(a) ? comName() : short(a));
  $('recentList').replaceChildren(...list.slice(0, recentShown).map((x) => {
    const mine = x.from === self || x.to === self; // 配布先の取引は、隠すときに枚数も隠す
    const link = data.dummy || !opts.explorer || !x.tx ? null :
      el('a', { class: 'tx-link', href: opts.explorer + '/tx/' + x.tx, target: '_blank', rel: 'noopener noreferrer' }, 'エクスプローラーで見る');
    return el('li', mine ? { class: 'mine' } : {},
      el('div', { class: 'tx-top' },
        el('span', { class: 'tx-date' }, fmtDate(x.t)),
        el('span', { class: 'tx-amt' }, (mine ? hid(fmtDec1(x.amount)) : fmtDec1(x.amount)) + ' ' + sym)),
      el('div', { class: 'recent-route' }, who(x.from, '発行'), ' → ', who(x.to, '焼却')),
      link ? el('div', {}, link) : null);
  }));
  const more = $('recentMore');
  more.hidden = recentShown >= list.length;
  more.onclick = () => { recentShown = Math.min(recentShown + 10, 100); renderRecent(opts); };
}

//--------------------------------------------------------------
// 報酬タブ（確定分のカードと、3年後までの見込みグラフ）
// who：[{ id, name, share（預入枚数） }]。Manager は2人分と合算、Agent は自分だけ。グラフの対象もこの並び
//--------------------------------------------------------------
let rewardMode = 'simple';

// 次の段階までの進み具合：見出し（左・右）と進捗バー。ratio は 0〜1。目のマークで隠すときはバーも空にする（2.2、EARN VIEWER 1.0.3 から取り込み）
// foot：バーの下の小さい説明（右寄せ。省略可）
function progressBlock(left, right, ratio, foot) {
  const r = showYen ? Math.max(0, Math.min(1, ratio || 0)) : 0;
  return el('div', { class: 'prog' },
    el('div', { class: 'prog-head' }, el('span', {}, left), el('span', { class: 'prog-need' }, right)),
    el('div', { class: 'prog-bar' }, el('span', { style: 'width:' + (r * 100).toFixed(1) + '%' })),
    foot && showYen ? el('div', { class: 'prog-foot' }, foot) : null); // 隠すときは次のランクの名前も出さない（今のランクがわかるため）
}

// 今の EARN Tier と次のランクまで：ランクは預入枚数（分ける前の合計）で決まるので、あと何枚預ければ上がるか（報酬は含めない）
// 表は次の1日に使うもの（rankNow と同じ。新ランク表の開始日の前後で旧・新を切り替える）
function tierProgress(split, rk, s, sym) {
  const table = split.t + (s.days + 1) * Reward.DAY < Date.parse(rk.new.startDate + 'T00:00:00+09:00') / 1000 ? rk.old.ranks : rk.new.ranks;
  const cur = s.rankNow;
  const next = table.find((r) => r.min > s.total);
  const name = el('span', { class: 'tier-nb' }, showYen ? tierIcon(cur && cur.name) : null, hid(cur ? cur.name : 'ランク外'));
  if (!next) return progressBlock(el('span', { class: 'tier-inline' }, 'EARN Tier：', name), hid('最上位です'), 1);
  const from = cur ? cur.min : 0;
  // 1行に収まるよう、右は「あと ○ 枚」だけ。次のランクの名前と下限はバーの下に
  return progressBlock(el('span', { class: 'tier-inline' }, 'EARN Tier：', name),
    'あと ' + hid(fmtInt(Math.ceil(next.min - s.total))) + ' ' + sym,
    (s.total - from) / (next.min - from),
    '次の ' + next.name + '（預入 ' + fmtInt(next.min) + ' ' + sym + ' 以上）まで');
}

// 配布先アドレスのウォレット残高（2.1.1、ユーザー決定）。保有者ランキングを取得した時点の値（データの ranking.source.wallet）
// ランキングと同じ決まりで Manager 分（と合算）に入れ、Agent 分は 0。ホームの総枚数・資産額、報酬タブの保有枚数・運用シミュレーションに含める
function walletOf(id) {
  if (id === 'agent') return 0;
  const rg = data && data.ranking;
  if (!rg || !rg.source || !rg.source.wallet || !rg.self) return 0;
  const raw = rg.source.wallet[String(rg.self).toLowerCase()];
  return raw ? Deposits.toTokens(BigInt(raw), rg.source.decimals) : 0;
}

// 報酬タブの枚数は横幅を取らないよう切り捨てて表示する（ユーザー指示）
// 大きい数字は整数、小さくなりうる「1日あたり」「期間の報酬」は小数2桁まで。計算の誤差（7199.9999…）で1つ少なく出ないよう、わずかに足してから切り捨てる
const fmtInt = (v) => Math.floor(Number(v) + 1e-9).toLocaleString('ja-JP');
// 表示・非表示（目のマーク。アプリ全体で1つ、2026-10）：隠すときは円の金額・％に加えて、自分の TUX の枚数・ランク情報・順位も「＊＊＊」にする
const hid = (str) => (showYen ? str : HIDDEN);
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
  $('rewardNote').textContent = !split ? '「EARN」に仕分けた取引がないため、報酬は計算していません。'
    : 'ランク表が読み込まれていないため、報酬を計算できません。' + FETCH_HINT() + 'で、新しいデータを読み込んでください。';
  $('rewardBody').hidden = !ok;
  // 資産タブも同じ条件（預入とランク表がないと、枚数を計算できない）
  $('assetNote').hidden = !!ok;
  $('assetNote').textContent = $('rewardNote').textContent;
  $('assetBody').hidden = !ok;
  if (!ok) return;

  const now = Math.floor(Date.now() / 1000);
  const rk = rewardRanks(); // 自分の報酬は TEEP を掛けた表で（version 4 のとき。工程表 E-04）
  const s = Reward.settled(split, rk, now);

  // 保有枚数（預入＋報酬）のカード。数字は資産タブの資産額と同じ大きさ。内訳は折りたたみ（起動時は開く）
  const multi = APP.id === 'manager'; // Manager は対象名を添える
  const rewardList = opts.rewardWho || who;
  $('rewardCards').replaceChildren(...(rewardList.length ? [] : [el('div', { class: 'card' }, el('p', { class: 'muted' }, '表示する対象がありません。「設定」の「保有枚数の表示」で選んでください。'))]), ...rewardList.map((w, wi) => {
    const reward = w.share * s.factor;
    const wallet = walletOf(w.id);
    const rows = [
      ...(w.id === 'agent' ? [] : [['ウォレット残高', hid(fmtInt(wallet)) + ' ' + sym]]),
      ['預入枚数', hid(fmtInt(w.share)) + ' ' + sym + (showYen && showTotal && w.share !== s.total ? '（' + pct(w.share / s.total) + '）' : '')],
      // 報酬枚数：1行目に枚数、2行目に1日あたり
      ['報酬枚数', el('span', {}, hid(fmtInt(reward)) + ' ' + sym, el('br'), el('span', { class: 'per-day' }, hid(fmtDec2(w.share * s.rateNow / 365)) + ' ' + sym + '/日'))],
      ['預入日時', fmtDate(split.t)],
      // 預入期間：「EARN Tier：Gold(9.75%) 30日」の形。ランクと年利は今のもの。旧・新の日数の内訳は出さない（2.1、EARN VIEWER に合わせる）
      ['預入期間', el('span', { class: 'tier-inline' }, 'EARN Tier：', el('span', { class: 'tier-nb' }, showYen ? tierIcon(s.rankNow && s.rankNow.name) : null,
        hid(s.rankNow ? s.rankNow.name + '(' + pct(s.rateNow) + ')' : 'ランク外(0%)')), ' ' + s.days + '日')],
    ];
    const key = 'reward-' + w.id;
    const d = el('details', { class: 'fold' },
      el('summary', {}, el('span', {}, '内訳')),
      el('div', { class: 'fold-body' }, el('div', { class: 'kv kv-plain' }, ...kvRows(rows))));
    d.open = !closedFolds.has(key);
    d.addEventListener('toggle', () => { if (d.open) closedFolds.delete(key); else closedFolds.add(key); });
    return el('div', { class: 'card asset-hero' },
      el('div', { class: 'sym' }, multi ? '保有枚数（' + labelOf_(w) + '）' : '保有枚数'),
      el('div', { class: 'hero-row' }, coinIcons[w.id] ? el('img', { class: 'coin-icon', src: coinIcons[w.id], alt: '' }) : null,
        el('span', { class: 'hero-val' }, hid(fmtInt(wallet + w.share + reward)) + ' ' + sym), wi === 0 ? eyeButton() : null),
      // EARN Tier と次のランクまで：Manager アプリの合算のカードだけ（ランクは分配全体の合計で決まる。Agent アプリには出さない。2.2 ユーザー決定）
      APP.id === 'manager' && w.id === 'total' ? tierProgress(split, rk, s, sym) : null,
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
  const tWallet = walletOf(target.id); // ウォレット残高（増えも減りもしない分として足す。報酬と引出しは預入の分で計算）
  const holding = tWallet + target.share * (1 + s.factor); // 今日の保有枚数
  const nowPrice = Number(data.price) || 0; // データの現在価格
  const wdUnitPrice = wdPrice > 0 ? wdPrice : nowPrice; // 空欄なら現在価格
  if (document.activeElement !== $('wdPrice')) $('wdPrice').value = wdPrice > 0 ? wdPrice : (nowPrice || '');
  if (document.activeElement !== $('wdYen')) $('wdYen').value = wdYen || '';
  showYenUnit();
  const withdraw = wdYen > 0 && wdUnitPrice > 0 ? wdYen / wdUnitPrice : 0; // 年間の枚数
  const perYear = { day: 365, week: 52, month: 12, year: 1 }[wdFreq];
  const freqJa = { day: '1日', week: '1週', month: '1か月', year: '1年' }[wdFreq];
  // 年間希望報酬が空欄のときは何も出さない（初めの説明はなくした。2026-10 ユーザー指示）
  $('wdInfo').replaceChildren(...(!(wdYen > 0) ? []
    : !(wdUnitPrice > 0) ? ['TUX価格を入力してください。']
    : ['必要な枚数：年間 ' + hid(fmtDec2(withdraw)) + ' ' + sym + (showYen && holding > 0 ? '（今日の保有枚数の ' + (withdraw / holding * 100).toFixed(1) + '%）' : ''), el('br'),
      freqJa + 'に ' + hid(fmtDec2(withdraw / perYear)) + ' ' + sym]));
  $('wdInfo').hidden = !$('wdInfo').textContent;
  const months = simYears * 12;
  const w = target.share > 0 ? withdraw / target.share : 0;
  const proj = { simple: Reward.project(split, rk, now, 'simple', months, w, wdFreq), compound: Reward.project(split, rk, now, 'compound', months, w, wdFreq) };
  const label = (p) => (p.month === 0 ? '今日' : p.month % 12 === 0 ? (p.month / 12) + '年後' : p.month + 'か月後') + '（' + fmtDay(p.t) + '）';
  const points = proj[rewardMode].map((p) => ({ v: tWallet + target.share * p.g, label: label(p) }));
  $('rewardTableTitle').textContent = simYears + '年後までの推移'; // 一覧の見出しは選んでいる期間に合わせる（2026-10 ユーザー指示）
  const step = simYears <= 1 ? 3 : simYears <= 5 ? 12 : 24; // 目盛り（1年は3か月ごと、5年までは1年ごと、10年は2年ごと）
  const ticks = [];
  for (let m = 0; m <= months; m += step) ticks.push([m, m === 0 ? '今日' : m % 12 === 0 ? (m / 12) + '年後' : m + 'か月']);
  if (showYen) {
    drawLineChart($('rewardChart'), points, {
      unit: sym, fmt: fmtInt, xTicks: ticks,
      title: target.name + ' の枚数の見込み（' + (rewardMode === 'simple' ? '単利' : '複利') + '・' + simYears + '年）',
    });
  } else {
    $('rewardChart').replaceChildren(el('div', { class: 'chart-hidden' }, '枚数を非表示にしています（目のマークで表示）'));
  }

  // 一覧：今日と、1年後〜選んだ年数後まで1年ごと
  const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
  const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
  const rows = [];
  for (let y = 0; y <= simYears; y++) rows.push(y * 12);
  $('rewardTable').replaceChildren(
    el('tr', {}, th('時点'), th('単利', 1), th('複利', 1)),
    ...rows.map((m) => el('tr', {}, td(label(proj.simple[m])), td(hid(fmtInt(tWallet + target.share * proj.simple[m].g)) + ' ' + sym, 1), td(hid(fmtInt(tWallet + target.share * proj.compound[m].g)) + ' ' + sym, 1))));
}

//--------------------------------------------------------------
// 資産タブ
// ・現在価格（1枚あたりの円）はデータに入っている値（取得エクセルの設定シートで入力。当面は固定）
// ・購入の記録もデータに入っている（Manager 用は Manager・Agent の両方、Agent 用は Agent の分だけ）
// ・購入分の平均単価＝購入金額の合計÷購入枚数の合計、総枚数の平均単価＝購入金額の合計÷総枚数（預入＋報酬）
// ・資産額＝総枚数×価格、含み損益＝資産額−購入金額の合計
// ・試算価格：価格が変わった場合の資産額・含み損益を見る（端末ごとに保存。空欄なら現在価格）
// ・目のマークで、円の金額・％と自分の枚数・ランク情報・順位を「＊＊＊」で隠す（ホーム・報酬・ランキングのどこからでも切り替え。端末ごとに保存）
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
// 資産額・保有枚数の内訳は、起動時は開いておく（2026-10 ユーザー指示）。利用者が閉じたものだけを覚えて、描き直しても閉じたままにする（起動し直すと開く）
const closedFolds = new Set();

// who：一番上と内訳に出す対象（順番どおり。一番上はその1番目）、all：シミュレーションの対象の選択に出す対象
function renderAsset(who, s, all = who) {
  const sym = data.token.symbol;
  const price = Number(data.price) || 0;
  const per = PERIODS[assetPeriod];
  // 試算価格：空欄なら「例」の価格（15 円で固定）で計算する（2026-10 ユーザー指示）
  const examplePrice = 15;
  const trial = trialPrice > 0 ? trialPrice : examplePrice;
  const na = '—';
  // 対象ごとの数字
  const calc = (w) => {
    const wallet = walletOf(w.id);
    const coins = wallet + w.share * (1 + s.factor); // 総枚数＝ウォレット残高＋預入＋報酬（2.1.1。Agent 分のウォレット残高は 0）
    const buys = purchasesOf(w.id);
    const qty = buys.reduce((a, p) => a + Number(p.qty), 0);
    const cost = buys.reduce((a, p) => a + Number(p.amount), 0);
    return { w, wallet, coins, buys, qty, cost, reward: w.share * s.rateNow / 365 * per.days };
  };
  const gain = (c, pr) => (c.cost > 0 ? signedYen(c.coins * pr - c.cost) + '（' + signedPct((c.coins * pr - c.cost) / c.cost) + '）' : na);

  // 一番上：資産額（Manager は合算、Agent は自分）と目のマーク
  paintEye($('eyeBtn'));
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
  // 現在価格：資産額の根拠として、すぐ下に小さく（取得エクセルで入れた値なので、データの作成日を「時点」として添える）
  const asOf = new Date(data.generatedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
  $('heroPrice').textContent = price && who.length ? '1 ' + sym + ' = ' + yenUnit(price) + '（' + asOf + ' 時点）' : '';

  // 資産額の内訳（対象ごとに折りたたみ。起動時は開く）
  $('assetList').replaceChildren(...who.map((w) => {
    const c = calc(w);
    const hasWallet = w.id !== 'agent'; // Agent 分のウォレット残高はいつも 0 なので行を出さない（2.1.1、ユーザー決定）
    const rows = [
      [hasWallet ? '総枚数（ウォレット残高＋預入＋報酬）' : '総枚数（預入＋報酬）', hid(fmtInt(c.coins)) + ' ' + sym],
      ...(hasWallet ? [['ウォレット残高', hid(fmtInt(c.wallet)) + ' ' + sym]] : []),
      ['預入枚数', hid(fmtInt(w.share)) + ' ' + sym],
      ['報酬枚数', hid(fmtInt(w.share * s.factor)) + ' ' + sym],
    ];
    // 購入情報（購入の記録は取得エクセルの「購入履歴」シートからデータで配る）
    const buyRows = [
      ['購入枚数', c.buys.length ? hid(fmtInt(c.qty)) + ' ' + sym : '購入の記録なし'],
      ['購入金額', c.buys.length ? yen(c.cost) : na],
      ['購入分の平均単価', c.qty > 0 ? yenUnit(c.cost / c.qty) : na],
      ['総枚数の平均単価', c.coins > 0 && c.buys.length ? yenUnit(c.cost / c.coins) : na],
    ];
    const fold = (key, summary, ...body) => {
      const f = el('details', { class: 'fold' }, summary, el('div', { class: 'fold-body' }, ...body));
      f.open = !closedFolds.has(key);
      f.addEventListener('toggle', () => { if (f.open) closedFolds.delete(key); else closedFolds.add(key); });
      return f;
    };
    // Manager：見出しは対象の名前と資産額。中を「内訳」「購入情報」の小見出しで分ける
    if (APP.id === 'manager') {
      return fold(w.id, el('summary', {}, el('span', {}, w.name), el('span', { class: 'fold-val' }, price ? yen(c.coins * price) : hid(fmtInt(c.coins)) + ' ' + sym)),
        el('div', { class: 'fold-sub-h' }, '内訳'), el('div', { class: 'kv kv-plain' }, ...kvRows(rows)),
        el('div', { class: 'fold-sub-h' }, '購入情報'), el('div', { class: 'kv kv-plain' }, ...kvRows(buyRows)));
    }
    // Agent：「内訳」と「購入情報」の2つの折りたたみ（EARN VIEWER と同じ）
    return el('div', { class: 'fold-group' },
      fold(w.id, el('summary', {}, el('span', {}, '内訳')), el('div', { class: 'kv kv-plain' }, ...kvRows(rows))),
      fold('buy-' + w.id, el('summary', {}, el('span', {}, '購入情報')), el('div', { class: 'kv kv-plain' }, ...kvRows(buyRows))));
  }));

  // 購入履歴の一覧（Agent アプリだけ。Manager アプリには一覧の欄がない）
  if ($('buyList')) {
    const list = [...(data.purchases || [])].sort((x, y) => y.date.localeCompare(x.date));
    $('buySummary').textContent = '購入履歴（' + list.length + ' 件）';
    const th = (t, n) => el('th', n ? { class: 'n' } : {}, t);
    const td = (t, n) => el('td', n ? { class: 'n' } : {}, t);
    $('buyList').replaceChildren(
      el('tr', {}, th('購入日'), th('枚数', 1), th('単価', 1), th('購入金額', 1)),
      ...(list.length ? list.map((p) => el('tr', {}, td(p.date.replace(/-/g, '/')), td(hid(fmtInt(p.qty)), 1), td(yenUnit(p.unit), 1), td(yen(p.amount), 1)))
        : [el('tr', {}, el('td', { colspan: '4' }, '購入の記録はありません'))]));
  }

  // シミュレーション：縦に 資産額・含み損益・報酬、横に 現在価格・試算価格
  if (document.activeElement !== $('trialInput')) $('trialInput').value = trialPrice || '';
  $('trialInput').placeholder = '例：' + String(examplePrice);
  document.querySelectorAll('#periodSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === assetPeriod)));
  $('assetPrice').textContent = '現在価格：' + (price ? yenUnit(price) : '未設定');
  $('rateNow').replaceChildren(el('span', { class: 'tier-inline' }, 'EARN Tier：', el('span', { class: 'tier-nb' }, showYen ? tierIcon(s.rankNow && s.rankNow.name) : null,
    hid(s.rankNow ? s.rankNow.name + '(' + pct(s.rateNow) + ')' : 'ランク外(0%)')))); // 2.1：Tier のアイコン。1行で出す（括弧は半角で短く）
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
  const cell = (main, ...subs) => el('td', { class: 'n' }, main, ...subs.filter(Boolean).map((x) => el('div', { class: 'sim-sub' }, x)));
  // 金額の下に括弧付きで ○○万円・○.○億円（1万円未満〔絶対値〕・金額を隠しているときは出さない）
  const unitOf = (v, signed) => (showYen && Math.abs(v) >= 1e4 ? '（' + (signed ? (v >= 0 ? '+' : '−') : '') + yenUnitText(Math.abs(v)) + '）' : null);
  const col = (pr) => pr
    ? [cell(yen(c.coins * pr), unitOf(c.coins * pr)),
      cell(c.cost > 0 ? signedYen(c.coins * pr - c.cost) : na, c.cost > 0 ? unitOf(c.coins * pr - c.cost, true) : null, c.cost > 0 ? signedPct((c.coins * pr - c.cost) / c.cost) : null),
      cell(yen(c.reward * pr), unitOf(c.reward * pr), hid(fmtDec2(c.reward)) + ' ' + sym)]
    : [cell(na), cell(na), cell(na, hid(fmtDec2(c.reward)) + ' ' + sym)];
  const now = col(price);
  const tri = col(trial);
  // 期間のボタンとランクは、含み損益と報酬の行の間に置く（ボタンは左、ランクは表の右端）。画面に1つずつある部品を、行に移して使う
  const ctl = el('tr', { class: 'sim-ctl' }, el('td', { colspan: '3' }, el('div', { class: 'sim-ctl-in' }, $('periodSeg'), $('rateNow'))));
  $('simTable').replaceChildren(
    el('tr', {}, th(''), th('現在価格', 1), th('試算価格', 1)),
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
// 目のマーク（ホーム・報酬・ランキングに置く。どこで押してもアプリ全体の表示・非表示が切り替わる）
function paintEye(b) {
  b.innerHTML = showYen ? EYE_ON : EYE_OFF; // 固定の図形だけ（データは入れない）
  b.setAttribute('aria-pressed', String(showYen));
  b.setAttribute('aria-label', showYen ? '金額・枚数を隠す' : '金額・枚数を表示する');
}
function eyeButton() { const b = el('button', { type: 'button', class: 'eye eye-toggle' }); paintEye(b); return b; }
document.addEventListener('click', async (e) => {
  if (!e.target.closest('.eye-toggle')) return;
  showYen = !showYen;
  await putSetting('showYen', showYen);
  refreshAll();
});
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
// 年間希望報酬の横の読みやすい表示：1万円未満は円のまま、1億円未満は「○○万円」（小数1桁まで）、1億円以上は「○.○億円」
function yenUnitText(v) {
  if (!(v > 0)) return '';
  if (v < 1e4) return Math.floor(v).toLocaleString('ja-JP') + '円';
  if (v >= 1e8) return (Math.floor(v / 1e7) / 10).toFixed(1) + '億円';
  return (Math.round(v / 1e3) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円';
}
// 年間希望報酬の横：1行目「年間：○○」、2行目 引出しの期間あたり「1日：○○」など（引出しを切り替えると変わる）
const showYenUnit = () => {
  const v = Number($('wdYen').value);
  const per = { day: 365, week: 52, month: 12, year: 1 }[wdFreq];
  const ja = { day: '1日', week: '1週', month: '1か月', year: '1年' }[wdFreq];
  $('wdYenUnit').replaceChildren(...(v > 0 ? [el('span', {}, '年間：' + yenUnitText(v)), ...(per > 1 ? [el('span', {}, ja + '：' + yenUnitText(v / per))] : [])] : []));
};
$('wdYen').addEventListener('input', showYenUnit);
document.querySelectorAll('#wdFreqSeg button').forEach((b) => b.addEventListener('click', async () => { wdFreq = b.dataset.freq; await putSetting('wdFreq', wdFreq); refreshAll(); }));
// ---- 画像・Community（データで配られる。取得エクセルの設定シート「■ 画像・Community」。2026-10）
// データの display を読んだとき、画像の目印（hash）や名前・色が変わったものだけを入れ替えて、端末に保存する（'display'）
// 以前の形のデータ（display がない）を読んだときは、保存してあるものをそのまま使う
// 以前スマホで選んでいた画像（'coinIcons'・'communityStyle'）は使わない（設定タブの欄もなくした）
let coinIcons = {};                                       // 保有枚数の数値の前の画像。id（total・manager・agent）→ データ URL
let communityStyle = { name: '', image: '', color: '' };   // ランキングのトークン配分内訳の運営の区分
let displayStore = { coin: {}, community: { name: '', color: '', image: null } }; // 画像は { png, hash }
function useDisplay() {
  coinIcons = Object.fromEntries(Object.entries(displayStore.coin || {}).filter(([, x]) => x && x.png).map(([k, x]) => [k, x.png]));
  const c = displayStore.community || {};
  communityStyle = { name: c.name || '', color: c.color || '', image: c.image && c.image.png ? c.image.png : '' };
}
async function applyDisplay(d) {
  if (!d || !d.display) return false;
  const nd = d.display;
  const hashOf = (x) => (x && x.hash) || '';
  const coin = { ...(displayStore.coin || {}) };
  let changed = false;
  for (const [id, x] of Object.entries(nd.coin || {})) { if (hashOf(coin[id]) !== hashOf(x)) { coin[id] = x || null; changed = true; } } // Agent 用のデータは agent だけ
  const oc = displayStore.community || {}, nc = nd.community || {};
  const community = { name: nc.name || '', color: nc.color || '', image: hashOf(oc.image) === hashOf(nc.image) ? oc.image || null : nc.image || null };
  if (community.name !== (oc.name || '') || community.color !== (oc.color || '') || hashOf(community.image) !== hashOf(oc.image)) changed = true;
  if (!changed) return false;
  displayStore = { coin, community };
  await putSetting('display', displayStore);
  useDisplay();
  return true;
}
ESV.loaders.push(async () => {
  const v = await getSetting('display');
  if (v && typeof v === 'object') displayStore = Object.assign({ coin: {}, community: { name: '', color: '', image: null } }, v);
  useDisplay();
  if (data) await applyDisplay(data); // 保存してあるデータに画像が入っていれば受け取る（更新した直後など）
  delSetting('coinIcons').catch(() => { /* 以前スマホで選んだ画像は使わない */ });
  delSetting('communityStyle').catch(() => { /* 同上 */ });
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

//--------------------------------------------------------------
// ヘルプ（資産シミュレーション・運用シミュレーションの見出しの横の丸付き ?。押すと画面の上に出す。2026-10）
// 入力のしかた・切り替え・空欄にしたときの動きを書く。Manager だけにある「対象」の選択は Manager のときだけ出す
//--------------------------------------------------------------
function helpItems(kind) {
  const mgr = APP.id === 'manager';
  if (kind === 'fish') {
    // 魚分類：手元＋元本が総供給量の何%以上か（fish.js の min）。枚数は今のデータの総供給量から（E-43、EV 1.0.10 と同じ）
    const v = rankingView(Math.floor(Date.now() / 1000));
    const sym = data.token.symbol;
    const amt = (p) => fmtInt(v.supply * p / 100);
    return ['魚分類', [
      ...Fish.CLASSES.map((c, i) => {
        const up = i ? Fish.CLASSES[i - 1].min : null;
        const range = up == null ? '総供給量の ' + c.min + '% 以上（' + amt(c.min) + ' ' + sym + ' 以上）'
          : c.min > 0 ? '総供給量の ' + c.min + '% 以上 ' + up + '% 未満（' + amt(c.min) + '〜' + amt(up) + ' ' + sym + ' 未満）'
          : '総供給量の ' + up + '% 未満（' + amt(up) + ' ' + sym + ' 未満）';
        return [(FISH_EMOJI[c.name] || '') + ' ' + c.name, range];
      }),
      [comName(), '運営のアドレスです（「トークン全体」のときだけ出します）。'],
      ['数え方', 'ウォレット残高と預入の元本を足した枚数で分けます（報酬は入れません）。総供給量は ' + fmtInt(v.supply) + ' ' + sym + '（データの取得時点）です。'],
    ]];
  }
  if (kind === 'asset') return ['資産シミュレーション', [
    ['現在価格', '取得エクセルの設定シートで決めた1枚あたりの価格です。データに入っていないときは、現在価格の列が「—」になります。'],
    ['試算価格', '価格が変わったときの資産額・含み損益・報酬を見るための1枚あたりの価格（円）です。入れた値はこの端末に保存されます。', '空欄のとき：例の価格（15 円）で計算します。'],
    ['日・週・月・年', '報酬の行を、その期間あたりの目安に切り替えます。今の EARN Tier の年利で計算します（月は1年の12分の1）。'],
    ['含み損益', '資産額から購入金額の合計を引いたものです。購入の記録がないときは「—」になります。'],
    ...(mgr ? [['対象', '合算・Manager・Agent のどれで計算するかを選びます。']] : []),
    ['目のマーク', '押すと、金額・％・枚数を「＊＊＊」で隠します。'],
  ]];
  return ['運用シミュレーション', [
    ['単利・複利', '単利は、報酬を元本に足さずに計算します。複利は、毎日の報酬を足した枚数で次の日の報酬を計算します。'],
    ['1年・3年・5年・10年', 'グラフと「○年後までの推移」の期間を切り替えます。'],
    ['TUX価格', '引き出す枚数を計算するときの1枚あたりの価格（円）です。入れた値はこの端末に保存されます。', '空欄のとき：現在価格を使います（現在価格と同じ値を入れたときも同じです）。'],
    ['年間希望報酬', '1年間に受け取りたい金額（円）です。入れると、必要な枚数を計算し、引き出しながら運用した場合の推移を出します。入れた値はこの端末に保存されます。', '空欄のとき：引き出さずに運用した場合の推移を出します。'],
    ['引出し（日・週・月・年）', '引き出すタイミングです。日は毎日、週は7日ごと、月は1か月ごと、年は1年ごとに、年間の枚数を回数で割って引き出します。'],
    ...(mgr ? [['対象', '合算・Manager・Agent のどれで計算するかを選びます（「保有枚数の表示」で2つ以上選んでいるときに出ます）。']] : []),
    ['計算について', '今の EARN Tier の年利で計算した目安です。引き出して枚数が減っても EARN Tier は下げずに計算します。'],
  ]];
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.help-btn');
  if (b && b.dataset.help) openHelp(b.dataset.help);
});
function openHelp(kind) {
  const [title, items] = helpItems(kind);
  $('helpTitle').textContent = title;
  $('helpBody').replaceChildren(...items.map(([h, text, empty]) => el('div', { class: 'help-item' },
    el('div', { class: 'help-h' }, h), el('p', {}, text), empty ? el('p', { class: 'help-empty' }, empty) : null)));
  $('helpDlg').showModal();
}
