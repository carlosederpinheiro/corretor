// Gabaritos oficiais fornecidos
const GABARITOS = {
    'SIS 2': [
        'B','D','B','C','C','B','D','A','B','E','C','D','A','D','A','C','A','D','C','D',
        'A','C','A','E','D','E','D','A','A','B','D','B','A','B','A','A','A','A','C','E',
        'A','D','E','C','E','E','B','C','A','E','C','C','C','E','C','C','C','E','B','E'
    ],
    'SIS 3': [
        'B','A','D','B','E','A','E','D','C','B','D','A','A','B','C','C','A','E','A','E',
        'D','A','D','A','A','A','C','E','B','C','A','D','B','D','E','A','E','C','A','B',
        'E','A','B','E','C','E','D','A','C','D','C','A','B','D','E','E','C','B','D','C'
    ]
};

let currentExam = '';
let stream = null;
let video = document.getElementById('video-feed');
let canvas = document.getElementById('capture-canvas');
let ctx = canvas.getContext('2d');

function onOpenCvReady() {
    cv['onRuntimeInitialized'] = () => {
        document.getElementById('loading').style.display = 'none';
        setupMask();
        window.addEventListener('resize', setupMask);
    };
}

// Configura o buraco da máscara e os 4 painéis escuros ao redor
function setupMask() {
    let screenW = window.innerWidth;
    let screenH = window.innerHeight;
    
    // O recorte vai ocupar 90% da largura da tela no celular
    let cutoutW = screenW * 0.9;
    // Baseado na nossa análise do PDF, as âncoras formam um retângulo horizontal (ratio H/W = 0.54)
    let cutoutH = cutoutW * 0.54; 
    
    // Se a altura passar da tela (raro, já que é horizontal), ajusta
    if (cutoutH > screenH * 0.8) {
        cutoutH = screenH * 0.8;
        cutoutW = cutoutH / 0.54;
    }
    
    let cutoutX = (screenW - cutoutW) / 2;
    let cutoutY = (screenH - cutoutH) / 2;
    
    let cutout = document.getElementById('cutout');
    cutout.style.width = cutoutW + 'px';
    cutout.style.height = cutoutH + 'px';
    cutout.style.left = cutoutX + 'px';
    cutout.style.top = cutoutY + 'px';
    
    document.getElementById('mask-top').style.height = cutoutY + 'px';
    document.getElementById('mask-bottom').style.height = (screenH - (cutoutY + cutoutH)) + 'px';
    document.getElementById('mask-left').style.width = cutoutX + 'px';
    document.getElementById('mask-left').style.top = cutoutY + 'px';
    document.getElementById('mask-left').style.height = cutoutH + 'px';
    document.getElementById('mask-right').style.width = (screenW - (cutoutX + cutoutW)) + 'px';
    document.getElementById('mask-right').style.top = cutoutY + 'px';
    document.getElementById('mask-right').style.height = cutoutH + 'px';
}

async function openScanner(examName) {
    currentExam = examName;
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('scanner-screen').style.display = 'block';
    document.getElementById('scan-instruction').innerText = `Alinhe as âncoras do ${examName}`;
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        video.srcObject = stream;
        video.play();
    } catch (err) {
        alert("Erro: Precisamos de permissão da câmera!");
        closeScanner();
    }
}

function closeScanner() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    document.getElementById('scanner-screen').style.display = 'none';
    document.getElementById('home-screen').style.display = 'flex';
}

function resetScanner() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('scan-subinstruction').innerText = "TOQUE NA TELA PARA FOTOGRAFAR";
}

// CAPTURA POR TOQUE NA TELA
document.getElementById('touch-area').addEventListener('click', () => {
    // 1. Tira a foto e vai pra tela de revisão
    document.getElementById('scanner-screen').style.display = 'none';
    document.getElementById('review-screen').style.display = 'flex';
    
    // Captura o vídeo em resolução total para o review-canvas
    let reviewCanvas = document.getElementById('review-canvas');
    let rCtx = reviewCanvas.getContext('2d');
    
    // Define o tamanho real da foto (baseado no vídeo)
    reviewCanvas.width = video.videoWidth;
    reviewCanvas.height = video.videoHeight;
    rCtx.drawImage(video, 0, 0, reviewCanvas.width, reviewCanvas.height);
    
    // Posiciona as âncoras inicialmente no local do 'cutout'
    // Como a tela de revisão redimensiona o canvas com object-fit: contain, 
    // precisamos calcular as posições relativas.
    setupHandles();
});

