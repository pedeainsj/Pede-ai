// ============================================================
// CLASSIFIEDS-APP.JS — Microapp Nativo de Anúncios
// Versão corrigida – arquitetura estável (igual products/gourmet)
// ============================================================

import { db } from './config.js';
import {
    collection, query, where, getDocs,
    updateDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const WHATSAPP_ADMIN  = "5599999999999";
let   categoriaAtual  = 'Todos';
let   todosAnuncios   = [];        // cache em memória
let   primeiraCarga   = false;     // impede recarga múltipla
let   estruturaMontada = false;

// ─────────────────────────────────────────────
// INJEÇÃO DO TEMPLATE HTML (uma única vez)
// ─────────────────────────────────────────────
function montarEstrutura(forceRebuild = false) {
    const root = document.getElementById('classifieds-root');
    if (!root) return;

    if (forceRebuild && estruturaMontada) {
        estruturaMontada = false;
    }

    // Se já montada, apenas reseta UI e renderiza (sem recarregar dados)
    if (estruturaMontada) {
    categoriaAtual = 'Todos';
    requestAnimationFrame(() => {
        resetarCategoriaUI();
        // Se o cache estiver vazio, tenta recarregar os dados
        if (!todosAnuncios || todosAnuncios.length === 0) {
            primeiraCarga = false; // permite nova tentativa
            carregarAnunciosInicial();
        } else {
            renderizarAnuncios(todosAnuncios);
        }
    });
    return;
}

    // Primeira montagem: injeta o HTML
    root.innerHTML = `
        <div class="classifieds-page">
            <header class="classifieds-header">
                <div class="header-top">
                    <span class="logo-container">
                        <i class="fas fa-bullhorn"></i>
                        Pede Aí Anúncios
                    </span>
                    <button id="btnVenderHeader" class="btn-vender-header">
                        <i class="fas fa-plus"></i> Anunciar
                    </button>
                </div>
                <div class="search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" id="inputBuscaAnuncio"
                           placeholder="O que você procura hoje?"
                           style="font-size:16px; -webkit-appearance:none;">
                </div>
            </header>
            <div class="categories-container" id="classifiedsCategories">
                <div class="category-item active" data-cat="Todos">
                    <div class="category-icon"><i class="fas fa-th-large"></i></div>
                    <span>Todos</span>
                </div>
                <div class="category-item" data-cat="Casas">
                    <div class="category-icon"><i class="fas fa-home"></i></div>
                    <span>Casas</span>
                </div>
                <div class="category-item" data-cat="Veículos">
                    <div class="category-icon"><i class="fas fa-car"></i></div>
                    <span>Veículos</span>
                </div>
                <div class="category-item" data-cat="Eletrônicos">
                    <div class="category-icon"><i class="fas fa-mobile-alt"></i></div>
                    <span>Eletrônicos</span>
                </div>
                <div class="category-item" data-cat="Brechó">
                    <div class="category-icon"><i class="fas fa-tshirt"></i></div>
                    <span>Brechó</span>
                </div>
            </div>
            <main class="container">
                <div id="listaAnuncios" class="grid-container"></div>
            </main>
        </div>
    `;

    bindEventos();
    estruturaMontada = true;

    // Carrega anúncios apenas uma vez (com cache)
    carregarAnunciosInicial();
}

// ─────────────────────────────────────────────
// CARREGAMENTO INICIAL (igual à estratégia do index)
// ─────────────────────────────────────────────
async function carregarAnunciosInicial() {
    // Evita múltiplas chamadas
    if (primeiraCarga) return;
    primeiraCarga = true;

    const container = document.getElementById('listaAnuncios');
    if (!container) return;

    // Tenta restaurar do sessionStorage
    const cache = sessionStorage.getItem('todosAnunciosCache');
    if (cache) {
        try {
            const parsed = JSON.parse(cache);
            if (Array.isArray(parsed) && parsed.length > 0) {
                todosAnuncios = parsed;
                renderizarAnuncios(todosAnuncios);
                console.log("[Classifieds] Restaurado do cache");
                return;
            }
        } catch(e) { console.warn(e); }
    }

    // Sem internet: mostra estado offline imediatamente, sem chamar Firebase
    if (!navigator.onLine) {
        mostrarEstadoOfflineClassifieds();
        return;
    }

    // Exibe spinner enquanto carrega
    container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:60px 20px;">
        <i class="fas fa-circle-notch fa-spin" style="font-size:32px; color:#0077ff;"></i>
    </div>`;

    try {
        // Sem timeout – aguarda normalmente (estável como index)
        const q = query(collection(db, "anuncios"), where("status", "==", "aprovado"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            container.innerHTML = estadoVazio('Nenhum anúncio aprovado.');
            todosAnuncios = [];
            return;
        }

        const agora = Date.now();
        const anuncios = [];
        querySnapshot.forEach(docSnap => {
            const dados = docSnap.data();
            const expirado = dados.dataExpiracao && agora > dados.dataExpiracao;
            if (!expirado) {
                anuncios.push({ id: docSnap.id, ...dados });
            }
        });

        anuncios.sort((a, b) => (b.dataCriacao || 0) - (a.dataCriacao || 0));
        todosAnuncios = anuncios;

        // Salva no cache persistente
        sessionStorage.setItem('todosAnunciosCache', JSON.stringify(anuncios));

        renderizarAnuncios(anuncios);

    } catch (erro) {
        console.error("[Classifieds] Erro ao carregar:", erro);
        mostrarEstadoOfflineClassifieds();
    } finally {
        window.IosOverlayManager?.hide('anuncios');
    }
}

// ─────────────────────────────────────────────
// RENDERIZAÇÃO CORRIGIDA (com variável 'ativos')
// ─────────────────────────────────────────────
function renderizarAnuncios(lista) {
    const container = document.getElementById('listaAnuncios');
    if (!container) return;

    const ativos = categoriaAtual === 'Todos'
        ? lista
        : lista.filter(a => a.categoria === categoriaAtual);

    if (ativos.length === 0) {
        container.innerHTML = estadoVazio(`Nenhum anúncio em "${categoriaAtual}"`);
        return;
    }

    // Remove qualquer transformação – usa a URL do Firestore diretamente
    container.innerHTML = ativos.map(a => {
        const precoExibicao = typeof a.preco === 'number'
            ? a.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : `R$ ${a.preco}`;
        const temImagem = a.foto && a.foto.trim() !== "";

        // Log para confirmar a URL
        if (temImagem) console.log("URL da imagem:", a.foto);

        return `
            <div class="card-anuncio" data-id="${a.id}" onclick="window.location.href='detalhe-anuncio.html?id=${a.id}'">
                <div class="card-img-container">
                    ${temImagem
                        ? `<img src="${a.foto}" loading="lazy" alt="${escapeHtml(a.titulo)}">`
                        : `<div style="display:flex;align-items:center;justify-content:center;color:#D1D1D6;height:100%;"><i class="fas fa-image fa-2x"></i></div>`
                    }
                </div>
                <div class="card-content">
                    <div class="card-title">${escapeHtml(a.titulo)}</div>
                    <div class="card-price">${precoExibicao}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ─────────────────────────────────────────────
// RESET VISUAL DA CATEGORIA (seguro)
// ─────────────────────────────────────────────
function resetarCategoriaUI() {
    const categories = document.querySelectorAll('#classifiedsCategories .category-item');
    if (categories.length === 0) return;
    categories.forEach(item => {
        item.classList.toggle('active', item.dataset.cat === 'Todos');
    });
    const inputBusca = document.getElementById('inputBuscaAnuncio');
    if (inputBusca) inputBusca.value = '';
}

// ─────────────────────────────────────────────
// FILTRO POR CATEGORIA
// ─────────────────────────────────────────────
function filtrarCategoria(nome) {
    categoriaAtual = nome;
    const categories = document.querySelectorAll('#classifiedsCategories .category-item');
    categories.forEach(item => {
        item.classList.toggle('active', item.dataset.cat === nome);
    });
    renderizarAnuncios(todosAnuncios);
}

// ─────────────────────────────────────────────
// ESTADO VAZIO
// ─────────────────────────────────────────────
function estadoVazio(msg) {
    // Prioridade máxima: offline nunca mostra "nenhum resultado"
    if (!navigator.onLine) {
        mostrarEstadoOfflineClassifieds();
        return '';
    }
    return `
        <div style="grid-column:1/-1; text-align:center; padding:80px 20px;">
            <i class="fas fa-search" style="font-size:40px; color:#D1D1D6; margin-bottom:16px; display:block;"></i>
            <p style="color:#8E8E93; font-weight:500;">${msg}</p>
        </div>`;
}

function mostrarEstadoOfflineClassifieds() {
    const container = document.getElementById('listaAnuncios');
    if (!container) return;
    container.innerHTML = `
        <div data-cl-offline style="grid-column:1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:64px 24px; text-align:center; min-height:300px;">
            <div style="width:80px; height:80px; background:#f2f2f7; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:20px; position:relative;">
                <i class="fas fa-wifi" style="font-size:28px; color:#aeaeb2;"></i>
                <div style="position:absolute; bottom:4px; right:4px; width:24px; height:24px; background:#ff3b30; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #f2f2f7;">
                    <i class="fas fa-xmark" style="font-size:10px; color:#fff;"></i>
                </div>
            </div>
            <p style="font-size:18px; font-weight:700; color:#1c1c1e; margin:0 0 8px 0; font-family:-apple-system, BlinkMacSystemFont, sans-serif;">Sem conexão</p>
            <p style="font-size:14px; color:#8e8e93; margin:0 0 28px 0; line-height:1.5; font-family:-apple-system, BlinkMacSystemFont, sans-serif;">Verifique sua internet e tente novamente</p>
            <button id="cl-retry-btn" style="background:#0077ff; color:#fff; border:none; border-radius:14px; padding:14px 32px; font-size:15px; font-weight:600; cursor:pointer; font-family:-apple-system, BlinkMacSystemFont, sans-serif; box-shadow:0 4px 12px rgba(0,119,255,0.3);">Tentar novamente</button>
        </div>`;
    const btn = document.getElementById('cl-retry-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            if (!navigator.onLine) {
                btn.textContent = 'Sem conexão...';
                setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
}, 3000);
                return;
            }
            primeiraCarga = false;
            carregarAnunciosInicial();
        });
    }
}

