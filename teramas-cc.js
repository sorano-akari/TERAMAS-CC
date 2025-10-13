// terra-mon.js (Revised with comprehensive i18n pack)

// =========================================================================
// 1. プロジェクト変数と状態管理
// =========================================================================
let videoElement;          // <video> 要素
let canvasElement;         // <canvas> 要素 (描画用)
let canvasContext;
let worker;                // Web Worker インスタンス
let rafId = null;          // requestAnimationFrame ID
let isWorkerReady = false;
let isCoreInitialized = false;
let isMeasuring = false;
let isCalibrating = false; // 予備測定（調整）の状態

let frameWidth = 0;
let frameHeight = 0;

let isCameraSetupDone = false; // カメラアクセスが完了したかどうか
let stream = null; // カメラストリームを保持
let wasmModuleLoaded = false; // Wasmモジュールがロードされたかどうか

// ノイズ閾値（初期値は仮の値）
const NOISE_MU = 0.05;
const NOISE_SIGMA = 0.01;

// 言語設定
let currentLang = 'ja'; // 'ja' or 'en'

// =========================================================================
// 2. 多言語対応 (i18n) - 提供された言語パックを使用
// =========================================================================

const MESSAGES = {
    "ja": {
        "mainTitle": "TERAMAS-CC てらますしーしー",
        "preliminaryButton": "予備測定（調整）",
        "startButton": "計測開始",
        "resetButton": "初期化・リセット",
        "dedicatedWindowButton": "単独ウィンドウで開きなおす",
        "mainHeader": "WebAssembly 放射線計測デモ",
        "headerCalib": "キャリブレーション状況 (ノイズ割合)",
        "factorGRLabel": "G/R係数:",
        "factorBRLabel": "B/R係数:",
        "langButton": "English / 日本語",      
        "statusInitialReady": "カメラ接続を待機しています。",
        "statusLangHint": "English version is available. Click the English / 日本語 button around left-top to switch.", 
        "statusInit": "システム起動処理中...",
        "statusWasmReady": "Wasmコア起動成功。",
        "statusCamera": "カメラアクセス成功。",
        "statusCoreInit": "C++コア初期化中...",
        "statusReady": "予備測定（調整）ボタンを押してキャリブレーションを開始してください。",
        "statusCalib": "予備測定（調整）中 - ノイズ積算",
        "statusCalibDone": "予備測定完了。計測開始ボタンを押してください。",
        "statusMeasure": "本計測中",
        "statusComplete": "計測完了! 結果出力中...",
        "statusError": "エラー",
        "statusAlreadyInit": "既に計測を開始しています。",
        "statusReset": "システムを初期化しました。",
        "statusWindowInfo": "計測の安定性のため、単独ウィンドウでの実行を推奨します。",
        "statusWindowOpened": "新しい単独ウィンドウで開きました。計測を続けるには、元のウィンドウを閉じてください。",
        "statusThrottle": "（警告）ブラウザが抑制中です。タブをアクティブにしてください。",
        "statusFactorUpdate": "補正係数を更新しました (G: %s, B: %s)",
        "statusInitFailed": "%s の初期化に失敗しました",
        "statusDisplayModeChanged_REALTIME": "表示モードを「直接出力」に切り替えました。", 
        "statusDisplayModeChanged_GRAYSCALE": "表示モードを「グレースケール積算画像」に切り替えました。",
        "statusDisplayModeChanged_COLOR": "表示モードを「カラー積算画像 (未実装)」に切り替えました。",
                "connectCameraButton": "カメラ接続開始", 
        "statusNoCamera": "カメラが見つかりません。デバイスを確認してください。", 
        "statusCameraList": "カメラを選択し、「カメラ接続開始」を押してください。",
                "processingLabel": "処理済みフレーム数:",
        "eventsLabel": "総イベント数:", 
        "rateLabel": "計数率:"
    },
    "en": {
        "mainTitle": "TERAMAS-CC (Radiation Measurement)",
        "preliminaryButton": "Preliminary Measurement (Adjust)",
        "startButton": "Start Measurement",
        "resetButton": "Initialize & Reset",
        "dedicatedWindowButton": "Open in Dedicated Window",
        "mainHeader": "WebAssembly Radiation Measurement Demo",
        "headerCalib": "Calibration Status (Noise Ratio)",
        "factorGRLabel": "G/R Factor:",
        "factorBRLabel": "B/R Factor:",
        "langButton": "日本語 / English",
        "statusInitialReady": "Waiting for camera connection.",
        "statusLangHint": "日本語版も利用可能です。Click the English / 日本語 button to switch.",
        "statusInit": "Starting system initialization...",
        "statusWasmReady": "Wasm Core ready.",
        "statusCamera": "Camera access successful.",
        "statusCoreInit": "Initializing C++ Core...",
        "statusReady": "Press the Preliminary Measurement (Adjust) button to start calibration.",
        "statusCalib": "Preliminary Measurement (Adjusting) - Noise Accumulation",
        "statusCalibDone": "Preliminary measurement complete. Press Start Measurement to begin.",
        "statusMeasure": "Main Measurement",
        "statusComplete": "Measurement complete! Outputting results...",
        "statusError": "Error",
        "statusAlreadyInit": "Measurement already started.",
        "statusReset": "System initialized and reset.",
        "statusWindowInfo": "For best stability, running in a dedicated window is recommended.",
        "statusWindowOpened": "Opened in a new dedicated window. Please close the original window to continue measurement.",
        "statusThrottle": "(WARNING) Browser is throttling. Please keep the tab active.",
        "statusFactorUpdate": "Correction factors updated (G: %s, B: %s)",
        "statusInitFailed": "Failed to initialize %s",
        "statusDisplayModeChanged_REALTIME": "Display mode: Direct Output.", 
        "statusDisplayModeChanged_GRAYSCALE": "Display mode: Gray-scale Accumulation.",
        "statusDisplayModeChanged_COLOR": "Display mode: Color Accumulation (Not Implemented).",
        "connectCameraButton": "Connect Camera", 
        "statusNoCamera": "No camera found. Please check your device.",
        "statusCameraList": "Select a camera and press 'Connect Camera'.",
        "processingLabel": "Processed Frames:", 
        "eventsLabel": "Total Events:", 
        "rateLabel": "Count Rate:"
    }
};

