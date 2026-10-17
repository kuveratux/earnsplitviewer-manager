// アプリごとの設定（画面と Service Worker の両方で使う）
// 同じドメイン（kuveratux.github.io）で取引ビューア・Agent と並ぶため、端末内の保存名をアプリごとに分ける
self.ESV_APP = {
  id: 'manager',
  defaultName: 'ESV Manager',
  db: 'esv-manager',               // IndexedDB
  lsAppearance: 'esvm-appearance', // localStorage（表示と配色の写し）
  cachePrefix: 'esvm-shell-',      // Service Worker の保管庫（この接頭辞のものだけ削除する）
  dataScope: 'manager',            // 読み込めるデータファイル（全量）
};
