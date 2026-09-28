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

let currentExam = 'SIS 2';
let video = document.getElementById('video-feed');
let canvasOutput = document.getElementById('output-canvas');
let ctx = canvasOutput.getContext('2d');
let statusMsg = document.getElementById('status-msg');
let loadingOverlay = document.getElementById('loading');

// Configuração dos botões
document.getElementById('btn-sis2').addEventListener('click', (e) => {
    currentExam = 'SIS 2';
    e.target.classList.add('active');
    document.getElementById('btn-sis3').classList.remove('active');
});

document.getElementById('btn-sis3').addEventListener('click', (e) => {
    currentExam = 'SIS 3';
    e.target.classList.add('active');
    document.getElementById('btn-sis2').classList.remove('active');
});

function onOpenCvReady() {
    cv['onRuntimeInitialized'] = () => {
        loadingOverlay.style.display = 'none';
        statusMsg.innerText = "Pronto! Aponte para a folha e tire a foto.";
        startCamera();
    };
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        video.srcObject = stream;
        video.play();
    } catch (err) {
        console.error(err);
        statusMsg.innerText = "Erro: Dê permissão para a câmera!";
    }
}

// Ordenar pontos do retângulo para a transformação de perspectiva
// Ordem esperada: Top-Left, Top-Right, Bottom-Right, Bottom-Left
function orderPoints(pts) {
    let rect = new cv.Mat(4, 1, cv.CV_32FC2);
    let ptsData = pts.data32S;
    
    // Converte os pontos para array de objetos pra facilitar o cálculo
    let pointsArray = [];
    for(let i=0; i<4; i++){
        pointsArray.push({x: ptsData[i*2], y: ptsData[i*2 + 1]});
    }

    // Soma (x + y) -> Top-Left tem a menor soma, Bottom-Right tem a maior
    let sums = pointsArray.map(p => p.x + p.y);
    let tl = pointsArray[sums.indexOf(Math.min(...sums))];
    let br = pointsArray[sums.indexOf(Math.max(...sums))];

    // Diferença (x - y) -> Top-Right tem a maior diff, Bottom-Left tem a menor
    let diffs = pointsArray.map(p => p.x - p.y);
    let tr = pointsArray[diffs.indexOf(Math.max(...diffs))];
    let bl = pointsArray[diffs.indexOf(Math.min(...diffs))];

    // Popula o rect na ordem certa (x, y)
    rect.data32F.set([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    return rect;
}

document.getElementById('btn-capture').addEventListener('click', () => {
    statusMsg.innerText = `Analisando gabarito...`;
    
    canvasOutput.width = video.videoWidth;
    canvasOutput.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
    
    let src = cv.imread(canvasOutput);
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    
    // Borrar e achar bordas
    let blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    let edged = new cv.Mat();
    cv.Canny(blurred, edged, 75, 200);

    // Encontrar contornos
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let docContour = null;

    // Procurar o maior contorno com 4 pontas (a folha de papel)
    for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        
        if (area > 50000) { // Ignorar lixos pequenos
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                if (docContour != null) docContour.delete();
                docContour = approx.clone();
            }
            approx.delete();
        }
    }

    if (docContour != null) {
        // Encontrou a folha! Vamos alinhar.
        let orderedPts = orderPoints(docContour);
        
        // Tamanho alvo do gabarito (A4 padrão proporção)
        let maxWidth = 800;
        let maxHeight = 1130;
        
        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, 
            maxWidth - 1, 0, 
            maxWidth - 1, maxHeight - 1, 
            0, maxHeight - 1
        ]);
        
        // Transforma a perspectiva
        let M = cv.getPerspectiveTransform(orderedPts, dstPts);
        let warped = new cv.Mat();
        let dsize = new cv.Size(maxWidth, maxHeight);
        cv.warpPerspective(src, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        
        // Mostra o resultado do alinhamento pra gente ver se funcionou
        cv.imshow('output-canvas', warped);
        statusMsg.innerText = `Folha alinhada! (Clique para voltar)`;
        
        orderedPts.delete(); dstPts.delete(); M.delete(); warped.delete();
        docContour.delete();
    } else {
        // Não achou, exibe a imagem com filtro de borda pra debug
        cv.imshow('output-canvas', edged);
        statusMsg.innerText = `Erro: Folha não encontrada. Tente um fundo mais escuro!`;
    }

    canvasOutput.style.display = 'block';
    video.style.display = 'none';

    // Limpeza de memória
    src.delete(); gray.delete(); blurred.delete(); edged.delete();
    contours.delete(); hierarchy.delete();
});

// Volta para câmera
canvasOutput.addEventListener('click', () => {
    canvasOutput.style.display = 'none';
    video.style.display = 'block';
    statusMsg.innerText = "Aponte para o próximo gabarito.";
});
