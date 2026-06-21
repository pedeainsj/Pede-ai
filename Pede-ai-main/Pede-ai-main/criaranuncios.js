// ============================================================
// PEDE AÍ - CRIAÇÃO DE ANÚNCIOS (FIREBASE FIRESTORE MODULAR)
// Mantém upload Cloudinary, preview, validações
// ============================================================

import { db } from './config.js';
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ========== TOAST ==========
function mostrarToast(mensagem, tipo = 'info') {
    const toastExistente = document.querySelector('.toast-message');
    if (toastExistente) toastExistente.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${tipo === 'erro' ? '#ea1d2c' : '#28a745'};
        color: white;
        padding: 12px 24px;
        border-radius: 30px;
        font-weight: 600;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 80%;
        text-align: center;
        font-family: 'Inter', sans-serif;
        backdrop-filter: blur(8px);
        transition: opacity 0.3s ease;
    `;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========== PREVIEW DA IMAGEM ==========
document.getElementById('fotosFile').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    if (fotosSelecionadas.length + files.length > 10) {
        mostrarToast('Máximo de 10 fotos por anúncio.', 'erro');
        return;
    }
    fotosSelecionadas.push(...files);
    atualizarGaleriaPreview();
    document.getElementById('previewPlaceholder').style.display = 'none';
});

// ========== PLANO SELECIONADO ==========
const tipoSelecionado = localStorage.getItem('pedeai_tipo_anuncio') || 'rapido';
let fotosSelecionadas = [];

function atualizarGaleriaPreview() {
    const galeria = document.getElementById('galeriaPreview');
    if (!galeria) return;
    galeria.innerHTML = '';
    fotosSelecionadas.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">
                <button class="remove-foto" data-index="${index}">&times;</button>
            `;
            galeria.appendChild(div);
            div.querySelector('.remove-foto').onclick = () => {
                fotosSelecionadas.splice(index, 1);
                atualizarGaleriaPreview();
                if (fotosSelecionadas.length === 0) {
                    document.getElementById('previewPlaceholder').style.display = 'block';
                }
            };
        };
        reader.readAsDataURL(file);
    });
}

// ========== UPLOAD PARA CLOUDINARY ==========
async function uploadParaCloudinary(file) {
    const cloudName = 'de0cvvii9';
    const uploadPreset = 'pedeairapido';

    const blob = await new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const MAX = 1200;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                const ratio = Math.min(MAX / width, MAX / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width  = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b); }, 'image/jpeg', 0.82);
        };
        img.src = url;
    });

    const formData = new FormData();
    formData.append('file', blob, 'foto.jpg');
    formData.append('upload_preset', uploadPreset);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        return data.secure_url;
    } catch (error) {
        console.error('Erro Cloudinary:', error);
        return null;
    }
}

async function uploadMultiplasImagens(files) {
    const urls = [];
    for (const file of files) {
        const url = await uploadParaCloudinary(file);
        if (url) urls.push(url);
    }
    return urls;
}

// ========== SUBMISSÃO DO FORMULÁRIO ==========
document.getElementById('formAnuncio').addEventListener('submit', async function(e) {
    e.preventDefault();

    const btn = document.getElementById('btnEnviar');

if (fotosSelecionadas.length === 0) {
    mostrarToast('Atenção: pelo menos uma foto é obrigatória.', 'erro');
    return;
}

btn.disabled = true;
btn.innerText = `Enviando ${fotosSelecionadas.length} imagem(ns)...`;
const fotosUrls = await uploadMultiplasImagens(fotosSelecionadas);

if (fotosUrls.length === 0) {
    mostrarToast('Erro no upload das imagens. Tente novamente.', 'erro');
    btn.disabled = false;
    btn.innerText = "Publicar Anúncio";
    return;
}

const novoAnuncio = {
    titulo: document.getElementById('titulo').value,
    categoria: document.getElementById('categoria').value,
    preco: parseFloat(document.getElementById('preco').value) || 0,
    whatsapp: document.getElementById('whatsapp').value,
    plano: tipoSelecionado,
    fotos: fotosUrls,
    foto: fotosUrls[0],
    descricao: document.getElementById('descricao').value,
    status: 'pendente',
    denuncias: 0,
    dataCriacao: Date.now(),
    dataExpiracao: Date.now() + (30 * 24 * 60 * 60 * 1000)
};

    try {
        await addDoc(collection(db, "anuncios"), novoAnuncio);
        window.mostrarModalSucesso();
    } catch (error) {
        console.error('Erro ao salvar no Firestore:', error);
        mostrarToast('Erro ao publicar anúncio. Tente novamente.', 'erro');
        btn.disabled = false;
        btn.innerText = "Publicar Anúncio";
    }
});