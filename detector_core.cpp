// detector_core.cpp - R/G/B個別積算と線形統合積算を両立する最終版

#include <emscripten/emscripten.h>
#include <cstdlib>   // std::malloc, std::free
#include <cstring>   // std::memset, std::memcpy
#include <cstdint>   // uint32_t, uint8_t, uint64_t 
#include <cmath>     // powf

// ----------------------------------------------------------------------
// Wasmリンクの安定化: C互換性とプロトタイプ宣言 (🚨 修正: 抜けを補完)
// ----------------------------------------------------------------------

#ifdef __cplusplus
extern "C" {
#endif

void init_correction_mode(uint32_t width, uint32_t height);
void reset_accumulation(); // 🚨 追加
void set_correction_factors(float gFactor, float bFactor);
uint32_t* process_correction_frame(uint32_t width, uint32_t height, int returnImage);
uint32_t* process_measurement_frame(uint32_t width, uint32_t height, int returnImage);
uint32_t get_input_frame_buffer_ptr(); // 🚨 追加
void cleanup(); // 🚨 追加
// setup_srgb_lut のプロトタイプ宣言は、定義がextern "C"内にあるため不要

#ifdef __cplusplus
}
#endif

// ----------------------------------------------------------------------
// グローバル変数の宣言
// ----------------------------------------------------------------------

uint64_t* sum_r_buffer = nullptr;
uint64_t* sum_g_buffer = nullptr;
uint64_t* sum_b_buffer = nullptr;

uint8_t* input_frame_buffer = nullptr; 

uint32_t* hit_count_buffer = nullptr;
uint8_t* image_data_buffer = nullptr;
uint32_t* result_struct = nullptr;

uint64_t* summary_r = nullptr;
uint64_t* summary_g = nullptr;
uint64_t* summary_b = nullptr;

// 🚨 sRGB逆変換ルックアップテーブル
float srgb_to_linear_lut[256];

uint32_t pixel_count = 0;
uint32_t frame_counter = 0;
float g_correction_factor = 1.0f;
float b_correction_factor = 1.0f;


// ----------------------------------------------------------------------
// 内部関数: フレーム処理の共通ロジック (コア処理)
// ----------------------------------------------------------------------
// NOTE: この関数はextern "C"ではないため、上記にプロトタイプ宣言は不要
uint32_t* process_frame_common(uint32_t width, uint32_t height, int returnImage) {
    const uint32_t total_pixels = width * height;
    uint64_t current_summary_r = 0;      
    uint64_t current_summary_g = 0;      
    uint64_t current_summary_b = 0;      
    
    const uint64_t SCALE_FACTOR = 16777216; 

    for (uint32_t i = 0; i < total_pixels; ++i) {
        uint8_t r_val = input_frame_buffer[i * 4];
        uint8_t g_val = input_frame_buffer[i * 4 + 1];
        uint8_t b_val = input_frame_buffer[i * 4 + 2];

        // 逆ガンマ補正
        float linearR = srgb_to_linear_lut[r_val];
        float linearG = srgb_to_linear_lut[g_val];
        float linearB = srgb_to_linear_lut[b_val];
        
        // 1. R/G/B 個別積算 
        uint64_t val_r = (uint64_t)(linearR * SCALE_FACTOR);
        uint64_t val_g = (uint64_t)(linearG * g_correction_factor * SCALE_FACTOR); 
        uint64_t val_b = (uint64_t)(linearB * b_correction_factor * SCALE_FACTOR); 

        sum_r_buffer[i] += val_r;
        sum_g_buffer[i] += val_g;
        sum_b_buffer[i] += val_b;

        current_summary_r += val_r;
        current_summary_g += val_g;
        current_summary_b += val_b;
        
        // 2. 可視化用のデータ作成 (入力データをそのまま出力バッファにコピー)
        if (returnImage && image_data_buffer) {
             image_data_buffer[i * 4] = r_val;
             image_data_buffer[i * 4 + 1] = g_val;
             image_data_buffer[i * 4 + 2] = b_val;
             image_data_buffer[i * 4 + 3] = 255; 
        }
    }

    frame_counter++;
    
    *summary_r = current_summary_r;
    *summary_g = current_summary_g;
    *summary_b = current_summary_b;
    
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

// ----------------------------------------------------------------------
// 公開関数定義ブロック (extern "C")
// ----------------------------------------------------------------------

#ifdef __cplusplus
extern "C" {
#endif

// 🚨 setup_srgb_lut の定義 (EMSCRIPTEN_KEEPALIVE付き)
EMSCRIPTEN_KEEPALIVE
void setup_srgb_lut() {
    for (int i = 0; i < 256; ++i) {
        float val = (float)i / 255.0f;
        if (val <= 0.04045f) {
            srgb_to_linear_lut[i] = val / 12.92f;
        } else {
            srgb_to_linear_lut[i] = powf((val + 0.055f) / 1.055f, 2.4f);
        }
    }
}


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
    
    sum_r_buffer = (uint64_t*)std::malloc(size_64bit);
    sum_g_buffer = (uint64_t*)std::malloc(size_64bit);
    sum_b_buffer = (uint64_t*)std::malloc(size_64bit);
    
    input_frame_buffer = (uint8_t*)std::malloc(size_frame_buffer);

    hit_count_buffer = (uint32_t*)std::malloc(size_32bit);
    image_data_buffer = (uint8_t*)std::malloc(size_frame_buffer); 
    
    summary_r = (uint64_t*)std::malloc(sizeof(uint64_t));
    summary_g = (uint64_t*)std::malloc(sizeof(uint64_t));
    summary_b = (uint64_t*)std::malloc(sizeof(uint64_t));
    
    result_struct = (uint32_t*)std::malloc(6 * sizeof(uint32_t));
    
    if (!sum_r_buffer || !hit_count_buffer || !result_struct || !input_frame_buffer) {
        return; 
    }
    
    setup_srgb_lut();
    reset_accumulation(); 
}

// 2. 蓄積のリセット
EMSCRIPTEN_KEEPALIVE
void reset_accumulation() {
    if (sum_r_buffer) {
        std::memset(sum_r_buffer, 0, pixel_count * sizeof(uint64_t));
        std::memset(sum_g_buffer, 0, pixel_count * sizeof(uint64_t));
        std::memset(sum_b_buffer, 0, pixel_count * sizeof(uint64_t));
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
EMSCRIPTEN_KEEPALIVE
uint32_t* process_correction_frame(uint32_t width, uint32_t height, int returnImage) {
    return process_frame_common(width, height, returnImage);
}

// 5. フレーム処理（MEASUREMENT_MODE）
EMSCRIPTEN_KEEPALIVE
uint32_t* process_measurement_frame(uint32_t width, uint32_t height, int returnImage) {
    return process_frame_common(width, height, returnImage);
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
        
        std::free(input_frame_buffer); 
        
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