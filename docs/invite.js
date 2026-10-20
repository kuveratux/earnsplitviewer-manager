'use strict';

// Agent の招待（Manager アプリだけ。2026-10）
// Agent 用のデータのファイルを「リンクを知っている全員」に共有し、その共有のリンクを貼ると、招待リンク・招待コード・QR コードを作る
//   招待リンク：Agent アプリの URL ＋ #invite=<招待コード>（# の後ろはサーバーに送られない）。招待コード＝ファイルの ID
//   合言葉は入れない（別の手段で伝える）
// 貼ったリンク（ファイルの ID）は、この端末の中（'agentInvite'）にだけ覚える。プログラムには書かない
// QR コードは qrcode.js（qrcode-generator、MIT ライセンス、Kazuhiko Arase）で作る。アプリの中に入れてあるので、ネットから読み込まない

const inviteUrlOf = (id) => location.origin + location.pathname.replace(/earnsplitviewer-manager/i, 'earnsplitviewer-agent').replace(/index\.html$/, '') + '#invite=' + id;

async function renderInvite(id, checkText) {
  $('invOut').hidden = !id;
  $('invForget').hidden = !id;
  if (!id) return;
  const url = inviteUrlOf(id);
  $('invLink').textContent = url;
  $('invCode').textContent = id;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('invQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }); // 作った図形だけ（データの文字は入れない）
  if (checkText != null) $('invCheck').textContent = checkText;
}

// 共有になっているか（ログインなしで読めるか）と、Agent 用のファイルかを確かめる
async function checkInviteFile(id) {
  $('invCheck').textContent = '共有の確認中…';
  try {
    const meta = await Drive.publicMeta(id);
    const name = String(meta.name || '');
    if (/manager/i.test(name)) return { ok: false, text: '「' + name + '」は Manager 用のファイルです。Manager 用のファイルは共有にしないでください（ドライブで共有を「制限付き」に戻してください）。' };
    if (!/agent/i.test(name)) return { ok: false, text: '「' + name + '」は Agent 用のファイルではないようです（ファイル名に agent が入っていません）。esv_agent_latest.json の共有のリンクを貼ってください。' };
    return { ok: true, text: '共有の確認：読めました（' + name + '、更新 ' + fmtShortJst(meta.modifiedTime) + '）' };
  } catch {
    return { ok: false, text: 'ログインなしで読めませんでした。ドライブで、このファイルの共有を「リンクを知っている全員」（閲覧者）にしてください。' };
  }
}

$('invSrc').addEventListener('change', async () => {
  const text = $('invSrc').value.trim();
  if (!text) return;
  const id = inviteIdOf(text);
  if (!id) { $('invCheck').textContent = 'リンクの形が正しくありません。ドライブの［リンクをコピー］で取ったリンクをそのまま貼ってください。'; return; }
  const r = await checkInviteFile(id);
  if (!r.ok) { $('invCheck').textContent = r.text; return; }
  $('invSrc').value = '';
  await putSetting('agentInvite', id);
  renderInvite(id, r.text);
});

const copyText = async (text, done) => {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('コピーできませんでした。長押ししてコピーしてください'); }
};
$('invCopyLink').addEventListener('click', () => copyText($('invLink').textContent, '招待リンクをコピーしました'));
$('invCopyCode').addEventListener('click', () => copyText($('invCode').textContent, '招待コードをコピーしました'));
$('invForget').addEventListener('click', async () => {
  if (!confirm('この端末に覚えている Agent 用のファイルのリンクを消しますか？（ドライブの共有や、Agent の端末には影響しません）')) return;
  await delSetting('agentInvite');
  $('invCheck').textContent = '';
  renderInvite(null);
});

ESV.loaders.push(async () => {
  const id = await getSetting('agentInvite');
  renderInvite(id || null, id ? '' : null);
  if (id) checkInviteFile(id).then((r) => { $('invCheck').textContent = r.text; });
});
