// js/painel-lojista.js
import { db, GetRegrasLojista, CONFIG_SISTEMA, APP_URL } from './config.js'; 
import { collection, addDoc, getDocs, getDoc, query, where, deleteDoc, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlCache = new Map();
function otimizarURL(url, width = 400) {
    if (!url || typeof url !== 'string') return url;
    if (!url.includes('cloudinary.com')) return url;
    const key = `${url}|${width}`;
    if (urlCache.has(key)) return urlCache.get(key);
    const optimized = url.replace(/\/upload\/(.*?)(\/v\d+\/)/, `/upload/f_auto,q_auto:eco,w_${width},c_limit$2`);
    urlCache.set(key, optimized);
    return optimized;
}

function otimizarVideoURL(url) {
    if (!url || typeof url !== 'string' || !url.includes('cloudinary.com/video/upload')) return url;
    if (url.includes('f_auto') || url.includes('q_auto')) return url;
    return url.replace('/video/upload/', '/video/upload/f_auto,q_auto:low,vc_auto/');
}

// VERIFICA LOGIN
const userId = localStorage.getItem('userId');

if (!userId) {
    setTimeout(() => {
        window.location.replace('index.html');
    }, 100);
}

let userData = null;
let categoriaFixaPlanoBasico = null;
let contextoAtual = 'Geral'; // Contexto padrão
// ============================================================
// LIMITE DE VÍDEOS POR PERFIL (validação cirúrgica)
// ============================================================
async function contarVideosDoLojista() {
    try {
        const q = query(collection(db, "produtos"), where("owner", "==", userId));
        const snap = await getDocs(q);
        let videosCount = 0;
        snap.forEach(doc => {
            const data = doc.data();
            if (data.videoUrl && data.videoUrl.trim() !== "") videosCount++;
        });
        return videosCount;
    } catch (e) {
        console.warn("Erro ao contar vídeos:", e);
        return 0; // fallback seguro – permite publicação se houver erro na contagem
    }
}

async function verificarLimiteVideo() {
    if (!userData) return { permitido: true, atual: 0, limite: 999 };
    const plano = userData.planoAtivo || "basico";
    const limite = CONFIG_SISTEMA?.planos?.[plano]?.limiteVideos ?? 2;
    const atual = await contarVideosDoLojista();
    return { permitido: atual < limite, atual, limite };
}

window.abrirModalLimiteVideo = () => {
    let modal = document.getElementById('modalLimiteVideo');
    if (!modal) {
        const modalHTML = `
        <div id="modalLimiteVideo" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:2000; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;">
            <div style="background:white; padding:30px; border-radius:15px; max-width:400px; width:100%; text-align:center; position:relative; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                <button onclick="fecharModalLimiteVideo()" style="position:absolute; top:10px; right:15px; background:none; border:none; font-size:24px; cursor:pointer; color:#999;">&times;</button>
                <i class="fa-solid fa-video" style="font-size:50px; color:#ee4d2d; margin-bottom:15px;"></i>
                <h3 style="margin:0 0 10px; color:#333;">Recursos de mídia utilizados</h3>
                <p style="font-size:14px; color:#666; line-height:1.5; margin-bottom:20px;">No momento este perfil já está utilizando todos os recursos de vídeo disponíveis para esta configuração de conta.<br><br>Para mais informações sobre recursos disponíveis e utilização da plataforma, fale com nossa equipe.</p>
                <a href="javascript:void(0)" onclick="window.abrirSuporteDinamico(); fecharModalLimiteVideo();" style="display:block; margin-top:10px; padding:12px 25px; background:#25d366; color:white; text-decoration:none; border-radius:8px; font-weight:bold; width:100%; box-sizing:border-box;">
                    Falar com suporte
                </a>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('modalLimiteVideo');
    }
    modal.style.display = 'flex';
};

window.fecharModalLimiteVideo = () => {
    const modal = document.getElementById('modalLimiteVideo');
    if (modal) modal.style.display = 'none';
};

// ============================================================
// SISTEMA DE MODAIS SUBSTITUINDO ALERT/CONFIRM/ PROMPT
// ============================================================

// Toast simples para mensagens curtas (sucesso/erro/info)
function mostrarToast(mensagem, tipo = 'info') {
    const toastId = 'globalToast';
    let toast = document.getElementById(toastId);
    if (!toast) {
        toast = document.createElement('div');
        toast.id = toastId;
        toast.style.cssText = `
            position: fixed; bottom: 30px; left: 20px; right: 20px;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
            color: white; text-align: center; padding: 14px 20px;
            border-radius: 50px; font-size: 14px; font-weight: 500;
            z-index: 100000; transform: translateY(100px);
            transition: transform 0.25s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);
    }
    // Ícone opcional
    let prefixo = '';
    if (tipo === 'sucesso') prefixo = '✅ ';
    else if (tipo === 'erro') prefixo = '⚠️ ';
    toast.innerText = prefixo + mensagem;
    toast.style.transform = 'translateY(0px)';
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
    }, 3000);
}

