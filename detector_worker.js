// TERAMAS-CC Web Worker (detector_worker.js)
// Wasmコアを非同期でロードし、グローバル競合を避けて画像処理とデータ蓄積を実行します。

// Emscriptenが使用するグローバルな 'Module' オブジェクトを、競合を避けるために先に設定します。
// WasmコアのJSがロードされると、このオブジェクトに追加されます。
var Module = {}; 

// Workerの状態を self プロパティとして格納し、名前の競合を回避
self.workerState = {
    wasmReady: false,
    wasmMemory: null,
    wasmExports: null,
    accumulationBufferPtr: 0, // グローバルなポインタ
    statsPtr: 0,
    STATS_SIZE_ELEMENTS: 10,
};

// ----------------------------------------------------------------------
// Wasmコアの初期化フック
// Emscriptenのロード後に、Wasmランタイムの初期化が完了すると呼び出されます。
// ----------------------------------------------------------------------
Module.onRuntimeInitialized = () => {
    const state = self.workerState;
    
    // Wasmのエクスポート関数とメモリを取得
    // EmscriptenのMODULARIZE設定により、asmはWasm Exportsを保持
    state.wasmExports = Module.asm;
    state.wasmMemory = state.wasmExports.memory;

    // 統計データ構造のポインタを一度取得
    // Wasmコアが初期化された後でのみアクセス可能
    if (state.wasmExports._getStatisticalStats) {
        state.statsPtr = state.wasmExports._getStatisticalStats(); 
    }

    state.wasmReady = true;
    console.log("[Worker] Wasmコアの初期化が完了しました。");
    // Wasmコアの準備が完了したことをメインスレッドに通知
    postMessage({ type: 'STATUS', status: 'READY' });
};


// ----------------------------------------------------------------------
// Wasmコアのロード
// detector_core.js をロードします。
// ----------------------------------------------------------------------
try {
    // 依存スクリプトのロード。ここではまだWasmモジュール自体はコンパイルされません。
    // Emscriptenはロード時に 'Module' オブジェクトにフックして処理を進めます。
    importScripts('detector_core.js'); 
} catch (e) {
    // 予期せぬ Worker 外部のエラーの場合 (例: ファイルが見つからない)
    postMessage({ type: 'STATUS', status: 'ERROR', message: `Wasmコアのロードに失敗しました: ${e.message}` });
    console.error('Failed to load detector_core.js:', e);
}


// ----------------------------------------------------------------------
// Wasmメモリビューとユーティリティ
// ----------------------------------------------------------------------

// フレーム処理時に必要な最新のメモリビューを取得する関数
const getWasmMemoryViews = () => {
    // wasmMemoryが初期化されているか確認
    if (!self.workerState.wasmMemory) {
        // 初期化前のアクセスを防ぐためのエラーハンドリング
        throw new Error("Wasm Memory not initialized.");
    }
    const buffer = self.workerState.wasmMemory.buffer;
    return {
        // Module._malloc, Module._free はグローバルに存在する
        HEAPU8: new Uint8Array(buffer),
        HEAPF32: new Float32Array(buffer)
    };
};

// 統計データへの参照を更新
function getStatsFromWasm() {
    const state = self.workerState;
    try {
        const { HEAPF32 } = getWasmMemoryViews();
        
        // statsPtrが有効なポインタであることを確認
        if (!state.statsPtr) {
             throw new Error("Stats pointer is null.");
        }

        const statsView = HEAPF32.subarray(state.statsPtr / 4, state.statsPtr / 4 + state.STATS_SIZE_ELEMENTS);
        
        // Wasm側のメモリレイアウトとteramas-cc.js側の currentStats のキーを合わせる
        const stats = {
            sum_R: statsView[0],
            sum_R_sq: statsView[1],
            sum_G: statsView[2],
            sum_G_sq: statsView[3],
            sum_B: statsView[4],
            sum_B_sq: statsView[5],
            sum_Charge: statsView[6],
            sum_Charge_sq: statsView[7],
            frameCount: statsView[8], // 整数だが、Float32として扱う
            pixelTotal: statsView[9], // 整数だが、Float32として扱う
        };
        return stats;
    } catch (e) {
        console.error("Error retrieving stats from Wasm memory:", e);
        return { frameCount: 0 }; // エラー時はデフォルト値を返す
    }
}


