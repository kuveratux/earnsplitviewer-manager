'use strict';

// ESV Manager：配布先の全取引（区分つき）と、分配の内訳（Manager 分・Agent 分）を表示する
// 共通の処理は core.js、取引タブの部品は views.js

const memberName = (id) => (data.members && data.members[id] && data.members[id].name) || (id === 'manager' ? 'Manager' : 'Agent');

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
  renderRewardTab(split ? [
    { id: 'total', name: '合算（' + memberName('manager') + '＋' + memberName('agent') + '）', share: Number(split.amount) },
    { id: 'manager', name: memberName('manager'), share: split.shares.manager },
    { id: 'agent', name: memberName('agent'), share: split.shares.agent },
  ] : []);
}

ESV.start({
  render() { if (data) { renderTx(); renderReward(); } },
  describe() { return '　取引：' + data.transfers.length + ' 件' + (data.chain ? '　チェーン：' + data.chain.name : ''); },
});