// Modal de confirmação (sim/não) reutilizável
let confirmCallback = null;
function mostrarConfirmacao(mensagem, aoConfirmar, aoCancelar = null) {
    let modal = document.getElementById('confirmacaoGlobalModal');
    if (!modal) {
        const modalHTML = `
        <div id="confirmacaoGlobalModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:30000; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;">
            <div style="background:white; border-radius:20px; padding:24px; max-width:320px; width:100%; text-align:center; position:relative; box-shadow:0 16px 40px rgba(0,0,0,0.2);">
                <i class="fas fa-question-circle" style="font-size:40px; color:#ee4d2d; margin-bottom:10px;"></i>
                <p id="confirmMsg" style="margin:10px 0 20px; font-size:16px; color:#333; line-height:1.4;"></p>
                <div style="display:flex; gap:12px;">
                    <button id="confirmSim" style="flex:1; background:#ee4d2d; color:white; border:none; padding:12px; border-radius:10px; font-weight:bold; cursor:pointer;">Sim</button>
                    <button id="confirmNao" style="flex:1; background:#e0e0e0; color:#333; border:none; padding:12px; border-radius:10px; font-weight:bold; cursor:pointer;">Não</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('confirmacaoGlobalModal');
        document.getElementById('confirmSim').onclick = () => {
            modal.style.display = 'none';
            if (confirmCallback) confirmCallback(true);
            confirmCallback = null;
        };
        document.getElementById('confirmNao').onclick = () => {
            modal.style.display = 'none';
            if (confirmCallback) confirmCallback(false);
            confirmCallback = null;
        };
    }
    document.getElementById('confirmMsg').innerText = mensagem;
    confirmCallback = (resp) => {
        if (resp) aoConfirmar();
        else if (aoCancelar) aoCancelar();
    };
    modal.style.display = 'flex';
}

// Função para substituir prompt (senha) - reaproveita modal de alterar senha? Mas para reset admin, usaremos modal customizado simples
function mostrarPrompt(mensagem, placeholder, callback) {
    let modal = document.getElementById('promptGlobalModal');
    if (!modal) {
        const promptHTML = `
        <div id="promptGlobalModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:30000; align-items:center; justify-content:center; padding:20px; box-sizing:border-box;">
            <div style="background:white; border-radius:20px; padding:24px; max-width:320px; width:100%; text-align:center;">
                <p id="promptMsg" style="margin:0 0 15px; font-size:16px; color:#333;"></p>
                <input type="text" id="promptInput" placeholder="${placeholder}" style="width:100%; padding:12px; border:1px solid #ddd; border-radius:8px; margin-bottom:20px; font-size:14px;">
                <div style="display:flex; gap:12px;">
                    <button id="promptOk" style="flex:1; background:#ee4d2d; color:white; border:none; padding:12px; border-radius:10px; font-weight:bold;">OK</button>
                    <button id="promptCancel" style="flex:1; background:#e0e0e0; color:#333; border:none; padding:12px; border-radius:10px;">Cancelar</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', promptHTML);
        modal = document.getElementById('promptGlobalModal');
        document.getElementById('promptOk').onclick = () => {
            const valor = document.getElementById('promptInput').value;
            modal.style.display = 'none';
            if (callback) callback(valor);
        };
        document.getElementById('promptCancel').onclick = () => {
            modal.style.display = 'none';
            if (callback) callback(null);
        };
    }
    document.getElementById('promptMsg').innerText = mensagem;
    document.getElementById('promptInput').value = '';
    modal.style.display = 'flex';
}

// ============================================================
// FIM DOS AJUSTES DE MODAL
// ============================================================

window.switchTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.secao-painel').forEach(s => s.classList.remove('active'));
    
    if(tab === 'config') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('aba-config').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('aba-vitrine').classList.add('active');
        carregarProdutos();
    }
};

window.trocarContexto = (contexto) => {
    contextoAtual = contexto;
    
    // AJUSTE: Atualiza o texto visual do botão de gatilho (o card que abre o form)
    const txtBtnGatilho = document.getElementById('txtBtnPublicarContexto');
    if(txtBtnGatilho) txtBtnGatilho.innerText = contexto.toUpperCase();

    // AJUSTE: Atualiza o título dentro do formulário que abre
    const txtTituloForm = document.getElementById('txtContextoForm');
    if(txtTituloForm) txtTituloForm.innerText = contexto;

    // UI Visual
    document.querySelectorAll('.radio-contexto').forEach(el => el.classList.remove('active'));
    if(contexto === 'Geral') document.getElementById('labelCtxGeral').classList.add('active');
    else document.getElementById('labelCtxComida').classList.add('active');

    document.getElementById('txtContextoPerfil').innerText = contexto;

    // =========================================================
    // BLOCO ADICIONADO: CONTROLE DE EXIBIÇÃO DOS LINKS
    // =========================================================
    const btnVitrine = document.getElementById('btn-link-vitrine');
    const btnCardapio = document.getElementById('btn-link-cardapio');
    const areaLink = document.getElementById('area-link-gerado');

    // Esconde a área de link aberto para não mostrar o link antigo ao trocar
    if(areaLink) areaLink.style.display = 'none';

    if (btnVitrine && btnCardapio) {
        if (contexto === 'Comida') {
            btnVitrine.style.setProperty('display', 'none', 'important');
            btnCardapio.style.setProperty('display', 'flex', 'important');
        } else {
            btnVitrine.style.setProperty('display', 'flex', 'important');
            btnCardapio.style.setProperty('display', 'none', 'important');
        }
    }
    // =========================================================

    // Atualiza o select de categoria no formulário de produtos automaticamente
    const selectCat = document.getElementById('pCategoria');
    if(selectCat) {
        selectCat.value = contexto;
        if (window.toggleFormFields) window.toggleFormFields();
    }

    // AJUSTE SOLICITADO: Mostra/Esconde o campo "Tipo de Produto" baseado no contexto
    const groupTipo = document.getElementById('groupTipoProduto');
    if(groupTipo) {
        groupTipo.style.display = contexto === 'Comida' ? 'none' : 'block';
    }

    // Carrega dados específicos do contexto (Nome e Foto)
    atualizarUIPerfil();
    carregarProdutos();
};

