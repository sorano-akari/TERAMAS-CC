# TERRA-MON: 地球規模放射線計測ネットワーク
# TERRA-MON: Global Radiation Measurement Network

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

### 現在のフェーズ 1: バックグラウンドノイズの測定

プロジェクト開始にあたり、最優先で**正確なノイズレベル**を把握しています。

* **目的:** 各ピクセルが持つ固有のノイズの**平均値 ($\mu$)** と**標準偏差 ($\sigma$)** を、約5分間（18,000フレーム）のデータから収集・計算します。
* **検出閾値:** $\mu$から**$2\sigma$以上**離れた輝度を、確度の高い「放射線イベント」として判定するための基礎データを作成中です。
* **C++での実装:** C++ (`detector_core.cpp`) の中で、ピクセルごとの輝度の**総和 ($\Sigma I$)** と**二乗の総和 ($\Sigma I^2$)** を高速に蓄積しています。

## 🔬 Core Technology: How Your Camera Becomes a Detector

A camera's image sensor (CMOS/CCD) generates an electrical charge not only from light but also from high-energy particles (such as **beta rays and muons from cosmic rays**).

1.  **Shading:** Ambient light is completely blocked by covering the lens with black tape or a similar material.
2.  **Detection:** Radiation events appear as **fleeting bright spots or tracks** against the dark screen.
3.  **High-Speed Analysis:** The detection core, written in **C++** and run via **WebAssembly (Wasm)**, operates at ultra-high speed to distinguish signals from noise and accurately extract event data.

### Current Phase 1: Background Noise Measurement

Our first priority is accurately characterizing the noise level.

* **Goal:** To calculate the **mean ($\mu$)** and **standard deviation ($\sigma$)** of the intrinsic noise for each pixel, using data collected over approximately 5 minutes (18,000 frames).
* **Detection Threshold:** This data is used to set the threshold at $\mu + 2\sigma$ to accurately identify high-confidence "radiation events."
* **C++ Implementation:** The C++ core (`detector_core.cpp`) is currently accumulating the **sum of intensity ($\Sigma I$)** and **sum of squared intensity ($\Sigma I^2$)** for each pixel at high speed.

---

## 🤝 貢献方法 (Contribution)

**TERRA-MON**は、オープンソースプロジェクトです。開発者、科学者、そしてすべての市民科学者の参加を歓迎します！

## 🤝 How to Contribute

**TERRA-MON** is an open-source project. We welcome contributions from developers, scientists, and all citizen scientists!

---

### 💻 コード貢献

| ファイル | 役割 (日本語) | Role (English) |
| :--- | :--- | :--- |
| `detector_core.cpp` | 検出アルゴリズム（ノイズ判定、粒子識別など）の開発。 | Core algorithm development (noise identification, particle identification, etc.). |
| `terra-mon.js` | カメラ制御、Wasm連携、UI/UX、データ通信層の開発。 | Development of camera control, Wasm integration, UI/UX, and data communication layers. |

### 📊 市民科学としての貢献 (データ提供)

#### 🇯🇵 日本語
測定ソフトウェアが公開された後、カメラを遮光し、ブラウザを起動して参加ボタンを押すだけです。あなたのデバイスが地球規模の観測に貢献し、人類の科学的知見を広げる手助けとなります。

#### 🇬🇧 English
Once the measurement software is released, participation is as simple as covering your camera, opening your browser, and clicking the participation button. Your device will contribute to global-scale observation and expand humanity's scientific knowledge.

---

## 📁 リポジトリ構造