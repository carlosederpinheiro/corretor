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

// Ordenar pontos do retângulo (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
function orderPoints(pts) {
    let rect = new cv.Mat(4, 1, cv.CV_32FC2);
    let ptsData = pts.data32S;
    
    let pointsArray = [];
    for(let i=0; i<4; i++){
        pointsArray.push({x: ptsData[i*2], y: ptsData[i*2 + 1]});
    }

    let sums = pointsArray.map(p => p.x + p.y);
    let tl = pointsArray[sums.indexOf(Math.min(...sums))];
    let br = pointsArray[sums.indexOf(Math.max(...sums))];

    let diffs = pointsArray.map(p => p.x - p.y);
    let tr = pointsArray[diffs.indexOf(Math.max(...diffs))];
    let bl = pointsArray[diffs.indexOf(Math.min(...diffs))];

    rect.data32F.set([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
    return rect;
}

document.getElementById('btn-capture').addEventListener('click', () => {
    statusMsg.innerText = `Analisando gabarito...`;
    
    canvasOutput.width = video.videoWidth;
    canvasOutput.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvasOutput.width, canvasOutput.height);
    
    let src = cv.imread(canvasOutput);
    
    // REDIMENSIONAMENTO: fundamental para celulares com câmera 4K
    let maxH = 800;
    let ratio = src.rows / maxH;
    let newW = Math.round(src.cols / ratio);
    
    let resized = new cv.Mat();
    cv.resize(src, resized, new cv.Size(newW, maxH), 0, 0, cv.INTER_AREA);
    
    let gray = new cv.Mat();
    cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY, 0);
    
    // BLUR BILATERAL: melhor que o Gaussiano porque preserva bordas fortes e elimina texturas (ruídos)
    let blurred = new cv.Mat();
    cv.bilateralFilter(gray, blurred, 9, 75, 75);
    
    // CANNY com limiares mais soltos
    let edged = new cv.Mat();
    cv.Canny(blurred, edged, 30, 100);

    // DILATAÇÃO: fecha buracos nas bordas (caso a linha do papel não esteja contínua por causa de luz)
    let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edged, edged, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Listar e ordenar contornos pelo tamanho
    let cntsList = [];
    for (let i = 0; i < contours.size(); i++) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area > 10000) { // Área mínima bem menor agora
            cntsList.push({cnt: cnt, area: area});
        }
    }
    cntsList.sort((a, b) => b.area - a.area);

    let docContour = null;

    // Tentativa robusta de achar a folha
    for (let i = 0; i < cntsList.length; i++) {
        let c = cntsList[i].cnt;
        let peri = cv.arcLength(c, true);
        
        // Tenta várias tolerâncias (0.02 a 0.05). Às vezes a folha tá meio curvada.
        for (let eps of [0.02, 0.03, 0.04, 0.05]) {
            let approx = new cv.Mat();
            cv.approxPolyDP(c, approx, eps * peri, true);
            
            if (approx.rows === 4) {
                docContour = approx.clone();
                approx.delete();
                break;
            }
            approx.delete();
        }
        if (docContour != null) break;
    }

    if (docContour != null) {
        // Encontrou a folha! Alinha usando o ratio pra voltar ao tamanho original do celular
        let orderedPts = orderPoints(docContour);
        
        // Múltiplicar os pontos pelo ratio
        let ptsArray = orderedPts.data32F;
        for(let i=0; i<8; i++) {
            ptsArray[i] = ptsArray[i] * ratio;
        }
        
        let maxWidth = 800;
        let maxHeight = 1130;
        
        let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0, 
            maxWidth - 1, 0, 
            maxWidth - 1, maxHeight - 1, 
            0, maxHeight - 1
        ]);
        
        let M = cv.getPerspectiveTransform(orderedPts, dstPts);
        let warped = new cv.Mat();
        let dsize = new cv.Size(maxWidth, maxHeight);
        cv.warpPerspective(src, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        
        cv.imshow('output-canvas', warped);
        statusMsg.innerText = `Folha alinhada! (Clique para voltar)`;
        
        orderedPts.delete(); dstPts.delete(); M.delete(); warped.delete();
        docContour.delete();
    } else {
        cv.imshow('output-canvas', edged);
        statusMsg.innerText = `Erro: Folha não achada (mostrando bordas detectadas).`;
    }

    canvasOutput.style.display = 'block';
    video.style.display = 'none';

    src.delete(); resized.delete(); gray.delete(); blurred.delete(); edged.delete(); kernel.delete();
    contours.delete(); hierarchy.delete();
});

canvasOutput.addEventListener('click', () => {
    canvasOutput.style.display = 'none';
    video.style.display = 'block';
    statusMsg.innerText = "Aponte para o próximo gabarito.";
});