function atualizarUIPerfil() {
    if (!userData) return;

    // Lógica de Identidade Visual por Contexto
    const nomeCtx = (contextoAtual === 'Comida' ? userData.nomeLojaComida : userData.nomeLojaGeral) || userData.nomeLoja || "Minha Loja";
    const fotoCtx = (contextoAtual === 'Comida' ? userData.fotoPerfilComida : userData.fotoPerfilGeral) || userData.fotoPerfil;

    // Header
    document.getElementById('nomeLojaHead').innerText = nomeCtx;
    const imgHeader = document.getElementById('fotoLoja');
    if(imgHeader) imgHeader.src = fotoCtx || "https://via.placeholder.com/50";

    // Inputs
    document.getElementById('inputNomeLoja').value = nomeCtx;
    const preview = document.getElementById('previewPerfil');
    if(preview && fotoCtx) {
        preview.style.backgroundImage = `url(${fotoCtx})`;
        preview.style.display = 'block';
    } else if(preview) {
        preview.style.display = 'none';
    }
}
async function verificarStatus() {
    try {
        const docRef = doc(db, "usuarios", userId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            userData = docSnap.data();
            userData.id = userId;
            
            // VERIFICAÇÃO DE BLOQUEIO POR PAGAMENTO
            if (userData.status === 'bloqueado' || userData.status === 'inadimplente' || userData.bloqueado === true || userData.bloqueado === "true") {
    document.body.innerHTML = `
        <div style="height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-family: sans-serif; padding: 20px; background: #f8f9fa;">
            <i class="fa-solid fa-lock" style="font-size: 50px; color: #dc3545; margin-bottom: 20px;"></i>
            <h2 style="color: #333;">Acesso temporariamente indisponível</h2>
            <p style="color: #666; max-width: 400px; line-height: 1.5;">
                Sua conta encontra-se temporariamente com acesso restrito.
                <br><br>
                Entre em contato com a equipe da plataforma para obter mais informações e orientações sobre a reativação do acesso.
            </p>
            <a href="https://wa.me/556692387529" style="margin-top: 20px; padding: 12px 25px; background: #28a745; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
                Falar com o suporte
            </a>
        </div>
    `;
    return; // Interrompe qualquer outra lógica do painel
}
            
            const regras = GetRegrasLojista(userData);
            const estaAutorizado = userData.status === 'ativo' || userData.status === 'aprovado';
            
            
            const btnPublicar = document.getElementById('btn-salvar');
            const msgBloqueio = document.getElementById('msgAvisoAdmin');

            if (!estaAutorizado) {
                if(btnPublicar) btnPublicar.disabled = true;
                if(msgBloqueio) {
                    msgBloqueio.style.display = 'block';
                    msgBloqueio.innerText = "⚠️ Aguardando aprovação do administrador para publicar.";
                }
            } else {
                if(msgBloqueio) msgBloqueio.style.display = 'none';
                aplicarRegrasDePlanoNaInterface();
            }

   // Se for Plano Básico, verificamos se ele já tem um tema definido
if (userData.planoAtivo === 'basico' || !userData.planoAtivo) {
    if (!userData.temaEscolhido) {
        // Se não escolheu, forçamos a escolha antes de mostrar qualquer coisa
        escolherTemaInicial(); 
        return; 
    }
    // Esconde o seletor (ele não pode trocar)
    document.getElementById('seletorContexto').style.display = 'none';
    
    // AJUSTE AQUI: Forçamos o contexto e atualizamos o texto do botão de publicação imediatamente
    contextoAtual = userData.temaEscolhido;
    window.trocarContexto(contextoAtual);
    
    // Garante que o texto do botão "Publicar Novo em..." reflita o tema salvo
    const txtBtn = document.getElementById('txtBtnPublicarContexto');
    if(txtBtn) txtBtn.innerText = contextoAtual.toUpperCase();

    // CORREÇÃO DE CONTEXTO: Força o formulário a carregar os campos do setor escolhido
    const selectCat = document.getElementById('pCategoria');
    if(selectCat) {
        selectCat.value = contextoAtual;
        if (window.toggleFormFields) window.toggleFormFields();
    }

} else {
    // Premium/VIP continuam vendo o seletor normal
    document.getElementById('seletorContexto').style.display = 'block';
    window.trocarContexto('Geral');
}
            
            
        }
    } catch (e) { console.error("Erro ao verificar status:", e); }
}

async function aplicarRegrasDePlanoNaInterface() {
    const infoCategoria = document.getElementById('restricaoCategoria');
    const selectCat = document.getElementById('pCategoria');

    if (userData.planoAtivo === 'basico' || !userData.planoAtivo) {
        const q = query(collection(db, "produtos"), where("owner", "==", userId));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            categoriaFixaPlanoBasico = snap.docs[0].data().categoria;
            selectCat.value = categoriaFixaPlanoBasico;
            selectCat.disabled = true;
            infoCategoria.innerText = `📌 Plano Básico: Você está usando a categoria ${categoriaFixaPlanoBasico.toUpperCase()}.`;
            if(window.toggleFormFields) window.toggleFormFields();
        } else {
            infoCategoria.innerText = "💡 Plano Básico: O primeiro produto definirá sua categoria única (Comida ou Geral).";
        }
    } else {
        infoCategoria.innerText = `✨ Plano Profissional: Editando contexto ${contextoAtual.toUpperCase()}.`;
        infoCategoria.style.background = "#d4edda";
        infoCategoria.style.color = "#155724";
        selectCat.disabled = true; // Força usar o seletor de contexto do topo
    }
}

// Função para Abrir/Fechar o Modal e carregar dados
window.togglePainelPerfil = () => {
    const modal = document.getElementById('painelPerfil');
    if (modal.style.display === 'none' || modal.style.display === '') {
        modal.style.display = 'flex';
        // Carrega o WhatsApp atual no input quando abre
        if (userData && userData.whatsapp) {
    // Remove o 55 inicial apenas para exibição no input, se ele existir
    let whatsExibicao = userData.whatsapp.replace(/\D/g, '');
    if (whatsExibicao.startsWith('55')) {
        whatsExibicao = whatsExibicao.substring(2);
    }
    document.getElementById('inputWhatsLoja').value = whatsExibicao;
}
    } else {
        modal.style.display = 'none';
    }
};

// Salvar Nome e WhatsApp (alert substituído)
document.getElementById('btnSalvarPerfilGeral').onclick = async () => {
    const novoNome = document.getElementById('inputNomeLoja').value;
    const novoWhats = document.getElementById('inputWhatsLoja').value;
    const btn = document.getElementById('btnSalvarPerfilGeral');

    if(!novoNome || !novoWhats) return mostrarToast("Preencha todos os campos!", "erro");
    
    btn.innerText = "Salvando...";
    try {
  // Remove tudo que não é número
const apenasNumeros = novoWhats.replace(/\D/g, '');
// Se o usuário digitou o 55, usamos como está. Se não, adicionamos.
const numeroFormatado = apenasNumeros.startsWith('55') 
    ? '+' + apenasNumeros 
    : '+55' + apenasNumeros;

        const updateData = {
            whatsapp: numeroFormatado // Este é o campo mestre que o carrinho vai ler
        };

        if(userData.planoAtivo === 'premium' || userData.planoAtivo === 'vip') {
            const campo = contextoAtual === 'Comida' ? 'nomeLojaComida' : 'nomeLojaGeral';
            updateData[campo] = novoNome;
            userData[campo] = novoNome;
        } else {
            updateData.nomeLoja = novoNome;
            userData.nomeLoja = novoNome;
        }

        await updateDoc(doc(db, "usuarios", userId), updateData);
        
        // Atualiza localmente
        userData.whatsapp = novoWhats;
        
        atualizarUIPerfil();
        mostrarToast("Perfil atualizado com sucesso!", "sucesso");
        togglePainelPerfil(); // Fecha o modal
    } catch (e) { 
        console.error(e);
        mostrarToast("Erro ao atualizar perfil.", "erro"); 
    } finally {
        btn.innerText = "Salvar Alterações";
    }
};

