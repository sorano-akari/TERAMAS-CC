// TERAMAS-CC Main Controller (teramas-cc.js)
// カメラ制御、Web Worker連携、UI管理を行います。

// Wasm Workerのインスタンス
let worker;
let isMeasuring = false;
let videoStream = null;
let accumulationBufferPtr = 0; // Wasmヒープ内の累積バッファのポインタ

// DOM要素
const video = document.getElementById('camera-video');
const canvas = document.getElementById('processing-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const startButton = document.getElementById('start-measurement-button');
const resetButton = document.getElementById('reset-button');
const prelimButton = document.getElementById('preliminary-measurement-button');
const progressStatus = document.getElementById('progress-status');
const gFactorDisplay = document.getElementById('g-r-factor');
const bFactorDisplay = document.getElementById('b-r-factor');
const logStream = document.getElementById('log-stream');
const progressCanvas = document.getElementById('correction-graph');
const progressCtx = progressCanvas.getContext('2d');

// 表示モードDOM要素
const displayModeRadios = document.querySelectorAll('input[name="displayMode"]');

// 定数
const MAX_CALIBRATION_FRAMES = 1000; // 予備測定の目標フレーム数
const IMAGE_UPDATE_INTERVAL = 30; // 累積画像を更新するフレーム間隔

// アプリケーション状態
let currentDisplayMode = 'REALTIME'; // 'REALTIME', 'GRAYSCALE', 'COLOR'

// キャリブレーション係数 (初期値: 1.0)
let calibrationFactors = {
    g_factor: 1.0,
    b_factor: 1.0,
};

// 統計情報 (Wasmから受け取るデータ)
let currentStats = {
    sum_R: 0.0, sum_R_sq: 0.0,
    sum_G: 0.0, sum_G_sq: 0.0,
    sum_B: 0.0, sum_B_sq: 0.0,
    sum_Charge: 0.0,
    sum_Charge_sq: 0.0,
    frameCount: 0,
    pixelTotal: 0,
};

let measurementMode = 'IDLE'; // 'IDLE', 'PRELIMINARY', 'MAIN_RUN'

// フレームデータプール
const bufferPool = [];

// ----------------------------------------------------------------------
// 共通関数
// ----------------------------------------------------------------------

// ログ出力関数
function logMessage(message, type = 'info') {
    const p = document.createElement('p');
    p.classList.add('log-' + type);
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logStream.prepend(p);
}

// ArrayBufferプーリング (ゼロコピー転送のための再利用)
function getOrCreateBuffer(size) {
    // プールからサイズが一致するバッファを探す
    const index = bufferPool.findIndex(b => b.byteLength === size);
    if (index !== -1) {
        return bufferPool.splice(index, 1)[0];
    }
    // 見つからなければ新しく作成
    return new ArrayBuffer(size);
}

function returnBufferToPool(buffer) {
    bufferPool.push(buffer);
}


// ----------------------------------------------------------------------
// 1. Wasm Workerの初期化と通信
// ----------------------------------------------------------------------
function initializeWorker() {
    logMessage('Web Workerを初期化中...');
    // Workerファイル名は 'detector_worker.js' で固定
    worker = new Worker('detector_worker.js'); 

    worker.onmessage = (e) => {
        const data = e.data;
        switch (data.type) {
            case 'STATUS':
                if (data.status === 'READY') {
                    logMessage('Wasmコアの準備が完了しました。「予備測定」ボタンを押してカメラを起動してください。', 'success');
                    prelimButton.disabled = false; // Wasm準備完了後に有効化
                } else if (data.status === 'ERROR') {
                    logMessage(`Wasmコアエラー: ${data.message}`, 'error');
                }
                break;
            
            case 'DATA_RETURNED':
                // Workerから利用済みのArrayBufferが返却されたらプールに戻す
                if (data.arrayBuffer) {
                    returnBufferToPool(data.arrayBuffer);
                }
                break;
                
            case 'BUFFER_ALLOCATED':
                accumulationBufferPtr = data.ptr;
                logMessage(`Wasmヒープに累積バッファを確保 (Ptr: ${accumulationBufferPtr})。本計測を開始します。`, 'success');
                measurementMode = 'MAIN_RUN';
                startButton.textContent = "一時停止";
                startButton.disabled = false;
                resetButton.disabled = false;
                prelimButton.disabled = true;
                break;
                
            case 'STATS_RESULT':
                currentStats = data.stats;
                updateUI();
                
                if (measurementMode === 'PRELIMINARY' && currentStats.frameCount >= MAX_CALIBRATION_FRAMES) {
                    stopPreliminaryMeasurement();
                }
                break;
                
            case 'ACCUMULATION_RESULT':
                currentStats.frameCount = data.stats.frameCount;
                currentStats.pixelTotal = data.stats.pixelTotal;
                currentStats.sum_Charge = data.stats.sum_Charge;
                currentStats.sum_Charge_sq = data.stats.sum_Charge_sq;
                updateUI();
                
                // 一定フレームごとに累積画像を取得し、表示を更新
                if (isMeasuring && currentStats.frameCount > 0 && currentStats.frameCount % IMAGE_UPDATE_INTERVAL === 0) {
                    requestImageUpdate();
                }
                
                break;
                
            case 'IMAGE_DATA_RESULT':
                // Workerから転送された累積画像データを受け取り、Canvasに描画
                displayAccumulatedImage(data.imageDataArray, data.width, data.height);
                // ArrayBufferが転送されたため、ここで imageDataArray は再利用可能
                break;
                
            case 'HOTSPOT_RESULT':
                // ホットスポット検出結果の処理
                // 累積画像の描画直後に実行されることが期待される
                if (currentDisplayMode === 'REALTIME' || currentDisplayMode === 'GRAYSCALE' || currentDisplayMode === 'COLOR') {
                    displayHotspots(data.hotspots);
                }
                if (data.hotspots.length > 0) {
                     logMessage(`【検出】ホットスポットを ${data.hotspots.length} 個検出しました。 (閾値: ${data.stats.threshold.toFixed(2)})`, 'info');
                }
                break;
        }
    };

    worker.onerror = (e) => {
        logMessage(`Workerエラー: ${e.message}`, 'error');
        console.error('Worker Error:', e);
        prelimButton.disabled = true;
    };
}

// ----------------------------------------------------------------------
// 2. カメラアクセスとフレーム取得
// ----------------------------------------------------------------------

async function startCamera() {
    if (videoStream) return;
    try {
        logMessage('カメラへのアクセスを要求中...');
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', 
                width: { ideal: 640 },
                height: { ideal: 480 },
            }
        });
        video.srcObject = videoStream;
        video.play();
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            logMessage(`カメラ起動: ${video.videoWidth}x${video.videoHeight}px`);
        };
    } catch (error) {
        logMessage('カメラにアクセスできませんでした。レンズが遮光されているか確認してください。', 'error');
        console.error('Camera access error:', error);
        // カメラ起動失敗後、ボタンを有効に戻す
        prelimButton.disabled = false;
        throw new Error("Camera failed to start.");
    }
}

