// teramas-cc.js - WebAssembly放射線計測デモ アプリケーションロジック

// ----------------------------------------------------
// 1. 定数とグローバル変数
// ----------------------------------------------------

// システム設定
const TARGET_CORRECTION_FRAMES = 300; 
const IMAGE_UPDATE_INTERVAL = 30;     

// グローバル状態
let worker = null;
let stream = null;
let videoReady = false; 
let wasmReady = false;
let initializationStarted = false; 
let currentMode = 'IDLE'; // IDLE, CORRECTION_MODE, MEASUREMENT_MODE
let currentFrameBuffer = null;
let canProcessFrame = false;

let pixelWidth = 640;
let pixelHeight = 480;

// 補正係数
let gFactor = 1.0;
let bFactor = 1.0;

let calibrationDone = false; 

let frameCounter = 0; 

// 画像データ描画用
let lastProcessedImageData = null; 
let updateImage = false;           

// 表示モードの制御変数
let currentDisplayMode = 'REALTIME'; // 'REALTIME', 'GRAYSCALE', 'COLOR'
let isColorModeActive = false;       // Wasmにカラー処理を要求するかどうか (現状未使用)

// 言語設定
let LANGUAGE_PACK = {};
let currentLang = 'ja';

// WasmReadyを待つための解決関数をグローバルに定義
let wasmReadyPromiseResolve; 

// DOM要素変数の定義 (初期化はinitAppで行う)
let video = null; 
let canvas = null; 
let ctx = null; 
let mainTitle = null; 
let mainHeader = null; 
let preliminaryButton = null; 
let startButton = null;
let resetButton = null;
let dedicatedWindowButton = null; 
let langSwitchButton = null; 
let logElement = null; 
let progressStatus = null; 
let factorGRLabel = null;
let factorBRLabel = null;
let factorGRValue = null;
let factorBRValue = null;
let headerCalib = null;
let correctionGraph = null;

// 表示モード切り替え用のDOM要素
let headerDisplayMode = null; 
let labelRealtime = null;     
let labelGrayscale = null;    
let labelColor = null;        
let radioRealtime = null;
let radioGrayscale = null;
let radioColor = null;


// ----------------------------------------------------
// 2. UI/ログ関数 (呼び出し順序の修正のため、このセクションを繰り上げ)
// ----------------------------------------------------

/**
 * @function updateControlPanel
 * @description アプリケーションの現在のモードに応じて、制御ボタンの状態を更新する
 */
function updateControlPanel() {
    if (!preliminaryButton || !startButton || !resetButton || !dedicatedWindowButton) return;

    if (currentMode === 'CORRECTION_MODE' || currentMode === 'MEASUREMENT_MODE') {
        // 測定/補正中は予備測定と開始を無効化
        preliminaryButton.disabled = true;
        startButton.disabled = true;
        // 致命的な測定ミスを防ぐため、専用ウィンドウボタンも無効化
        dedicatedWindowButton.disabled = true;
    } else { // IDLEモード
        if (wasmReady) {
            preliminaryButton.disabled = false; // Wasmが準備できれば予備測定開始可能
            // キャリブレーション完了済みの場合のみ本計測開始ボタンを有効化
            startButton.disabled = !calibrationDone; 
            dedicatedWindowButton.disabled = false;
        } else {
            // Wasmがまだ準備できていない初期状態
            preliminaryButton.disabled = true;
            startButton.disabled = true;
            dedicatedWindowButton.disabled = false; // 初期化中にウィンドウ変更は可能
        }
    }
    // リセットボタンは常に有効 (緊急停止用)
    resetButton.disabled = false; 
}