document.getElementById('inputFotoPerfil').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const statusText = document.getElementById('uploadStatus');
    if (!file) return;
    statusText.innerText = "Enviando...";
    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "pedeairapido");
        const response = await fetch("https://api.cloudinary.com/v1_1/de0cvvii9/image/upload", { method: "POST", body: formData });
        const data = await response.json();
        
        const updateData = {};
        if(userData.planoAtivo === 'premium' || userData.planoAtivo === 'vip') {
            const campo = contextoAtual === 'Comida' ? 'fotoPerfilComida' : 'fotoPerfilGeral';
            updateData[campo] = data.secure_url;
            if(contextoAtual === 'Comida') userData.fotoPerfilComida = data.secure_url;
            else userData.fotoPerfilGeral = data.secure_url;
        } else {
            updateData.fotoPerfil = data.secure_url;
            userData.fotoPerfil = data.secure_url;
        }

        await updateDoc(doc(db, "usuarios", userId), updateData);
        atualizarUIPerfil();
        statusText.innerText = "Foto atualizada!";
    } catch (error) { statusText.innerText = "Erro ao enviar."; }
});

async function carregarProdutos() {
    const container = document.getElementById('lista-produtos');
    if (!container) return;
    try {
        const q = query(
            collection(db, "produtos"), 
            where("owner", "==", userId),
            where("categoria", "==", contextoAtual)
        );
        
        const snap = await getDocs(q);
        container.innerHTML = "";
        const contador = document.getElementById('contadorProd');
        if(contador) contador.innerText = `${snap.size} itens (${contextoAtual})`;
        
        snap.forEach(d => {
            const p = d.id;
            const data = d.data();
            const img = data.foto || (data.fotos && data.fotos[0]) || "https://via.placeholder.com/150";
            
            const isTurbo = data.turbo === 'sim';
            const isPromo = data.promocao === 'sim';

            // Verifica se produto tem vídeo
            const hasVideo = data.videoUrl && data.videoUrl.trim() !== "";
            
            container.innerHTML += `
    <div class="prod-card" id="card-${p}">
        <div class="prod-card-header">
            <div class="prod-badges">
                ${isTurbo ? '<span class="badge-turbo">TURBO</span>' : ''}
                ${isPromo ? '<span class="badge-promo">OFERTA</span>' : ''}
                ${hasVideo ? '<span class="badge-video">🎥 VÍDEO</span>' : ''}
            </div>
            <button class="prod-menu-btn" data-prod-id="${p}" onclick="event.stopPropagation(); toggleProdMenu('${p}')">
                <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
        </div>
        <img src="${otimizarURL(img, 300)}" loading="lazy" class="prod-img">
        <div class="prod-details">
            <div class="prod-name" id="name-txt-${p}">${data.nome}</div>
            <div class="prod-price" id="price-txt-${p}">R$ ${data.preco}</div>
        </div>
        <div id="form-edit-${p}" class="form-edit-card">
            <input type="text" id="edit-nome-${p}" value="${data.nome}">
            <input type="text" id="edit-preco-${p}" value="${data.preco}">
            ${data.tipoProduto === 'roupa' ? `<input type="text" id="edit-tam-${p}" value="${data.numeracoes || ''}" placeholder="Numeração">` : ''}
            <button class="btn-post btn-mini" onclick="salvarEdicao('${p}')">Salvar</button>
        </div>
        <div class="prod-dropdown" id="dropdown-${p}" style="display: none;">
            <div class="dropdown-item" onclick="toggleEditCard('${p}'); closeProdMenu('${p}')">
                <i class="fa-solid fa-pen"></i> Editar produto
            </div>
            <div class="dropdown-item" onclick="togglePromo('${p}', ${isPromo}); closeProdMenu('${p}')">
                <i class="fa-solid fa-tag"></i> ${isPromo ? 'Desativar promoção' : 'Ativar promoção'}
            </div>
            <div class="dropdown-item" onclick="toggleTurbo('${p}', ${isTurbo}); closeProdMenu('${p}')">
                <i class="fa-solid fa-bolt"></i> ${isTurbo ? 'Remover destaque' : 'Destacar produto'}
            </div>
            ${hasVideo ? `
            <div class="dropdown-item" onclick="visualizarVideoProduto('${data.videoUrl}'); closeProdMenu('${p}')">
                <i class="fa-solid fa-play"></i> Ver vídeo
            </div>
            <div class="dropdown-item" onclick="removerVideoProduto('${p}'); closeProdMenu('${p}')">
                <i class="fa-solid fa-trash-can"></i> Remover vídeo
            </div>
            ` : ''}
            <div class="dropdown-item danger" onclick="excluirProd('${p}'); closeProdMenu('${p}')">
                <i class="fa-solid fa-trash"></i> Excluir produto
            </div>
        </div>
    </div>`;
        });
    } catch (e) { console.error(e); }
}

// FUNCIONALIDADES DOS CARDS
window.toggleEditCard = (id) => {
    const form = document.getElementById(`form-edit-${id}`);
    form.style.display = form.style.display === 'block' ? 'none' : 'block';
};

