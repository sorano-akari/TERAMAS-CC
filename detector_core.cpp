#include <stdlib.h> // calloc, free のために必要

// ----------------------------------------------------
// グローバル変数（ピクセル統計量を保持する動的配列）
// ----------------------------------------------------

// 輝度の総和 (Sum of Intensity: ΣI)
long long* sum_intensity = nullptr;

// 輝度の二乗の総和 (Sum of Intensity Squared: ΣI²)
long long* sum_intensity_sq = nullptr;

// 現在の解像度情報
int current_width = 0;
int current_height = 0;
int frame_counter = 0; // 処理したフレーム数

// ----------------------------------------------------
// JavaScriptから呼び出される公開関数
// ----------------------------------------------------
extern "C" {
    /**
     * @brief 計測の初期化とメモリ確保を行う
     * * @param width 確定したカメラの幅
     * @param height 確定したカメラの高さ
     */
    void init_bg_measurement(int width, int height) {
        // 以前確保したメモリがあれば解放し、クリーンな状態にする
        if (sum_intensity) free(sum_intensity);
        if (sum_intensity_sq) free(sum_intensity_sq);
        
        current_width = width;
        current_height = height;
        frame_counter = 0;
        
        int pixel_count = width * height;
        
        // メモリを動的に確保し、同時にゼロ初期化を行う (callocを使用)
        // C#の配列初期化と同じく、データはゼロからスタート
        sum_intensity = (long long*)calloc(pixel_count, sizeof(long long));
        sum_intensity_sq = (long long*)calloc(pixel_count, sizeof(long long));
        
        // メモリ確保に失敗した場合は、JavaScript側でエラーハンドリングが必要
        if (!sum_intensity || !sum_intensity_sq) {
            // エラー処理（この例ではシンプルにそのまま終了）
            current_width = 0;
            current_height = 0;
        }
    }

    /**
     * @brief 1フレーム分の画像データを受け取り、統計量を更新する
     * * @param img_data JavaScriptから渡された生のピクセルデータ (RGBA, 4バイト/ピクセル)
     * @return int 更新後のフレーム数
     */
    int process_bg_frame(unsigned char* img_data) {
        if (current_width == 0 || !sum_intensity) {
            return -1; // 初期化が完了していない場合はエラー
        }

        // ピクセルごとの高速処理
        for (int y = 0; y < current_height; y++) {
            for (int x = 0; x < current_width; x++) {
                // RGBAデータは4バイト/ピクセル（R, G, B, A の順）
                // RGBAのRチャネル（インデックス0）を輝度として使用
                // C#版のようにR, G, Bすべてを使うわけではないが、まずはシンプルにRチャネルで進める
                long long intensity = (long long)img_data[(y * current_width + x) * 4]; 
                
                int index = y * current_width + x; // 1次元配列のインデックス

                // 統計量の更新: ΣI と ΣI²
                sum_intensity[index] += intensity;
                sum_intensity_sq[index] += intensity * intensity;
            }
        }

        frame_counter++;
        return frame_counter;
    }

    /**
     * @brief 計測完了後、計算に用いたメモリを解放する
     */
    void free_bg_memory() {
        if (sum_intensity) free(sum_intensity);
        if (sum_intensity_sq) free(sum_intensity_sq);
        sum_intensity = nullptr;
        sum_intensity_sq = nullptr;
        current_width = 0;
        current_height = 0;
        frame_counter = 0;
    }

    // TODO: 後で統計量計算関数 (calculate_statistics) と結果エクスポート関数を追加
}