/**
 * @brief 指定されたキーに対応する多言語テキストを取得
 * @param key MESSAGES内のキー
 * @param args プレースホルダー（%s）に埋め込む引数
 */
function getMessage(key, ...args) {
    let msg = MESSAGES[currentLang][key] || MESSAGES['en'][key] || key;
    args.forEach(arg => {
        msg = msg.replace('%s', arg);
    });
    return msg;
}

/**
 * @brief UIテキストを現在の言語に更新する
 */
function updateUI() {
    document.title = getMessage('mainTitle');
    document.getElementById('main-header').textContent = getMessage('mainHeader');
    document.getElementById('header-calib').textContent = getMessage('headerCalib');
    document.getElementById('factor-gr-label').textContent = getMessage('factorGRLabel');
    document.getElementById('factor-br-label').textContent = getMessage('factorBRLabel');
    document.getElementById('lang-button').textContent = getMessage('langButton');
    
    document.getElementById('preliminary-button').textContent = getMessage('preliminaryButton');
    document.getElementById('start-button').textContent = getMessage('startButton');
    document.getElementById('reset-button').textContent = getMessage('resetButton');
    document.getElementById('dedicated-window-button').textContent = getMessage('dedicatedWindowButton');
    
    // ★ カメラ接続ボタンのテキストを更新
    document.getElementById('connect-camera-button').textContent = getMessage('connectCameraButton');

    // ★ 統計情報のラベルを更新 (キーを追加したのでコメントアウトを解除)
    document.getElementById('frame-label').textContent = getMessage('processingLabel');
    document.getElementById('event-label').textContent = getMessage('eventsLabel');
    document.getElementById('rate-label').textContent = getMessage('rateLabel');
    
    // 初期状態メッセージの更新 (ロジックがまだカメラ一覧取得前の場合を想定)
    if (!isCoreInitialized) {
        document.getElementById('status-message').textContent = getMessage('statusInitialReady');
    }
}

/**
 * @brief 言語を切り替える
 */
function toggleLanguage() {
    currentLang = (currentLang === 'ja') ? 'en' : 'ja';
    updateUI();
}

// =========================================================================
// 3. カメラと Worker の初期化
// =========================================================================

// teramas-cc.js の Webカメラを起動するセクション (setupCamera() をこれら2つの関数に置き換える)

/**
 * @brief Webカメラデバイスの一覧を取得し、セレクトボックスに反映する（カメラアクセス許可は求めない）
 */
