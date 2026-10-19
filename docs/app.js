'use strict';

// ESV Manager：配布先の全取引（区分つき）と、分配の内訳（Manager 分・Agent 分）を表示する
// 共通の処理は core.js、取引タブの部品は views.js

// 名前：この端末で設定した名前（スマホの中にだけ保存）→ データの名前 → 「Manager」「Agent」の順
let localNames = { manager: '', agent: '' };
const memberName = (id) => (localNames[id] || '').trim() || (data && data.members && data.members[id] && data.members[id].name) || (id === 'manager' ? 'Manager' : 'Agent');

// 資産タブ・保有枚数に表示する対象と順番（この端末だけの設定）
const ORDER_IDS = ['total', 'manager', 'agent'];
const ORDER_DEFAULT = () => ORDER_IDS.map((id) => ({ id, on: true }));
let orders = { asset: ORDER_DEFAULT(), reward: ORDER_DEFAULT() };
const orderLabel = (id) => (id === 'total' ? '合算' : memberName(id));
// 保存した順番を正す（足りない対象は後ろに、知らない対象は外す）
function fixOrder(list) {
  const ok = (list || []).filter((x) => x && ORDER_IDS.includes(x.id));
  for (const id of ORDER_IDS) if (!ok.some((x) => x.id === id)) ok.push({ id, on: true });
  return ok.filter((x, i) => ok.findIndex((y) => y.id === x.id) === i);
}

function renderOrderList(key, ul) {
  const list = orders[key];
  ul.replaceChildren(...list.map((x, i) => el('li', {},
    el('label', { class: 'order-check' }, Object.assign(el('input', { type: 'checkbox' }), { checked: x.on, onchange: async (e) => { x.on = e.target.checked; await saveOrders(); } }),
      el('span', { class: 'sym-name' }, orderLabel(x.id))),
    Object.assign(el('button', { type: 'button', 'aria-label': orderLabel(x.id) + ' を上へ', onclick: () => moveOrder(key, i, -1) }, '↑'), { disabled: i === 0 }),
    Object.assign(el('button', { type: 'button', 'aria-label': orderLabel(x.id) + ' を下へ', onclick: () => moveOrder(key, i, 1) }, '↓'), { disabled: i === list.length - 1 }))));
}
async function moveOrder(key, i, d) {
  const list = orders[key];
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await saveOrders();
}
async function saveOrders() { await putSetting('orders', orders); refreshAll(); }

['nameManager', 'nameAgent'].forEach((elId) => $(elId).addEventListener('change', async () => {
  localNames = { manager: $('nameManager').value.trim(), agent: $('nameAgent').value.trim() };
  await putSetting('localNames', localNames);
  refreshAll();
}));

function renderTx() {
  const sym = data.token.symbol;
  renderTxTab({
    clsList: CLS_ORDER,
    amountOf: (x) => x.amount,
    splitRows: (s) => [
      ['預入枚数（合計）', fmtAmount(s.amount) + ' ' + sym],
      [memberName('manager') + ' 分（' + pct(data.ratio.manager) + '）', fmtAmount(s.shares.manager) + ' ' + sym],
      [memberName('agent') + ' 分（' + pct(data.ratio.agent) + '）', fmtAmount(s.shares.agent) + ' ' + sym],
    ],
    explorer: data.chain && data.chain.explorer,
  });
}
['clsSel', 'dirSel'].forEach((id) => $(id).addEventListener('change', renderTx));

function renderReward() {
  const split = data.transfers.find((x) => x.cls === 'split');
  const all = split ? [
    { id: 'total', name: '合算（' + memberName('manager') + '＋' + memberName('agent') + '）', share: Number(split.amount) },
    { id: 'manager', name: memberName('manager'), share: split.shares.manager },
    { id: 'agent', name: memberName('agent'), share: split.shares.agent },
  ] : [];
  // 設定で選んだ対象を、選んだ順に
  const pick = (key) => orders[key].filter((x) => x.on).map((x) => all.find((w) => w.id === x.id)).filter(Boolean);
  renderRewardTab(all, true, { rewardWho: pick('reward'), assetWho: pick('asset') });
  renderRankingTab(pick('reward')); // ランキングタブの一番上も「保有枚数の表示」の対象・順番
}

function renderSettings() {
  if (document.activeElement !== $('nameManager')) $('nameManager').value = localNames.manager || '';
  if (document.activeElement !== $('nameAgent')) $('nameAgent').value = localNames.agent || '';
  $('nameManager').placeholder = (data && data.members && data.members.manager && data.members.manager.name) || 'Manager';
  $('nameAgent').placeholder = (data && data.members && data.members.agent && data.members.agent.name) || 'Agent';
  renderOrderList('asset', $('orderAsset'));
  renderOrderList('reward', $('orderReward'));
}

ESV.start({
  async init() {
    localNames = Object.assign({ manager: '', agent: '' }, (await getSetting('localNames')) || {});
    const o = (await getSetting('orders')) || {};
    orders = { asset: fixOrder(o.asset), reward: fixOrder(o.reward) };
  },
  render() { renderSettings(); if (data) { renderTx(); renderReward(); } },
  describe() { return '　取引：' + data.transfers.length + ' 件' + (data.chain ? '　チェーン：' + data.chain.name : ''); },
});
