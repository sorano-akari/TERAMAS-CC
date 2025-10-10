// detector_worker.js - 最終決定版 (ダミー malloc 削除 + フレーム処理ログ追加)

console.log("[WORKER STARTUP] Worker script started (Native Wasm Loader)."); 

let wasmInstance = null;
let HEAPU64 = null;
let memory = null; 

let INPUT_FRAME_PTR = 0; 

// ----------------------------------------------------
// Wasmネイティブのインスタンス化
// ----------------------------------------------------
async function initializeWasm(wasmBinary, width, height) {
    try {
        // C++側のTOTAL_MEMORY=33554432 (32MB) に合わせて 512 ページを確保
        memory = new WebAssembly.Memory({ initial: 512 }); 
        
        const mutable_i32 = { value: "i32", mutable: true };
        const immutable_i32 = { value: "i32" };
        
        const imports = {
            env: {
                memory: memory,
                __memory_base: new WebAssembly.Global(immutable_i32, 1024), 
                __table_base: new WebAssembly.Global(immutable_i32, 0),
                __stack_pointer: new WebAssembly.Global(mutable_i32, 262144), 
                
                // LinkErrorとメモリ確保失敗を回避するため、malloc/freeの提供は停止。

                abort: () => { console.error('Wasm aborted'); throw new Error('Wasm aborted'); },
                _emscripten_stack_init: () => {},
                _emscripten_stack_get_base: () => 0,
                _emscripten_stack_get_free: () => 0,
                __cxa_allocate_exception: (size) => { return 0; },
                __cxa_throw: (ptr, type, destructor) => { throw new Error("C++ exception occurred."); },
            },
            
            "GOT.mem": {
                "memory": memory,
                "sum_r_buffer": new WebAssembly.Global(mutable_i32, 0),
                "sum_g_buffer": new WebAssembly.Global(mutable_i32, 0),
                "sum_b_buffer": new WebAssembly.Global(mutable_i32, 0),
                "input_frame_buffer": new WebAssembly.Global(mutable_i32, 0), 
                "hit_count_buffer": new WebAssembly.Global(mutable_i32, 0),
                "image_data_buffer": new WebAssembly.Global(mutable_i32, 0),
                "result_struct": new WebAssembly.Global(mutable_i32, 0),
                "summary_r": new WebAssembly.Global(mutable_i32, 0),
                "summary_g": new WebAssembly.Global(mutable_i32, 0),
                "summary_b": new WebAssembly.Global(mutable_i32, 0),
                
                "pixel_count": new WebAssembly.Global(mutable_i32, 0),
                "frame_counter": new WebAssembly.Global(mutable_i32, 0),
                "g_correction_factor": new WebAssembly.Global(mutable_i32, 0), 
                "b_correction_factor": new WebAssembly.Global(mutable_i32, 0)
            }
        };

        const result = await WebAssembly.instantiate(wasmBinary, imports);
        wasmInstance = result.instance;
        
        HEAPU64 = new BigUint64Array(memory.buffer);
        
        // C++のロジックが、Wasm内部の dlmalloc を使ってメモリを確保
        wasmInstance.exports.init_correction_mode(width, height); 
        
        INPUT_FRAME_PTR = wasmInstance.exports.get_input_frame_buffer_ptr();
        if (INPUT_FRAME_PTR === 0) {
            // dlmallocがヒープから確保に失敗した場合、このエラーが出る
            throw new Error("WASM init error: C++ failed to allocate input buffer.");
        }
        console.log(`Input buffer successfully allocated by C++ at: ${INPUT_FRAME_PTR}`);

        postMessage({ type: 'STATUS', message: 'WasmReady' });
        console.log("[WORKER] WasmReady message SENT to main thread."); 
        console.log("Native Wasm initialized. Strict Mode bypassed.");

    } catch (e) {
        console.error("Native Wasm initialization failed:", e);
        postMessage({ type: 'ERROR', message: `Native Wasm Init Failed: ${e.toString()}` });
    }
}


// ----------------------------------------------------
// Workerからのメッセージハンドラ 
// ----------------------------------------------------