async function enumerateCameras() {
    try {
        // 最初の navigator.mediaDevices.enumerateDevices() は、カメラへの実際のアクセス許可を求めない。
        // デバイスのリストを取得するだけ。
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        const selectBox = document.getElementById('camera-select');
        selectBox.innerHTML = ''; // リストをクリア
        
        if (videoDevices.length === 0) {
            selectBox.innerHTML = `<option>${getMessage('statusNoCamera')}</option>`;
            document.getElementById('connect-camera-button').disabled = true;
            document.getElementById('status-message').textContent = getMessage('statusNoCamera');
            return;
        }

        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            // ラベルがない場合は "Camera [index + 1]" のようなフォールバック名を使用
            option.text = device.label || `${getMessage('genericCameraLabel')} ${index + 1}`; 
            selectBox.appendChild(option);
        });
        
        selectBox.disabled = false;
        document.getElementById('connect-camera-button').disabled = false;
        document.getElementById('status-message').textContent = getMessage('statusCameraList'); // カメラ選択を促すメッセージ
        
    } catch (err) {
        // 通常、この段階でエラーが出ることは稀だが、ブラウザ機能がない場合などに対応
        document.getElementById('status-message').textContent = getMessage('statusError');
        console.error('Camera enumeration error:', err);
    }
}

/**
 * @brief 選択されたWebカメラを起動し、Wasmコアの初期化に進む
 */
async function startSelectedCamera() {
    if (isCameraSetupDone) return;
    
    document.getElementById('status-message').textContent = getMessage('statusInit'); // 初期化開始メッセージ
    
    const selectedDeviceId = document.getElementById('camera-select').value;
    const connectButton = document.getElementById('connect-camera-button');
    connectButton.disabled = true; // 接続ボタンを無効化
    
    try {
        const constraints = {
            video: {
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            }
        };
        
        videoElement = document.getElementById('camera-feed');
        // ★ navigator.mediaDevices.getUserMedia がカメラアクセス許可を求め、ストリームを開始する
        stream = await navigator.mediaDevices.getUserMedia(constraints); 
        videoElement.srcObject = stream;
        
        await new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                frameWidth = videoElement.videoWidth;
                frameHeight = videoElement.videoHeight;
                canvasElement.width = frameWidth;
                canvasElement.height = frameHeight;
                
                document.getElementById('status-message').textContent = getMessage('statusCamera');
                isCameraSetupDone = true;
                
                // カメラセットアップ後にWasm Workerを初期化
                setupWorker(); 
                resolve();
            };
        });

    } catch (err) {
        document.getElementById('status-message').textContent = getMessage('statusInitFailed', 'Camera');
        console.error('Camera setup error (getUserMedia):', err);
        isCameraSetupDone = false;
        connectButton.disabled = false; // エラー時はボタンを再有効化
    }
}

/**
 * @brief Web Workerを初期化し、Wasmコアのロードを指示する
 */
function setupWorker() {
    document.getElementById('status-message').textContent = getMessage('statusInit');
    worker = new Worker('detector_worker.js');

    worker.onmessage = (e) => {
        const data = e.data;

        switch (data.type) {
            case 'ready':
                // Wasmロード完了
                isWorkerReady = true;
                document.getElementById('status-message').textContent = getMessage('statusWasmReady');

                // Wasmコアをカメラ解像度と閾値で初期化
                document.getElementById('status-message').textContent = getMessage('statusCoreInit');
                worker.postMessage({
                    type: 'init',
                    width: frameWidth,
                    height: frameHeight,
                    mu: NOISE_MU,
                    sigma: NOISE_SIGMA
                });
                break;
            case 'initialized':
                // Wasmコア初期化完了
                isCoreInitialized = true;
                document.getElementById('status-message').textContent = getMessage('statusReady');
                document.getElementById('preliminary-button').disabled = false;
                document.getElementById('reset-button').disabled = false;
                break;
            case 'processed':
                // Workerからの処理結果を受信
                handleProcessedData(data);
                break;
            case 'error':
                document.getElementById('status-message').textContent = getMessage('statusError');
                console.error('Worker error:', data.message);
                break;
        }
    };
    
    worker.postMessage({ type: 'load' });
}

// =========================================================================
// 4. データ処理と描画
// =========================================================================

/**
 * @brief Webカメラからフレームを取得し、Workerに渡すメインループ
 */