function setUILanguage(lang) {
    const texts = LANGUAGE_PACK[lang];
    if (!texts) return;

    // 1. グローバル設定
    currentLang = lang;
    document.documentElement.lang = lang;

    // 2. テキストの更新
    if (mainTitle) mainTitle.textContent = texts.mainTitle;
    if (mainHeader) mainHeader.textContent = texts.mainHeader;
    if (preliminaryButton) preliminaryButton.textContent = texts.preliminaryButton;
    if (startButton) startButton.textContent = texts.startButton;
    if (resetButton) resetButton.textContent = texts.resetButton;
    if (dedicatedWindowButton) dedicatedWindowButton.textContent = texts.dedicatedWindowButton;
    if (headerCalib) headerCalib.textContent = texts.headerCalib;
    if (factorGRLabel) factorGRLabel.textContent = texts.factorGRLabel;
    if (factorBRLabel) factorBRLabel.textContent = texts.factorBRLabel;
    
    // 画像表示モードのラベルを更新
    if (headerDisplayMode) headerDisplayMode.textContent = texts['headerDisplayMode'] || '画像表示モード';
    if (labelRealtime) labelRealtime.textContent = texts['modeRealtime'] || 'リアルタイム';
    if (labelGrayscale) labelGrayscale.textContent = texts['modeGrayscale'] || 'グレースケール';
    if (labelColor) labelColor.textContent = texts['modeColor'] || 'カラー積算(未実装)';
    
    if (langSwitchButton) langSwitchButton.textContent = texts.langButton;
    
    // 3. ステータスを再表示
    const currentStatusKey = progressStatus.getAttribute('data-status-key') || 'statusInitialReady';
    if (progressStatus) progressStatus.textContent = texts[currentStatusKey] || '...';
}

function updateStatus(key) {
    if (!progressStatus) return;
    progressStatus.textContent = getDynamicLogMessage(key);

    const style = progressStatus.style;
    switch(key) {
        case 'statusInitialReady':
        case 'statusReady':
        case 'statusCalibDone': 
            style.backgroundColor = 'var(--success-color)';
            style.color = 'var(--bg-color)';
            break;
        case 'statusCalib':
        case 'statusMeasure':
        case 'statusInit':
            style.backgroundColor = 'var(--log-bg-color)';
            style.color = 'var(--wait-color)';
            break;
        case 'statusError':
            style.backgroundColor = 'var(--log-bg-color)';
            style.color = 'var(--error-color)';
            break;
        default:
            style.backgroundColor = 'var(--log-bg-color)';
            style.color = 'var(--text-color)';
    }
    progressStatus.setAttribute('data-status-key', key);
}


function toggleLanguage() {
    currentLang = (currentLang === 'ja') ? 'en' : 'ja';
    setUILanguage(currentLang);
    updateStatus('statusInitialReady'); 
}


function getDynamicLogMessage(key, ...args) {
    const texts = LANGUAGE_PACK[currentLang];
    
    if (!texts || !texts[key]) {
        return `[LOG ERROR] Missing Key: ${key}`;
    } 

    let messageTemplate = texts[key];

    switch(key) {
        case 'statusCalib': 
            if (args.length < 2) return `${messageTemplate} (Error/300)`; 
            return messageTemplate.replace('%s', args[0]).replace('%s', args[1]); 
            
        case 'statusFactorUpdate': 
            if (args.length < 2) return `${messageTemplate} (G: Error, B: Error)`;
            let finalMessage = messageTemplate;
            finalMessage = finalMessage.replace('%s', args[0]); 
            finalMessage = finalMessage.replace('%s', args[1]);
            return finalMessage;

        case 'statusInitFailed': 
        case 'statusError': 
            if (args.length < 1) return `${messageTemplate}: (Unknown Error)`;
            return `${messageTemplate}: ${args[0]}`;

        default: 
            return messageTemplate;
    }
}


function streamLog(key, type = 'info', ...args) {
    if (!logElement) return; 

    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    let message;
    
    if (key === 'statusInit' && args.length > 0 && typeof args[0] === 'string' && (args[0].includes("ロジックは未実装です。"))) {
        message = args[0];
    } else {
        message = getDynamicLogMessage(key, ...args);
    }
    
    const newLog = document.createElement('div');
    newLog.className = `log-entry log-${type}`;
    newLog.textContent = `[${timeString}] ${message}`;

    if (logElement.firstChild) {
        logElement.insertBefore(newLog, logElement.firstChild);
    } else {
        logElement.appendChild(newLog);
    }

    if (type === 'error') {
        console.error(`[SYSTEM ERROR] ${message}`);
    }
}

