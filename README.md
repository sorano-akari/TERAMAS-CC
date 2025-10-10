### 💻 コード貢献 (Code Contribution)

<comment-tag id="1">|

| **ファイル** | **役割 (日本語)** | **Role (English)** |
| `detector_core.cpp` | **Wasm Core**：検出アルゴリズム（ノイズ判定、**線形化**、粒子識別など）の開発。 | Core algorithm development (noise identification, **linearity correction**, particle identification, etc.). |
| `detector_worker.js` | **Web Worker**：WebAssemblyの実行とフレーム処理を行うワーカー。 | Web Worker to run WebAssembly and handle frame processing. |
| `terra-mon.js` | カメラ制御、Wasm連携、UI/UX、データ通信層の開発。 | Development of camera control, Wasm integration, UI/UX, and data communication layers. |</comment-tag id="1" text="|

| ファイル | 役割 (日本語) | Role (English) |
| :--- | :--- | :--- |
| `detector_core.cpp` | **Wasm Core**：検出アルゴリズム（ノイズ判定、**線形化**、粒子識別など）の開発。 | Core algorithm development (noise identification, **linearity correction**, particle identification, etc.). |
| `detector_worker.js` | **Web Worker**：WebAssemblyの実行とフレーム処理を行うワーカー。 | Web Worker to run WebAssembly and handle frame processing. |
| `terra-mon.js` | カメラ制御、Wasm連携、UI/UX、データ通信層の開発。 | Development of camera control, Wasm integration, UI/UX, and data communication layers. |

これは、`コード貢献` テーブルから壊れた行と不要なフォーマットを削除し、一貫した Markdown テーブル形式で再構築することで、視認性とプロフェッショナリズムを大幅に向上させます。" type="suggestion">

### 2. Markdownの強調表示の修正と一貫性確保

太字 (`**`) の開始タグと終了タグが一致していない箇所や、Markdownが壊れている箇所を修正します。

| 改善要素 | 役割を果たす場所 |
| :--- | :--- |
| **一貫性と正確性** | **プロジェクト概要**および**線形化**セクション |

**なぜ改善するのか:** 強調表示の構文が壊れていると、レンダリング時に意図した強調表示がされなかったり、Markdownソースが読みにくくなったりします。

**修正案:**

<comment-tag id="2">**TERRA-MON**は、世界中の**PCやスマートフォンのWebカメラ**のイメージセンサー（CMOS/CCD）を連携させ、地球規模の放射線（宇宙線）計測ネットワークを構築する\*\*市民科学（シチズンサイエンス）\*\*プロジェクトです。</comment-tag id="2" text="Markdownの太字表現を `**` に統一し、バックスラッシュを削除します。

**TERRA-MON**は、世界中の**PCやスマートフォンのWebカメラ**のイメージセンサー（CMOS/CCD）を連携させ、地球規模の放射線（宇宙線）計測ネットワークを構築する**市民科学（シチズンサイエンス）**プロジェクトです。" type="suggestion">高価な専用機器やアプリのインストールは不要です。

* **課題（Problem）**: 多くのカメラドライバーは、暗闇で**ノイズ抑制**を過剰に行い、真のノイズ信号を消してしまいます。また、RGB出力には<comment-tag id="3">\*\*人間の視覚に合わせた非線形な補正（ガンマ補正）\*\*</comment-tag id="3" text="Markdownの太字表現を `**` に統一します。

**人間の視覚に合わせた非線形な補正（ガンマ補正）**" type="suggestion">がかかっており、電荷量（物理量）に比例していません。

### 3. タイトルと見出しの充実化 (バッジの追加)

GitHubリポジトリとして標準的な情報（ライセンス、スター数、主要技術）を一目でわかるようにします。

| 改善要素 | 役割を果たす場所 |
| :--- | :--- |
| **エンゲージメント** | **ドキュメントのヘッダー** |

**なぜ改善するのか:** バッジは、プロジェクトのステータス（ライセンス、人気、技術スタック）を簡潔に伝え、信頼性と注目度を高めるための標準的な方法です。

**修正案:**

```markdown
<comment-tag id="4"># TERAMAS-CC: シチズンサイエンス地球放射線マッピングシステム（てらますしーしー）

# TERAMAS-CC: TErra RAdiation MApping System by Citizens' Cameras: TERAMAS-CC project's repository.

あなたのカメラが、地球を測る巨大な放射線検出器になる。
Your camera becomes a massive radiation detector that measures the Earth.</comment-tag id="4" text="# TERAMAS-CC: シチズンサイエンス地球放射線マッピングシステム（てらますしーしー）

# TERAMAS-CC: TErra RAdiation MApping System by Citizens' Cameras: TERAMAS-CC project's repository.

[![GitHub license](https://img.shields.io/github/license/user/terra-mon?style=flat-square)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/user/terra-mon/stargazers?style=flat-square)](https://github.com/user/terra-mon/stargazers)
[![WebAssembly](https://img.shields.io/badge/Tech-WebAssembly-654ff0?style=flat-square)](https://webassembly.org/)

あなたのカメラが、地球を測る巨大な放射線検出器になる。
Your camera becomes a massive radiation detector that measures the Earth.

プロジェクトタイトルと主要な技術・ライセンス情報を一目でわかるようにするためのバッジを追加します。" type="suggestion">

### 4. 技術の核セクションの簡潔化

技術説明の最初のポイントである「遮光」の日本語表現を、より簡潔で力強いものに修正します。

| 改善要素 | 役割を果たす場所 |
| :--- | :--- |
| **明瞭さと簡潔さ** | **技術の核：遮光** |

**なぜ改善するのか:** 技術的な説明は、冗長な表現を避け、直感的かつ簡潔である方が効果的です。

**修正案:**

1. **遮光 (Light Shielding):** <comment-tag id="5">レンズを黒いテープなどで覆うことで環境光を完全に遮断します。</comment-tag id="5" text="表現をより簡潔にし、読者に直感的に内容が伝わるようにします。

レンズを黒いテープなどで覆い、環境光を完全に遮断します。" type="suggestion">
   **Light Shielding:** The camera lens is completely covered with black tape or similar material to block ambient light.

### 5. 線形化セクションの日本語表現の修正

特に重要な線形化の説明部分の日本語の言い回しと強調表示を修正します。

| 改善要素 | 役割を果たす場所 |
| :--- | :--- |
| **日本語の流暢さ** | **線形化**の説明文 |

**なぜ改善するのか:** 「...**逆ガンマ補正（Inverse Gamma Correction）を実装します。これは、画像データにかけられた非線形な補正を排除**し...」という文章は、句読点や接続詞がないため読みにくく、また強調表示も不完全です。

**修正案:**

#### ⚛️ 物理量計測のための線形化 (Linearity Correction for Physical Measurement)

電荷量に比例する正確な積算を行うため、以下の**逆ガンマ補正（Inverse Gamma Correction）**を実装します。<comment-tag id="6">これは、画像データにかけられた非線形な補正を排除**し</comment-tag id="6" text="文章の区切りを自然にし、強調表示を修正します。

これは、画像データにかけられた**非線形な補正を排除**し、" type="suggestion">、線形な物理量に戻すための最も重要なステップです。