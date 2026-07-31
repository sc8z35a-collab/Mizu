# MIZUNE 実装・検証記録

## 実装構成

- 依存ライブラリなしのES Modules構成
- 19以上の分割ファイル
- Web Audio APIによるリアルタイム解析
- MediaRecorderによる録音
- IndexedDBによる音源・録音・解析結果・設定保存
- Web Workerによるオフライン区間分析
- Canvas 2Dによる8種類の表現
- Service Worker / Web App Manifest
- Windows用ローカルサーバー起動スクリプト

## 実施した検査

- 全JavaScriptファイルの `node --check`
- Web App ManifestのJSON構文検査
- Python起動スクリプトのコンパイル検査
- HTML内IDの重複検査
- UIコントローラーが参照するIDの存在検査
- 全ローカル参照資源のHTTP 200応答確認
- 人工音声を用いた解析Workerのスモークテスト
- マイク入力がスピーカー出力へ直結しない配線確認

## 制約

この作業環境のChromiumには、組織ポリシーによりlocalhostとfile URLの表示が禁止されていました。そのため、実ブラウザ上の最終クリック操作、マイク許可、MediaRecorder実録音のE2E試験は実施できていません。ソース構文、資源配信、解析アルゴリズムは個別に検証済みです。

実機では `start_windows.bat` から起動し、ChromeまたはEdgeの最新版で確認してください。

## v1.0.1 マイク画面修正（2026-07-31）

- `hidden` 属性が `.modal-backdrop { display:grid }` に上書きされ、マイク説明画面が閉じない不具合を修正。
- `[hidden] { display:none !important; }` を追加し、初期状態・キャンセル・許可成功時に確実に非表示化。
- 権限取得中、拒否、マイク未検出、他アプリ使用中、非HTTPSの状態説明を追加。
- マイクを使用できない場合でも、音楽ファイルまたはデモ音源へ移動可能に変更。
- Service Workerのキャッシュ世代を更新。
- 既存サーバーとのポート衝突時に、4173〜4192から空きポートを自動選択するよう起動処理を修正。