function updateCorrectionFactors(rAvg, gAvg, bAvg) {
    if (rAvg <= 0 || isNaN(rAvg) || isNaN(gAvg) || isNaN(bAvg)) {
        streamLog('statusFactorUpdate', 'info', gFactor.toFixed(4), bFactor.toFixed(4));
        return; 
    } 
    
    gFactor = rAvg / gAvg;
    bFactor = rAvg / bAvg;

    const gFactorDisplay = document.getElementById('g-r-factor');
    const bFactorDisplay = document.getElementById('b-r-factor');
    
    const fixedGFactor = isNaN(gFactor) ? 'NaN' : gFactor.toFixed(4);
    const fixedBFactor = isNaN(bFactor) ? 'NaN' : bFactor.toFixed(4);
    
    if (gFactorDisplay) gFactorDisplay.textContent = fixedGFactor;
    if (bFactorDisplay) bFactorDisplay.textContent = fixedBFactor;
    
    if (worker) {
        worker.postMessage({ type: 'SET_FACTORS', gFactor: gFactor, bFactor: bFactor });
    }

    streamLog('statusFactorUpdate', 'info', fixedGFactor, fixedBFactor);
}


// ----------------------------------------------------
// 3. 機能関数
// ----------------------------------------------------

function startMainMeasurement() { 
    streamLog('statusInit', 'info', "本測定ロジックは未実装です。");
    // TODO: 本測定開始ロジック
} 

/**
 * @function resetSystem
 * @description システムの状態を完全にリセットし、Wasmとカメラ接続を再初期化する
 */
function resetSystem() { 
    streamLog('statusReset', 'info');
    
    // 1. Workerを終了し、新しく生成
    if (worker) {
        worker.terminate();
        worker = new Worker('detector_worker.js');
        worker.onmessage = handleWorkerMessage;
    }
    
    // 2. カメラストリームを停止
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        if (video) video.srcObject = null;
    }
    
    // 3. グローバル状態のリセット
    videoReady = false;
    wasmReady = false;
    initializationStarted = false;
    currentMode = 'IDLE';
    canProcessFrame = false;
    gFactor = 1.0;
    bFactor = 1.0;
    calibrationDone = false; // 🚨 キャリブレーション完了フラグもリセット
    frameCounter = 0;
    lastProcessedImageData = null;

    // 4. UIのリセット
    if (canvas && ctx) ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    
    updateStatus('statusInitialReady'); 
    
    updateCorrectionFactors(1.0, 1.0, 1.0); // 係数表示をリセット
    
    // 5. ボタン状態のリセット
    updateControlPanel(); // IDLE状態に戻るため、これでボタンも正しくリセットされる

    // 6. Wasmの初期化を再度開始
    startWasmInitialization();
}

/**
 * @function openInDedicatedWindow
 * @description 現在のウィンドウを閉じ、タブバーを持たない単独の新しいウィンドウでアプリを開き直す。
 */
function openInDedicatedWindow() { 
    streamLog('statusWindowInfo', 'info');
    
    const currentUrl = window.location.href;
    
    const features = 'toolbar=no,menubar=no,status=no,resizable=yes,scrollbars=yes,width=1000,height=800';
    
    const newWindow = window.open(currentUrl, '_blank', features);

    if (newWindow) {
        streamLog('statusWindowOpened', 'info'); 
        window.close();
    } else {
        streamLog('statusError', 'error', getDynamicLogMessage('statusError', "ポップアップがブロックされました。ブラウザの設定を確認してください。"));
    }
}


// ----------------------------------------------------
// 4. 画像描画ロジック
// ----------------------------------------------------

