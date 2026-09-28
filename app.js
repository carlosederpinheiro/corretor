let currentExam = "";
// URL da API que hospedaremos no Render.com
// Substitua por algo como "https://seu-app.onrender.com/corrigir/" quando estiver no ar
const API_URL = "https://corretor-api-yaa5.onrender.com/corrigir/"; 

const cameraInput = document.getElementById('camera-input');

function startCapture(examName) {
    currentExam = examName;
    cameraInput.click(); // Abre a câmera nativa do celular imediatamente
}

cameraInput.addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    let file = e.target.files[0];
    
    document.getElementById('home-screen').style.display = 'none';
    document.getElementById('loading-screen').style.display = 'flex';
    
    let formData = new FormData();
    formData.append("file", file);
    formData.append("exam", currentExam);
    
    try {
        let response = await fetch(API_URL, {
            method: 'POST',
            body: formData
        });
        
        let data = await response.json();
        
        document.getElementById('loading-screen').style.display = 'none';
        
        if (data.error) {
            alert(data.error);
            resetApp();
        } else {
            document.getElementById('final-score').innerText = data.score;
            document.getElementById('debug-image').src = data.debug_image;
            document.getElementById('result-screen').style.display = 'block';
        }
    } catch (err) {
        document.getElementById('loading-screen').style.display = 'none';
        alert("Erro ao conectar com a API: " + err.message);
        resetApp();
    }
});

function resetApp() {
    cameraInput.value = "";
    document.getElementById('result-screen').style.display = 'none';
    document.getElementById('home-screen').style.display = 'block';
}