window.salvarEdicao = async (id) => {
    const novoNome = document.getElementById(`edit-nome-${id}`).value;
    const novoPreco = document.getElementById(`edit-preco-${id}`).value;
    const updateData = { nome: novoNome, preco: novoPreco };
    
    const inputTam = document.getElementById(`edit-tam-${id}`);
    if(inputTam) updateData.numeracoes = inputTam.value;

    try {
        await updateDoc(doc(db, "produtos", id), updateData);
        document.getElementById(`name-txt-${id}`).innerText = novoNome;
        document.getElementById(`price-txt-${id}`).innerText = "R$ " + novoPreco;
        window.toggleEditCard(id);
        mostrarToast("Atualizado!", "sucesso");
    } catch (e) { mostrarToast("Erro ao editar.", "erro"); }
};

window.togglePromo = async (id, statusAtual) => {
    if(!statusAtual) {
        const q = query(collection(db, "produtos"), where("owner", "==", userId), where("promocao", "==", "sim"));
        const snap = await getDocs(q);
    if(snap.size >= 6) return window.abrirModalLimite();
    }
    try {
        await updateDoc(doc(db, "produtos", id), { 
            promocao: statusAtual ? "nao" : "sim",
            promoExpira: statusAtual ? null : Date.now() + (24 * 60 * 60 * 1000)
        });
        carregarProdutos();
    } catch (e) { console.error(e); }
};

window.toggleTurbo = async (id, statusAtual) => {
    if(!statusAtual) {
        const plano = userData.planoAtivo || 'basico';
        const limites = { 'basico': 1, 'premium': 3, 'vip': 5 };
        const q = query(collection(db, "produtos"), where("owner", "==", userId), where("turbo", "==", "sim"));
        const snap = await getDocs(q);
if(snap.size >= limites[plano]) return window.abrirModalLimite();
    }
    try {
        await updateDoc(doc(db, "produtos", id), { turbo: statusAtual ? "nao" : "sim" });
        carregarProdutos();
    } catch (e) { console.error(e); }
};

document.getElementById('btn-salvar').onclick = async () => {
    const btn = document.getElementById('btn-salvar');
    const fInput = document.getElementById('pFoto');
    const nome = document.getElementById('pNome').value;
    const preco = document.getElementById('pPreco').value;
    const categoria = document.getElementById('pCategoria').value;
    const tipo = document.getElementById('pTipo').value;

    if (!nome || !preco) return mostrarToast("Preencha nome e preço.", "erro");
    if (!categoria) return mostrarToast("Selecione um setor!", "erro");
    if (document.getElementById('groupTipoProduto').style.display !== 'none' && !tipo) {
        return mostrarToast("Selecione o tipo de produto!", "erro");
    }
    if (fInput.files.length === 0) return mostrarToast("Selecione ao menos uma foto.", "erro");
    // VALIDAÇÃO DE LIMITE DE VÍDEOS (antes de qualquer upload)
        const videoInputCheck = document.getElementById('pVideo');
        if (videoInputCheck.files.length > 0) {
            const { permitido } = await verificarLimiteVideo();
            if (!permitido) {
                window.abrirModalLimiteVideo();
                btn.disabled = false;
                btn.innerText = "PUBLICAR NA VITRINE";
                return;
            }
        }
    
    btn.innerText = "Publicando...";
    btn.disabled = true;

    try {
        const urls = [];
        for (let i = 0; i < fInput.files.length; i++) {
            const fd = new FormData();
            fd.append("file", fInput.files[i]);
            fd.append("upload_preset", "pedeairapido");
            const res = await fetch("https://api.cloudinary.com/v1_1/de0cvvii9/image/upload", { method: "POST", body: fd });
            const data = await res.json();
            if (data.secure_url) urls.push(data.secure_url);
        }

        // Upload do vídeo (se houver)
        let videoUrl = "";
        const videoInput = document.getElementById('pVideo');
        if (videoInput.files.length > 0) {
            const videoFile = videoInput.files[0];
            const videoFormData = new FormData();
            videoFormData.append("file", videoFile);
            videoFormData.append("upload_preset", "pedeairapido");
            // Forçar resource_type para vídeo no Cloudinary
            const videoRes = await fetch("https://api.cloudinary.com/v1_1/de0cvvii9/video/upload", { method: "POST", body: videoFormData });
            const videoData = await videoRes.json();
            if (videoData.secure_url) videoUrl = otimizarVideoURL(videoData.secure_url);
        }

        let tamanhos = [];
        let numeracao = "";
        if(categoria === 'Geral' && tipo === 'roupa') {
            document.querySelectorAll('input[name="tam"]:checked').forEach(el => tamanhos.push(el.value));
            numeracao = document.getElementById('pNumeracao').value;
        }

        await addDoc(collection(db, "produtos"), {
            nome, 
            preco, 
            owner: userId, 
            turbo: "nao", 
            promocao: "nao",
            fotos: urls, 
            foto: urls[0],
            videoUrl: videoUrl || "",
            descricao: document.getElementById('pDesc').value,
            categoria: categoria,
            tipoProduto: tipo,
            tamanhosDisponiveis: tamanhos,
            numeracoes: numeracao,
            variacoes: [],
            adicionais: [],
            variacoes: [],
            adicionais: (() => {
                const lista = [];
                document.querySelectorAll('#lista-adicionais-produto .item-config').forEach(row => {
                    const nome = row.querySelector('.adic-nome')?.value.trim();
                    const preco = row.querySelector('.adic-preco')?.value.trim();
                    if(nome) lista.push({ nome, preco: preco || '0' });
                });
                return lista;
            })(),
            whatsapp: userData.whatsapp || "",
            createdAt: serverTimestamp()
        });

        // Feedback elegante
        if (window.mostrarSucessoPublicacao) window.mostrarSucessoPublicacao();

        // Fechar formulário
        document.getElementById('containerFormPublicar').style.display = 'none';
        document.getElementById('cardGatilhoPublicar').style.display = 'flex';

        // Reset COMPLETO de todos os campos
        document.getElementById('pNome').value = "";
        document.getElementById('pPreco').value = "";
        document.getElementById('pDesc').value = "";
        document.getElementById('pFoto').value = "";
        document.getElementById('pTipo').value = "";   // volta para placeholder
        document.querySelectorAll('input[name="tam"]:checked').forEach(el => el.checked = false);
        const pNumeracao = document.getElementById('pNumeracao');
        if (pNumeracao) pNumeracao.value = "";
        const pPermiteMontar = document.getElementById('pPermiteMontar');
        if (pPermiteMontar) pPermiteMontar.checked = false;
        const listaAdicionais = document.getElementById('lista-adicionais-produto');
        if (listaAdicionais) listaAdicionais.innerHTML = "";
        const areaRoupa = document.getElementById('area-roupa-config');
        if (areaRoupa) areaRoupa.style.display = 'none';

        // Reset preview foto
        if (window.resetarPreviewFoto) resetarPreviewFoto();
        
        // Reset preview vídeo
        const videoInputReset = document.getElementById('pVideo');
        if (videoInputReset) videoInputReset.value = "";
        if (window.resetarPreviewVideo) resetarPreviewVideo();
        
        carregarProdutos();
        btn.disabled = false;
        btn.innerText = "PUBLICAR NA VITRINE";
    } catch (error) { 
        mostrarToast("Erro ao publicar.", "erro"); 
        btn.disabled = false; 
        btn.innerText = "PUBLICAR NA VITRINE"; 
    } 
};

