#include <emscripten/emscripten.h>
#include <cstdlib>   // std::malloc, std::free
#include <cstring>   // std::memset, std::memcpy
#include <cstdint>   // uint32_t, uint8_t, uint64_t 

// ----------------------------------------------------------------------
// Wasmリンクの安定化: C互換性とプロトタイプ宣言
// ----------------------------------------------------------------------

#ifdef __cplusplus
extern "C" {
#endif

// 🚨 修正: process_frame 関数から frame_data 引数を削除しました。
// JSはC++が確保した input_frame_buffer に直接データを書き込みます。
void init_correction_mode(uint32_t width, uint32_t height);
void reset_accumulation();
void set_correction_factors(float gFactor, float bFactor);
uint32_t* process_correction_frame(uint32_t width, uint32_t height, int returnImage);
uint32_t* process_measurement_frame(uint32_t width, uint32_t height, int returnImage);
void cleanup();

#ifdef __cplusplus
}
#endif

// ----------------------------------------------------------------------
// グローバル変数の宣言
// ----------------------------------------------------------------------

// 🚨 修正: uint64_t* で積算バッファを宣言 (オーバーフロー防止)
uint64_t* sum_r_buffer = nullptr;
uint64_t* sum_g_buffer = nullptr;
uint64_t* sum_b_buffer = nullptr;

// 🚨 追加: JSがカメラデータを書き込むための入力バッファ
uint8_t* input_frame_buffer = nullptr; 

uint32_t* hit_count_buffer = nullptr;
uint8_t* image_data_buffer = nullptr; 
uint32_t* result_struct = nullptr; // JSに返す結果ポインタ構造体

uint64_t* summary_r = nullptr;
uint64_t* summary_g = nullptr;
uint64_t* summary_b = nullptr;

uint32_t pixel_count = 0;
uint32_t frame_counter = 0;
float g_correction_factor = 1.0f;
float b_correction_factor = 1.0f;


// ----------------------------------------------------------------------
// 関数定義ブロック (extern "C")
// ----------------------------------------------------------------------