// ----------------------------------------------------------------------
// メインスレッドとのメッセージハンドリング
// ----------------------------------------------------------------------
self.onmessage = (e) => {
    const state = self.workerState;

    if (!state.wasmReady) {
        // Workerが初期化を完了する前にメッセージを受け取った場合
        console.warn("[Worker] Wasmコアが未準備です。メッセージをスキップしました。");
        return;
    }

    const data = e.data;
    const width = data.width;
    const height = data.height;

    // wasmExportsが初期化されているか確認
    if (!state.wasmExports) {
        console.error("[Worker] Wasm exports not loaded.");
        return;
    }
    
    // Wasmのエクスポート関数をローカルに参照
    // Module.asm 経由で取得するため、Module._malloc, Module._free は直接使用
    const _resetStats = state.wasmExports._resetStats;
    const _setCalibrationFactors = state.wasmExports._setCalibrationFactors;
    const _allocateAccumulationBuffer = state.wasmExports._allocateAccumulationBuffer;
    const _freeAccumulationBuffer = state.wasmExports._freeAccumulationBuffer;
    const _processFrame = state.wasmExports._processFrame;
    const _accumulateFrame = state.wasmExports._accumulateFrame;
    const _copyAccumulatedImage = state.wasmExports._copyAccumulatedImage;
    const _detectHotspots = state.wasmExports._detectHotspots;


    switch (data.type) {
        case 'RESET':
            if (_freeAccumulationBuffer && state.accumulationBufferPtr) {
                _freeAccumulationBuffer(state.accumulationBufferPtr);
                state.accumulationBufferPtr = 0;
            }
            _resetStats();
            postMessage({ type: 'STATUS', status: 'RESET_COMPLETE' });
            break;

        case 'SET_FACTORS':
            _setCalibrationFactors(data.g_factor, data.b_factor);
            break;

        case 'ALLOCATE_BUFFER':
            try {
                state.accumulationBufferPtr = _allocateAccumulationBuffer(width, height);
            } catch (error) {
                console.error("Failed to allocate Wasm buffer:", error);
            }
            postMessage({ type: 'BUFFER_ALLOCATED', ptr: state.accumulationBufferPtr });
            break;

        case 'PROCESS_FRAME':
            // 予備測定: 統計量計算のみ
            const frameDataPrelim = data.imageData.data.buffer;
            // Module._malloc, Module._free はグローバルに存在する（detector_core.jsによって提供される）
            const frameDataPtrPrelim = Module._malloc(frameDataPrelim.byteLength);
            
            const { HEAPU8: HEAPU8_P } = getWasmMemoryViews();
            HEAPU8_P.set(new Uint8Array(frameDataPrelim), frameDataPtrPrelim);
            
            _processFrame(frameDataPtrPrelim, width, height); 

            Module._free(frameDataPtrPrelim); 
            postMessage({ type: 'DATA_RETURNED', arrayBuffer: frameDataPrelim }); 
            postMessage({ type: 'STATS_RESULT', stats: getStatsFromWasm() });
            break;

        case 'ACCUMULATE_FRAME':
            // 本計測: 積算処理
            if (state.accumulationBufferPtr) {
                const frameData = data.imageData.data.buffer;
                const frameDataPtr = Module._malloc(frameData.byteLength);
                
                const { HEAPU8: HEAPU8_A } = getWasmMemoryViews();
                HEAPU8_A.set(new Uint8Array(frameData), frameDataPtr);
                
                _accumulateFrame(frameDataPtr, width, height, state.accumulationBufferPtr); 

                Module._free(frameDataPtr); 
                postMessage({ type: 'DATA_RETURNED', arrayBuffer: frameData }); 
                
                postMessage({ type: 'ACCUMULATION_RESULT', stats: getStatsFromWasm() });
            } else {
                console.error('Accumulation buffer not allocated.');
                postMessage({ type: 'DATA_RETURNED', arrayBuffer: data.imageData.data.buffer });
            }
            break;

        case 'GET_ACCUMULATED_IMAGE':
            if (state.accumulationBufferPtr) {
                const imageSize = width * height * 4; 
                const resultPtr = Module._malloc(imageSize);
                
                // Wasmコアで処理を実行
                _copyAccumulatedImage(state.accumulationBufferPtr, width, height, data.max_value, resultPtr, data.mode);
                
                // 結果をArrayBufferとしてコピーし、メインスレッドに転送
                const resultBuffer = state.wasmMemory.buffer.slice(resultPtr, resultPtr + imageSize);
                
                Module._free(resultPtr);
                postMessage({ 
                    type: 'IMAGE_DATA_RESULT', 
                    imageDataArray: resultBuffer, 
                    width: width, 
                    height: height 
                }, [resultBuffer]); 
            }
            break;

        case 'DETECT_HOTSPOTS':
            if (state.accumulationBufferPtr) {
                const { HEAPF32 } = getWasmMemoryViews();
                
                const thresholdPtr = Module._malloc(4); 
                const hotspotCount = _detectHotspots(state.accumulationBufferPtr, width, height, thresholdPtr);
                
                const threshold = HEAPF32[thresholdPtr / 4];
                Module._free(thresholdPtr);
                
                const dummyHotspots = [];
                if (hotspotCount > 0) {
                    dummyHotspots.push({x: Math.floor(width/2), y: Math.floor(height/2), intensity: 1.0, threshold: threshold.toFixed(2)});
                }

                postMessage({ 
                    type: 'HOTSPOT_RESULT', 
                    hotspots: dummyHotspots,
                    stats: { threshold: threshold }
                });
            }
            break;
    }
};