onmessage = function(e) {
    const data = e.data;
    const { type, width, height, buffer, gFactor, bFactor } = data;
    let frameBuffer = buffer; 
    
    if (!wasmInstance && type !== 'LOAD_WASM_MODULE') {
        postMessage({ type: 'ERROR', message: `WasmModule is not ready. Received type: ${type}` });
        if (buffer) { 
            postMessage({ buffer: frameBuffer }, [frameBuffer]);
        }
        return;
    }
    
    try {
        switch (type) {
            
            case 'LOAD_WASM_MODULE':
                if (wasmInstance) return;
                initializeWasm(data.wasmBinary, width, height); 
                break;
                
            case 'INIT_CORE': 
                wasmInstance.exports.init_correction_mode(width, height);
                INPUT_FRAME_PTR = wasmInstance.exports.get_input_frame_buffer_ptr(); 
                if (INPUT_FRAME_PTR === 0) throw new Error("WASM re-init failed.");
                break;

            case 'RESET_ACCUMULATION':
                wasmInstance.exports.reset_accumulation(); 
                break;
                
            case 'SET_FACTORS':
                wasmInstance.exports.set_correction_factors(gFactor, bFactor);
                break;
                
            case 'PROCESS_FRAME': 
                
                // 🚨 デバッグログ 1: フレーム受信を確認
                console.log(`[WORKER] Received frame ${data.frameCount}. Processing...`);

                if (INPUT_FRAME_PTR === 0 || !frameBuffer || width === 0 || height === 0 || !memory) { 
                    postMessage({ type: 'ERROR', message: `PROCESS_FRAME received invalid context data or INPUT_FRAME_PTR is zero.` });
                    return;
                }
                
                const frameData = new Uint8ClampedArray(frameBuffer);
                
                const WasmHEAPU8 = new Uint8Array(memory.buffer);
                WasmHEAPU8.set(frameData, INPUT_FRAME_PTR); 

                let wasmFuncName = '';

                if (data.currentMode === 'CORRECTION_MODE') {
                    wasmFuncName = 'process_correction_frame'; 
                } else if (data.currentMode === 'MEASUREMENT_MODE') {
                    wasmFuncName = 'process_measurement_frame';
                } else {
                    postMessage({ buffer: frameBuffer }, [frameBuffer]);
                    return;
                }
                
                let resultStructPtr = wasmInstance.exports[wasmFuncName](width, height, data.returnImage ? 1 : 0);
                
                if (resultStructPtr === 0 || !memory.buffer) {
                     postMessage({ type: 'ERROR', message: `WASM function returned NULL pointer (0). Frame processing failed.` });
                     return;
                }

                // 4. 結果の取得
                const WasmHEAPU32 = new Uint32Array(memory.buffer);
                const resultStruct = WasmHEAPU32.subarray(resultStructPtr / 4, resultStructPtr / 4 + 6); 
                
                const frameCount = resultStruct[0];
                const summary_r_ptr = resultStruct[1];
                const summary_g_ptr = resultStruct[2];
                const summary_b_ptr = resultStruct[3];
                const imageDataPtr = resultStruct[4];
                const pixelCount = resultStruct[5];
                
                let rSumString = "0";
                let gSumString = "0";
                let bSumString = "0";

                // 5. BigIntとして読み込み、文字列で転送
                if (HEAPU64 && summary_r_ptr !== 0) {
                    if (summary_r_ptr % 8 !== 0) {
                        console.error("Wasm Result Error: Summary pointer is not 8-byte aligned.");
                    } else {
                        const r_index = summary_r_ptr / 8;
                        const g_index = summary_g_ptr / 8;
                        const b_index = summary_b_ptr / 8;
                        
                        if(r_index < HEAPU64.length) rSumString = HEAPU64[r_index].toString(); 
                        if(g_index < HEAPU64.length) gSumString = HEAPU64[g_index].toString(); 
                        if(b_index < HEAPU64.length) bSumString = HEAPU64[b_index].toString(); 
                    }
                }
                
                // 6. メッセージの構築と画像データの転送
                const response = {
                    type: data.currentMode === 'CORRECTION_MODE' ? 'CORRECTION_PROCESSED' : 'PROCESSED',
                    rSum: rSumString, 
                    gSum: gSumString, 
                    bSum: bSumString, 
                    frameCount: frameCount,
                    pixelCount: pixelCount
                };
                
                const transferable = [frameBuffer]; 
                
                if (data.returnImage && imageDataPtr > 0) {
                    const imageBufferSize = width * height * 4; 
                    
                    const imageBufferToTransfer = memory.buffer.slice(imageDataPtr, imageDataPtr + imageBufferSize);
                    
                    response.imageData = imageBufferToTransfer; 
                    transferable.push(imageBufferToTransfer);  
                }

                postMessage(response, transferable);
                // 🚨 デバッグログ 2: メッセージ送信を確認
                console.log(`[WORKER] Frame ${frameCount} processed. Sending result back.`); 
                
                break;

            case 'TERMINATE':
                wasmInstance.exports.cleanup(); 
                self.close(); 
                break;
                
            default:
                if (frameBuffer) { 
                    postMessage({ buffer: frameBuffer }, [frameBuffer]);
                }
                break;
        }

    } catch (e) {
        let errorMessage = (e && typeof e.toString === 'function') ? e.toString() : 'An unknown error occurred.';
        postMessage({ type: 'ERROR', message: errorMessage + ' (Worker catch block)' });
        if (frameBuffer) {
            postMessage({ buffer: frameBuffer }, [frameBuffer]);
        }
    }
};