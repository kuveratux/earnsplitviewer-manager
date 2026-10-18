'use strict';

// 報酬の計算（Manager・Agent 共通。ブラウザと Node の両方で使える）
//
// ・元の枚数：「分配」に仕分けた取引の枚数（分配は常に1件）
// ・日数：分配の日時から24時間後を1日目とし、アプリを開いた時点までに経過した24時間の回数
// ・年利：k 日目の時点（分配日時＋k×24時間）が新ランク表の開始日（日本時間 0:00）より前なら旧ランク表、以降なら新ランク表
// ・ランク：分ける前の合計枚数が、ランク表の「下限」以上かで決める（最下位の下限未満は「ランク外」で年利 0）
// ・報酬（確定分）：取り分 × 年利 ÷ 365 × 日数（単利）。旧・新の日数ごとに足す
// ・見込み（グラフ）：今日の確定分から先を、1日ごとに足していく
//     単利：毎日 取り分 × 年利 ÷ 365 を足す（ランクは合計枚数で決めたまま）
//     複利：毎日 その時点の枚数 × 年利 ÷ 365 を足す。枚数が増えてランクが上がったら年利も上げる
//   どちらも取り分の比率に関係なく同じ伸び方になるので、「元の1枚あたりの枚数（倍率）」で計算する

const Reward = (() => {
  const DAY = 86400;
  const jstMidnight = (ymd) => Date.parse(ymd + 'T00:00:00+09:00') / 1000;

  // 枚数が下限以上の、いちばん上のランク。どれにも届かなければ null（ランク外）
  function rankFor(ranks, amount) {
    let hit = null;
    for (const r of ranks) if (amount >= r.min) hit = r;
    return hit;
  }

  // k 日目に使うランク表
  const tableOn = (split, rk, k) => (split.t + k * DAY < jstMidnight(rk.new.startDate) ? rk.old.ranks : rk.new.ranks);

  // 確定分。split：{ t, amount（合計） }、rk：{ old: { ranks }, new: { ranks, startDate } }、now：UNIX 秒
  function settled(split, rk, now) {
    const total = Number(split.amount);
    const days = Math.max(0, Math.floor((now - split.t) / DAY));
    const newStart = jstMidnight(rk.new.startDate);
    const oldDays = Math.min(days, Math.max(0, Math.ceil((newStart - split.t) / DAY) - 1));
    const newDays = days - oldDays;
    const rankOld = rankFor(rk.old.ranks, total);
    const rankNew = rankFor(rk.new.ranks, total);
    const rateOld = rankOld ? rankOld.rate : 0;
    const rateNew = rankNew ? rankNew.rate : 0;
    const factor = (rateOld * oldDays + rateNew * newDays) / 365; // 元の1枚あたりの報酬
    // 今の年利：次の1日（days＋1 日目）に使うランク表で、合計枚数から決めたランクの年利（1日・週・月・年の報酬の目安に使う）
    const rankNow = rankFor(tableOn(split, rk, days + 1), total);
    const rateNow = rankNow ? rankNow.rate : 0;
    return { total, days, oldDays, newDays, rankOld, rankNew, rateOld, rateNew, rankNow, rateNow, factor, firstDay: split.t + DAY };
  }

  // 日本時間の年月日を n か月ずらした日の 0:00（月末は丸める）
  function addMonthsJst(unix, n) {
    const d = new Date((unix + 9 * 3600) * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + n;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / 1000 - 9 * 3600;
  }

  // 見込み。今日から months か月後まで、1か月ごとの倍率（元の1枚あたりの枚数）を返す
  // mode：'simple' | 'compound'。[{ t（その日の日本時間 0:00）, k（その時点の日数）, g（倍率） }]
  function project(split, rk, now, mode, months = 36) {
    const s = settled(split, rk, now);
    const today = addMonthsJst(now, 0);
    const points = [];
    for (let i = 0; i <= months; i++) {
      const t = i === 0 ? now : addMonthsJst(today, i);
      points.push({ t, k: Math.max(s.days, Math.floor((t - split.t) / DAY)), month: i });
    }
    let g = 1 + s.factor;
    let k = s.days;
    for (const p of points) {
      for (; k < p.k; ) {
        k++;
        const table = tableOn(split, rk, k);
        if (mode === 'compound') {
          const r = rankFor(table, s.total * g);
          g += g * (r ? r.rate : 0) / 365;
        } else {
          const r = rankFor(table, s.total);
          g += (r ? r.rate : 0) / 365;
        }
      }
      p.g = g;
    }
    return points;
  }

  return { DAY, rankFor, settled, project, addMonthsJst };
})();

if (typeof module !== 'undefined') module.exports = Reward;
