'use strict';

// ランキングタブ（保有者ランキング）。Manager・Agent 共通
// ・データの ranking.source（保有者ランキング取得エクセルが作った元データ）から、開いた時点の報酬・魚分類で作り直す（report.js）
//   ランク表は ESV のデータのもの（ranks）を使う（報酬タブと同じ表で計算する）
// ・一番上：保有枚数（報酬タブと同じ）と推定順位・魚分類。分配で持ち分を分けているので一致するアドレスはなく「推定」
//     推定順位＝その保有枚数より ① の合計（手元＋元本＋報酬）が多い人の数＋1。配布先アドレス（ranking.self）の行は除いて比べる
// ・① 保有者ランキング／② 預入ランキング（切り替え）。順位の変化はエクセルで前回ランキングを作ったときとの比較
// ・名前は各スマホのアドレス一覧（book.js）の名前。押すと名前を付けられる
// 使う部品：deposits.js・fish.js・report.js（保有者ランキングの部品の写し。tools/sync-ranking.js で本体と同じか確かめる）

const FISH_EMOJI = { Whale: '🐳', Shark: '🦈', Dolphin: '🐬', Fish: '🐟', Crab: '🦀', Shrimp: '🦐' };
const FISH_JA = Object.fromEntries(Fish.CLASSES.map((c) => [c.name, c.ja]));
const RANK_PAGE = 100; // 一度に出す件数（「さらに表示」で増やす）
let rankListKind = 'holders';
let rankShown = RANK_PAGE;
let rankCache = { key: '', view: null };

// 開いた時点（分単位）の4つの観点。同じ分のうちは作り直さない
function rankingView(now) {
  const rg = data.ranking;
  const key = rg.generatedAt + '|' + Math.floor(now / 60) + '|' + ranks.old.generatedAt + '|' + ranks.new.startDate;
  if (rankCache.key !== key) {
    const src = { ...rg.source, ranks: { old: { ranks: ranks.old.ranks }, new: { ranks: ranks.new.ranks, startDate: ranks.new.startDate } } };
    rankCache = { key, view: Report.build(src, now) };
  }
  return rankCache.view;
}

// 前回からの順位の変化：↑n・↓n・－・新。前回の記録がないときは出さない
function rankChange(kind, address, no) {
  const prev = data.ranking.previous;
  if (!prev || !prev[kind]) return null;
  if (!(address in prev[kind])) return null;
  const p = prev[kind][address];
  if (p == null) return el('span', { class: 'rk-chg new' }, '新');
  const d = p - no;
  return el('span', { class: 'rk-chg ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same') }, d > 0 ? '↑' + d : d < 0 ? '↓' + -d : '－');
}

const fishBadge = (name, big) => el('span', { class: 'fish' + (big ? ' big' : ''), title: name + '（' + (FISH_JA[name] || '') + '）' }, FISH_EMOJI[name] || '');

