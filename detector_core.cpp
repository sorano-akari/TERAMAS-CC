// Wasm Core Source: 検出アルゴリズムと高速計算の C++ ソースコード

#include <emscripten.h>
#include <cstdint>
#include <cmath>
#include <iostream>
#include <cstdlib> // malloc/free用

// Stats構造体のメモリ配置
// 統計情報はR, G, Bの各チャネル、および総電荷量(Charge = R+G+B)で個別に保持します。

struct Stats {
    // R (赤)
    double sum_R;        // Rピクセル強度の合計
    double sum_R_sq;     // Rピクセル強度の二乗の合計 (分散計算用)
    // G (緑)
    double sum_G;        // Gピクセル強度の合計
    double sum_G_sq;     // Gピクセル強度の二乗の合計
    // B (青)
    double sum_B;        // Bピクセル強度の合計
    double sum_B_sq;     // Bピクセル強度の二乗の合計
    
    // Charge (R + G + B の電荷量)
    double sum_Charge;   // チャネル合計(R+G+B)の総和
    double sum_Charge_sq;// チャネル合計(R+G+B)の二乗の総和
    
    // 共通
    uint64_t frame_count; // 処理されたフレーム数
    uint64_t pixel_total; // フレーム内の全ピクセル数 (W*H)
};

// グローバルな統計情報構造体
// 複数のフレームにわたって積算するために必要
Stats global_stats = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0};

// --- グローバル補正係数 (初期値 1.0) ---
// JavaScriptから設定され、検出イベント処理時に使用されます。
double g_factor = 1.0;
double b_factor = 1.0;

// --- 画像積算用グローバル変数 ---
// R, G, Bの各チャネルをfloatで積算するバッファ
// float (4バイト) を使用することで、Uint8の画像でも高精度な累積が可能
float* accumulated_image = nullptr; 
int img_width = 0;
int img_height = 0;

// ---------------------
// C++関数 (Wasm公開用)
// ---------------------

