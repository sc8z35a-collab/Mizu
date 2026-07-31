# MIZUNE v1.4.0 FULL WEBGL SCENE 実装レポート

## 概要
v1.3.0 WEBGL Hybrid をベースに、より踏み込んだ Full WebGL Scene 版を実装した。
これまでの「背景だけGPU」から進め、メインの音反応表現も WebGL 2 フラグメントシェーダーで描く構成を追加した。

## 主な変更点

### 1. 新規レンダラー `webgl-scene-renderer.js`
- フルスクリーントライアングル + フラグメントシェーダーで描画
- 背景水面、紙、コースティクス風光表現をGPU描画
- 音反応するメインビジュアルをモード別にGPU描画
- 最大6個のメタボール風水滴をGPU側で合成

### 2. WebGLで描画するモード別シーン
- Waterline
  - 水面ライン
  - 水体の厚み
  - 反射線
  - 波紋
- Circular Garden
  - リング
  - 放射状スポーク
  - コアハロー
- Paper Wave
  - 複数の紙帯状レイヤー
- Glass Orbit
  - 軌道上のガラス泡風表現
- Ink Bloom
  - にじみ状のインク雲
- Particle Pond
  - 粒子の漂い風パターン
- Minimal Scope
  - 波線とバー表示

### 3. VisualEngine 改修
- レンダリングエンジンを以下に再構成
  - Full WebGL Scene
  - WebGL Hybrid
  - Auto
  - Canvas 2D
- Full WebGL Scene では、Canvasの役割を補助レイヤー中心へ変更
- Hybridでは従来通りCanvas 2D主体 + WebGL背景

### 4. UI改修
- 設定欄のレンダリングエンジンを更新
- 初期値を `Full WebGL Scene` に変更
- ライブ指標へ `Full WebGL / WebGL Hybrid / Canvas 2D` 表示

### 5. Service Worker更新
- 新しい `webgl-scene-renderer.js` をキャッシュ対象へ追加
- キャッシュ名を更新

## できるようになったこと
- 従来より“全面的”なWebGL描画
- 背景だけでなく主役のシーンもGPU描画
- 豪華さの向上
- Waterline / Circular / Glass / Pond 系の質感向上

## 限界と注意
- 依然として UI 全体までWebGL化したわけではない
- 物理ベース流体や本格3Dガラスではない
- WebGL 2 非対応環境では自動フォールバック
- Full WebGL Scene は端末負荷が高い可能性がある

## 検証
- 全JS `node --check` 通過
- `analysis-worker-smoke.cjs` 通過
- `resolution-profile-smoke.mjs` 通過