// ─────────────────────────────────────────────
// BIND DE EVENTOS (busca, modal, etc.)
// ─────────────────────────────────────────────
function bindEventos() {
    // Categorias
    const cats = document.getElementById('classifiedsCategories');
    if (cats) {
        cats.addEventListener('click', e => {
            const item = e.target.closest('.category-item');
            if (item) filtrarCategoria(item.dataset.cat);
        });
    }

    // Busca textual (não recarrega dados, só filtra o DOM)
    const inputBusca = document.getElementById('inputBuscaAnuncio');
    if (inputBusca) {
        inputBusca.addEventListener('input', e => {
            const termo = e.target.value.toLowerCase().trim();
            const cards = document.querySelectorAll('#listaAnuncios .card-anuncio');
            cards.forEach(card => {
                const titulo = card.querySelector('.card-title')?.innerText.toLowerCase() || '';
                card.style.display = titulo.includes(termo) ? 'flex' : 'none';
            });
        });
    }

    // Botão vender
    document.getElementById('btnVenderHeader')?.addEventListener('click', () => selecionarPlano('intermediado'));

    // Fechar modal (caso exista – o modal não está mais no DOM, mas mantemos compatibilidade)
    document.getElementById('btnFecharModal')?.addEventListener('click', fecharModal);
    document.getElementById('modalVenda')?.addEventListener('click', e => {
        if (e.target === document.getElementById('modalVenda')) fecharModal();
    });
}