/**
 * 統計情報をリセットします。
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void resetStats() {
        global_stats = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0};
        // 係数はリセットしない (キャリブレーションの結果は保持)
        std::cout << "[Wasm] Stats reset completed." << std::endl;
    }
}

/**
 * グローバル統計情報構造体へのポインタを返します。
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    Stats* getGlobalStatsPtr() {
        return &global_stats;
    }
}


/**
 * JavaScriptから補正係数を受け取り、Wasmコアに設定します。
 * @param gFactor G/R補正係数
 * @param bFactor B/R補正係数
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void setCalibrationFactors(double gFactor, double bFactor) {
        g_factor = gFactor;
        b_factor = bFactor;
        std::cout << "[Wasm] Calibration factors set: G/R=" << g_factor << ", B/R=" << b_factor << std::endl;
    }
}

/**
 * 累積画像バッファを確保・初期化します。
 * この関数は計測開始時に一度だけ呼び出されます。
 * @param width 画像の幅
 * @param height 画像の高さ
 * @return 確保された累積バッファへのポインタ
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    float* allocateAccumulationBuffer(int width, int height) {
        if (accumulated_image) {
            // 既に確保されている場合は解放
            free(accumulated_image);
            accumulated_image = nullptr;
        }

        img_width = width;
        img_height = height;

        // R, G, Bの3チャネルをfloat (4バイト) で積算
        size_t buffer_size = (size_t)width * height * 3;
        
        // Emscriptenのランタイムを通じてメモリを確保
        accumulated_image = (float*)malloc(buffer_size * sizeof(float));

        if (accumulated_image) {
            // バッファをゼロクリア
            for (size_t i = 0; i < buffer_size; ++i) {
                accumulated_image[i] = 0.0f;
            }
            std::cout << "[Wasm] Accumulation buffer allocated: " << width << "x" << height << "x3 (Float)" << std::endl;
            return accumulated_image;
        } else {
            std::cerr << "[Wasm] ERROR: Failed to allocate accumulation buffer." << std::endl;
            return nullptr;
        }
    }
}

/**
 * 累積バッファを解放します。
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    void freeAccumulationBuffer() {
        if (accumulated_image) {
            free(accumulated_image);
            accumulated_image = nullptr;
            img_width = 0;
            img_height = 0;
            std::cout << "[Wasm] Accumulation buffer freed." << std::endl;
        }
    }
}

/**
 * 予備測定時に使用。入力フレームを処理し、R, G, Bチャネルおよび電荷量の統計量を計算・積算します。
 * * @param buffer Uint8ArrayとしてJSから渡される画像データ (RGBA形式)
 * @param width 画像の幅
 * @param height 画像の高さ
 * @return Stats構造体へのポインタ
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    Stats* processFrame(uint8_t* buffer, int width, int height) {
        
        // 処理のたびにフレームカウントをインクリメント
        global_stats.frame_count++;
        
        // 初回実行時にピクセル総数を設定
        if (global_stats.pixel_total == 0) {
            // RGBAで4バイト/ピクセル
            global_stats.pixel_total = (uint64_t)width * height;
        }

        // 画像データのサイズ (ピクセル数 * 4チャネル)
        size_t data_size = (size_t)width * height * 4;
        
        // フレーム内の統計量を計算し、グローバル統計量に積算
        for (size_t i = 0; i < data_size; i += 4) {
            // 画素値は0-255の範囲
            double R = (double)buffer[i];     // 赤チャネル (R)
            double G = (double)buffer[i + 1]; // 緑チャネル (G)
            double B = (double)buffer[i + 2]; // 青チャネル (B)
            // buffer[i + 3] はアルファチャネル (A)

            double Charge = R + G + B;
            
            // R, G, Bチャネルの統計量積算
            global_stats.sum_R += R;
            global_stats.sum_R_sq += R * R;

            global_stats.sum_G += G;
            global_stats.sum_G_sq += G * G;

            global_stats.sum_B += B;
            global_stats.sum_B_sq += B * B;
            
            // 電荷量 (Charge) の統計量積算
            global_stats.sum_Charge += Charge;
            global_stats.sum_Charge_sq += Charge * Charge;
        }

        // Stats構造体のポインタを返す
        return &global_stats;
    }
}

/**
 * 入力フレームを処理し、カラーバランス補正を適用して累積画像バッファに加算します。
 * (この段階では検出は行わず、純粋に積算のみを行います)
 * @param buffer Uint8ArrayとしてJSから渡される画像データ (RGBA形式)
 * @return 成功 (1) / 失敗 (0)
 */
extern "C" {
    EMSCRIPTEN_KEEPALIVE
    int accumulateFrame(uint8_t* buffer) {
        // img_width/heightはallocateAccumulationBufferで設定済みと仮定
        if (!accumulated_image) {
             std::cerr << "[Wasm] ERROR: Accumulation buffer not initialized." << std::endl;
             return 0;
        }
        
        size_t data_size = (size_t)img_width * img_height * 4;
        size_t acc_index = 0; // accumulated_imageのインデックス (R, G, Bの順)

        for (size_t i = 0; i < data_size; i += 4) {
            // 画素値を取得 (0-255)
            float R = (float)buffer[i];
            float G = (float)buffer[i + 1];
            float B = (float)buffer[i + 2];

            // 1. カラーバランス補正を適用
            // Rチャネルはそのまま (基準)
            // GチャネルとBチャネルに係数を乗算
            float corrected_R = R;
            float corrected_G = G * (float)g_factor;
            float corrected_B = B * (float)b_factor;

            // 2. 累積バッファに加算
            accumulated_image[acc_index++] += corrected_R; // R
            accumulated_image[acc_index++] += corrected_G; // G
            accumulated_image[acc_index++] += corrected_B; // B
        }
        
        // 積算が成功したフレームは統計情報のフレーム数をインクリメント
        global_stats.frame_count++;
        
        return 1;
    }
}