/**
 * @function drawGrayscaleAccumulation
 * @description ワーカーから受け取った積算データをグレースケール画像として描画する。
 * @param {Uint8ClampedArray} dataArray - ワーカーから返された積算結果の可視化データ (RGBA形式)
 */
function drawGrayscaleAccumulation(dataArray) {
    if (!ctx || !dataArray || dataArray.length === 0) return;

    // CanvasのImageDataを生成
    const tempImageData = ctx.createImageData(pixelWidth, pixelHeight);
    const data = tempImageData.data; 
    
    // 1. 最大積算値を見つける (スケーリングのため)
    let maxVal = 0;
    for (let i = 0; i < dataArray.length; i += 4) {
        // Rチャネルに積算値が入っている想定
        if (dataArray[i] > maxVal) {
            maxVal = dataArray[i]; 
        }
    }
    
    // 2. スケーリング係数を計算 (最大値を255にする)
    const scaleFactor = maxVal > 0 ? 255.0 / maxVal : 1.0;

    // 3. グレースケール画像を生成・設定
    for (let i = 0; i < dataArray.length; i += 4) {
        const sourceVal = dataArray[i]; 
        
        // スケーリング
        const scaledVal = Math.min(255, Math.round(sourceVal * scaleFactor));

        // グレースケール (R=G=B) に設定
        data[i] = scaledVal;     // R
        data[i + 1] = scaledVal; // G
        data[i + 2] = scaledVal; // B
        data[i + 3] = 255;       // A (不透明)
    }

    // 4. Canvasに描画
    ctx.putImageData(tempImageData, 0, 0);
}


/**
 * @function drawColorBarUnimplemented
 * @description カラー積算画像が未実装であることを示すカラーバーを描画する
 */
function drawColorBarUnimplemented() {
    if (!ctx) return;
    
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    
    const segmentCount = 10;
    const segmentWidth = pixelWidth / segmentCount;
    const colors = ['#f00', '#fa0', '#ff0', '#af0', '#0f0', '#0fa', '#0ff', '#0af', '#00f', '#80f']; 

    for (let i = 0; i < segmentCount; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(i * segmentWidth, 0, segmentWidth, pixelHeight * 0.7);
    }
    
    ctx.fillStyle = '#f3f4f6'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(LANGUAGE_PACK[currentLang]['modeColor'] || 'カラー', pixelWidth / 2, pixelHeight * 0.8);
    ctx.font = '20px sans-serif';
    ctx.fillText(`(${LANGUAGE_PACK[currentLang]['unimplemented'] || '未実装'})`, pixelWidth / 2, pixelHeight * 0.88);
}


function drawCanvasContent() {
    if (!canvas || !ctx) return;
    
    // 修正: 無条件のキャンバスクリア処理を削除。
    // キャンバスクリアは、CORRECTION/MEASUREMENTモードにおいては
    // processFrameLoop の ctx.drawImage(video, ...) の直後に実行される。
    // IDLEモードではクリアせず、最後の描画内容を静止画として保持する。

    if (currentDisplayMode === 'REALTIME') {
        if (videoReady && video) {
            ctx.drawImage(video, 0, 0, pixelWidth, pixelHeight);
        }
    } else if (currentDisplayMode === 'GRAYSCALE') {
        if (lastProcessedImageData && lastProcessedImageData.length > 0) {
             drawGrayscaleAccumulation(lastProcessedImageData);
        }
    } else if (currentDisplayMode === 'COLOR') {
        drawColorBarUnimplemented();
    }
}

/**
 * @function drawCorrectionGraph
 * @description キャリブレーションの進捗を 'correction-graph' キャンバスに描画する。
 * @param {number} frameCount - 現在の処理済みフレーム数
 * @param {number} totalFrames - 目標とする総フレーム数
 * @param {boolean} isDone - 完了したかどうか
 */
