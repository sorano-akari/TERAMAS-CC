# TERAMAS-CC: シチズンサイエンス地球放射線マッピングシステム（てらますしーしー）
# TERAMAS-CC: TErra RAdiation MApping System by Citizens' Cameras: TERAMAS-CC project's repository.

[![GitHub license](https://img.shields.io/github/license/user/terra-mon?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/user/terra-mon/stargazers?style=flat-square)](https://github.com/user/terra-mon/stargazers)
[![WebAssembly](https://img.shields.io/badge/Tech-WebAssembly-654ff0?style=flat-square)](https://webassembly.org/)

あなたのカメラが、地球を測る巨大な放射線検出器になる。
Your camera becomes a massive radiation detector that measures the Earth.

---

## 🌎 プロジェクトの概要

**TERRA-MON**は、世界中の**PCやスマートフォンのWebカメラ**のイメージセンサー（CMOS/CCD）を連携させ、地球規模の放射線（宇宙線）計測ネットワークを構築する**市民科学（シチズンサイエンス）**プロジェクトです。高価な専用機器やアプリのインストールは不要です。

## 🌎 Project Overview

**TERRA-MON** is a **Citizen Science** project that builds a global-scale radiation (cosmic ray) measurement network by utilizing the image sensors (CMOS/CCD) of **webcams on PCs and smartphones** worldwide. No expensive specialized equipment or app installation is required.

---

## 🔬 技術の核：カメラが検出器になる仕組み

カメラの光センサーは、光だけでなく、高エネルギー粒子（**宇宙線由来のベータ線やミューオン**など）が当たっても電荷を発生させます。

1.  **遮光:** レンズを黒いテープなどで覆うことで環境光を完全に遮断します。
2.  **検出:** 放射線イベントは、真っ暗な画面の上に**チカッと光る点や飛跡**として現れます。
3.  **高速解析:** **C++**で書かれた検出コアを**WebAssembly (Wasm)**で超高速に動作させ、ノイズと区別し、正確なイベント情報を抽出します。

### Current Phase 1: Background Noise Measurement & Linearity Correction

プロジェクト開始にあたり、最優先で**正確なノイズレベル**を把握し、**物理量の正確な計測**を可能にします。

* **課題（Problem）**: 多くのカメラドライバーは、暗闇で**ノイズ抑制**を過剰に行い、真のノイズ信号を消してしまいます。また、RGB出力には**人間の視覚に合わせた非線形な補正（ガンマ補正）**がかかっており、電荷量（物理量）に比例していません。
* **目的 (Goal)**: **ノイズ抑制を回避**しつつ、$\text{RGB}$ 値を**電荷量に比例する線形な値**に戻すための処理を実装します。

#### ⚛️ 物理量計測のための線形化 (Linearity Correction for Physical Measurement)

電荷量に比例する正確な積算を行うため、以下の**逆ガンマ補正（Inverse Gamma Correction）**を実装します。これは、画像データにかけられた**非線形な補正を排除**し、線形な物理量に戻すための最も重要なステップです。

* **処理**: 各ピクセルの $\text{RGB}$ $8$ビット値 $(0 \sim 255)$ に対して、$\text{sRGB}$ の標準に基づいた**非線形な逆ガンマ関数**を適用します。
* **効果**: これにより、$\text{RGB}$ 値に隠された非線形な補正が解除され、**光の強さ（電荷量）に比例した線形な値**のみを積算に用いることができるようになります。

* **検出閾値:** $\mu$から**$2\sigma$以上**離れた輝度を、確度の高い「放射線イベント」として判定するための基礎データを作成中です。
* **C++での実装:** C++ (`detector_core.cpp`) の中で、ピクセルごとの輝度の**総和 ($\Sigma I$)** と**二乗の総和 ($\Sigma I^2$)** を高速に蓄積しています。

---

## 🤝 貢献方法 (Contribution)

**TERRA-MON**は、オープンソースプロジェクトです。開発者、科学者、そしてすべての市民科学者の参加を歓迎します！

## 🤝 How to Contribute

**TERRA-MON** is an open-source project. We welcome contributions from developers, scientists, and all citizen scientists!

---

### 💻 コード貢献

| ファイル | 役割 (日本語) | Role (English) |
| :--- | :--- | :--- |
| `detector_core.cpp` | **Wasm Core**：検出アルゴリズム（ノイズ判定、**線形化**、粒子識別など）の開発。 | Core algorithm development (noise identification, **linearity correction**, particle identification, etc.). |
| `detector_worker.js` | **Web Worker**：WebAssemblyの実行とフレーム処理を行うワーカー。 | Web Worker to run WebAssembly and handle frame processing. |
| `terra-mon.js` | カメラ制御、Wasm連携、UI/UX、データ通信層の開発。 | Development of camera control, Wasm integration, UI/UX, and data communication layers. |

### 📊 市民科学としての貢献 (データ提供)

#### 🇯🇵 日本語
測定ソフトウェアが公開された後、カメラを遮光し、ブラウザを起動して参加ボタンを押すだけです。あなたのデバイスが地球規模の観測に貢献し、人類の科学的知見を広げる手助けとなります。

#### 🇬🇧 English
Once the measurement software is released, participation is as simple as covering your camera, opening your browser, and clicking the participation button. Your device will contribute to global-scale observation and expand humanity's scientific knowledge.

---

## 📁 リポジトリ構造 (Repository Structure)

| ファイル/ディレクトリ | 役割 (Role) |
| :--- | :--- |
| `detector_core.cpp` | **Wasm Core Source**: 検出アルゴリズムと高速計算の C++ ソースコード。 |
| `detector_core.js` / `.wasm` | **Wasm Artifacts**: C++から生成された WebAssembly のコア実行ファイル。 |
| `detector_worker.js` | **Web Worker**: $\text{WebAssembly}$ を実行し、フレーム処理をメインスレッドから分離するワーカー。 |
| `terra-mon.js` | メインスレッドの制御、カメラアクセス、UI/UX管理。 |
| `index.html` | プロジェクトのフロントエンドエントリポイント。 |
| `README.md` | プロジェクト概要と技術詳細。 |