function captureAndProcessFrame() {
    if (!isMeasuring && !isCalibrating) {
        // 測定/調整中でない場合は終了
        rafId = null;
        return;
    }

    const activeMode = document.querySelector('input[name="view-mode"]:checked').value;
    
    // 描画用canvasに現在のvideoフレームを描画 (データ取得のため)
    canvasContext.drawImage(videoElement, 0, 0, frameWidth, frameHeight);
    
    // ImageDataオブジェクトを取得
    const imageData = canvasContext.getImageData(0, 0, frameWidth, frameHeight);
    
    // RGBデータのみをUint8Arrayとして抽出 (Workerへ転送するため)
    const rgbArray = new Uint8Array(frameWidth * frameHeight * 3);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgbArray[j] = imageData.data[i];     // R
        rgbArray[j + 1] = imageData.data[i + 1]; // G
        rgbArray[j + 2] = imageData.data[i + 2]; // B
    }

    // Workerに処理を依頼 (Transferable ObjectとしてArrayBufferを転送)
    worker.postMessage({
        type: 'process',
        imageData: rgbArray.buffer,
        mode: activeMode, // 表示モードをWorkerに伝える（将来的な実装用）
        isCalibrating: isCalibrating // 調整中かどうかをコアに伝える
    }, [rgbArray.buffer]);
    
    // 次のフレーム処理をスケジュール
    rafId = requestAnimationFrame(captureAndProcessFrame);
}


/**
 * @brief Workerから受信した処理済みデータをCanvasに描画する
 * @param data Workerからのデータオブジェクト
 */
function handleProcessedData(data) {
    const mode = document.querySelector('input[name="view-mode"]:checked').value;
    
    // 統計情報の更新
    const frameCount = data.frameCount;
    const eventCount = data.eventCount;
    document.getElementById('frame-count').textContent = frameCount;
    document.getElementById('event-count').textContent = eventCount;
    
    // 計数率の計算と表示 (露光時間は30fpsを仮定)
    const exposureTime = 1.0 / 30.0; // 秒
    const totalTime = frameCount * exposureTime;
    const countRate = totalTime > 0 ? (eventCount / totalTime).toFixed(3) : 0;
    document.getElementById('rate-value').textContent = countRate + ' Hz';
    
    // 描画処理
    if (mode === 'live') {
        // 生画像モードの場合、描画はcaptureAndProcessFrame内で完了している (video to canvas)
    } else if (mode === 'grayscale') {
        // グレースケール積算画像
        const grayscaleBuffer = data.grayscaleData; // ArrayBuffer
        const grayscaleArray = new Uint8ClampedArray(grayscaleBuffer);
        
        const imageData = canvasContext.createImageData(frameWidth, frameHeight);
        const pixelData = imageData.data;
        
        // グレースケールデータをRGB (4ch) に変換してImageDataに格納
        for (let i = 0, j = 0; i < grayscaleArray.length; i++, j += 4) {
            const value = grayscaleArray[i];
            pixelData[j] = value;     // R
            pixelData[j + 1] = value; // G
            pixelData[j + 2] = value; // B
            pixelData[j + 3] = 255;   // A (不透明)
        }
        canvasContext.putImageData(imageData, 0, 0);
        
    } else if (mode === 'color') {
        // カラー積算画像（開発中を示す図を表示）
        canvasContext.fillStyle = 'rgba(0, 0, 0, 0.5)';
        canvasContext.fillRect(0, 0, frameWidth, frameHeight);
        canvasContext.fillStyle = 'white';
        canvasContext.font = '24px Arial';
        canvasContext.textAlign = 'center';
        canvasContext.fillText(getMessage('statusDisplayModeChanged_COLOR'), frameWidth / 2, frameHeight / 2);
    }
}


// =========================================================================
// 5. UI イベントハンドラ
// =========================================================================

/**
 * @brief 予備測定（調整）ボタンのハンドラ
 */
