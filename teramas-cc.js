// 目標フレーム数
const TARGET_FRAMES = 18000; // 5分 (300秒) * 60 fps
let Module = null; // Wasmモジュール（Emscriptenが生成）

// ----------------------------------------------------
// 1. Wasmモジュールのロードと初期化
// ----------------------------------------------------
const loadWasm = () => {
    return new Promise(resolve => {
        // Emscriptenが生成したモジュールをロード
        // (ここではグローバルなModuleオブジェクトを想定)
        Module = {
            onRuntimeInitialized: () => {
                console.log("[TERAMAS-CC] Wasmモジュールの初期化が完了しました。");
                resolve(Module);
            }
        };
        // 実際にはHTMLで Emscripten のラッパーJSファイル（例: detector_core.js）を読み込みます
    });
};

// ----------------------------------------------------
// 2. カメラの起動と解像度ネゴシエーション
// ----------------------------------------------------
async function startMeasurement() {
    console.log("カメラの起動とBGノイズ測定を開始します...");
    
    // 最大解像度と60fpsを要求する制約
    const constraints = {
      video: {
        width: { ideal: 4096 }, // 最大要求解像度 (4K)
        height: { ideal: 2160 },
        frameRate: { ideal: 60 } // 60fpsを強く要求
      }
    };
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const video = document.getElementById('videoElement');
        video.srcObject = stream;
        
        // 映像メタデータがロードされるのを待つ
        await new Promise(resolve => video.onloadedmetadata = resolve);

        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        
        const actualWidth = settings.width;
        const actualHeight = settings.height;
        
        console.log(`[TERAMAS-CC] 確定解像度: ${actualWidth}x${actualHeight}, FPS: ${settings.frameRate}`);

        // C++コアに確定した解像度を渡し、メモリを動的に確保させる
        // C++のinit_bg_measurement関数を呼び出す (Module._関数名 でアクセス)
        Module._init_bg_measurement(actualWidth, actualHeight); 
        
        // メモリ確保が成功したら、フレーム処理ループを開始
        processFrameLoop(video, actualWidth, actualHeight);

    } catch (error) {
        console.error("[TERAMAS-CC] カメラの起動またはWasmとの連携に失敗しました:", error);
    }
}


// ----------------------------------------------------
// 3. メインのフレーム処理ループ
// ----------------------------------------------------
function processFrameLoop(video, width, height) {
    const canvas = document.getElementById('canvasElement');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); // 高速読取をOSに促す
    
    let frameCount = 0;

    const loop = () => {
        if (frameCount >= TARGET_FRAMES) {
            console.log("BG計測が完了しました。統計計算へ移行します...");
            // TODO: C++の統計計算関数を呼び出す
            return;
        }

        // 映像フレームをcanvasに描画
        ctx.drawImage(video, 0, 0, width, height);
        
        // canvasからRGBAピクセルデータを取得 (imgData.data は Uint8ClampedArray)
        const imgData = ctx.getImageData(0, 0, width, height);
        
        // Wasmのメモリ空間にデータをコピーし、C++の処理関数を呼び出す
        
        // 1. C++側で使用するメモリを確保 (RGBA 4バイト/ピクセル * ピクセル数)
        const dataPtr = Module._malloc(imgData.data.length);
        
        // 2. JavaScriptのデータをWasmのメモリにコピー
        // HEAPU8はWasmのメモリ空間をUint8Arrayとして扱うビューです
        Module.HEAPU8.set(imgData.data, dataPtr);
        
        // 3. C++の処理関数を呼び出し、フレームデータを渡す
        const currentFrame = Module._process_bg_frame(dataPtr);
        
        // 4. C++側で使用したメモリを解放 (処理後すぐに解放することが重要)
        Module._free(dataPtr);

        frameCount = currentFrame;
        // console.log(`Processed Frame: ${frameCount}`); // デバッグ用
        
        // 60fpsを維持するためにrequestAnimationFrameで次のフレーム処理を予約
        requestAnimationFrame(loop);
    };

    // ループ開始
    requestAnimationFrame(loop);
}


// ----------------------------------------------------
// 4. エントリポイント
// ----------------------------------------------------
// HTML側でボタンクリックなどのイベントでこの関数を呼び出すことを想定
async function main() {
    await loadWasm(); // Wasmモジュールのロードを待つ
    startMeasurement();
}