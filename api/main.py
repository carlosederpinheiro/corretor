from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import fitz  # PyMuPDF

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GABARITOS = {
    "SIS 2": [
        "B", "D", "B", "C", "C", "B", "D", "A", "B", "E", "C", "D", "A", "D", "A",
        "C", "A", "D", "C", "D", "A", "C", "A", "E", "D", "E", "D", "A", "A", "B",
        "D", "B", "A", "B", "A", "A", "A", "A", "C", "E", "A", "D", "E", "C", "E",
        "E", "B", "C", "A", "E", "C", "C", "C", "E", "C", "C", "C", "E", "B", "E"
    ],
    "SIS 3": [
        "B", "A", "D", "B", "E", "A", "E", "D", "C", "B", "D", "A", "A", "B", "C",
        "C", "A", "E", "A", "E", "D", "A", "D", "A", "A", "A", "C", "E", "B", "C",
        "A", "D", "B", "D", "E", "A", "E", "C", "A", "B", "E", "A", "B", "E", "C",
        "E", "D", "A", "C", "D", "C", "A", "B", "D", "E", "E", "C", "B", "D", "C"
    ]
}

@app.post("/corrigir/")
async def corrigir_prova(file: UploadFile = File(...), exam: str = Form(...)):
    contents = await file.read()
    
    # 1. Processar PDF ou Imagem
    if file.filename.lower().endswith('.pdf'):
        try:
            # Abre o PDF usando PyMuPDF
            doc = fitz.open("pdf", contents)
            page = doc.load_page(0)  # Pega apenas a primeira página
            # Renderiza a página como imagem (zoom de 2x para boa resolução)
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
            img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            
            # Converte de RGB para BGR para o OpenCV
            if pix.n == 4:
                img = cv2.cvtColor(img_np, cv2.COLOR_RGBA2BGR)
            elif pix.n == 3:
                img = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
            else:
                img = cv2.cvtColor(img_np, cv2.COLOR_GRAY2BGR)
        except Exception as e:
            return {"error": f"Falha ao ler o PDF: {str(e)}"}
    else:
        # Lógica padrão para imagens (JPG, PNG)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        return {"error": "Falha ao processar o arquivo enviado."}

    max_dim = 1500
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]

    # --- LÓGICA INTELIGENTE DE BUSCA DE ÂNCORAS ---
    cnts, _ = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    
    areas = []
    candidates = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area > 50:
            x, y, w_box, h_box = cv2.boundingRect(c)
            ar = w_box / float(h_box)
            if 0.5 <= ar <= 1.5:
                areas.append(area)
                candidates.append({"cx": x + w_box/2, "cy": y + h_box/2, "area": area})
                
    if not areas:
        return {"error": "Nenhuma marcação encontrada na imagem."}
        
    median_area = np.median(areas)
    
    large_candidates = [c for c in candidates if c["area"] > median_area * 3.0]
    
    if len(large_candidates) < 4:
        return {"error": "Não encontrei as 4 âncoras. Verifique se o scanner cortou as bordas."}

    tl = min(large_candidates, key=lambda c: c["cx"] + c["cy"])
    br = max(large_candidates, key=lambda c: c["cx"] + c["cy"])
    tr = max(large_candidates, key=lambda c: c["cx"] - c["cy"])
    bl = min(large_candidates, key=lambda c: c["cx"] - c["cy"])

    # 3. Transformação de Perspectiva
    W = 1000
    H = int(W * 0.5394)
    
    src_pts = np.array([
        [tl["cx"], tl["cy"]],
        [tr["cx"], tr["cy"]],
        [br["cx"], br["cy"]],
        [bl["cx"], bl["cy"]]
    ], dtype="float32")
    
    dst_pts = np.array([
        [0, 0],
        [W, 0],
        [W, H],
        [0, H]
    ], dtype="float32")
    
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped_color = cv2.warpPerspective(img, M, (W, H))
    
    warped_gray = cv2.cvtColor(warped_color, cv2.COLOR_BGR2GRAY)
    warped_thresh = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]

    # 4. Aplicar o DNA Matemático
    colBounds = [
        {"start": 0.076, "end": 0.238},
        {"start": 0.317, "end": 0.478},
        {"start": 0.559, "end": 0.720},
        {"start": 0.800, "end": 0.962}
    ]
    yStartPercent = 0.076
    yEndPercent = 0.942
    totalGridH = (yEndPercent - yStartPercent) * H
    rowH = totalGridH / 15.0

    options = ['A', 'B', 'C', 'D', 'E']
    acertos = 0
    gabarito = GABARITOS.get(exam, GABARITOS["SIS 2"])
    index = 0

    for c in range(4):
        bounds = colBounds[c]
        colStartX = int(bounds["start"] * W)
        colW = int((bounds["end"] - bounds["start"]) * W)
        optW = int(colW / 5)
        
        for r in range(15):
            y_start = int((yStartPercent * H) + (r * rowH))
            y_end = int((yStartPercent * H) + ((r + 1) * rowH))
            
            maxPixels = 0
            chosenOptionIndex = -1
            optionCoords = []
            
            for o in range(5):
                x_start = colStartX + o * optW
                x_end = colStartX + (o + 1) * optW
                optionCoords.append((x_start, y_start, x_end, y_end))
                
                roi = warped_thresh[y_start+4:y_end-4, x_start+4:x_end-4]
                nonZero = cv2.countNonZero(roi)
                
                if nonZero > maxPixels:
                    maxPixels = nonZero
                    chosenOptionIndex = o

            area_quadradinho = (y_end - y_start - 8) * (x_end - x_start - 8)
            if maxPixels > (area_quadradinho * 0.15):
                if options[chosenOptionIndex] == gabarito[index]:
                    acertos += 1
            else:
                chosenOptionIndex = -1

            for o in range(5):
                color = (0, 255, 0) if o == chosenOptionIndex else (0, 0, 255)
                x1, y1, x2, y2 = optionCoords[o]
                cv2.rectangle(warped_color, (x1, y1), (x2, y2), color, 2)
            
            index += 1

    _, buffer = cv2.imencode('.jpg', warped_color)
    img_b64 = base64.b64encode(buffer).decode('utf-8')

    return {
        "score": acertos,
        "debug_image": f"data:image/jpeg;base64,{img_b64}"
    }