function drawCorrectionGraph(frameCount, totalFrames, isDone = false) {
    const graphCanvas = document.getElementById('correction-graph');
    if (!graphCanvas) return;

    const gCtx = graphCanvas.getContext('2d');
    const width = graphCanvas.width;
    const height = graphCanvas.height;

    gCtx.clearRect(0, 0, width, height);

    const style = getComputedStyle(document.body);
    const bgColor = style.getPropertyValue('--log-bg-color').trim();
    const waitColor = style.getPropertyValue('--wait-color').trim();
    const successColor = style.getPropertyValue('--success-color').trim();
    const textColor = style.getPropertyValue('--text-color').trim();
    
    gCtx.fillStyle = bgColor;
    gCtx.fillRect(0, 0, width, height);
    
    const padding = 5;
    const barHeight = height - 2 * padding;
    const barWidth = width - 2 * padding;
    
    const progress = Math.min(frameCount / totalFrames, 1.0);
    const currentProgressWidth = barWidth * progress;

    gCtx.fillStyle = isDone ? successColor : waitColor;
    gCtx.fillRect(padding, padding, currentProgressWidth, barHeight);

    const percentage = (progress * 100).toFixed(0);
    const text = isDone ? `${percentage}% COMPLETE` : `${percentage}%`;

    gCtx.fillStyle = isDone ? bgColor : textColor;
    gCtx.font = `${barHeight * 0.5}px Arial`;
    gCtx.textAlign = 'center';
    gCtx.textBaseline = 'middle';
    gCtx.fillText(text, width / 2, height / 2);
}


// ----------------------------------------------------
// 5. 初期化とメインロジック (このセクションを繰り下げ)
// ----------------------------------------------------

async function initApp() {
    
    // DOM要素の取得 (全て)
    video = document.getElementById('camera-video');
    canvas = document.getElementById('processing-canvas');
    mainTitle = document.getElementById('main-title'); 
    mainHeader = document.getElementById('main-header'); 
    preliminaryButton = document.getElementById('preliminary-measurement-button');
    startButton = document.getElementById('start-measurement-button');
    resetButton = document.getElementById('reset-button');
    dedicatedWindowButton = document.getElementById('dedicated-window-button');
    langSwitchButton = document.getElementById('lang-switch-button'); 
    logElement = document.getElementById('log-stream');
    progressStatus = document.getElementById('progress-status');
    factorGRLabel = document.getElementById('g-factor-label'); 
    factorBRLabel = document.getElementById('b-factor-label'); 
    factorGRValue = document.getElementById('g-r-factor'); 
    factorBRValue = document.getElementById('b-r-factor'); 
    headerCalib = document.getElementById('header-calib'); 
    correctionGraph = document.getElementById('correction-graph'); 
    headerDisplayMode = document.getElementById('header-display-mode'); 
    labelRealtime = document.getElementById('label-realtime'); 
    labelGrayscale = document.getElementById('label-grayscale'); 
    labelColor = document.getElementById('label-color'); 
    radioRealtime = document.getElementById('mode-realtime');
    radioGrayscale = document.getElementById('mode-grayscale');
    radioColor = document.getElementById('mode-color');


    if (canvas) {
        ctx = canvas.getContext('2d');
    } else {
        console.error("Fatal Error: 'processing-canvas' element not found.");
        return;
    }
    
    // UIの初期無効化
    if (preliminaryButton) preliminaryButton.disabled = true; 
    if (startButton) startButton.disabled = true;
    if (resetButton) resetButton.disabled = false; 

    // Step 1: 言語パックのロードと適用 
    try {
        if (Object.keys(LANGUAGE_PACK).length === 0) {
            const response = await fetch('lang.json');
            if (!response.ok) {
                 throw new Error(`lang.json fetch failed: ${response.statusText}`);
            }
            LANGUAGE_PACK = await response.json();
            setUILanguage(currentLang); // <-- 呼び出しが可能になりました
        } else {
            setUILanguage(currentLang); // <-- 呼び出しが可能になりました
        }
    } catch (e) {
        console.error("Failed to load lang.json:", e);
        streamLog('statusError', 'error', `言語ファイル (lang.json) の読み込みに失敗しました。詳細: ${e.message}`);
    }
    
    // Step 2: Workerの作成と永続ハンドラの設定
    worker = new Worker('detector_worker.js');
    worker.onmessage = handleWorkerMessage; 
    
    // Step 3: イベントリスナー設定
    if (preliminaryButton) preliminaryButton.addEventListener('click', startPreliminaryMeasurement); 
    if (startButton) startButton.addEventListener('click', startMainMeasurement); 
    if (resetButton) resetButton.addEventListener('click', resetSystem); 
    if (dedicatedWindowButton) dedicatedWindowButton.addEventListener('click', openInDedicatedWindow); 
    if (langSwitchButton) langSwitchButton.addEventListener('click', toggleLanguage);
    
    // 画像表示モード切り替えのイベントリスナー
    [radioRealtime, radioGrayscale, radioColor].forEach(radio => {
        if (radio) {
            radio.addEventListener('change', (e) => {
                currentDisplayMode = e.target.value;
                streamLog('statusInit', 'info', `表示モード: ${currentDisplayMode} に変更`); 
                drawCanvasContent();
            });
        }
    });

    // Step 4: Wasmの初期化を開始
    await startWasmInitialization();
    
    // Step 5: 最終チェックと初期値設定
    if (!wasmReady) {
        streamLog('statusError', 'error', getDynamicLogMessage('statusInitFailed', "Wasm"));
    }
    
    // 補正係数の初期値を設定 (NaN表示を防ぐ)
    if (factorGRValue) factorGRValue.textContent = gFactor.toFixed(4); 
    if (factorBRValue) factorBRValue.textContent = bFactor.toFixed(4); 
    
    // 最初のフレーム処理用にバッファを確保
    const bufferSize = pixelWidth * pixelHeight * 4; 
    currentFrameBuffer = new ArrayBuffer(bufferSize);
    canProcessFrame = true;
}

