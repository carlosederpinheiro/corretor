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
    
    // --- LÓGICA GEOMÉTRICA DE CORREÇÃO ---
    // Como o usuário já alinhou manualmente o grid, sabemos exatamente onde procurar!
    // A imagem que temos no "thresh" é estritamente o bloco das bolinhas.
    let W = thresh.cols;
    let H = thresh.rows;
    
    let colW = W / 4;   // 4 colunas de questões
    let rowH = H / 15;  // 15 questões por coluna
    let optW = colW / 5; // 5 alternativas (A, B, C, D, E) por questão
    
    let options = ['A', 'B', 'C', 'D', 'E'];
    let acertos = 0;
    let gabarito = GABARITOS[currentExam];
    
    let index = 0; // Vai de 0 a 59
    
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 15; r++) {
            
            // Posição Y da questão
            let y_start = Math.floor(r * rowH);
            let y_end = Math.floor((r + 1) * rowH);
            
            let maxPixels = 0;
            let chosenOption = '?';
            
            // Analisa as 5 alternativas dessa questão
            for (let o = 0; o < 5; o++) {
                let x_start = Math.floor(c * colW + o * optW);
                let x_end = Math.floor(c * colW + (o + 1) * optW);
                
                // Pega um pequeno quadrado no centro da alternativa
                let roi = thresh.roi(new cv.Rect(x_start + 2, y_start + 2, (x_end-x_start)-4, (y_end-y_start)-4));
                
                // Conta quantos pixels brancos (que eram pretos de caneta) tem ali dentro
                let nonZero = cv.countNonZero(roi);
                
                if (nonZero > maxPixels) {
                    maxPixels = nonZero;
                    chosenOption = options[o];
                }
                roi.delete();
            }
            
            // Verifica se tem tinta suficiente para não ser só ruído da folha em branco
            if (maxPixels > 50) { 
                if (chosenOption === gabarito[index]) {
                    acertos++;
                }
            }
            index++;
        }
    }
    
    // Mostra o resultado final!
    document.getElementById('result-exam-name').innerText = `Nota do Aluno (${currentExam})`;
    document.getElementById('final-score').innerText = acertos;
    document.getElementById('result-modal').style.display = 'flex';
    
    src.delete(); gray.delete(); thresh.delete();
}