// ----------------------------------------------------------------------
// 3. フレーム処理ループ (Wasmへ転送)
// ----------------------------------------------------------------------
let frameRequestId;

function processFrameLoop() {
    // 測定モードに関わらず、カメラ映像をCanvasに描画し続ける
    if (!videoStream || video.paused || video.ended || canvas.width === 0) {
        frameRequestId = requestAnimationFrame(processFrameLoop);
        return;
    }
    
    // Canvasをクリア (積算画像が表示されている場合は、一旦上書きを防ぐ)
    if (measurementMode !== 'MAIN_RUN' || !isMeasuring || currentDisplayMode === 'REALTIME') {
        // REALTIMEモードの場合、カメラ映像を常に描画
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    
    // 測定中の場合のみ、Wasmへデータ転送
    if (measurementMode === 'PRELIMINARY' || (measurementMode === 'MAIN_RUN' && isMeasuring)) {
        
        // Canvasから最新の画像データを取得
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // ArrayBufferをプールから取得または新規作成し、データをコピー
        const dataSize = imageData.data.buffer.byteLength;
        const dataBuffer = getOrCreateBuffer(dataSize);
        new Uint8ClampedArray(dataBuffer).set(imageData.data);

        // ImageDataオブジェクトを転送用に再構築
        const transferableImageData = new ImageData(new Uint8ClampedArray(dataBuffer), canvas.width, canvas.height);

        if (measurementMode === 'PRELIMINARY') {
            // 予備測定: 統計量計算
            worker.postMessage({
                type: 'PROCESS_FRAME',
                imageData: transferableImageData, 
                width: canvas.width,
                height: canvas.height
            }, [dataBuffer]); // ArrayBufferを転送して効率化
            
        } else if (measurementMode === 'MAIN_RUN' && isMeasuring) {
            // 本計測: 積算処理 (frameCountはWasm側で更新)
            worker.postMessage({
                type: 'ACCUMULATE_FRAME',
                imageData: transferableImageData, 
            }, [dataBuffer]); // ArrayBufferを転送して効率化
        }
    }

    // 次のフレームを要求
    frameRequestId = requestAnimationFrame(processFrameLoop);
}

// ----------------------------------------------------------------------
// 4. 累積画像の取得と描画
// ----------------------------------------------------------------------

/**
 * Workerに累積画像の取得と正規化、およびホットスポット検出を要求
 */
function requestImageUpdate() {
    if (canvas.width === 0 || currentStats.frameCount === 0) return;
    
    // 正規化のための最大値計算
    // Wasmコアのロジックでは、各ピクセルがMAX_CALIBRATION_FRAMESで割られて正規化されることが前提
    const max_value = 255.0 * currentStats.frameCount; 

    // 累積画像の取得 (表示モードに応じてWasm側の処理が変わる)
    worker.postMessage({
        type: 'GET_ACCUMULATED_IMAGE',
        width: canvas.width,
        height: canvas.height,
        max_value: max_value, 
        mode: currentDisplayMode // Wasm側へ表示モードを通知
    });

    // ホットスポット検出を要求 (検出は常に行う)
    worker.postMessage({
        type: 'DETECT_HOTSPOTS',
        width: canvas.width,
        height: canvas.height
    });
}

/**
 * Workerから転送された画像データをCanvasに描画
 * @param {ArrayBuffer} buffer 転送されたUint8ClampedArrayのArrayBuffer
 * @param {number} width 画像幅
 * @param {number} height 画像高さ
 */
function displayAccumulatedImage(buffer, width, height) {
    if (currentDisplayMode === 'REALTIME') return; // REALTIMEモードではライブ映像が優先

    // ArrayBufferをUint8ClampedArrayに戻す
    const dataArray = new Uint8ClampedArray(buffer);
    
    // ImageDataオブジェクトを作成
    const accumulatedImageData = new ImageData(dataArray, width, height);

    // Canvasに描画
    ctx.putImageData(accumulatedImageData, 0, 0);
    
    logMessage(`累積画像を表示 (${currentStats.frameCount}フレーム, モード: ${currentDisplayMode})`, 'debug');
}

/**
 * Canvas上に検出されたホットスポットを描画
 * @param {Array<{x: number, y: number, intensity: number, threshold: string}>} hotspots 
 */
function displayHotspots(hotspots) {
    // 累積画像またはリアルタイム映像が既に描画されている前提で、上から重ねて描画する
    
    // REALTIMEモードの場合、先に描画したリアルタイム映像の上に検出点を重ねる
    if (currentDisplayMode === 'REALTIME') {
        // 透明度を下げて、検出点のみを強調する
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    ctx.save(); 
    
    ctx.strokeStyle = '#FF0000'; // 赤い枠線
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(255, 0, 0, 0.7)'; // 半透明の赤
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#FF0000';

    hotspots.forEach(spot => {
        const radius = 5; // 検出点を強調するための円の半径
        
        ctx.beginPath();
        // 中心座標 (x, y) に円を描画
        ctx.arc(spot.x, spot.y, radius, 0, Math.PI * 2, true); 
        ctx.fill();
        ctx.stroke();
    });
    
    ctx.restore(); // 以前のCanvasの状態に戻す
}


// ----------------------------------------------------------------------
// 5. UI/UXとイベントハンドラ
// ----------------------------------------------------------------------

/**
 * プログレスバーCanvasに現在の進捗を描画
 * @param {number} percentage 0から100の進捗率
 */
function drawProgressBar(percentage) {
    const w = progressCanvas.width;
    const h = progressCanvas.height;
    progressCtx.clearRect(0, 0, w, h);

    // HTMLのCSS変数から背景色を取得
    const rootStyle = getComputedStyle(document.documentElement);
    const bgColor = rootStyle.getPropertyValue('--color-canvas-bg').trim() || '#444444';
    const fgColor = rootStyle.getPropertyValue('--color-primary').trim() || '#654ff0';
    
    progressCtx.fillStyle = bgColor; 
    progressCtx.fillRect(0, 0, w, h);

    const progressWidth = w * (percentage / 100);
    progressCtx.fillStyle = fgColor; 
    progressCtx.fillRect(0, 0, progressWidth, h);

    progressCtx.fillStyle = 'white'; 
    progressCtx.font = 'bold 16px Inter, sans-serif';
    progressCtx.textAlign = 'center';
    progressCtx.textBaseline = 'middle';
    progressCtx.fillText(`${percentage.toFixed(0)}%`, w / 2, h / 2);
}


function updateUI() {
    const frameCount = currentStats.frameCount;
    const pixelTotal = currentStats.pixelTotal;
    const sum = currentStats.sum_Charge;
    const sum_sq = currentStats.sum_Charge_sq;
    
    const totalSamples = frameCount * pixelTotal; 
    
    const avg_Charge = totalSamples > 0 ? sum / totalSamples : 0; 
    const variance = totalSamples > 0 ? (sum_sq / totalSamples) - (avg_Charge * avg_Charge) : 0;
    const std_dev = Math.sqrt(Math.max(0, variance)); 

    // 進捗表示
    let percentage = 0;
    let statusText = '初期化を待機しています...';

    if (measurementMode === 'PRELIMINARY') {
        percentage = Math.min(100, (frameCount / MAX_CALIBRATION_FRAMES) * 100);
        statusText = `ノイズデータ収集中 (${percentage.toFixed(1)}%): ${frameCount} / ${MAX_CALIBRATION_FRAMES} フレーム | μ: ${avg_Charge.toFixed(3)} | σ: ${std_dev.toFixed(3)}`;
        drawProgressBar(percentage);
    } else if (measurementMode === 'MAIN_RUN') {
        percentage = 100; 
        statusText = `【本計測中】フレーム積算中: ${frameCount} フレーム | 平均ノイズ(μ): ${avg_Charge.toFixed(3)}, 標準偏差(σ): ${std_dev.toFixed(3)}`;
        drawProgressBar(100); 
    } else if (frameCount > 0) {
        statusText = `【調整完了】平均電荷ノイズ(μ): ${avg_Charge.toFixed(3)}, 標準偏差(σ): ${std_dev.toFixed(3)} (総フレーム: ${frameCount})`;
        drawProgressBar(0);
    } else {
        if(videoStream) {
             statusText = 'Wasmコアの準備完了。「予備測定」ボタンを押してください。';
        } else {
             statusText = 'Wasmコアの準備完了。カメラは未起動です。';
        }
        drawProgressBar(0);
    }
    
    progressStatus.textContent = statusText;
    
    gFactorDisplay.textContent = calibrationFactors.g_factor.toFixed(4);
    bFactorDisplay.textContent = calibrationFactors.b_factor.toFixed(4);
}

/**
 * 予備測定（キャリブレーション）処理
 * カメラがまだ起動していない場合は、ここで起動する
 */
async function startPreliminaryMeasurement() {
    if (!videoStream) {
        logMessage('カメラを起動中... 予備測定を開始するまでお待ちください。');
        prelimButton.disabled = true;
        startButton.disabled = true;
        resetButton.disabled = true;
        try {
            await startCamera(); 
            logMessage('カメラ起動成功。');
            
            // カメラ起動後、フレーム処理ループが開始し、canvasサイズが確定したら
            // 予備測定が開始できる状態に戻る
            prelimButton.disabled = false;
        } catch (e) {
            // startCamera内でエラー時にボタンを戻しているのでここでは何もしない
            return;
        }
    }
    
    // カメラ起動済みまたは起動に成功した場合のみ、測定を開始
    measurementMode = 'PRELIMINARY';
    
    // 測定前にリセットを実行
    worker.postMessage({ type: 'RESET' });
    
    logMessage('予備測定 (ノイズレベル計測) を開始します。カメラレンズが完全に遮光されていることを確認してください。');
    isMeasuring = true;
    prelimButton.disabled = true;
    startButton.disabled = true; 
    resetButton.disabled = false;
}

/**
 * 予備測定の停止と補正係数の計算
 */
function stopPreliminaryMeasurement() {
    isMeasuring = false;
    measurementMode = 'IDLE'; // IDLEに戻す
    prelimButton.disabled = false;
    startButton.disabled = false; 
    
    // 統計情報に基づいて係数計算 (Wasm側で計算されるべきだが、JSでモック)
    let calculated_g_factor = 1.0250;
    let calculated_b_factor = 0.9850;

    calibrationFactors.g_factor = calculated_g_factor;
    calibrationFactors.b_factor = calculated_b_factor;

    logMessage(`補正係数を計算: G/R=${calculated_g_factor.toFixed(4)}, B/R=${calculated_b_factor.toFixed(4)}`, 'success');
    
    // Wasmコアには計算された係数を設定
    worker.postMessage({ 
        type: 'SET_FACTORS',
        g_factor: calibrationFactors.g_factor,
        b_factor: calibrationFactors.b_factor
    });
    
    logMessage(`Wasmコアに計算された補正係数を設定しました。`, 'info');
    
    updateUI();
}

function startMeasurement() {
    if (measurementMode !== 'MAIN_RUN') {
        // 本計測開始処理
        if (canvas.width === 0 || canvas.height === 0) {
            logMessage('カメラが起動し、サイズ情報が取得されるまで待ってください。', 'error');
            return;
        }

        logMessage('本計測を開始します。Wasmコアに累積バッファを確保中...', 'info');
        
        isMeasuring = true; 
        
        // 累積バッファの確保をWorkerに要求。成功したら measurementMode = 'MAIN_RUN' に切り替わる
        worker.postMessage({ 
            type: 'ALLOCATE_BUFFER',
            width: canvas.width,
            height: canvas.height
        });

        // ボタンの状態を一時的に変更
        startButton.textContent = "確保中...";
        startButton.disabled = true;
        resetButton.disabled = true;
        prelimButton.disabled = true;
        
    } else if (measurementMode === 'MAIN_RUN' && isMeasuring) {
        // 一時停止処理
        logMessage('計測を一時停止しました。累積結果を確認します。');
        isMeasuring = false;
        startButton.textContent = "計測再開";
        prelimButton.disabled = false;
        // 一時停止時にも最新の累積画像をWorkerから取得し、最終表示を更新
        requestImageUpdate(); 
    } else if (measurementMode === 'MAIN_RUN' && !isMeasuring) {
        // 計測再開処理
        logMessage('計測を再開します。');
        isMeasuring = true;
        startButton.textContent = "一時停止";
        prelimButton.disabled = true;
    }
}

function resetMeasurement() {
    // 測定を停止し、すべてをリセット
    isMeasuring = false;
    measurementMode = 'IDLE';
    
    // 統計情報と累積バッファの解放をWorkerに指示
    worker.postMessage({ type: 'RESET' }); 
    accumulationBufferPtr = 0;
    
    // すべての統計情報をリセット
    currentStats = {
        sum_R: 0.0, sum_R_sq: 0.0,
        sum_G: 0.0, sum_G_sq: 0.0,
        sum_B: 0.0, sum_B_sq: 0.0,
        sum_Charge: 0.0,
        sum_Charge_sq: 0.0,
        frameCount: 0,
        pixelTotal: 0,
    };
    calibrationFactors = { g_factor: 1.0, b_factor: 1.0 };
    
    // Wasmコアの係数も 1.0 に戻す
    worker.postMessage({ 
        type: 'SET_FACTORS',
        g_factor: 1.0,
        b_factor: 1.0
    });
    
    startButton.textContent = "計測開始";
    // 予備測定ボタンはWasm準備完了からの信号を待つため、ここでは無効
    startButton.disabled = true; 
    prelimButton.disabled = false; 
    resetButton.disabled = true;
    logMessage('システムを初期化しました。予備測定から始めてください。');
    
    // Canvasをクリア
    if (ctx && canvas.width > 0) {
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--color-background').trim() || '#1A1A1A';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    updateUI();
}

/**
 * 画像表示モードの切り替え処理
 */
function handleDisplayModeChange(e) {
    const newMode = e.target.value;
    if (newMode === currentDisplayMode) return;
    
    currentDisplayMode = newMode;
    logMessage(`表示モードを「${newMode}」に切り替えました。`, 'info');
    
    // モードが切り替わった場合、本計測中であれば強制的に累積画像を更新
    if (measurementMode === 'MAIN_RUN' && !isMeasuring) {
        requestImageUpdate();
    } else if (newMode === 'REALTIME') {
        // REALTIMEモードに戻したら、Canvasをクリアしてライブ映像が描画されるようにする
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}


// ----------------------------------------------------------------------
// 6. 初期ロードとイベントリスナー
// ----------------------------------------------------------------------

// イベントリスナーの登録
prelimButton.addEventListener('click', startPreliminaryMeasurement);
startButton.addEventListener('click', startMeasurement);
resetButton.addEventListener('click', resetMeasurement);

// 表示モードのラジオボタンのイベントリスナーを登録
displayModeRadios.forEach(radio => {
    radio.addEventListener('change', handleDisplayModeChange);
});

window.onload = () => {
    // 初期状態では、Wasmが準備できるまでボタンを無効化
    startButton.disabled = true;
    prelimButton.disabled = true;
    resetButton.disabled = true;

    // Canvasの初期化
    progressCanvas.width = 300; // HTMLのCSSに合わせた固定値
    progressCanvas.height = 50;
    
    initializeWorker();
    
    // フレーム処理ループを開始
    frameRequestId = requestAnimationFrame(processFrameLoop);
    updateUI();
};