// Wasmの初期化のみを行う関数
async function startWasmInitialization() {
    
    if (initializationStarted) {
        streamLog('statusAlreadyInit', 'info');
        return Promise.resolve(true); 
    }
    
    initializationStarted = true;
    streamLog('statusInit', 'info'); 
    
    try {
        const wasmReadyPromise = new Promise((resolve, reject) => {
            wasmReadyPromiseResolve = resolve;
            worker.onerror = (e) => {
                reject(new Error(`Worker Error: ${e.message}`));
            };
        });

        // 1. Wasmバイナリのロードと送信
        streamLog('statusInit', 'wait');
        const wasmResponse = await fetch('detector_core.wasm'); 
        if (!wasmResponse.ok) {
            throw new Error(`Wasmファイルが見つかりません (Status: ${wasmResponse.status})`);
        }
        const wasmBinary = await wasmResponse.arrayBuffer();
        worker.postMessage({ type: 'LOAD_WASM_MODULE', wasmBinary: wasmBinary }, [wasmBinary]); 

        // 2. Wasmの初期化完了を待つ
        await wasmReadyPromise; 
        wasmReady = true;
        
        // 3. Wasm Coreに初期化を要求 (サイズ情報)
        worker.postMessage({ type: 'INIT_CORE', width: pixelWidth, height: pixelHeight }); 

        // 準備完了で予備測定ボタンを有効化
        if (preliminaryButton) preliminaryButton.disabled = false;
        streamLog('statusWasmReady', 'success'); 
        updateControlPanel();

        return true; 
    } catch (err) {
        streamLog('statusError', 'error', getDynamicLogMessage('statusInitFailed', `Wasm (${err.message || err.name})`));
        initializationStarted = false;
        if (resetButton) resetButton.disabled = false;
        return false; 
    }
}