// ─────────────────────────────────────────────
// UTILITÁRIOS (escape, toast, denúncia, modal)
// ─────────────────────────────────────────────
function escapeHtml(texto) {
    if (!texto) return '';
    return texto.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function mostrarToast(mensagem, tipo = 'info') {
    document.querySelector('.classifieds-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'classifieds-toast';
    toast.style.cssText = `
        position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
        background: ${tipo === 'erro' ? '#ea1d2c' : '#28a745'}; color: white;
        padding: 12px 24px; border-radius: 30px; font-weight: 600; font-size: 14px;
        z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        text-align: center; backdrop-filter: blur(8px); transition: opacity 0.3s;
        pointer-events: none;
    `;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function denunciarAnuncio(id, titulo) {
    try {
        const docRef = doc(db, "anuncios", id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) { mostrarToast('Anúncio não encontrado', 'erro'); return; }
        const denunciasAtuais = docSnap.data().denuncias || 0;
        const novasDenuncias = denunciasAtuais + 1;
        await updateDoc(docRef, {
            denuncias: novasDenuncias,
            status: novasDenuncias >= 1 ? 'pendente' : docSnap.data().status
        });
        mostrarToast('Denúncia enviada. O anúncio será revisado.', 'info');
        // Recarrega a lista (sem timeout, com cache)
        primeiraCarga = false;
        carregarAnunciosInicial();
        const mensagem = `Denúncia: ${titulo} (ID: ${id})`;
        window.location.assign(`https://wa.me/${WHATSAPP_ADMIN}?text=${encodeURIComponent(mensagem)}`);
    } catch (error) {
        console.error('[Classifieds] Erro na denúncia:', error);
        mostrarToast('Erro ao enviar denúncia.', 'erro');
    }
}

function abrirModal() {
    document.getElementById('modalVenda')?.classList.add('active');
    document.body.style.overflow = 'hidden';
}
function fecharModal() {
    document.getElementById('modalVenda')?.classList.remove('active');
    document.body.style.overflow = '';
}
function selecionarPlano(tipo) {
    localStorage.setItem('pedeai_tipo_anuncio', tipo);
    window.location.href = 'criaranuncios.html';
}

// Expor funções globais (compatibilidade)
window.filtrarCategoria  = filtrarCategoria;
window.denunciarAnuncio  = denunciarAnuncio;
window.abrirModalVender  = abrirModal;
window.fecharModal       = fecharModal;
window.selecionarPlano   = selecionarPlano;

// ─────────────────────────────────────────────
// EVENTOS DE MODO (changeMode, pageshow, DOMContentLoaded)
// ─────────────────────────────────────────────
window.addEventListener('changeMode', e => {
    const root = document.getElementById('classifieds-root');
    if (!root) return;
    if (e.detail === 'classifieds') {
        root.style.display = 'block';
        montarEstrutura();
    } else {
        root.style.display = 'none';
    }
});

// Recupera automaticamente quando a conexão volta
window.addEventListener('online', () => {
    const container = document.getElementById('listaAnuncios');
    if (container && container.querySelector('[data-cl-offline]')) {
        primeiraCarga = false;
        carregarAnunciosInicial();
    }
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
    const modoSalvo = sessionStorage.getItem('pedeai_mode');
    if (modoSalvo !== 'classifieds') return;
    if (!estruturaMontada) {
        montarEstrutura();
        return;
    }
    // Apenas reseta UI e renderiza (sem chamar Firebase novamente)
    categoriaAtual = 'Todos';
    resetarCategoriaUI();
    // Se o cache estiver vazio, tenta recarregar
    if (!todosAnuncios || todosAnuncios.length === 0) {
        primeiraCarga = false;
        carregarAnunciosInicial();
    } else {
        renderizarAnuncios(todosAnuncios);
    }
}
});

document.addEventListener('DOMContentLoaded', () => {
    const savedMode = sessionStorage.getItem('pedeai_mode');
    const root = document.getElementById('classifieds-root');
    if (!root) return;
    if (savedMode === 'classifieds') {
        ['dynamicHeader', 'featuredStrip', 'chipContainer', 'products-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        root.style.display = 'block';
        montarEstrutura();
    } else {
        root.style.display = 'none';
    }
});