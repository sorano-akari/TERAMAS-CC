// detector_worker.js

// 警告: Emscriptenが生成するラッパーファイル（detector_core.js）は、
// Web Worker内で 'importScripts' を使ってロードする必要があります。

// Wasmモジュールがロードされる前に、グローバルな 'Module' オブジェクトを準備
let Module = null; 
let DetectorCore = null; // Embindによって生成されるDetectorCoreモジュール

// Wasmモジュールのロード状態
let isInitialized = false;
let width = 0;
let height = 0;

// =========================================================================
// Wasm/Embind のロード処理
// =========================================================================

/**
 * @brief Wasmモジュールをロードし、初期化関数を実行する
 */
function loadWasmModule() {
    if (wasmModuleLoaded) {
        // ★ 既にロードされている場合は何もしないで終了
        return; 
    }

    try {
        // Emscriptenのラッパーファイルをインポート
        importScripts('./detector_core.js'); 
        wasmModuleLoaded = true; // ★ ロード成功フラグを立てる

        // Emscriptenの初期化処理
        Module.onRuntimeInitialized = () => {
            postMessage({ cmd: 'init_done' });
        };

    } catch (e) {
        console.error("Failed to load Wasm module:", e);
        postMessage({ cmd: 'error', message: 'Wasm module failed to load.' });
    }
}

// =========================================================================
// メインスレッドとの通信処理
// =========================================================================

self.onmessage = (e) => {
    const data = e.data;

    switch (data.type) {
        case 'load':
            // ロードコマンドを受信したらWasmモジュールをロード
            loadWasmModule();
            break;

        case 'init':
            loadWasmModule(); // 指示を出すだけ
            break;

        case 'process':
            if (isInitialized && data.imageData instanceof Uint8Array) {
                // 1. JS側のUint8ArrayをWasmヒープにコピー (メモリを確保し、データをコピー)
                // RGB 3チャンネル * ピクセル数
                const numBytes = width * height * 3;
                const dataPtr = Module._malloc(numBytes);
                Module.HEAPU8.set(data.imageData, dataPtr);

                // 2. Wasmコアに処理を依頼
                DetectorCore.processFrame(dataPtr);

                // 3. Wasm側で生成されたグレースケール画像のポインターを取得
                const imagePtr = DetectorCore.getGrayscaleImagePointer();
                
                // 4. Wasmメモリからグレースケールデータを読み取り (1チャンネルのみ)
                const numGrayscaleBytes = width * height;
                const grayscaleData = new Uint8Array(
                    Module.HEAPU8.subarray(imagePtr, imagePtr + numGrayscaleBytes)
                );
                
                // 5. カウンター値を取得
                const frameCount = DetectorCore.getFrameCount();
                const eventCount = DetectorCore.getEventCount();

                // 6. Wasmヒープから元のRGBデータを解放
                Module._free(dataPtr);
                
                // 7. メインスレッドに結果を転送
                // ArrayBufferとして転送することで、高速なデータ転送が可能 (Transferable Objects)
                postMessage({
                    type: 'processed',
                    frameCount: frameCount,
                    eventCount: eventCount,
                    grayscaleData: grayscaleData.buffer // ArrayBufferとして転送
                }, [grayscaleData.buffer]);
            }
            break;

        // エラー処理や停止処理などは必要に応じて追加
    }
};