// targets：[{ id, name, share }]（報酬タブと同じ対象・順番）
function renderRankingTab(targets) {
  const rg = data.ranking;
  const split = data.transfers.find((x) => x.cls === 'split');
  const ok = rg && rg.source && ranks.old && ranks.new;
  $('rankNote').hidden = !!ok;
  $('rankNote').textContent = !rg ? 'このデータには保有者ランキングが入っていません。'
    : 'ランク表が読み込まれていないため、ランキングを計算できません。「設定」の［最新データを取得］で、新しいデータを読み込んでください。';
  $('rankBody').hidden = !ok;
  if (!ok) return;

  const sym = data.token.symbol;
  const now = Math.floor(Date.now() / 1000);
  const v = rankingView(now);
  const self = (rg.self || '').toLowerCase();
  const others = v.holders.filter((h) => h.address !== self);

  // 一番上：保有枚数と推定順位
  const multi = APP.id === 'manager';
  const s = split ? Reward.settled(split, { old: ranks.old, new: ranks.new }, now) : null;
  $('rankCards').replaceChildren(...(targets.length ? [] : [el('div', { class: 'card' }, el('p', { class: 'muted' }, split ? '表示する対象がありません。「設定」の「保有枚数の表示」で選んでください。' : '「分配」に仕分けた取引がないため、保有枚数はありません。'))]),
    ...targets.map((w) => {
      const amount = w.share + w.share * s.factor;
      const est = others.filter((h) => h.total > amount).length + 1;
      const f = Fish.classify(amount, v.supply).name;
      return el('div', { class: 'card asset-hero rank-me' },
        el('div', { class: 'sym' }, multi ? '保有枚数（' + labelOf_(w) + '）' : '保有枚数'),
        el('div', { class: 'hero-row' }, coinIcons[w.id] ? el('img', { class: 'coin-icon', src: coinIcons[w.id], alt: '' }) : null,
          el('span', { class: 'hero-val' }, fmtInt(amount) + ' ' + sym)),
        el('div', { class: 'rank-est' }, fishBadge(f, true),
          el('div', {}, el('div', { class: 'rank-est-no' }, '推定 ', el('b', {}, est.toLocaleString('ja-JP') + '位'), el('span', { class: 'muted' }, '（全 ' + (others.length + 1).toLocaleString('ja-JP') + '人中）')),
            el('div', { class: 'muted' }, f + '（' + FISH_JA[f] + '）・総供給量の ' + (amount / v.supply * 100).toFixed(3) + '%'))));
    }));

  // ① 保有者ランキング／② 預入ランキング
  document.querySelectorAll('#rankSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.list === rankListKind)));
  const list = rankListKind === 'holders' ? v.holders : v.depositors;
  $('rankMeta').textContent = (rankListKind === 'holders' ? '手元＋預入（元本）＋報酬の多い順。運営・コントラクトのアドレスは載せていません。' : '預けている人だけ。元本＋報酬の多い順。') +
    ' ランキング作成：' + fmtJst(rg.generatedAt) + (rg.previous ? '（順位の変化は ' + fmtJst(rg.previous.generatedAt) + ' との比較）' : '') + '。報酬は今の時点で計算しています。';
  const shown = list.slice(0, rankShown);
  $('rankList').replaceChildren(...shown.map((r) => {
    const isSelf = r.address === self;
    const sub = rankListKind === 'holders'
      ? '手元 ' + fmtInt(r.wallet) + (r.principal > 0 ? '・預入 ' + fmtInt(r.principal) + '・報酬 ' + fmtInt(r.reward) : '') + '（' + r.share.toFixed(2) + '%）'
      : (r.rankName ? r.rankName + ' ' + pct(r.rate) : 'ランク外') + '・元本 ' + fmtInt(r.principal) + '・報酬 ' + fmtInt(r.reward);
    return el('li', { class: 'rank-row' + (isSelf ? ' self' : '') },
      el('div', { class: 'rank-line' },
        el('span', { class: 'rk-no' }, String(r.no)),
        rankChange(rankListKind, r.address, r.no),
        rankListKind === 'holders' ? fishBadge(r.fish) : null,
        el('button', { class: 'cp', type: 'button', onclick: () => openNameDialog(r.address) }, nameOf(r.address)),
        isSelf ? el('span', { class: 'cat' }, '配布先') : null,
        el('span', { class: 'rk-total' }, fmtInt(r.total) + ' ' + sym)),
      el('div', { class: 'rank-sub' }, sub));
  }));
  $('rankMore').hidden = list.length <= rankShown;
  $('rankMore').textContent = 'さらに表示（' + Math.min(RANK_PAGE, list.length - rankShown) + '件／残り ' + (list.length - rankShown) + '件）';
}

document.querySelectorAll('#rankSeg button').forEach((b) => b.addEventListener('click', () => { rankListKind = b.dataset.list; rankShown = RANK_PAGE; refreshAll(); }));
$('rankMore').addEventListener('click', () => { rankShown += RANK_PAGE; refreshAll(); });
