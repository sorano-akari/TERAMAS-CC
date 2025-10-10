// TERAMAS-CC: Web Worker (detector_worker.js)
// メインスレッドから分離し、WebAssembly (Wasm) の実行と高速なフレーム処理を行います。

let Module; // Emscriptenによって生成されるWasmモジュール
let isInitialized = false;

// ----------------------------------------------------------------------
// 1. Wasmモジュールのロードと初期化
// ----------------------------------------------------------------------
// WasmのJavaScriptラッパーを読み込みます。
self.importScripts('detector_core.js'); 

// Emscriptenモジュールの設定
Module = {
    // Web Worker環境向けの設定
    locateFile: (path, prefix) => {
        // .wasmファイルが同じディレクトリにあることを想定
        return path;
    },
    onRuntimeInitialized: () => {
        // Wasmランタイムの初期化が完了した後の処理
        isInitialized = true;
        self.postMessage({ type: 'STATUS', status: 'READY' });
        
        // C++の関数をJSで扱いやすいようにラップ
        // 'v' (void), 'i' (int), 'f' (float), 'd' (double), '*' (ポインタ)
        Module.c_processFrame = Module.cwrap('processFrame', 'number', ['number', 'number', 'number']);
        Module.c_resetStats = Module.cwrap('resetStats', 'void', []);
        Module.c_setCalibrationFactors = Module.cwrap('setCalibrationFactors', 'void', ['number', 'number']);

        console.log("Wasm initialized and functions wrapped.");
    }
};

// ----------------------------------------------------------------------
// 2. Wasmヒープからのデータ読み取り
// ----------------------------------------------------------------------

// C++のStats構造体のメモリレイアウト (Wasmヒープ内での配置)
// double (8 bytes) + double (8 bytes) + long long (8 bytes) = 24 bytes
const STATS_STRUCT_SIZE = 24;
// DetectionResult構造体のメモリレイアウト
// int (4 bytes) + int (4 bytes) + int (4 bytes) = 12 bytes
// C++側では構造体がパディングされる可能性を考慮し、正確なオフセットで読み取る

// Stats構造体のメンバオフセット
const STATS_OFFSET_SUM_I = 0;       // double (8 bytes)
const STATS_OFFSET_SUM_I_SQ = 8;    // double (8 bytes)
const STATS_OFFSET_PIXEL_COUNT = 16; // long long (8 bytes)

// DetectionResult構造体のメンバオフセット (全てint32_tとして読み込む)
const RESULT_OFFSET_STATS_PTR = 0;       // int (4 bytes)
const RESULT_OFFSET_EVENT_COUNT = 4;     // int (4 bytes)
const RESULT_OFFSET_COORDS_PTR = 8;      // int (4 bytes)


// ----------------------------------------------------------------------
// 3. メインスレッドからのメッセージ処理
// ----------------------------------------------------------------------
self.onmessage = (e) => {
    if (!isInitialized) return;

    const data = e.data;
    switch (data.type) {
        case 'PROCESS_FRAME':
            processFrameWasm(data.imageData, data.width, data.height);
            break;
        case 'RESET':
            Module.c_resetStats();
            break;
        case 'SET_FACTORS':
            Module.c_setCalibrationFactors(data.g_factor, data.b_factor);
            break;
    }
};

/**
 * フレームデータをWasmコアに渡し、結果をメインスレッドに返します。
 * @param {ImageData} imageData 
 * @param {number} width 
 * @param {number} height 
 */
function processFrameWasm(imageData, width, height) {
    // 1. C++ヒープにImageDataをコピー
    // imageData.data (Uint8ClampedArray) のサイズ
    const byteLength = imageData.data.byteLength;
    
    // C++ヒープにメモリを割り当て (malloc相当)
    const dataPtr = Module._malloc(byteLength);
    
    // JSのデータをC++ヒープに転送 (高速化のためTypedArrayのビューを使用)
    // Module.HEAPU8 は Wasmメモリ (Uint8Array) のビュー
    Module.HEAPU8.set(imageData.data, dataPtr);

    // 2. Wasm関数を実行 (C++からDetectionResult構造体のアドレスが返る)
    const resultPtr = Module.c_processFrame(dataPtr, width, height);

    // 3. 結果の読み取り (Wasmヒープからデータを読み取る)

    // DetectionResult構造体からポインタとイベント数を読み出す
    const statsPtr = Module.getValue(resultPtr + RESULT_OFFSET_STATS_PTR, 'i32');
    const eventCount = Module.getValue(resultPtr + RESULT_OFFSET_EVENT_COUNT, 'i32');
    const coordsPtr = Module.getValue(resultPtr + RESULT_OFFSET_COORDS_PTR, 'i32');
    
    // globalStats構造体の中身を読み出す (doubleは8バイト)
    const sum_I = Module.getValue(statsPtr + STATS_OFFSET_SUM_I, 'double');
    const sum_I_sq = Module.getValue(statsPtr + STATS_OFFSET_SUM_I_SQ, 'double');
    // long long は64bit整数 (i64)。JSではNumberに変換される
    const pixel_count = Module.getValue(statsPtr + STATS_OFFSET_PIXEL_COUNT, 'i64'); 

    // 4. イベント座標の読み取り
    let events = [];
    if (eventCount > 0) {
        // イベント座標配列は int32_t の配列 (4バイト)
        // [x0, y0, x1, y1, ...] が coordsPtr から始まる
        // Module.HEAP32 は Wasmメモリの Int32Array ビュー
        const eventDataView = Module.HEAP32.subarray(
            coordsPtr / 4, // バイトアドレスを32bit整数のインデックスに変換
            coordsPtr / 4 + eventCount * 2
        );
        // events配列にコピー (Transferableにしないため、シンプルなコピーで)
        for (let i = 0; i < eventCount * 2; i += 2) {
            events.push({ x: eventDataView[i], y: eventDataView[i + 1] });
        }
    }
    
    // 5. C++ヒープからメモリを解放
    Module._free(dataPtr);

    // 6. メインスレッドに統計情報とイベントデータを送信
    self.postMessage({
        type: 'STATS_RESULT',
        stats: {
            sum_I: sum_I,
            sum_I_sq: sum_I_sq,
            pixel_count: pixel_count,
            event_count: eventCount, // イベント数を追加
            events: events           // イベント座標を追加
        }
    });
}
