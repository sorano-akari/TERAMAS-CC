// TERAMAS-CC: Wasm Core Source (detector_core.cpp)
// 検出アルゴリズムと高速計算を実行するC++コード。
// Emscriptenでコンパイルされ、Web Workerから呼び出されます。

#include <emscripten/emscripten.h>
#include <cstdint>
#include <cmath>
#include <algorithm>

// グローバルな定数と統計用メモリ
// Wasmヒープ内でこの構造体を1つ保持し、結果を返すために使用します。
struct Stats {
    double sum_I = 0.0;
    double sum_I_sq = 0.0;
    long long pixel_count = 0;
};

// ----------------------------------------------------------------------
// Wasmヒープ上のグローバルなStatsオブジェクト
// ----------------------------------------------------------------------
// このアドレス（ポインタ）をJS側に渡し、JS側でデータを読み取ります。
Stats globalStats;

// ----------------------------------------------------------------------
// 補正係数
// ----------------------------------------------------------------------
// Rチャネルを基準（1.0）とし、GとBチャネルの不均一性を補正するための係数。
// JS側から _setCalibrationFactors で設定されます。
float G_FACTOR = 1.0f;
float B_FACTOR = 1.0f;

// ----------------------------------------------------------------------
// sRGB逆ガンマ補正関数 (Linearity Correction)
// ----------------------------------------------------------------------
// 8-bit値 (0-255) から、電荷量に比例する線形な輝度値 (0.0-1.0) に変換します。
// これが、正確な物理量計測のための最も重要なステップです。
float inverseGammaCorrection(uint8_t component) {
    // 0.0から1.0の範囲に正規化
    float v = (float)component / 255.0f;

    if (v <= 0.04045f) {
        // 線形部分
        return v / 12.92f;
    } else {
        // 非線形（べき乗）部分
        return std::pow((v + 0.055f) / 1.055f, 2.4f);
    }
}

// ----------------------------------------------------------------------
// 1. フレーム処理と統計計算
// ----------------------------------------------------------------------
// ImageData.data (Uint8ClampedArray) を受け取り、統計情報を更新します。
// Wasmにエクスポートされ、Web Workerから呼び出されます。
extern "C" {

EMSCRIPTEN_KEEPALIVE
int processFrame(const uint8_t* data_ptr, int width, int height) {
    const int num_pixels = width * height;

    // R, G, Bの輝度合計と二乗合計をフレームごとに積算するための変数
    // ここでは、グローバルなStatsオブジェクトに直接加算します。
    
    for (int i = 0; i < num_pixels; ++i) {
        // RGBAデータは4バイト（R, G, B, A）で1ピクセル
        int data_index = i * 4;
        
        // 8bit RGB値を取得
        uint8_t R_8bit = data_ptr[data_index];
        uint8_t G_8bit = data_ptr[data_index + 1];
        uint8_t B_8bit = data_ptr[data_index + 2];
        
        // 1. 逆ガンマ補正を適用し、線形な物理量に変換 (0.0 - 1.0)
        float I_R = inverseGammaCorrection(R_8bit);
        float I_G = inverseGammaCorrection(G_8bit);
        float I_B = inverseGammaCorrection(B_8bit);

        // 2. キャリブレーション係数を適用
        // Rチャネルを基準とし、G, Bチャネルの感度差を補正
        float I_G_calibrated = I_G * G_FACTOR;
        float I_B_calibrated = I_B * B_FACTOR;
        
        // 3. 3つのチャネルの平均を線形輝度Iとして算出
        // これが電荷量に比例する値です
        double I = (I_R + I_G_calibrated + I_B_calibrated) / 3.0;

        // 4. グローバルな統計情報に積算
        globalStats.sum_I += I;
        globalStats.sum_I_sq += (I * I);
        globalStats.pixel_count += 1;
    }

    // globalStatsオブジェクトのメモリアドレス（ポインタ）を整数として返す
    // JS側はこのアドレスから globalStats の内容を読み出します。
    return (int)&globalStats;
}

// ----------------------------------------------------------------------
// 2. 統計情報のリセット
// ----------------------------------------------------------------------
// JS側から呼び出され、統計情報を初期化します。
EMSCRIPTEN_KEEPALIVE
void resetStats() {
    globalStats.sum_I = 0.0;
    globalStats.sum_I_sq = 0.0;
    globalStats.pixel_count = 0;
}

// ----------------------------------------------------------------------
// 3. キャリブレーション係数の設定
// ----------------------------------------------------------------------
// 予備測定で得られた補正係数をWasmコアに設定します。
EMSCRIPTEN_KEEPALIVE
void setCalibrationFactors(float g_factor, float b_factor) {
    G_FACTOR = g_factor;
    B_FACTOR = b_factor;
}

} // extern "C"
