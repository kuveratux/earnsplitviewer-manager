'use strict';

// ランキングタブ（保有者ランキング）。Manager・Agent 共通
// ・データの ranking.source（保有者ランキング取得エクセルが作った元データ）から、開いた時点の報酬・魚分類で作り直す（report.js）
//   ランク表は ESV のデータのもの（ranks）を使う（報酬タブと同じ表で計算する）
// ・一番上：保有枚数（報酬タブと同じ）と推定順位・魚分類。分配で持ち分を分けているので一致するアドレスはなく「推定」
//     分配しているときは、配布先アドレス（ranking.self）の行を外し、分配後の Manager 分・Agent 分を1行ずつ差し込んで順位を数える
//     （Agent アプリは Agent 分だけを表示し、Manager 分は表示しないが人数・順位には数える。2026-10 ユーザー決定）
//     推定順位：Manager 分・Agent 分は差し込んだ一覧の中の順位、合算はほかの保有者と比べた順位
// ・① 保有者ランキング／② 預入ランキング（切り替え）。順位の変化はエクセルで前回ランキングを作ったときとの比較
// ・名前は各スマホのアドレス一覧（book.js）の名前。押すと名前を付けられる
// 使う部品：deposits.js・fish.js・report.js（保有者ランキングの部品の写し。tools/sync-ranking.js で本体と同じか確かめる）

