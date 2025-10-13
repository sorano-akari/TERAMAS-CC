# TERAMAS-CC: シチズンサイエンス地球放射線マッピングシステム（てらますしーしー）
# TERAMAS-CC: TErra RAdiation MApping System by Citizens' Cameras: TERAMAS-CC project's repository.

[![GitHub license](https://img.shields.io/github/license/sorano-akari/TERAMAS-CC?style=flat-square)](https://github.com/sorano-akari/TERAMAS-CC/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sorano-akari/TERAMAS-CC/stargazers?style=flat-square)](https://github.com/sorano-akari/TERAMAS-CC/stargazers)
[![WebAssembly](https://img.shields.io/badge/Tech-WebAssembly-654ff0?style=flat-square)](https://webassembly.org/)

あなたのカメラが、地球を測る巨大な放射線検出器になる。
Your camera becomes a massive radiation detector that measures the Earth.

---

## 🌎 プロジェクトの概要

**TERAMAS-CC**は、世界中の**PCやスマートフォンのWebカメラ**のイメージセンサー（CMOS/CCD）を連携させ、地球規模の放射線（宇宙線）計測ネットワークを構築する**市民科学（シチズンサイエンス）**プロジェクトです。高価な専用機器やアプリのインストールは不要です。

## 🌎 Project Overview

**TERAMAS-CC** is a **Citizen Science** project that builds a global-scale radiation (cosmic ray) measurement network by utilizing the image sensors (CMOS/CCD) of **webcams on PCs and smartphones** worldwide. No expensive specialized equipment or app installation is required.

---

## 🔬 技術の核：カメラが検出器になる仕組み / Core Technology: How the Camera Becomes a Detector

カメラの光センサーは、光だけでなく、高エネルギー粒子（**宇宙線由来のベータ線やミューオン**など）が当たっても電荷を発生させます。

1.  **遮光:** レンズを黒いテープなどで覆うことで環境光を完全に遮断します。
2.  **検出:** 放射線イベントは、真っ暗な画面の上に**チカッと光る点や飛跡**として現れます。
3.  **高速解析:** **C++**で書かれた検出コアを**WebAssembly (Wasm)**で超高速に動作させ、ノイズと区別し、正確なイベント情報を抽出します。

### Current Phase 1: Background Noise Measurement & Linearity Correction

プロジェクト開始にあたり、最優先で**正確なノイズレベル**を把握し、**物理量の正確な計測**を可能にします。

* **課題（Problem）**: 多くのカメラドライバーは、暗闇で**ノイズ抑制**を過剰に行い、真のノイズ信号を消してしまいます。また、$\text{RGB}$ 出力には**人間の視覚に合わせた非線形な補正（ガンマ補正）**がかかっており、電荷量（物理量）に比例していません。
* **目的 (Goal)**: **ノイズ抑制を回避**しつつ、$\text{RGB}$ 値を**電荷量に比例する線形な値**に戻すための処理を実装します。

---

## 🛠️ 技術要件と設計の決定事項 (Development Requirements and Design Decisions)

### 1. 線形化と電荷量の計算 (Linearization and Charge Calculation)

| 項目 (Item) | 仕様 (Specification) |
| :--- | :--- |
| **入力データ (Input Data)** | $\text{RGB}$ 各色 $8$ビット整数値 ($0 \sim 255$)。 |
| **線形化の手順 (Linearization Steps)** | 1. $V_{8\text{bit}} / 255.0$ で $0 \sim 1.0$ に正規化。 <br> 2. 標準的な $\text{sRGB}$ の**逆ガンマ関数**を適用し、線形輝度 $I_{\text{linear}}$ を $0 \sim 1.0$ の**倍精度浮動小数点数 ($\text{double}$)** で得る。 |
| **1ピクセルの電荷量 $Q$ (Pixel Charge $Q$)** | 線形化された $\text{RGB}$ の総和: $Q = I_{\text{linear}}^{\text{R}} + I_{\text{linear}}^{\text{G}} + I_{\text{linear}}^{\text{B}}$ <br> **範囲**: $0 \sim 3.0$ の倍精度浮動小数点数。 |
| **放射線イベント判定 (Event Threshold)** | 予備測定で求めた**ノイズレベル $\mu$** に対し、**$Q > \mu + 2\sigma$** の電荷量を持つピクセルをイベントとして識別する。 |

### 2. WebAssembly (Wasm) とデータフロー (Wasm and Data Flow)

| 項目 (Item) | 仕様 (Specification) |
| :--- | :--- |
| **Wasmの役割 (Wasm Role)** | 検出アルゴリズム（線形化、ノイズ識別、電荷量積算）の実行、フレーム数・イベント数のカウント、ユーザー向け**積分グレースケール画像**の生成。 |
| **Wasmへの入力 (Wasm Input)** | Webカメラの $\text{RGB}$ $8$ビットフレームデータ（ポインター渡し）。 |
| **Wasmの出力 (Wasm Output)** | 1. **処理済みフレーム数** (int)<br> 2. **検出イベント数** (int)<br> 3. ユーザー表示用の**グレースケール積分画像** ($\text{Uint8}$ $0 \sim 255$) の**メモリアドレス**。 |
| **積分データ構造 (Integrated Data)** | `detector_core.cpp`内で`ChargeMap` (`double`) と `EventMap` (`uint8_t`、アルファチャンネルとして利用) を**共有メモリ**に保持し、Wasm内で更新する。 |
| **データ転送最適化 (Transfer Optimization)** | Wasmは**グレースケール画像**のアドレスを返し、Workerがメモリから読み取りメインスレッドに転送する。これにより、重い処理はWasm内で完結する。 |

### 3. Wasm API (Emscripten Bindings) 設計

| $\text{C++}$ 関数 | $\text{JS}$ 側の呼び出し名 | $\text{Wasm}$ コア内部での役割 |
| :--- | :--- | :--- |
| `initialize(width, height)` | `DetectorCore.initialize(w, h)` | ピクセルサイズに基づき、`g_charge_map`などのメモリを確保し、カウンターをリセット。 |
| `setNoiseThreshold(mu, sigma)` | `DetectorCore.setNoiseThreshold(m, s)` | ノイズ判定に使用する $\mu$ と $\sigma$ の値をグローバル変数に設定。 |
| `processFrame(rgbDataPointer)` | `DetectorCore.processFrame(ptr)` | $\text{RGB}$ データを受け取り、線形化、閾値判定、$\text{g\_charge\_map}$ への積算を実行。 |
| `getGrayscaleImagePointer()` | `DetectorCore.getGrayscaleImagePointer()` | $\text{g\_charge\_map}$ からグレースケール画像を生成し、その $\text{Uint8}$ 配列のメモリアドレスを返す。 |
| `getFrameCount()` | `DetectorCore.getFrameCount()` | 処理済みのフレーム数 `g_frame_count` を返す。 |
| `getEventCount()` | `DetectorCore.getEventCount()` | 検出された総イベント数 `g_event_count` を返す。 |

### 4. 計測時間と露出制御 (Measurement Time and Exposure Control)

| 項目 (Item) | 仕様 (Specification) |
| :--- | :--- |
| **露光時間 (Exposure Time)** | **常に固定**とする。ターゲットは標準的なカメラの $\text{15fps}$ または $\text{30fps}$ に対応する時間。 |
| **計数率の計算 (Count Rate)** | $\text{Count Rate} = \text{Events} / (\text{Processed Frames} \times \text{Fixed Exposure Time})$ |
| **ゲイン (Gain)** | カメラを遮光するため、オートゲインで最大値になることを許容する。 |

### 5. ユーザー体験と積分画像 (User Experience and Integrated Image)

| 項目 (Item) | 仕様 (Specification) |
| :--- | :--- |
| **積分データの蓄積 (Data Integration)** | **積算電荷量マップ**として、イベントと識別されたピクセルの電荷量 $Q$ を継続的に加算し蓄積する。 |
| **グレースケール画像 (Grayscale Image)** | $\text{5fps}$ 程度の頻度で、積算電荷量マップから**最大値を $255$** とするスケールでグレースケール画像 ($\text{Uint8}$ $0 \sim 255$) を $\text{Wasm}$ 内で計算・生成する。 |
| **カラー積分画像 (Color Integration - Future)** | ラジオボタンの選択肢として用意し、当面は**開発中を示す図**を表示する。（将来的にイベントカウント数に応じた $\text{Hue}$ 値を割り当てる。） |

### 6. 多言語対応 (i18n) (Internationalization)

| 項目 (Item) | 仕様 (Specification) |
| :--- | :--- |
| **対応言語 (Languages)** | 日本語 (Japanese) と 英語 (English) |
| **対応範囲 (Scope)** | **UIテキスト**、**主要な出力ログ**（計測開始/終了時刻など）を最低限多言語化する。理想的には全てのテキストを対象とする。 |

### 7. Wasm/Worker の実行環境 (Execution Environment)

| 項目 (Item) | 仕様 (Specification) | 備考 |
| :--- | :--- | :--- |
| **JS/Wasmの配置** | 全ファイルを同一ディレクトリに配置。 | $\text{Web Worker}$ の $\text{importScripts}$ が相対パスで動作するため。 |
| **コンパイルコマンド** | `emcc -O3 -s WASM=1 -s EXPORT_NAME="DetectorCore" -s MODULARIZE=1 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_RUNTIME_METHODS="['cwrap','getValue','setValue']" --bind detector_core.cpp -o detector_core.js` | Embind使用のため、`-s EXPORTED_FUNCTIONS`は**削除済み**。 |
| **サーバー要件** | $\text{http://}$ または $\text{https://}$ サーバー環境が必須。 | $\text{Web Worker}$ と $\text{Wasm}$ のセキュリティ制約のため。（$\text{Live Server}$などで対応） |

---

## ✅ 実装状況 (Current Implementation Status)

| ファイル | 完了した機能 | 未完了・懸案事項 |
| :--- | :--- | :--- |
| `detector_core.cpp` | 線形化、閾値判定、$\text{ChargeMap}$積算、グレースケール画像生成、$\text{API}$バインディング。 | $\text{getEventCount()}$ のロジックは実装済みだが、利用ロジックの最適化。 |
| `detector_worker.js` | $\text{Wasm}$モジュールのロード、$\text{init/process}$ コマンドハンドリング、$\text{TypedArray}$ 転送、$\text{Wasm}$ メモリ管理（$\text{malloc/free}$）。 | $\text{Transferable Object}$ の効率的な再利用（プール）は未実装。 |
| `teramas-cc.js` | カメラアクセス、$\text{Web Worker}$初期化、$\text{requestAnimationFrame}$ ループ、$\text{i18n}$対応 $\text{UI}$ 更新、予備測定の**タイマー仮実装**。 | 予備測定の**自動終了ロジック**（ノイズ収束判定）は未実装。 |
| `index.html` | ダークモード $\text{UI}$ 構造、ボタン、表示エリアの配置。 | $-$ |
| `style.css` | ダークモード $\text{CSS}$ の実装。 | $-$ |

---

## 🛑 残課題と次期目標 (Open Issues and Next Goals)

### 1. 予備測定の高度化 (Advanced Preliminary Measurement)

* **課題**: 現在、予備測定は $\text{5}$秒間の**仮タイマー**で強制終了している。
* **目標**: $\text{Wasm}$コア内に**ノイズ統計量計算ロジック**（平均 $\mu$ と標準偏差 $\sigma$）を実装し、統計量が収束した時点で $\text{Worker}$ からメインスレッドに終了を通知する。

### 2. データ転送の最適化 (Data Transfer Optimization)

* **課題**: $\text{Worker}$ がフレーム処理結果を返す際、$\text{ArrayBuffer}$ を新規作成し転送している。
* **目標**: $\text{SharedArrayBuffer}$ の利用を検討するか、または $\text{Worker}$ とメインスレッド間で $\text{ArrayBuffer}$ の**プール化と再利用**を行うことで、ガベージコレクションの負荷とメモリコピーを削減する。

### 3. 計測結果のデータ出力 (Measurement Result Output)

* **課題**: 本計測（$\text{Start Measurement}$）後の結果出力ロジックがない。
* **目標**: 計測終了時、積算された総イベント数や計数率を**CSV形式**などでダウンロードできるようにする。

### 4. 単独ウィンドウ化の実装 (Dedicated Window Implementation)

* **課題**: $\text{index.html}$ には「単独ウィンドウで開きなおす」ボタンがあるが、機能が未実装。
* **目標**: メインの$\text{teramas-cc.js}$に、計測の安定性を高めるため**新しいウィンドウを開き、元のウィンドウを閉じる**ロジックを実装する。

---

## 🤝 貢献方法 (Contribution)

**TERAMAS-CC**は、オープンソースプロジェクトです。開発者、科学者、そしてすべての市民科学者の参加を歓迎します！

**TERAMAS-CC** is an open-source project. We welcome contributions from developers, scientists, and all citizen scientists!

### 💻 コード貢献 / Code Contribution

| ファイル | 役割 (日本語) | Role (English) |
| :--- | :--- | :--- |
| `detector_core.cpp` | **Wasm Core**：検出アルゴリズム（線形化、ノイズ識別、**フレーム/イベント数カウント**）の開発。 | Core algorithm development (linearity correction, noise identification, **frame/event counting**, etc.). |
| `detector_worker.js` | **Web Worker**：WebAssemblyの実行、フレーム処理、**計測時間計算**を行うワーカー。 | Web Worker to run WebAssembly, handle frame processing, and **calculate measurement time**. |
| `teramas-cc.js` | カメラ制御、Wasm連携、UI/UX、データ通信層、**多言語化UIの管理**の開発。 | Development of camera control, Wasm integration, UI/UX, data communication layers, and **i18n UI management**. |

### 📊 市民科学としての貢献 (データ提供) / Citizen Science Contribution (Data Provision)

#### 🇯🇵 日本語
測定ソフトウェアが公開された後、カメラを遮光し、ブラウザを起動して参加ボタンを押すだけです。あなたのデバイスが地球規模の観測に貢献し、人類の科学的知見を広げる手助けとなります。

#### 🇬🇧 English
Once the measurement software is released, participation is as simple as covering your camera, opening your browser, and clicking the participation button. Your device will contribute to global-scale observation and expand humanity's scientific knowledge.