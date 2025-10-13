#include <vector>
#include <cmath>
#include <algorithm>
#include <emscripten/bind.h>

// カメラのピクセルサイズ
int g_width = 0;
int g_height = 0;
int g_num_pixels = 0;

// 積分データ (Wasmメモリに保持)
// 1. 積算電荷量マップ (倍精度浮動小数点数)
std::vector<double> g_charge_map;
// 2. イベントカウントマップ (uint8_t, 将来のカラーモード用)
std::vector<uint8_t> g_event_map;
// 3. ユーザー表示用グレースケール画像 (Uint8)
std::vector<uint8_t> g_grayscale_image;

// カウンター
int g_frame_count = 0;
int g_event_count = 0; // 総イベント数 (将来実装)

// ノイズ閾値
double g_noise_mu = 0.0;
double g_noise_sigma = 0.0;

/**
 * @brief sRGB標準に基づいた非線形な逆ガンマ補正を適用し、線形な輝度値（電荷量に比例）を計算
 * @param v_8bit 0から255の8ビット整数値
 * @return 0.0から1.0の線形輝度値 (double)
 */
double inverse_gamma_correction(uint8_t v_8bit) {
    // 0-255を0.0-1.0に正規化
    double v_norm = static_cast<double>(v_8bit) / 255.0;

    if (v_norm <= 0.04045) {
        return v_norm / 12.92;
    } else {
        // 標準sRGBの逆ガンマ関数: ((V_norm + 0.055) / 1.055) ^ 2.4
        return std::pow((v_norm + 0.055) / 1.055, 2.4);
    }
}

/**
 * @brief Wasmコアを初期化し、積分マップ用のメモリを確保する
 * @param width カメラの幅
 * @param height カメラの高さ
 */
void initialize(int width, int height) {
    if (width <= 0 || height <= 0) return;

    g_width = width;
    g_height = height;
    g_num_pixels = width * height;

    // 積分マップの確保とゼロ初期化
    g_charge_map.assign(g_num_pixels, 0.0);
    g_event_map.assign(g_num_pixels, 0); // uint8_t
    g_grayscale_image.assign(g_num_pixels, 0); // グレースケール画像は1ch (RBG入力は3ch)

    g_frame_count = 0;
    g_event_count = 0;
}

/**
 * @brief ノイズ閾値を設定する
 * @param mu ノイズレベルの平均 (電荷量 Q の単位)
 * @param sigma ノイズレベルの標準偏差 (電荷量 Q の単位)
 */
void setNoiseThreshold(double mu, double sigma) {
    g_noise_mu = mu;
    g_noise_sigma = sigma;
}

/**
 * @brief Webカメラからキャプチャしたフレームを処理し、積分マップを更新する
 * @param rgbDataPointer JS側から渡されたRGB 8bitデータのメモリアドレス
 */
void processFrame(uintptr_t rgbDataPointer) {
    if (g_num_pixels == 0) return;
    
    // JSから渡されたRGBデータ (R1 G1 B1 R2 G2 B2 ...)
    const uint8_t* rgb_data = reinterpret_cast<const uint8_t*>(rgbDataPointer);
    
    // ノイズ判定の閾値 (Q_threshold = mu + 2*sigma)
    const double q_threshold = g_noise_mu + 2.0 * g_noise_sigma;

    g_frame_count++; // フレーム数をカウント

    for (int i = 0; i < g_num_pixels; ++i) {
        int data_index = i * 3; // RGB 3チャンネルなのでインデックスを計算

        // 1. 線形化 (逆ガンマ補正)
        double r_linear = inverse_gamma_correction(rgb_data[data_index]);
        double g_linear = inverse_gamma_correction(rgb_data[data_index + 1]);
        double b_linear = inverse_gamma_correction(rgb_data[data_index + 2]);

        // 2. 1ピクセル当たりの電荷量 Q を計算 (0.0 から 3.0 の範囲)
        double q_charge = r_linear + g_linear + b_linear;

        // 3. 放射線イベント判定と積算
        if (q_charge > q_threshold) {
            // 放射線イベントと識別された場合
            g_charge_map[i] += q_charge;

            // イベントカウントマップをインクリメント（オーバーフロー許容）
            if (g_event_map[i] < 255) {
                g_event_map[i]++;
            }
            g_event_count++; // 総イベント数 (将来実装)
        }
    }
}

/**
 * @brief 積分マップからユーザー表示用のグレースケール画像を生成し、そのポインターを返す
 * @return グレースケール画像データ（Uint8）のメモリアドレス
 */
uintptr_t getGrayscaleImagePointer() {
    if (g_num_pixels == 0) return 0;

    // 1. ChargeMap内の最大値を見つける (スケーリングに必要)
    double max_charge = 0.0;
    if (!g_charge_map.empty()) {
        max_charge = *std::max_element(g_charge_map.begin(), g_charge_map.end());
    }

    // 最大値が0の場合は、全て0でクリアして返す
    if (max_charge == 0.0) {
        std::fill(g_grayscale_image.begin(), g_grayscale_image.end(), 0);
        return reinterpret_cast<uintptr_t>(g_grayscale_image.data());
    }

    // 2. グレースケール画像を生成 (最大値を255とするスケーリング)
    for (int i = 0; i < g_num_pixels; ++i) {
        // (現在の電荷量 / 最大電荷量) * 255.0
        double scaled_value = (g_charge_map[i] / max_charge) * 255.0;
        
        // 0-255に丸めてUint8_tに格納
        g_grayscale_image[i] = static_cast<uint8_t>(std::round(scaled_value));
    }

    // Wasmメモリ内の配列の先頭アドレスを返す
    return reinterpret_cast<uintptr_t>(g_grayscale_image.data());
}

/**
 * @brief 処理済みフレーム数を返す
 * @return 処理済みフレーム数
 */
int getFrameCount() {
    return g_frame_count;
}

/**
 * @brief 検出された総イベント数を返す
 * @return 総イベント数 (将来実装)
 */
int getEventCount() {
    return g_event_count;
}

// Emscriptenバインディングの設定
EMSCRIPTEN_BINDINGS(detector_core_module) {
    emscripten::function("initialize", &initialize);
    emscripten::function("setNoiseThreshold", &setNoiseThreshold);
    emscripten::function("processFrame", &processFrame);
    emscripten::function("getGrayscaleImagePointer", &getGrayscaleImagePointer);
    emscripten::function("getFrameCount", &getFrameCount);
    emscripten::function("getEventCount", &getEventCount);
}