async function deletarMidiaCloudinary(publicIds) {
    if (!publicIds || publicIds.length === 0) return;
    // Supõe que você tenha um endpoint backend (ex: Firebase Function) que recebe os public_ids e chama a API do Cloudinary
    // Substitua a URL pelo seu endpoint real
    const endpoint = 'https://us-central1-seu-projeto.cloudfunctions.net/deleteCloudinaryMedia';
    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicIds })
        });
    } catch (e) {
        console.warn("Erro ao notificar backend para exclusão:", e);
        // Não impede a exclusão do produto
    }
}

window.excluirProd = async (id) => {
    // Primeiro, busca os dados do produto para extrair URLs de mídia
    const produtoRef = doc(db, "produtos", id);
    const snapProd = await getDoc(produtoRef);
    if (!snapProd.exists()) {
        mostrarToast("Produto não encontrado.", "erro");
        return;
    }
    const data = snapProd.data();
    const imagens = data.fotos || (data.foto ? [data.foto] : []);
    const videoUrl = data.videoUrl || "";
    const allUrls = [...imagens];
    if (videoUrl) allUrls.push(videoUrl);
    
    // Extrai public_id das URLs do Cloudinary
    const publicIds = [];
    for (const url of allUrls) {
        if (url && url.includes('cloudinary.com')) {
            // Exemplo: https://res.cloudinary.com/.../upload/v123456/nome_imagem.jpg
            const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)\.(jpg|png|mp4|mov|webm)/i);
            if (match && match[1]) {
                publicIds.push(match[1]);
            }
        }
    }

    mostrarConfirmacao("Excluir este produto permanentemente? As imagens e vídeos também serão removidos.", async () => {
        // Tenta deletar do Cloudinary (não bloqueia se falhar)
        if (publicIds.length > 0) {
            await deletarMidiaCloudinary(publicIds);
        }
        // Exclui o documento do Firestore
        await deleteDoc(produtoRef);
        carregarProdutos();
        mostrarToast("Produto removido com sucesso.", "sucesso");
    });
};
document.getElementById('btnSair').onclick = () => {
    localStorage.clear();
    window.location.href = 'index.html';
};

verificarStatus();

// Função para gerar o link do Cartão de Visita Digital
window.gerarLinkCartaoVisita = function(modo) {
    const userId = localStorage.getItem('userId'); // Recupera o ID do lojista logado
    if (!userId) return mostrarToast("Erro: Usuário não identificado.", "erro");

    const urlBase = `${APP_URL}/vitrine-cartao.html`;
    const linkFinal = `${urlBase}?lojista=${userId}&modo=${modo}`;
    
    console.log("Link Gerado:", linkFinal);
    return linkFinal;
};
// Função para gerar e exibir o link na interface
window.prepararLink = function(modo) {
    // AJUSTE: Se for plano básico, força o modo correto independente do clique
    let modoReal = modo;
    if (userData && (userData.planoAtivo === 'basico' || !userData.planoAtivo)) {
        modoReal = (userData.temaEscolhido === 'Comida') ? 'gourmet' : 'vitrine';
    }

    const link = window.gerarLinkCartaoVisita(modoReal);
    const area = document.getElementById('area-link-gerado');
    const input = document.getElementById('inputLinkCopia');
    const label = document.getElementById('labelTipoLink');
    const icone = document.getElementById('iconeLink');

    if (modoReal === 'gourmet') {
        label.innerText = "🍔 Este é o link do seu cardápio online:";
        icone.innerHTML = "🍕";
    } else {
        label.innerText = "📢 Este é o link da sua vitrine digital:";
        icone.innerHTML = "🛍️";
    }
    
    input.value = link;
    area.style.display = 'block';
    
    window.scrollTo({ top: area.offsetTop - 150, behavior: 'smooth' });
};

// Função de cópia com Pop-up Quadrado
window.copiarLinkBotao = function() {
    const input = document.getElementById('inputLinkCopia');
    const linkOriginal = input.value;
    
    const isCardapio = linkOriginal.includes('modo=gourmet');
    
    // Criação do texto de divulgação com emojis e quebra de linha
    let textoDivulgacao = "";
    if (isCardapio) {
        textoDivulgacao = `🍔 Confira nosso cardápio online no PedeAí 👇\n${linkOriginal}`;
    } else {
        textoDivulgacao = `🛍️ Confira nossa vitrine digital no PedeAí 👇\n${linkOriginal}`;
    }

    // Mensagem que aparece no balão verde na tela
    const mensagemFeedback = isCardapio 
        ? "🍔🍕 Sucesso!<br><br>O link do seu cardápio foi copiado com o texto de divulgação! ☺️"
        : "🛍️🛒 Sucesso!<br><br>O link da sua vitrine foi copiado com o texto de divulgação! ☺️";

    try {
        // Copia o texto de divulgação (Texto + Link) para o celular/computador
        navigator.clipboard.writeText(textoDivulgacao).then(() => {
            abrirPopUpSucesso(mensagemFeedback);
        });
    } catch (err) {
        // Fallback para navegadores antigos: aqui ele copiará o que estiver no input
        input.value = textoDivulgacao; 
        input.select();
        document.execCommand('copy');
        input.value = linkOriginal; // Volta o valor do input ao normal
        abrirPopUpSucesso(mensagemFeedback);
    }
};