#ifdef __cplusplus
extern "C" {
#endif

// 1. 初期化とメモリ確保
EMSCRIPTEN_KEEPALIVE
void init_correction_mode(uint32_t width, uint32_t height) {
    if (sum_r_buffer) {
        cleanup(); 
    }
    
    pixel_count = width * height;
    
    size_t size_64bit = pixel_count * sizeof(uint64_t); 
    size_t size_32bit = pixel_count * sizeof(uint32_t);
    size_t size_frame_buffer = pixel_count * 4 * sizeof(uint8_t);
    
    // 積算バッファ (uint64_t)
    sum_r_buffer = (uint64_t*)std::malloc(size_64bit);
    sum_g_buffer = (uint64_t*)std::malloc(size_64bit);
    sum_b_buffer = (uint64_t*)std::malloc(size_64bit);
    
    // 🚨 追加: 入力バッファをC++側で確保
    input_frame_buffer = (uint8_t*)std::malloc(size_frame_buffer);

    // 他のバッファの確保
    hit_count_buffer = (uint32_t*)std::malloc(size_32bit);
    image_data_buffer = (uint8_t*)std::malloc(size_frame_buffer); // RGBA出力用
    
    // 集計ポインタ（BigInt用）の確保
    summary_r = (uint64_t*)std::malloc(sizeof(uint64_t));
    summary_g = (uint64_t*)std::malloc(sizeof(uint64_t));
    summary_b = (uint64_t*)std::malloc(sizeof(uint64_t));
    
    // 結果構造体の確保
    result_struct = (uint32_t*)std::malloc(6 * sizeof(uint32_t));
    
    if (!sum_r_buffer || !hit_count_buffer || !result_struct || !input_frame_buffer) {
        // メモリ確保失敗時のエラー処理
        return; 
    }
    
    reset_accumulation(); 
}

// 2. 蓄積のリセット
EMSCRIPTEN_KEEPALIVE
void reset_accumulation() {
    if (sum_r_buffer) {
        // 8バイト（uint64_t）単位でゼロクリア
        std::memset(sum_r_buffer, 0, pixel_count * sizeof(uint64_t));
        std::memset(sum_g_buffer, 0, pixel_count * sizeof(uint64_t));
        std::memset(sum_b_buffer, 0, pixel_count * sizeof(uint64_t));
        // uint32_tのサイズでゼロクリア
        std::memset(hit_count_buffer, 0, pixel_count * sizeof(uint32_t));
    }
    if (summary_r) {
        *summary_r = 0;
        *summary_g = 0;
        *summary_b = 0;
    }
    frame_counter = 0;
}

// 3. 補正係数の設定
EMSCRIPTEN_KEEPALIVE
void set_correction_factors(float gFactor, float bFactor) {
    g_correction_factor = gFactor;
    b_correction_factor = bFactor;
}

// 4. フレーム処理（CORRECTION_MODE）
// 🚨 修正: frame_data 引数を削除
EMSCRIPTEN_KEEPALIVE
uint32_t* process_correction_frame(uint32_t width, uint32_t height, int returnImage) {
    // ********** ⚠️ 実際の処理ロジックをここに移植してください ⚠️ **********
    // データの読み出しは input_frame_buffer から行います。
    // 例: uint8_t r_val = input_frame_buffer[i * 4];

    frame_counter++;

    // 結果構造体へのポインタ書き込み
    if (result_struct) {
        result_struct[0] = frame_counter;
        result_struct[1] = (uint32_t)summary_r;
        result_struct[2] = (uint32_t)summary_g;
        result_struct[3] = (uint32_t)summary_b;
        result_struct[4] = returnImage ? (uint32_t)image_data_buffer : 0;
        result_struct[5] = pixel_count;
    }
    
    return result_struct;
}

// 5. フレーム処理（MEASUREMENT_MODE）
// 🚨 修正: frame_data 引数を削除
EMSCRIPTEN_KEEPALIVE
uint32_t* process_measurement_frame(uint32_t width, uint32_t height, int returnImage) {
    // ********** ⚠️ 実際の処理ロジックをここに移植してください ⚠️ **********
    // データの読み出しは input_frame_buffer から行います。

    frame_counter++;
    
    // 結果構造体へのポインタ書き込み
    if (result_struct) {
        result_struct[0] = frame_counter;
        result_struct[1] = (uint32_t)summary_r;
        result_struct[2] = (uint32_t)summary_g;
        result_struct[3] = (uint32_t)summary_b;
        result_struct[4] = returnImage ? (uint32_t)image_data_buffer : 0;
        result_struct[5] = pixel_count;
    }
    
    return result_struct;
}

// 6. 入力バッファポインタをJSに公開
EMSCRIPTEN_KEEPALIVE
uint32_t get_input_frame_buffer_ptr() {
    return (uint32_t)input_frame_buffer;
}

// 7. クリーンアップとメモリ解放
EMSCRIPTEN_KEEPALIVE
void cleanup() {
    if (sum_r_buffer) {
        std::free(sum_r_buffer); 
        std::free(sum_g_buffer); 
        std::free(sum_b_buffer);
        std::free(hit_count_buffer); 
        std::free(image_data_buffer);
        std::free(summary_r); 
        std::free(summary_g); 
        std::free(summary_b);
        std::free(result_struct);
        
        // 🚨 input_frame_buffer も解放
        std::free(input_frame_buffer); 
        
        // ポインタを nullptr にリセット
        sum_r_buffer = nullptr;
        sum_g_buffer = nullptr;
        sum_b_buffer = nullptr;
        input_frame_buffer = nullptr;
        hit_count_buffer = nullptr;
        image_data_buffer = nullptr;
        summary_r = nullptr;
        summary_g = nullptr;
        summary_b = nullptr;
        result_struct = nullptr;
    }
    pixel_count = 0;
    frame_counter = 0;
}


#ifdef __cplusplus
} // extern "C"
#endif

// ----------------------------------------------------------------------
// 内部的な（非公開の）関数定義はここから下へ
// ----------------------------------------------------------------------