let handles = [
    {id: 'handle-tl', x: 0.1, y: 0.1},
    {id: 'handle-tr', x: 0.9, y: 0.1},
    {id: 'handle-br', x: 0.9, y: 0.9},
    {id: 'handle-bl', x: 0.1, y: 0.9}
];
let activeHandle = null;

function setupHandles() {
    let container = document.getElementById('review-canvas-container');
    let cw = container.clientWidth;
    let ch = container.clientHeight;
    
    // Calcula o tamanho real do canvas na tela (devido ao object-fit: contain)
    let videoRatio = video.videoWidth / video.videoHeight;
    let containerRatio = cw / ch;
    
    let renderedW, renderedH;
    if (containerRatio > videoRatio) {
        renderedH = ch;
        renderedW = ch * videoRatio;
    } else {
        renderedW = cw;
        renderedH = cw / videoRatio;
    }
    
    let offsetX = (cw - renderedW) / 2;
    let offsetY = (ch - renderedH) / 2;
    
    // Inicia os handles mais ou menos no formato de uma folha paisagem no centro
    handles[0].x = offsetX + renderedW * 0.1; handles[0].y = offsetY + renderedH * 0.2;
    handles[1].x = offsetX + renderedW * 0.9; handles[1].y = offsetY + renderedH * 0.2;
    handles[2].x = offsetX + renderedW * 0.9; handles[2].y = offsetY + renderedH * 0.8;
    handles[3].x = offsetX + renderedW * 0.1; handles[3].y = offsetY + renderedH * 0.8;
    
    updateHandlesUI();
}

function updateHandlesUI() {
    let polygon = document.getElementById('crop-polygon');
    let points = "";
    
    for (let h of handles) {
        let el = document.getElementById(h.id);
        el.style.left = h.x + 'px';
        el.style.top = h.y + 'px';
        points += `${h.x},${h.y} `;
    }
    polygon.setAttribute('points', points.trim());
}

// Lógica de arrastar (Drag & Drop para mobile)
function handleTouchStart(e) {
    if (e.target.classList.contains('drag-handle')) {
        activeHandle = handles.find(h => h.id === e.target.id);
    }
}
function handleTouchMove(e) {
    if (!activeHandle) return;
    e.preventDefault();
    let touch = e.touches ? e.touches[0] : e;
    let container = document.getElementById('review-canvas-container').getBoundingClientRect();
    
    let nx = touch.clientX - container.left;
    let ny = touch.clientY - container.top;
    
    // Limita dentro do container
    activeHandle.x = Math.max(0, Math.min(nx, container.width));
    activeHandle.y = Math.max(0, Math.min(ny, container.height));
    
    updateHandlesUI();
}
function handleTouchEnd() {
    activeHandle = null;
}

let container = document.getElementById('review-canvas-container');
container.addEventListener('touchstart', handleTouchStart, {passive: false});
container.addEventListener('touchmove', handleTouchMove, {passive: false});
container.addEventListener('touchend', handleTouchEnd);
container.addEventListener('mousedown', handleTouchStart);
window.addEventListener('mousemove', handleTouchMove);
window.addEventListener('mouseup', handleTouchEnd);