// Função para criar o Pop-up com X vermelho
function abrirPopUpSucesso(texto) {
    // Remove se já houver um aberto
    const overlayExistente = document.querySelector('.popup-copiado-overlay');
    if (overlayExistente) overlayExistente.remove();

    const overlay = document.createElement('div');
    overlay.className = 'popup-copiado-overlay';
    
    overlay.innerHTML = `
        <div class="popup-copiado-box">
            <button class="btn-fechar-popup" onclick="this.parentElement.parentElement.remove()">X</button>
            <div style="font-size: 16px; line-height: 1.4;">${texto}</div>
        </div>
    `;

    // Fecha ao clicar fora do quadrado verde
    overlay.onclick = function(e) {
        if (e.target === overlay) overlay.remove();
    };

    document.body.appendChild(overlay);
}

// A função base que você já possui (garanta que esteja presente)
window.gerarLinkCartaoVisita = function(modo) {
    const userId = localStorage.getItem('userId');
    const urlBase = `${APP_URL}/vitrine-cartao.html`;
    return `${urlBase}?lojista=${userId}&modo=${modo}`;
};
// AJUSTE CIRÚRGICO: Função de Suporte Global via Firebase
window.abrirSuporteDinamico = async function() {
    const mensagem = encodeURIComponent("Olá! Preciso de ajuda com meu painel.");
    let numeroSuporte = "5511999999999";

    try {
        const docSnap = await getDoc(doc(db, "configuracoes", "suporte"));
        if (docSnap.exists() && docSnap.data().numero) {
            numeroSuporte = docSnap.data().numero;
        }
    } catch (e) { console.error(e); }

    const url = `https://wa.me/${numeroSuporte.replace(/\D/g, '')}?text=${mensagem}`;
    
    // No iOS Safari, window.location.href é mais confiável que window.open dentro de async
    window.location.href = url;
};
async function escolherTemaInicial() {
    // Cria um fundo branco por cima de tudo para a escolha
    const overlay = document.createElement('div');
    overlay.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;box-sizing:border-box;";
    overlay.innerHTML = `
    <style>
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
    <div style="max-width:400px; width:100%; animation: fadeInUp 0.3s ease-out;">
        <div style="background: white; border-radius: 28px; overflow: hidden; box-shadow: 0 24px 48px -12px rgba(0,0,0,0.25); padding: 32px 24px 40px; text-align: center;">
            <div style="margin-bottom: 20px;">
                <div style="width: 64px; height: 64px; background: #ee4d2d15; border-radius: 32px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
                    <i class="fas fa-store" style="font-size: 32px; color: #ee4d2d;"></i>
                </div>
                <h2 style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif; font-size: 24px; font-weight: 700; margin: 0 0 8px; color: #1c1c1e;">Perfil Essencial</h2>
                <p style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; font-size: 15px; line-height: 1.4; color: #6c6c70; margin: 0 0 24px;">Escolha o setor da sua loja para começar.</p>
            </div>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button onclick="definirTema('Geral')" style="background: white; border: 1.5px solid #ee4d2d; border-radius: 14px; padding: 16px 20px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; font-weight: 600; font-size: 16px; color: #ee4d2d; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s ease; background: #fff5f2;" 
                    onmouseover="this.style.backgroundColor='#ffede8'; this.style.transform='scale(1.01)'" onmouseout="this.style.backgroundColor='#fff5f2'; this.style.transform='scale(1)'">
                    <span style="display: flex; align-items: center; gap: 12px;"><span style="font-size: 24px;">🛍️</span> Produtos Gerais</span>
                    <i class="fas fa-chevron-right" style="font-size: 14px; opacity: 0.7;"></i>
                </button>
                <button onclick="definirTema('Comida')" style="background: white; border: 1.5px solid #f59e0b; border-radius: 14px; padding: 16px 20px; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; font-weight: 600; font-size: 16px; color: #d97706; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s ease; background: #fffbeb;" 
                    onmouseover="this.style.backgroundColor='#fff3d6'; this.style.transform='scale(1.01)'" onmouseout="this.style.backgroundColor='#fffbeb'; this.style.transform='scale(1)'">
                    <span style="display: flex; align-items: center; gap: 12px;"><span style="font-size: 24px;">🍔</span> Comida & Delivery</span>
                    <i class="fas fa-chevron-right" style="font-size: 14px; opacity: 0.7;"></i>
                </button>
            </div>
            <p style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; font-size: 12px; color: #8e8e93; margin: 32px 0 0; padding-top: 16px; border-top: 0.5px solid #e9e9ef;">Caso precise, essa configuração poderá ser alterada futuramente.</p>
        </div>
    </div>
`;
    document.body.appendChild(overlay);

    window.definirTema = async (tema) => {
        mostrarConfirmacao(`Confirmar setor ${tema.toUpperCase()}?`, async () => {
            await updateDoc(doc(db, "usuarios", userId), { temaEscolhido: tema });
            window.location.reload(); // Recarrega já com a trava aplicada
        });
    };
}
// FUNÇÃO ADICIONADA: Solicitar Exclusão via Firestore
window.excluirContaReal = async () => {
    mostrarConfirmacao(
        "Tem certeza que deseja excluir permanentemente sua conta?\n\nTodos os produtos, imagens, vídeos e informações associadas serão removidos e essa ação não poderá ser desfeita.",
        async () => {
            const btn = document.getElementById('btnExcluirContaModal');
            if (btn) {
                btn.disabled = true;
                btn.innerText = "Excluindo...";
            }
            try {
                // 1. Deletar todos os produtos do usuário
                const qProdutos = query(collection(db, "produtos"), where("owner", "==", userId));
                const snapshotProdutos = await getDocs(qProdutos);
                const deletePromises = [];
                snapshotProdutos.forEach(docProd => {
                    deletePromises.push(deleteDoc(doc(db, "produtos", docProd.id)));
                });
                await Promise.all(deletePromises);
                
                // 2. Deletar o documento do usuário
                await deleteDoc(doc(db, "usuarios", userId));
                
                // 3. Registrar no histórico de exclusões para o admin saber
                const { setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
                await setDoc(doc(db, "solicitacoes_exclusao", userId + "_" + Date.now()), {
                    lojistaId: userId,
                    nomeLoja: userData.nomeLoja || "Não identificado",
                    whatsapp: userData.whatsapp || "",
                    dataExclusao: serverTimestamp(),
                    status: "concluida_automaticamente"
                });
                
                // 4. Limpar localStorage
                localStorage.clear();
                
                // 5. Redirecionar para login
                mostrarToast("Conta excluída com sucesso.", "sucesso");
                setTimeout(() => {
                    window.location.href = "login.html";
                }, 1500);
            } catch (e) {
                console.error("Erro ao excluir conta:", e);
                mostrarToast("Erro ao excluir conta. Tente novamente.", "erro");
                if (btn) {
                    btn.disabled = false;
                    btn.innerText = "Excluir conta";
                }
            }
        },
        null
    );
};
// Aguardar DOM carregado e associar botão de exclusão
document.addEventListener('DOMContentLoaded', () => {
    const btnExcluir = document.getElementById('btnExcluirContaModal');
    if (btnExcluir) {
        btnExcluir.addEventListener('click', window.excluirContaReal);
    }
});
// ═══════════════════════════════════════════
// ALTERAR SENHA — usa o mesmo SHA-256 do sistema
// ═══════════════════════════════════════════
window.abrirModalAlterarSenha = () => {
    document.getElementById('inputNovaSenha').value = '';
    document.getElementById('inputConfirmarSenha').value = '';
    document.getElementById('statusAlterarSenha').innerText = '';
    document.getElementById('modalAlterarSenha').style.display = 'flex';
};

window.fecharModalAlterarSenha = () => {
    document.getElementById('modalAlterarSenha').style.display = 'none';
};

window.salvarNovaSenha = async () => {
    const novaSenha = document.getElementById('inputNovaSenha').value;
    const confirmar = document.getElementById('inputConfirmarSenha').value;
    const status = document.getElementById('statusAlterarSenha');
    const btn = document.getElementById('btnConfirmarSenha');

    if (!novaSenha || novaSenha.length < 4) {
        status.style.color = '#dc3545';
        status.innerText = '⚠️ A senha precisa ter pelo menos 4 caracteres.';
        return;
    }
    if (novaSenha !== confirmar) {
        status.style.color = '#dc3545';
        status.innerText = '⚠️ As senhas não coincidem.';
        return;
    }

    btn.innerText = 'Salvando...';
    btn.disabled = true;
    status.innerText = '';

    try {
        // Mesmo hash SHA-256 usado pelo admin e pelo login
        const encoder = new TextEncoder();
        const data = encoder.encode(novaSenha);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const senhaHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        await updateDoc(doc(db, "usuarios", userId), { senha: senhaHash });

        status.style.color = '#28a745';
        status.innerText = '✅ Senha alterada com sucesso!';
        setTimeout(() => window.fecharModalAlterarSenha(), 1500);
    } catch (e) {
        console.error(e);
        status.style.color = '#dc3545';
        status.innerText = '❌ Erro ao salvar. Tente novamente.';
    } finally {
        btn.innerText = 'SALVAR NOVA SENHA';
        btn.disabled = false;
    }
};
// ============================================================
// CONTROLE DE MENU DROPDOWN DOS CARDS
// ============================================================
window.toggleProdMenu = (prodId) => {
    const dropdown = document.getElementById(`dropdown-${prodId}`);
    if (!dropdown) return;
    // Fecha todos os outros menus abertos
    document.querySelectorAll('.prod-dropdown').forEach(menu => {
        if (menu.id !== `dropdown-${prodId}`) menu.style.display = 'none';
    });
    // Alterna o atual
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
};

window.closeProdMenu = (prodId) => {
    const dropdown = document.getElementById(`dropdown-${prodId}`);
    if (dropdown) dropdown.style.display = 'none';
};

// Fecha menus ao clicar fora
document.addEventListener('click', (e) => {
    if (!e.target.closest('.prod-menu-btn') && !e.target.closest('.prod-dropdown')) {
        document.querySelectorAll('.prod-dropdown').forEach(menu => menu.style.display = 'none');
    }
});
// ============================================================
// GERENCIAMENTO DE VÍDEO NOS CARDS (ESCOPO GLOBAL)
// ============================================================

window.visualizarVideoProduto = function(videoUrl) {
    if (!videoUrl || videoUrl === "") {
        mostrarToast("Vídeo indisponível.", "erro");
        return;
    }
    
    const modalExistente = document.getElementById('videoPreviewModal');
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = 'videoPreviewModal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); backdrop-filter: blur(10px);
        z-index: 100000; display: flex; align-items: center; justify-content: center;
        padding: 20px; box-sizing: border-box;
    `;
    
    modal.innerHTML = `
        <div style="position: relative; max-width: 95%; max-height: 90%;">
            <button style="
                position: absolute; top: -40px; right: 0; background: white; border: none;
                width: 36px; height: 36px; border-radius: 50%; font-size: 22px; cursor: pointer;
                display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                z-index: 10;
            " onclick="this.closest('#videoPreviewModal').remove()">&times;</button>
            <video 
                src="${otimizarVideoURL(videoUrl)}"
                controls
                playsinline
                style="max-width: 100%; max-height: 85vh; border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.3);"
            ></video>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.remove();
    });
};

window.removerVideoProduto = async function(produtoId) {
    if (!produtoId) return;
    
    mostrarConfirmacao("Remover o vídeo deste produto? As fotos e os dados serão mantidos.", async () => {
        try {
            const produtoRef = doc(db, "produtos", produtoId);
            await updateDoc(produtoRef, { videoUrl: "" });
            mostrarToast("Vídeo removido com sucesso!", "sucesso");
            if (typeof carregarProdutos === 'function') {
                await carregarProdutos();
            } else {
                window.location.reload();
            }
        } catch (e) {
            console.error("Erro ao remover vídeo:", e);
            mostrarToast("Erro ao remover vídeo. Tente novamente.", "erro");
        }
    });
};