// カメラ起動ロジック
async function startCamera() {
    if (videoReady) return true;

    try {
        streamLog('statusInitialReady', 'wait'); 
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment', width: 640, height: 480 } 
        });
        
        if (video) video.srcObject = stream;
        
        await new Promise((resolve) => { 
            if(video) video.onloadedmetadata = resolve;
            else resolve(); 
        });
        
        if (video) {
            pixelWidth = video.videoWidth; 
            pixelHeight = video.videoHeight;
            if (canvas) {
                 canvas.width = pixelWidth;
                 canvas.height = pixelHeight;
            }
            video.width = pixelWidth;
            video.height = pixelHeight;
        }

        worker.postMessage({ type: 'INIT_CORE', width: pixelWidth, height: pixelHeight });
        
        videoReady = true;
        streamLog('statusCamera', 'success');
        
        // 🚨 最終修正箇所: カメラ映像自体を非表示にし、Canvasのみを表示する
        if (video) video.style.display = 'none';
        if (canvas) canvas.style.display = 'block';
        
        requestAnimationFrame(processFrameLoop);
        
        return true;
    } catch (err) {
        streamLog('statusError', 'error', getDynamicLogMessage('statusInitFailed', `カメラ (${err.message || err.name})`));
        return false;
    }
}

async function startPreliminaryMeasurement() {
    if (!wasmReady) {
        streamLog('statusError', 'error', getDynamicLogMessage('statusInitFailed', "Wasm"));
        return;
    }

    if (!(await startCamera())) {
        streamLog('statusError', 'error', getDynamicLogMessage('statusInitFailed', "カメラ"));
        return;
    }
    
    currentMode = 'CORRECTION_MODE';
    streamLog('statusCalib', 'wait'); 
    
    // UIを補正中モードに更新
    updateControlPanel();
    
    // 進捗表示を初期化
    updateStatus('statusCalib'); 
    
    // グラフをリセット
    drawCorrectionGraph(0, TARGET_CORRECTION_FRAMES, false); 

    // Workerに初期化と最初のフレーム処理を指示
    worker.postMessage({ type: 'RESET_ACCUMULATION' }); 
    canProcessFrame = true;
    
    ctx.clearRect(0, 0, pixelWidth, pixelHeight); 
}

function processFrameLoop() {
    // 処理の前提条件チェック
    if (!videoReady || !wasmReady || !worker) {
        drawCanvasContent(); 
        requestAnimationFrame(processFrameLoop);
        return;
    }

    // 1. IDLEモードの場合は静止画像を維持
    // drawCanvasContent() のみ呼び出し、ctx.drawImageとctx.clearRectは実行しない
    if (currentMode === 'IDLE') {
        drawCanvasContent();
        requestAnimationFrame(processFrameLoop);
        return;
    }

    // --- CORRECTION/MEASUREMENTモードの処理を続行 ---
    
    // 1. Workerに送るためのフレームデータをCanvas経由で取得
    ctx.drawImage(video, 0, 0, pixelWidth, pixelHeight); 
    const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
    
    // 2. Canvasをクリア
    // データ取得後、すぐにCanvasをクリアし、リアルタイム映像がユーザーに見えるのを防ぐ
    ctx.clearRect(0, 0, pixelWidth, pixelHeight); 
    
    // 3. 5fps間引きロジック
    frameCounter++;
    const sendFrame = (frameCounter % (60 / 5)) === 0;
    
    // 4. Workerへのフレーム処理要求
    if (sendFrame && canProcessFrame) { 
        canProcessFrame = false; 
        currentFrameBuffer = imageData.data.buffer;
        
        const returnImage = (currentDisplayMode !== 'REALTIME'); 

        worker.postMessage({
            type: 'PROCESS_FRAME',
            width: pixelWidth,
            height: pixelHeight,
            buffer: currentFrameBuffer,
            gFactor: gFactor,
            bFactor: bFactor,
            currentMode: currentMode,
            returnImage: returnImage
        }, [currentFrameBuffer]);
    }
    
    // 5. 画像の更新フラグをリセット
    if (updateImage && lastProcessedImageData) {
        updateImage = false; 
    } 
    
    // 6. モードに応じた最終的な描画を実行
    drawCanvasContent();

    // 7. ループを継続
    requestAnimationFrame(processFrameLoop);
}