function startPreliminaryMeasurement() {
    if (!isCoreInitialized || isMeasuring || isCalibrating) {
        document.getElementById('status-message').textContent = getMessage('statusAlreadyInit');
        return;
    }

    isCalibrating = true;
    document.getElementById('status-message').textContent = getMessage('statusCalib');
    document.getElementById('preliminary-button').disabled = true;
    document.getElementById('start-button').disabled = true;
    
    // 描画モードを強制的にグレースケール積算にするのが自然だが、ここではユーザー選択に任せる
    
    // 最初のフレーム処理をスケジュール
    rafId = requestAnimationFrame(captureAndProcessFrame);

    // TODO: 予備測定の終了ロジック（一定時間後、または分散が収束した後）を実装
    // 仮に5秒後に終了するタイマーを設定
    setTimeout(() => {
        isCalibrating = false;
        if (rafId) cancelAnimationFrame(rafId);
        
        // TODO: Wasmコアからノイズ積算結果を受け取り、新たな閾値 (mu, sigma) を計算・設定
        // worker.postMessage({ type: 'finalize_calib' });
        
        document.getElementById('status-message').textContent = getMessage('statusCalibDone');
        document.getElementById('preliminary-button').disabled = false;
        document.getElementById('start-button').disabled = false;
    }, 5000);
}


/**
 * @brief 測定開始/停止ボタンのハンドラ
 */
function toggleMeasurement() {
    if (!isCoreInitialized || isCalibrating) return;

    isMeasuring = !isMeasuring;
    
    if (isMeasuring) {
        // 測定開始
        document.getElementById('start-button').textContent = getMessage('stop_button'); // ストップボタンに切り替え
        document.getElementById('status-message').textContent = getMessage('statusMeasure');
        document.getElementById('preliminary-button').disabled = true;

        // 最初のフレーム処理をスケジュール
        rafId = requestAnimationFrame(captureAndProcessFrame);
    } else {
        // 測定停止
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        document.getElementById('start-button').textContent = getMessage('startButton');
        document.getElementById('status-message').textContent = getMessage('statusComplete'); // 完了メッセージ
        document.getElementById('preliminary-button').disabled = false;
        
        // TODO: 最終結果（計数率など）をサーバに送信するロジック
    }
}

/**
 * @brief 初期化・リセットボタンのハンドラ
 */
function resetSystem() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    isMeasuring = false;
    isCalibrating = false;
    isCoreInitialized = false;

    // TODO: WasmコアのリセットAPIを呼び出す（現在のC++コードには未実装だが、initialize()を再度呼ぶなどで対応可能）
    worker.postMessage({ type: 'init', width: frameWidth, height: frameHeight, mu: NOISE_MU, sigma: NOISE_SIGMA });
    
    // UIをリセット状態に戻す
    document.getElementById('start-button').textContent = getMessage('startButton');
    document.getElementById('preliminary-button').disabled = true;
    document.getElementById('status-message').textContent = getMessage('statusReset');
}

/**
 * @brief 描画モードの変更ハンドラ
 */
function handleModeChange(event) {
    const mode = event.target.value;
    
    if (mode === 'REALTIME') {
        // 生画像モード: video要素を表示
        videoElement.style.display = 'block';
        canvasElement.style.display = 'none';
        document.getElementById('status-message').textContent = getMessage('statusDisplayModeChanged_REALTIME');
    } else {
        // 積算画像モード: canvas要素を表示
        videoElement.style.display = 'none';
        canvasElement.style.display = 'block';
        if (mode === 'GRAYSCALE') {
            document.getElementById('status-message').textContent = getMessage('statusDisplayModeChanged_GRAYSCALE');
        } else if (mode === 'COLOR') {
            document.getElementById('status-message').textContent = getMessage('statusDisplayModeChanged_COLOR');
        }
    }
}

// =========================================================================
// 6. メインエントリーポイント
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    videoElement = document.getElementById('camera-feed');
    canvasElement = document.getElementById('display-canvas');
    canvasContext = canvasElement.getContext('2d');
    
    // イベントリスナーの設定
    // ★ 新規追加: カメラ接続開始ボタンのリスナー
    document.getElementById('connect-camera-button').addEventListener('click', startSelectedCamera);

    document.getElementById('preliminary-button').addEventListener('click', startPreliminaryMeasurement);
    document.getElementById('start-button').addEventListener('click', toggleMeasurement);
    document.getElementById('reset-button').addEventListener('click', resetSystem);
    document.getElementById('lang-button').addEventListener('click', toggleLanguage);
    document.querySelectorAll('input[name="view-mode"]').forEach(radio => {
        radio.addEventListener('change', handleModeChange);
    });

    // 初期UIの更新
    updateUI();
    
    // ★ 修正: カメラの自動起動を削除し、カメラ一覧の取得（アクセス許可は求めない）のみを行う
    enumerateCameras(); 
    
    // 従来のロジック:
    /*
    setupCamera().then(() => {
        setupWorker();
        updateUI(); 
    });
    */
});