function processWarp() {
    // 1. Pega os pontos do UI e mapeia para a resolução original do vídeo/imagem
    let reviewCanvas = document.getElementById('review-canvas');
    let src = cv.imread(reviewCanvas);
    
    let container = document.getElementById('review-canvas-container');
    let cw = container.clientWidth;
    let ch = container.clientHeight;
    
    let videoRatio = src.cols / src.rows;
    let containerRatio = cw / ch;
    
    let renderedW, renderedH;
    if (containerRatio > videoRatio) {
        renderedH = ch;
        renderedW = ch * videoRatio;
    } else {
        renderedW = cw;
        renderedH = cw / videoRatio;
    }
    
    let offsetX = (cw - renderedW) / 2;
    let offsetY = (ch - renderedH) / 2;
    
    // Converte de pixels da tela para pixels da imagem real
    let pts = [];
    for (let h of handles) {
        let realX = ((h.x - offsetX) / renderedW) * src.cols;
        let realY = ((h.y - offsetY) / renderedH) * src.rows;
        pts.push({x: realX, y: realY});
    }
    
    // Ordena os pontos garantindo que: 0=TL, 1=TR, 2=BR, 3=BL
    // O UI já está nessa ordem na array handles, então usamos direto!
    
    // --- 2. TRANSFORMAÇÃO DE PERSPECTIVA (WARP) ---
    // Largura padronizada para a nossa correção
    let W = 1000;
    // O DNA matemático provou que a proporção das âncoras é 0.5394
    let H = Math.round(W * 0.5394);
    
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        pts[0].x, pts[0].y, // TL
        pts[1].x, pts[1].y, // TR
        pts[2].x, pts[2].y, // BR
        pts[3].x, pts[3].y  // BL
    ]);
    
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        W, 0,
        W, H,
        0, H
    ]);
    
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let warpedColor = new cv.Mat();
    let dsize = new cv.Size(W, H);
    
    cv.warpPerspective(src, warpedColor, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    
    // Binariza a imagem desamassada
    let gray = new cv.Mat();
    cv.cvtColor(warpedColor, gray, cv.COLOR_RGBA2GRAY, 0);
    let thresh = new cv.Mat();
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    
    // --- 3. APLICAÇÃO DO DNA MATEMÁTICO NA IMAGEM PERFEITAMENTE PLANA ---
    let colBounds = [
        { start: 0.076, end: 0.238 },
        { start: 0.317, end: 0.478 },
        { start: 0.559, end: 0.720 },
        { start: 0.800, end: 0.962 }
    ];
    let yStartPercent = 0.076;
    let yEndPercent = 0.942;
    let totalGridH = (yEndPercent - yStartPercent) * H;
    let rowH = totalGridH / 15;
    
    let options = ['A', 'B', 'C', 'D', 'E'];
    let acertos = 0;
    let gabarito = GABARITOS[currentExam];
    let index = 0;
    
    for (let c = 0; c < 4; c++) {
        let bounds = colBounds[c];
        let colStartX = Math.floor(bounds.start * W);
        let colW = Math.floor((bounds.end - bounds.start) * W);
        let optW = Math.floor(colW / 5);
        
        for (let r = 0; r < 15; r++) {
            let y_start = Math.floor((yStartPercent * H) + (r * rowH));
            let y_end = Math.floor((yStartPercent * H) + ((r + 1) * rowH));
            
            let maxPixels = 0;
            let chosenOptionIndex = -1;
            let optionCoords = [];
            
            for (let o = 0; o < 5; o++) {
                let x_start = colStartX + o * optW;
                let x_end = colStartX + (o + 1) * optW;
                optionCoords.push({x1: x_start, x2: x_end, y1: y_start, y2: y_end});
                
                // Diminui um pouco o tamanho do retângulo de leitura para evitar pegar a borda da bolinha
                let roi = thresh.roi(new cv.Rect(x_start + 4, y_start + 4, (x_end-x_start)-8, (y_end-y_start)-8));
                let nonZero = cv.countNonZero(roi);
                
                if (nonZero > maxPixels) {
                    maxPixels = nonZero;
                    chosenOptionIndex = o;
                }
                roi.delete();
            }
            
            if (maxPixels > (optW * 0.15)) { // 15% de preenchimento mínimo
                if (options[chosenOptionIndex] === gabarito[index]) {
                    acertos++;
                }
            } else {
                chosenOptionIndex = -1;
            }

            for (let o = 0; o < 5; o++) {
                let color = (o === chosenOptionIndex) ? [0, 255, 0, 255] : [255, 0, 0, 255]; 
                let coords = optionCoords[o];
                cv.rectangle(warpedColor, new cv.Point(coords.x1, coords.y1), new cv.Point(coords.x2, coords.y2), color, 2);
            }
            index++;
        }
    }
    
    cv.imshow('debug-canvas', warpedColor);
    
    document.getElementById('result-exam-name').innerText = `Nota do Aluno (${currentExam})`;
    document.getElementById('final-score').innerText = acertos;
    document.getElementById('result-modal').style.display = 'flex';
    
    src.delete(); gray.delete(); thresh.delete();
    srcTri.delete(); dstTri.delete(); M.delete(); warpedColor.delete();
}

function showDebugCanvas() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('debug-canvas').style.display = 'block';
    document.getElementById('debug-canvas').onclick = resetScanner;
}

function resetScanner() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('debug-canvas').style.display = 'none';
    document.getElementById('review-screen').style.display = 'none';
    document.getElementById('scanner-screen').style.display = 'block';
    
    // Se o vídeo parou, reinicia
    if (video.paused) {
        video.play();
    }
}