function handleWorkerMessage(e) {
    const data = e.data;
    
    if (data.type === 'STATUS' && data.message === 'WasmReady') {
        if (typeof wasmReadyPromiseResolve === 'function') {
            wasmReadyPromiseResolve(); 
        }
        return; 
    }

    if (data.buffer) {
        currentFrameBuffer = data.buffer;
    }
    canProcessFrame = true;

    // 積算画像データ処理
    if (data.imageData) {
        lastProcessedImageData = new Uint8ClampedArray(data.imageData);
        updateImage = true;
    }
    
    switch (data.type) {
            
        case 'CORRECTION_PROCESSED':
            const rSum = data.rSum; 
            const gSum = data.gSum;
            const bSum = data.bSum;
            const pixelCount = data.pixelCount; // 🚨 ノイズピクセル数を受け取る
            
            const frameCount = data.frameCount;
            const totalFrames = TARGET_CORRECTION_FRAMES; 

            // プログレスバー描画を呼び出し
            drawCorrectionGraph(frameCount, totalFrames, frameCount >= totalFrames);

            // 進捗テキスト表示を更新
            if (progressStatus) {
                progressStatus.textContent = getDynamicLogMessage('statusCalib', frameCount, totalFrames); 
                progressStatus.style.color = 'var(--wait-color)'; 
            }

            if (frameCount >= totalFrames) {
                const totalR = Number(rSum); 
                const totalG = Number(gSum);
                const totalB = Number(bSum);
                
                if (totalR > 0 && totalG > 0 && totalB > 0) {
                    // Rを基準とした補正係数を計算（計算式自体は正しい）
                    gFactor = totalR / totalG; 
                    bFactor = totalR / totalB;
                    
                    if (factorGRValue) factorGRValue.textContent = gFactor.toFixed(4);
                    if (factorBRValue) factorBRValue.textContent = bFactor.toFixed(4);

                    streamLog('statusFactorUpdate', 'success', gFactor.toFixed(4), bFactor.toFixed(4));
                } else {
                    streamLog('statusError', 'error', 'Calibration sums were zero. Check camera feed and WASM initialization.');
                }

                currentMode = 'IDLE'; 
                calibrationDone = true;
                
                updateStatus('statusCalibDone'); 
                streamLog('statusCalibDone', 'success');
                
                // 🚨 ノイズピクセル数の最終結果をログ出力
                const totalPixels = pixelWidth * pixelHeight * totalFrames;
                const totalNoisePixels = pixelCount;
                const noiseRatio = (totalNoisePixels / totalPixels) * 100;
                
                streamLog('statusInit', 'info', `--- Noise Measurement Summary ---`);
                streamLog('statusInit', 'info', `Total Accumulated Pixels: ${totalNoisePixels.toLocaleString()}`);
                streamLog('statusInit', 'info', `Total Possible Pixels (Frames*W*H): ${totalPixels.toLocaleString()}`);
                streamLog('statusInit', 'info', `Noise Detection Rate: ${noiseRatio.toFixed(6)}%`);
                streamLog('statusInit', 'info', `---------------------------------`);

                updateControlPanel();
            }
            break;
            
        case 'PROCESSED': 
            // 本計測処理ロジック (TODO)
            break;
        
        case 'ERROR': 
            const errorMessage = data.message ? `WASM Worker Error: ${data.message}` : `WASM Worker Error: Unknown error (Message property missing).`;
            streamLog('statusError', 'error', errorMessage);
            currentMode = 'IDLE';
            updateControlPanel();
            break;
            
        case 'DEBUG':
            // Workerからのデバッグメッセージ（積算値とピクセル数を含む）を出力
            console.log(`[WORKER DEBUG] ${data.message}`);
            break;
    }
}

// ----------------------------------------------------
// 6. アプリケーション開始
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', initApp);