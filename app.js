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
    document.getElementById('scan-subinstruction').innerText = "CORRIGINDO...";
    
    // Usamos um pequeno atraso pra dar tempo da UI atualizar antes de travar processando a imagem
    setTimeout(() => {
        processCapture();
    }, 50);
});

function processCapture() {
    // Igualar o canvas ao tamanho exato da tela do celular
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Desenhar o vídeo imitando o "object-fit: cover" do CSS
    let videoRatio = video.videoWidth / video.videoHeight;
    let screenRatio = canvas.width / canvas.height;
    
    let drawW, drawH, drawX, drawY;
    if (screenRatio > videoRatio) {
        drawW = canvas.width;
        drawH = canvas.width / videoRatio;
        drawX = 0;
        drawY = (canvas.height - drawH) / 2;
    } else {
        drawH = canvas.height;
        drawW = canvas.height * videoRatio;
        drawX = (canvas.width - drawW) / 2;
        drawY = 0;
    }
    
    ctx.drawImage(video, drawX, drawY, drawW, drawH);
    
    // Agora pegamos só a parte da imagem que está DENTRO do recorte das âncoras!
    let cutout = document.getElementById('cutout');
    let rect = cutout.getBoundingClientRect();
    
    // Pega os pixels puros do recorte
    let imageData = ctx.getImageData(rect.left, rect.top, rect.width, rect.height);
    
    // Manda pro OpenCV processar
    let src = cv.matFromImageData(imageData);
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    
    // Binariza: Deixa só o que está preenchido
    let thresh = new cv.Mat();
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    
    // --- LÓGICA GEOMÉTRICA DE CORREÇÃO COM DEBUG VISUAL ---
    let W = thresh.cols;
    let H = thresh.rows;
    
    // Os limites exatos de cada coluna no eixo X (em porcentagem da largura total)
    let colBounds = [
        { start: 0.076, end: 0.238 },
        { start: 0.317, end: 0.478 },
        { start: 0.559, end: 0.720 },
        { start: 0.800, end: 0.962 }
    ];
    
    // Os limites exatos do bloco de questões no eixo Y (em porcentagem da altura total)
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
                
                // Recorta o quadradinho da alternativa
                let roi = thresh.roi(new cv.Rect(x_start, y_start, x_end-x_start, y_end-y_start));
                let nonZero = cv.countNonZero(roi);
                
                if (nonZero > maxPixels) {
                    maxPixels = nonZero;
                    chosenOptionIndex = o;
                }
                roi.delete();
            }
            
            // Verifica se está preenchida
            if (maxPixels > 40) { 
                if (options[chosenOptionIndex] === gabarito[index]) {
                    acertos++;
                }
            } else {
                chosenOptionIndex = -1; // Nenhuma marcada
            }

            // --- DESENHO DO DEBUG VISUAL ---
            for (let o = 0; o < 5; o++) {
                let color = (o === chosenOptionIndex) ? [0, 255, 0, 255] : [255, 0, 0, 255]; 
                let coords = optionCoords[o];
                cv.rectangle(src, new cv.Point(coords.x1, coords.y1), new cv.Point(coords.x2, coords.y2), color, 2);
            }
            
            index++;
        }
    }
    
    // Exibe o desenho de debug no canvas escondido
    cv.imshow('debug-canvas', src);
    
    document.getElementById('result-exam-name').innerText = `Nota do Aluno (${currentExam})`;
    document.getElementById('final-score').innerText = acertos;
    document.getElementById('result-modal').style.display = 'flex';
    
    src.delete(); gray.delete(); thresh.delete();
}

// Funções para gerenciar o modo de Debug Visual
function showDebugCanvas() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('debug-canvas').style.display = 'block';
    
    // Tocar no debug canvas faz ele sumir e voltar pra câmera
    document.getElementById('debug-canvas').onclick = resetScanner;
}

function resetScanner() {
    document.getElementById('result-modal').style.display = 'none';
    document.getElementById('debug-canvas').style.display = 'none';
    document.getElementById('scan-subinstruction').innerText = "TOQUE NA TELA PARA FOTOGRAFAR";
}