const FISH_EMOJI = { Whale: '🐳', Shark: '🦈', Dolphin: '🐬', Fish: '🐟', Crab: '🦀', Shrimp: '🦐' };
const FISH_JA = Object.fromEntries(Fish.CLASSES.map((c) => [c.name, c.ja]));
const RANK_PAGE = 100; // 一度に出す件数（「さらに表示」で増やす）
let rankListKind = 'holders';
let rankShown = RANK_PAGE;
let rankCache = { key: '', view: null };
let rankSelfName = ''; // Agent アプリ：ランキングでの自分の表示名（空欄なら「自分」。端末の中だけ）
let rankJump = null;   // 推定順位を押したときに移る行（分配の行の id）

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
// 配布先の行・分配の行を除いた順位どうしで比べる（分配の行を差し込んだことで、ほかの人の順位がずれて見えないように）
//   前回の順位（配布先の行を含む）から、配布先が上にいた分を引く
function rankChange(kind, address, curNo, adjust = true) {
  const prev = data.ranking.previous;
  if (!prev || !prev[kind] || !(address in prev[kind])) return null;
  const p = prev[kind][address];
  if (p == null) return el('span', { class: 'rk-chg new' }, '新');
  const selfPrev = adjust ? prev[kind][(data.ranking.self || '').toLowerCase()] : null;
  const d = (selfPrev != null && selfPrev < p ? p - 1 : p) - curNo;
  return el('span', { class: 'rk-chg ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'same') }, d > 0 ? '↑' + d : d < 0 ? '↓' + -d : '－');
}

const fishBadge = (name, big) => el('span', { class: 'fish' + (big ? ' big' : ''), title: name + '（' + (FISH_JA[name] || '') + '）' }, FISH_EMOJI[name] || '');

// 分配後の持ち分（Manager 分・Agent 分）。Agent アプリは Manager 分を一覧に出さないが、人数・順位には数える
function splitShares(split) {
  if (!split) return [];
  // Manager アプリ：Manager 分・Agent 分を名前で区別。Agent アプリ：自分の行は「自分」（設定の「ランキングでの表示名」で変えられる）
  const name = (id) => (typeof memberName === 'function' ? memberName(id) : id === 'agent' ? (rankSelfName || '').trim() || '自分' : 'Manager');
  const isMgr = APP.id === 'manager';
  const agent = isMgr ? split.shares.agent : split.share;
  const manager = isMgr ? split.shares.manager : Number(split.amount) - split.share;
  return [{ id: 'manager', name: name('manager'), share: manager, show: isMgr }, { id: 'agent', name: name('agent'), share: agent, show: true }];
}

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
  // 分配しているときは、配布先の行を外し、分配後の Manager 分・Agent 分を差し込む（報酬タブと同じ計算）
  // ただし Manager アプリで「保有枚数の表示」が合算だけのときは、配布先の行をほかの保有者と同じくアドレスで（合算の枚数で）そのまま出す（2026-10 ユーザー決定）
  const merged = APP.id === 'manager' && targets.length > 0 && targets.every((w) => w.id === 'total');
  const selfAddr = split ? (rg.self || '').toLowerCase() : '';
  const self = merged ? '' : selfAddr; // 一覧から外す行
  const s = split ? Reward.settled(split, { old: ranks.old, new: ranks.new }, now) : null;
  // 配布先アドレスの手元（ウォレットの残高）は Manager 分に入れる（2026-10 ユーザー決定。手元がなければ両方とも 0）
  const selfRow = v.holders.find((h) => h.address === selfAddr);
  const selfWallet = selfRow ? selfRow.wallet : 0;
  const shares = (merged ? [] : splitShares(split)).map((x) => {
    const wallet = x.id === 'manager' ? selfWallet : 0;
    const reward = x.share * s.factor;
    return { ...x, wallet, reward, total: wallet + x.share + reward };
  });
  const ins = (rows, extra) => [...rows.filter((r) => r.address !== self).map((r, i) => ({ ...r, otherNo: i + 1 })), ...shares.map(extra)]
    .sort((a, b) => b.total - a.total).map((r, i) => ({ ...r, no: i + 1 }));
  const holders = ins(v.holders, (x) => ({ split: x, wallet: x.wallet, principal: x.share, reward: x.reward, total: x.total, share: x.total / v.supply * 100, fish: Fish.classify(x.total, v.supply).name }));
  // 預入ランキングは元本＋報酬（手元は入れない）
  const depositors = ins(v.depositors, (x) => ({ split: x, principal: x.share, reward: x.reward, total: x.share + x.reward, rankName: s.rankNow ? s.rankNow.name : null, rate: s.rateNow }));
  const others = v.holders.filter((h) => h.address !== self);

  // 一番上：保有枚数と推定順位（Manager 分・Agent 分は一覧の中の順位、合算はほかの保有者と比べた順位）
  const multi = APP.id === 'manager';
  $('rankCards').replaceChildren(...(targets.length ? [] : [el('div', { class: 'card' }, el('p', { class: 'muted' }, split ? '表示する対象がありません。「設定」の「保有枚数の表示」で選んでください。' : '「分配」に仕分けた取引がないため、保有枚数はありません。'))]),
    ...targets.map((w) => {
      // 保有枚数：分配＋報酬。Manager 分と合算には配布先の手元も入れる
      const amount = w.share + w.share * s.factor + (w.id === 'agent' ? 0 : selfWallet);
      const mergedRow = merged ? holders.find((r) => r.address === selfAddr) : null;
      const row = merged ? holders.find((r) => r.address === selfAddr) : holders.find((r) => r.split && r.split.id === w.id);
      const est = row ? row.no : others.filter((h) => h.total > amount).length + 1;
      const of = row ? holders.length : others.length + 1;
      const canJump = row && (merged || row.split.show);
      const shownAmount = mergedRow ? mergedRow.total : amount;
      const f = Fish.classify(shownAmount, v.supply).name;
      return el('div', { class: 'card asset-hero rank-me' },
        el('div', { class: 'sym' }, multi ? '保有枚数（' + labelOf_(w) + '）' : '保有枚数'),
        el('div', { class: 'hero-row' }, coinIcons[w.id] ? el('img', { class: 'coin-icon', src: coinIcons[w.id], alt: '' }) : null,
          el('span', { class: 'hero-val' }, fmtInt(shownAmount) + ' ' + sym)),
        el('div', { class: 'rank-est' }, fishBadge(f, true),
          el('div', {}, el(canJump ? 'button' : 'div', { class: 'rank-est-no' + (canJump ? ' jump' : ''), type: 'button', onclick: canJump ? () => jumpToRank(w.id) : null },
            '推定 ', el('b', {}, est.toLocaleString('ja-JP') + '位'), el('span', { class: 'muted' }, '（全 ' + of.toLocaleString('ja-JP') + '人中）')),
            el('div', { class: 'muted' }, f + '（' + FISH_JA[f] + '）・総供給量の ' + (shownAmount / v.supply * 100).toFixed(3) + '%'))));
    }));

  // ① 保有者ランキング／② 預入ランキング
  document.querySelectorAll('#rankSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.list === rankListKind)));
  const list = (rankListKind === 'holders' ? holders : depositors).filter((r) => !r.split || r.split.show);
  const shown = list.slice(0, rankShown);
  $('rankList').replaceChildren(...shown.map((r) => {
    const sub = rankListKind === 'holders'
      ? (r.split ? '手元 ' + fmtInt(r.wallet) + '・預入 ' + fmtInt(r.principal) + '・報酬 ' + fmtInt(r.reward) : '手元 ' + fmtInt(r.wallet) + (r.principal > 0 ? '・預入 ' + fmtInt(r.principal) + '・報酬 ' + fmtInt(r.reward) : '')) + '（' + r.share.toFixed(2) + '%）'
      : (r.rankName ? r.rankName + ' ' + pct(r.rate) : 'ランク外') + '・' + '元本 ' + fmtInt(r.principal) + '・報酬 ' + fmtInt(r.reward);
    const mine = r.split ? r.split.id : merged && r.address === selfAddr ? 'total' : ''; // 自分の行（枠全体を強調・ジャンプ先）
    return el('li', { class: 'rank-row' + (mine ? ' self' : ''), ...(mine ? { 'data-split': mine } : {}) },
      el('div', { class: 'rank-line' },
        el('span', { class: 'rk-no' }, String(r.no)),
        r.split ? null : rankChange(rankListKind, r.address, merged ? r.no : r.otherNo, !merged),
        rankListKind === 'holders' ? fishBadge(r.fish) : null,
        r.split ? el('span', { class: 'rk-name' }, r.split.name) : el('button', { class: 'cp', type: 'button', onclick: () => openNameDialog(r.address) }, nameOf(r.address)),
        el('span', { class: 'rk-total' }, fmtInt(r.total) + ' ' + sym)),
      el('div', { class: 'rank-sub' }, sub));
  }));
  $('rankMore').hidden = list.length <= rankShown;
  $('rankMore').textContent = 'さらに表示（' + Math.min(RANK_PAGE, list.length - rankShown) + '件／残り ' + (list.length - rankShown) + '件）';
  // 推定順位を押したとき：その行まで移って、一瞬光らせる
  if (rankJump) {
    const li = document.querySelector('#rankList li[data-split="' + rankJump + '"]');
    rankJump = null;
    if (li) {
      const top = li.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
    }
  }
}

// 推定順位を押したとき：保有者ランキングに切り替え、その行が出るまで表示を広げてから移る
function jumpToRank(id) {
  rankListKind = 'holders';
  const li = () => document.querySelector('#rankList li[data-split="' + id + '"]');
  rankJump = id;
  rankShown = Math.max(rankShown, RANK_PAGE);
  refreshAll();
  for (let guard = 0; !li() && !$('rankMore').hidden && guard < 50; guard++) { rankShown += RANK_PAGE; rankJump = id; refreshAll(); }
}

document.querySelectorAll('#rankSeg button').forEach((b) => b.addEventListener('click', () => { rankListKind = b.dataset.list; rankShown = RANK_PAGE; refreshAll(); }));
$('rankMore').addEventListener('click', () => { rankShown += RANK_PAGE; refreshAll(); });
