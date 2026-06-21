import { db, GetRegrasLojista, APP_URL } from './config.js';
import {doc, getDoc, collection, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let itemAtualConfig = null;
let lojistaInfoCache = null;
window.tamanhoSelecionadoAtual = null;

function otimizarURL(url, width = 400) {
    if (!url || typeof url !== 'string') {
        return "https://via.placeholder.com/300";
    }

    if (!url.includes('cloudinary.com/image/upload')) {
        return url;
    }

    // evita reaplicar otimização
    if (url.includes('f_auto') || url.includes('q_auto')) {
        return url;
    }

    return url.replace(
        '/image/upload/',
        `/image/upload/f_auto,q_auto:eco,w_${width},c_limit/`
    );
}

function otimizarVideoURL(url) {
    if (!url || typeof url !== 'string' || !url.includes('cloudinary.com/video/upload')) return url;
    if (url.includes('f_auto') || url.includes('q_auto')) return url;
    return url.replace('/video/upload/', '/video/upload/f_auto,q_auto:low,vc_auto/');
}


// Função para gerar link do produto
function gerarLinkVitrine(sellerId, prodId, modo) {
    const base = `${APP_URL}/vitrine-lojista.html`;
    return `${base}?seller=${sellerId}&product=${prodId}&modo=${modo}`;
}

export async function carregarVitrineCompleta() {
    const params = new URLSearchParams(window.location.search);
    const sellerId = params.get('seller');
    const activeProductId = params.get('product'); 
    const modo = params.get('modo') || 'produto';
    const mainContainer = document.getElementById('productDetail');

    if (!mainContainer) return;

    try {
        let lojistaInfo = { nomeLoja: "Loja", fotoPerfil: "" };
        let regrasLojista = { podeExibirProdutos: true };

        if (sellerId) {
            const s = await getDoc(doc(db, "usuarios", sellerId));
            if (s.exists()) {
                lojistaInfo = s.data();
                lojistaInfoCache = lojistaInfo;
                lojistaInfoCache.id = sellerId;
                regrasLojista = GetRegrasLojista(lojistaInfo);

                if (!regrasLojista.podeExibirProdutos || regrasLojista.isBloqueado) {
                    mainContainer.innerHTML = "";
                    return;
                }

                // Define qual foto e qual nome usar baseado no modo e no que existe salvo no banco
                const fotoParaExibir = (modo === 'gourmet' ? lojistaInfo.fotoPerfilComida : lojistaInfo.fotoPerfilGeral) || lojistaInfo.fotoPerfil || 'https://via.placeholder.com/100';
                const nomeParaExibir = (modo === 'gourmet' ? lojistaInfo.nomeLojaComida : lojistaInfo.nomeLojaGeral) || lojistaInfo.nomeLoja || 'Vitrine';

                const header = document.getElementById('main-header');
                if (header) {
                    header.innerHTML = `
<div style="display: flex; align-items: center; width: 100%; justify-content: space-between; padding: 0 5px;">

    <div style="display: flex; align-items: center;">
        <a href="javascript:void(0)" class="back-btn" style="text-decoration:none; color:#222;" onclick="history.back(); return false;">
    <i class="fas fa-arrow-left"></i>
</a>

        <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 700; font-size: 14px; color:#111;">
                ${nomeParaExibir}
            </span>

            <span style="font-size: 11px; color:#888;">
                ${modo === 'gourmet' ? 'Cardápio Digital' : 'Loja Oficial'}
            </span>
        </div>
    </div>

    <div style="display:flex; align-items:center; gap:10px;">

        <button 
    onclick="window.abrirModalDenuncia('${sellerId}', '${nomeParaExibir}')"
    style="
        border: 1px solid #e8e8e8;
        background: #fafafa;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #aaa;
        font-size: 13px;
        transition: all 0.2s;
    ">
    <i class="fas fa-ellipsis-v"></i>
</button>

        <img 
            src="${otimizarURL(fotoParaExibir, 100)}"
            style="
                width: 38px;
                height: 38px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid #ee4d2d;
                box-shadow: 0 2px 8px rgba(238,77,45,0.18);
            ">
    </div>

</div>`;
                }
                
            } else { return; }
        }

        const snap = await getDocs(collection(db, "produtos"));
        let htmlDestaque = "";
        let htmlGridLojista = "";
        let categoriaAtiva = "";

        const docPrincipal = await getDoc(doc(db, "produtos", activeProductId));
        if (docPrincipal.exists()) {
            categoriaAtiva = docPrincipal.data().categoria;
        }

        snap.forEach(d => {
            const p = d.data();
            if (p.status === "desativado" || p.visivel === false) return;

            // Normaliza a origem das fotos aceitando: p.fotos (array), p.foto (array) ou p.foto (string)
let listaFotosRaw = [];
if (Array.isArray(p.fotos)) {
    listaFotosRaw = p.fotos;
} else if (Array.isArray(p.foto)) {
    listaFotosRaw = p.foto;
} else if (typeof p.foto === 'string' && p.foto.trim() !== '') {
    listaFotosRaw = [p.foto];
} else {
    listaFotosRaw = ["https://via.placeholder.com/300"];
}

const fotos = listaFotosRaw;
const imgCapaRaw = fotos[0];
            const imgCapaOtimizada = otimizarURL(imgCapaRaw, 600);
            const linkProduto = gerarLinkVitrine(sellerId, d.id, modo);
            // Agora sempre considera que tem config se for Comida, para oferecer os adicionais da loja
const temConfig = p.categoria === 'Comida';
            const descSanitizada = (p.descricao || "").replace(/'/g, "\\'").replace(/\n/g, " ");
            const nomeSanitizado = p.nome.replace(/'/g, "\\'");

            // Funções de clique ajustadas para bater com a assinatura do carrinho.js:
            // (id, nome, preco, owner, whatsapp, imagem, linkProduto, descricao)
            
            const funcAddDiretoGeral = `
                (() => {
                    const id = '${d.id}';
                    const nome = '${nomeSanitizado}';
                    const preco = '${p.preco}';
                    const owner = '${p.owner}';
                    const whatsapp = '${p.whatsapp}';
                    const imagem = '${imgCapaRaw}';
                    const link = '${linkProduto}';
                    const tipo = '${p.tipoProduto || ""}';
                    const desc = '${descSanitizada}';
                    
                    if(tipo === 'roupa') {
                        if(!window.tamanhoSelecionadoAtual) {
                            window.mostrarToastTamanho();
                            return;
                        }
                        window.adicionarAoCarrinho(id, nome + ' (Tam: ' + window.tamanhoSelecionadoAtual + ')', preco, owner, whatsapp, imagem, link, desc);
                    } else {
                        window.adicionarAoCarrinho(id, nome, preco, owner, whatsapp, imagem, link, desc);
                    }
                })()
            `;

            const funcAddDiretoSimples = `window.adicionarAoCarrinho('${d.id}', '${nomeSanitizado}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${imgCapaRaw}', '${linkProduto}', '${descSanitizada}')`;
            const adicionaisProduto = (p.adicionais && p.adicionais.length > 0) ? p.adicionais : [];
const adicionaisKey = `adic_${d.id}`;
window[adicionaisKey] = adicionaisProduto;
const funcAddConfig = adicionaisProduto.length > 0 
    ? `window.abrirAdicionaisProduto('${d.id}', '${nomeSanitizado}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${imgCapaRaw}', '${linkProduto}', '${descSanitizada}', window['${adicionaisKey}'])`
    : `window.adicionarAoCarrinho('${d.id}', '${nomeSanitizado}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${imgCapaRaw}', '${linkProduto}', '${descSanitizada}')`;
            
            if (p.categoria !== categoriaAtiva) return;

            if (d.id === activeProductId) {
                if (modo === 'gourmet') {
                // Monta array de mídias
                let mediaItems = [];
                if (p.videoUrl && p.videoUrl.trim() !== "") {
                    mediaItems.push({
                        type: 'video',
                        url: p.videoUrl,
                        poster: p.foto || (p.fotos && p.fotos[0]) || ''
                    });
                }
                fotos.forEach(url => {
                    mediaItems.push({ type: 'image', url: url });
                });

                const sliderHTML = mediaItems.map(item => {
                    if (item.type === 'video') {
                        const videoId = `vid_gourmet_${Math.random()}`;
                        const posterGourmet = item.url && item.url.includes('res.cloudinary.com')
                            ? item.url.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|mov|webm)$/i, '.jpg')
                            : '';
                        return `<div style="position: relative; width: 100%; aspect-ratio: 1.2/1; background: #000; border-radius: inherit; overflow: hidden;">
                            <video 
                                id="${videoId}"
                                src="${otimizarVideoURL(item.url)}" 
                                poster="${posterGourmet}" 
                                preload="none"
                                muted
                                playsinline
                                style="width: 100%; height: 100%; object-fit: cover;"
                            ></video>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 2;">
                                <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(0,0,0,0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 2px solid rgba(255,255,255,0.55); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(0,0,0,0.35);">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="margin-left: 3px;"><path d="M8 5v14l11-7z"/></svg>
                                </div>
                            </div>
                            <div class="custom-video-overlay" style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; gap: 12px; padding: 8px 12px; backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.2s;">
                                <button class="play-pause-btn" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;"><i class="fas fa-play"></i></button>
                                <div class="progress-bar" style="flex: 1; height: 3px; background: rgba(255,255,255,0.3); border-radius: 3px; overflow: hidden;">
                                    <div class="progress" style="width: 0%; height: 100%; background: white;"></div>
                                </div>
                            </div>
                            <div class="replay-overlay" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.2s; border-radius: inherit;">
                                <button class="replay-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; font-size: 48px; cursor: pointer; width: 80px; height: 80px; border-radius: 50%; backdrop-filter: blur(8px);"><i class="fas fa-redo-alt"></i></button>
                            </div>
                        </div>`;
                    } else {
                        return `<img src="${otimizarURL(item.url, 800)}" style="width: 100%; aspect-ratio: 1.2/1; object-fit: cover; flex-shrink: 0; scroll-snap-align: start;">`;
                    }
                }).join('');

                htmlDestaque = `
                        <div class="gourmet-card-container">
                            <div class="gourmet-image-wrapper">
                                <div id="slider-main" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;">
                                    ${sliderHTML}
                                </div>
                            </div>
                            <div class="gourmet-info-header">
                                <h1 class="gourmet-title">${p.nome}</h1>
                                <span class="gourmet-price">R$ ${p.preco}</span>
                            </div>
                            <div class="desc-gourmet-box">
                                <p class="gourmet-description">${p.descricao || 'Produto selecionado do nosso cardápio.'}</p>
                            </div>
                        </div>
                        <div class="gourmet-section-title">Veja também</div>`;
                
                // Função global para acionar o modal gourmet (adicionais/observação)
                window.adicionarProdutoAtual = () => {
                    if (adicionaisProduto.length > 0) {
                        window.abrirAdicionaisProduto(d.id, nomeSanitizado, p.preco, p.owner, p.whatsapp, imgCapaRaw, linkProduto, descSanitizada, adicionaisProduto);
                    } else {
                        window.abrirConfigComida(d.id, false, true);
                    }
                };
                } else {
                    let htmlRoupa = "";
                    if(p.tipoProduto === 'roupa') {
                        let opcoes = (p.tamanhosDisponiveis && p.tamanhosDisponiveis.length > 0) ? p.tamanhosDisponiveis : (p.numeracoes ? p.numeracoes.split(',').map(s => s.trim()) : []);
                        if(opcoes.length > 0) {
                            htmlRoupa = `<div class="tamanho-container" id="tamanho-container-hidden" style="display:none;"><span class="tamanho-label">Selecione o Tamanho:</span><div class="tamanho-grid">${opcoes.map(t => `<button class="btn-tamanho" onclick="window.selecionarTamanho(this, '${t}')">${t}</button>`).join('')}</div></div>`;
                        }
                    }

                    // Monta array de mídias
                    let mediaItems = [];
                    if (p.videoUrl && p.videoUrl.trim() !== "") {
                        mediaItems.push({
                            type: 'video',
                            url: p.videoUrl,
                            poster: p.foto || (p.fotos && p.fotos[0]) || ''
                        });
                    }
                    fotos.forEach(url => {
                        mediaItems.push({ type: 'image', url: url });
                    });

                    const sliderHTML = mediaItems.map((item, idx) => {
                        if (item.type === 'video') {
                            const videoId = `vid_prod_${Math.random()}`;
                            return `
  <div style="min-width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#000; scroll-snap-align:start; position:relative;">
    <video id="${videoId}" src="${otimizarVideoURL(item.url)}" poster="${item.url && item.url.includes('res.cloudinary.com') ? item.url.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|mov|webm)$/i, '.jpg') : ''}" preload="none" muted playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video>
    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); pointer-events:none; z-index:2;">
        <div style="width:64px; height:64px; border-radius:50%; background:rgba(0,0,0,0.45); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); border:2px solid rgba(255,255,255,0.55); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 24px rgba(0,0,0,0.4);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style="margin-left:4px;"><path d="M8 5v14l11-7z"/></svg>
        </div>
    </div>
    <div class="custom-video-overlay" style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; gap:12px; padding:8px 12px; backdrop-filter:blur(4px); opacity:0; transition:opacity 0.2s;">
        <button class="play-pause-btn" style="background:none; border:none; color:white; font-size:18px; cursor:pointer;"><i class="fas fa-play"></i></button>
        <div class="progress-bar" style="flex:1; height:3px; background:rgba(255,255,255,0.3); border-radius:3px; overflow:hidden;"><div class="progress" style="width:0%; height:100%; background:white;"></div></div>
    </div>
    <div class="replay-overlay" style="position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity 0.2s; border-radius:inherit;">
        <button class="replay-btn" style="background:rgba(255,255,255,0.2); border:none; color:white; font-size:48px; cursor:pointer; width:80px; height:80px; border-radius:50%; backdrop-filter:blur(8px);"><i class="fas fa-redo-alt"></i></button>
    </div>
  </div>`;
 } else {
    return `
  <div style="min-width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#fff; scroll-snap-align:start;">
    <img src="${otimizarURL(item.url, 1000)}"
         decode="async"
         loading="eager"
         onload="
             const w = this.naturalWidth;
             const h = this.naturalHeight;
             if (h > w) {
                 this.style.objectFit = 'contain';
                 this.style.transform = 'scale(1.15) scaleX(1.12)';
             }
             else if (w > h) {
                 this.style.objectFit = 'cover';
                 this.style.transform = 'scale(1.02) scaleX(1.01)';
             }
             else {
                 this.style.objectFit = 'contain';
                 this.style.transform = 'scale(1.08) scaleX(1.02)';
             }
         "
         style="width:100%; height:100%; object-position:center; transition:0.2s;">
  </div>`;
}
                    }).join('');

                    htmlDestaque = `
    <div class="destaque-container" style="background:#fff;">
        <div class="slider-wrapper" style="width:100%; height:420px; position:relative; background:#fff; border-bottom:1px solid #f0f0f0;">
            <div class="image-slider" id="slider-main" style="display:flex; width:100%; height:100%; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none;">
                ${sliderHTML}
            </div>
            <div class="photo-counter" style="position:absolute; bottom:12px; right:12px; background:rgba(0,0,0,0.5); color:#fff; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; backdrop-filter:blur(6px);">
                <span id="counter">1</span> / ${mediaItems.length}
            </div>
        </div>
                            ${mediaItems.length > 1 ? `
                            <div id="thumbnails-strip" style="display:flex; gap:7px; padding:10px 14px 2px; overflow-x:auto; scrollbar-width:none; background:#fff; border-bottom:1px solid #f0f0f0;">
                                ${mediaItems.map((mItem, mIdx) => `
                                    <div onclick="const sl=document.getElementById('slider-main'); sl.scrollTo({left:sl.offsetWidth*${mIdx}, behavior:'smooth'}); document.getElementById('counter').innerText=${mIdx+1}; document.querySelectorAll('.thumb-item').forEach(t=>{t.style.borderColor='#e0e0e0';}); this.style.borderColor='#ee4d2d';" class="thumb-item" style="flex-shrink:0; width:52px; height:52px; border-radius:8px; overflow:hidden; border:2px solid ${mIdx===0?'#ee4d2d':'#e0e0e0'}; cursor:pointer; background:#f5f5f5; display:flex; align-items:center; justify-content:center;">
                                        ${mItem.type === 'video'
                                            ? `<div style="width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;"><i class="fas fa-play" style="color:#fff;font-size:16px;"></i></div>`
                                            : `<img src="${otimizarURL(mItem.url, 120)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`
                                        }
                                    </div>
                                `).join('')}
                            </div>` : ''}
                            <div class="product-info-box" style="padding: 18px 16px 24px;">
                                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:6px;">
                                    <div class="p-name-main" style="font-size:19px; color:#1a1a1a; font-weight:700; line-height:1.3; flex:1;">${p.nome}</div>
                                    <div class="p-price-main" style="color:#ee4d2d; font-size:24px; font-weight:800; white-space:nowrap;">R$ ${p.preco}</div>
                                </div>
                                <div class="desc-produto-box">
                                    <span class="desc-produto-label">Descrição</span>
                                    <p class="desc-produto-text">${p.descricao || 'Nenhuma descrição informada.'}</p>
                                </div>
                                ${htmlRoupa}
                            </div>
                        </div>`;
                    
                    // Função global para produtos com tamanho
                    window.adicionarProdutoAtual = () => {
                        const tipoProd = p.tipoProduto || "";
                        if(tipoProd === 'roupa') {
                            // Mostrar modal de seleção de tamanho
                            const tamanhosExistentes = (p.tamanhosDisponiveis && p.tamanhosDisponiveis.length > 0) ? p.tamanhosDisponiveis : (p.numeracoes ? p.numeracoes.split(',').map(s => s.trim()) : []);
                            if(tamanhosExistentes.length === 0) {
                                window.adicionarAoCarrinho(d.id, nomeSanitizado, p.preco, p.owner, p.whatsapp, imgCapaRaw, linkProduto, descSanitizada);
                                exibirToastSucesso();
                                return;
                            }
                            
                            // modal simples para tamanho
                            const modalHTML = `
                            <div id="modal-tamanho-simples" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center;">
                                <div style="background:#fff; border-radius:20px; width:85%; max-width:300px; padding:20px; text-align:center;">
                                    <h3 style="margin-top:0;">Escolha o tamanho</h3>
                                    <div class="tamanho-grid" style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">${tamanhosExistentes.map(t => `<button class="modal-tamanho-btn" data-tamanho="${t}" style="border:1px solid #ddd; background:#fff; padding:8px 16px; border-radius:40px; font-size:14px; cursor:pointer;">${t}</button>`).join('')}</div>
                                    <button id="modal-tamanho-cancel" style="margin-top:20px; background:#f0f0f0; border:none; padding:8px 16px; border-radius:40px; cursor:pointer;">Cancelar</button>
                                </div>
                            </div>`;
                            document.body.insertAdjacentHTML('beforeend', modalHTML);
                            document.querySelectorAll('.modal-tamanho-btn').forEach(btn => {
                                btn.addEventListener('click', (e) => {
                                    const tamanhoSelecionado = btn.getAttribute('data-tamanho');
                                    window.adicionarAoCarrinho(d.id, nomeSanitizado + ' (Tam: ' + tamanhoSelecionado + ')', p.preco, p.owner, p.whatsapp, imgCapaRaw, linkProduto, descSanitizada);
                                    document.getElementById('modal-tamanho-simples')?.remove();
                                    exibirToastSucesso();
                                });
                            });
                            document.getElementById('modal-tamanho-cancel')?.addEventListener('click', () => {
                                document.getElementById('modal-tamanho-simples')?.remove();
                            });
                        } else {
                            window.adicionarAoCarrinho(d.id, nomeSanitizado, p.preco, p.owner, p.whatsapp, imgCapaRaw, linkProduto, descSanitizada);
                            exibirToastSucesso();
                        }
                    };
                }
            } else if (p.owner === sellerId) {
            // Gourmet mantém visual premium com bordas suaves e imagem preenchida


                
// Adiciona ícone de vídeo se existir
                const hasVideo = p.videoUrl && p.videoUrl.trim() !== "";
                const videoBadge = hasVideo ? `<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none;"><div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(0,0,0,0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 2px solid rgba(255,255,255,0.55); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 12px rgba(0,0,0,0.35);"><svg width="14" height="14" viewBox="0 0 24 24" fill="white" style="margin-left: 2px;"><path d="M8 5v14l11-7z"/></svg></div></div>` : '';
                htmlGridLojista += `
                    <div class="card-menor" onclick="window.abrirVitrine ? window.abrirVitrine('${sellerId}', '${d.id}', '${modo}') : window.location.href='vitrine-lojista.html?seller=${sellerId}&product=${d.id}&modo=${modo}'" style="
                        background: #fff;
                        border-radius: 12px;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                        border: 1px solid #f0f0f0;
                        position: relative;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                        cursor: pointer;
                    ">
                        <div style="position: relative; overflow: hidden;">
                            <img src="${otimizarURL(imgCapaOtimizada, 300)}" loading="lazy" style="width: 100%; height: 230px; background: #fcfcfc; padding: 4px; border-radius: 14px 14px 0 0; display: block; transition: 0.2s; object-fit: cover;">
                            ${videoBadge}
                        </div>
                        <div style="padding: 9px 10px 12px;">
                            <div style="font-size: 12px; color: #222; font-weight: 600; margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; height: 34px;">${p.nome}</div>
                            <div style="color: #ee4d2d; font-weight: 800; font-size: 15px; letter-spacing: -0.3px;">R$ ${p.preco}</div>
                        </div>
                    </div>`;
            }
        });

        mainContainer.innerHTML = htmlDestaque + `
            <div style="padding: 16px 14px 24px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px;">
                    <div style="width: 3px; height: 18px; background: #ee4d2d; border-radius: 3px; flex-shrink: 0;"></div>
                    <h3 style="font-size: 14px; color: #1a1a1a; margin: 0; font-weight: 700; letter-spacing: 0.1px;">Mais de ${lojistaInfo.nomeLoja || 'esta loja'}</h3>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    ${htmlGridLojista}
                </div>
            </div>`;

        const slider = document.getElementById('slider-main');
        const counter = document.getElementById('counter');
        if (slider && counter) {
            slider.addEventListener('scroll', () => {
                const index = Math.round(slider.scrollLeft / slider.offsetWidth) + 1;
                counter.innerText = index;
                // Atualiza borda das miniaturas ao scrollar
                document.querySelectorAll('.thumb-item').forEach((t, i) => {
                    t.style.borderColor = (i === index - 1) ? '#ee4d2d' : '#e0e0e0';
                });
            });
        }

        // Conecta lógica de play/pause em todos os vídeos do slider
        document.querySelectorAll('#slider-main video').forEach(video => {
            const wrapper = video.closest('div[style*="position:relative"], div[style*="position: relative"]');
            if (!wrapper) return;

            const overlay = wrapper.querySelector('.custom-video-overlay');
            const playPauseBtn = wrapper.querySelector('.play-pause-btn');
            const progressEl = wrapper.querySelector('.progress');
            const replayOverlay = wrapper.querySelector('.replay-overlay');
            const replayBtn = wrapper.querySelector('.replay-btn');
            const playIconCenter = wrapper.querySelector('div[style*="inset: 0"], div[style*="top:50%"], div[style*="top: 50%"]');

            function mostrarOverlay() {
                if (overlay) overlay.style.opacity = '1';
            }
            function ocultarOverlay() {
                if (overlay) overlay.style.opacity = '0';
            }
            function ocultarPlayIconCenter() {
                if (playIconCenter) playIconCenter.style.display = 'none';
            }

            // Clique no ícone central de play inicia o vídeo
            if (playIconCenter) {
                playIconCenter.style.pointerEvents = 'auto';
                playIconCenter.style.cursor = 'pointer';
                playIconCenter.addEventListener('click', () => {
                    if (video.readyState === 0) video.load();
                    video.muted = true;
                    video.play().catch(() => {});
                    ocultarPlayIconCenter();
                    mostrarOverlay();
                });
            }

            // Clique direto no vídeo
            video.addEventListener('click', () => {
                if (video.paused) {
                    if (video.readyState === 0) video.load();
                    video.muted = true;
                    video.play().catch(() => {});
                    ocultarPlayIconCenter();
                    mostrarOverlay();
                } else {
                    video.pause();
                    mostrarOverlay();
                }
            });

            // Botão play/pause da barra inferior
            if (playPauseBtn) {
                playPauseBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (video.paused) {
                        if (video.readyState === 0) video.load();
                        video.muted = true;
                        video.play().catch(() => {});
                    } else {
                        video.pause();
                    }
                });
            }

            // Atualiza ícone e barra de progresso
            video.addEventListener('play', () => {
                if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
                mostrarOverlay();
                setTimeout(ocultarOverlay, 2000);
            });
            video.addEventListener('pause', () => {
                if (playPauseBtn) playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                mostrarOverlay();
            });
            video.addEventListener('timeupdate', () => {
                if (!video.duration) return;
                const pct = (video.currentTime / video.duration) * 100;
                if (progressEl) progressEl.style.width = pct + '%';
            });

            // Fim do vídeo — mostra overlay de replay
            video.addEventListener('ended', () => {
                if (replayOverlay) {
                    replayOverlay.style.opacity = '1';
                    replayOverlay.style.pointerEvents = 'auto';
                }
                ocultarOverlay();
            });

            // Botão replay
            if (replayBtn) {
                replayBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    video.currentTime = 0;
                    video.play().catch(() => {});
                    if (replayOverlay) {
                        replayOverlay.style.opacity = '0';
                        replayOverlay.style.pointerEvents = 'none';
                    }
                    mostrarOverlay();
                    setTimeout(ocultarOverlay, 2000);
                });
            }
        });

    } catch (error) { console.error("Erro ao carregar vitrine:", error); }
}

window.selecionarTamanho = (btn, tamanho) => {
    document.querySelectorAll('.btn-tamanho').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    window.tamanhoSelecionadoAtual = tamanho;
};

window.abrirConfigComida = async (id, isGlobal = false, isIntermediario = false) => {
    const modal = document.getElementById('modalComida');
    const overlay = document.getElementById('overlayComida');
    const content = document.getElementById('modalContent');
    
    content.innerHTML = "Carregando...";
    modal.classList.add('active');
    overlay.style.display = 'block';

    let configData = null;
    if (isGlobal) {
        configData = { 
            nome: lojistaInfoCache.montarTitulo || "Personalizar", 
            variacoes: lojistaInfoCache.montarVariacoes || [], 
            adicionais: lojistaInfoCache.montarAdicionais || [], 
            isMontarGlobal: true, 
            owner: lojistaInfoCache.id, 
            whatsapp: lojistaInfoCache.whatsapp, 
            foto: lojistaInfoCache.fotoPerfil || "", 
            descricao: "" 
        };
    } else {
        const d = await getDoc(doc(db, "produtos", id));
        if (d.exists()) { 
            const data = d.data();
            configData = { 
                ...data, 
                id: d.id,
                adicionais: [...(data.adicionais || []), ...(lojistaInfoCache.montarAdicionais || [])]
            }; 
        }
    }

    if (!configData) return;
    itemAtualConfig = configData;

    let html = "";
    
    // 1. Renderiza Variações (Sempre visíveis se existirem)
    if (configData.variacoes && configData.variacoes.length > 0) {
        html += `<div class="config-section-title">Escolha uma opção</div>`;
        configData.variacoes.forEach((v, idx) => {
            html += `
                <label class="config-item">
                    <div class="config-info">
                        <span class="config-name">${v.nome}</span>
                        <span class="config-price">+ R$ ${v.preco}</span>
                    </div>
                    <input type="radio" name="variacao" value="${idx}" onchange="window.atualizarPrecoModal()" ${idx === 0 ? 'checked' : ''}>
                </label>`;
        });
    }

    // 2. Renderiza Adicionais (Escondidos por padrão)
    if (configData.adicionais && configData.adicionais.length > 0) {
        html += `
            <div id="btn-toggle-adicionais" 
                 onclick="const lista = document.getElementById('lista-adicionais'); lista.style.display = (lista.style.display === 'none') ? 'block' : 'none';"
                 style="margin: 15px; padding: 15px; border: 1px solid #e2e2e2; background: #fdfdfd; color: #333; text-align: center; border-radius: 10px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <i class="fas fa-plus" style="color: #ea1d2c;"></i> 
                ADICIONAR EXTRAS
            </div>

            <div id="lista-adicionais" style="display: none;">
                <div class="config-section-title">Adicionais</div>
                ${configData.adicionais.map((a, idx) => `
                    <label class="config-item">
                        <div class="config-info">
                            <span class="config-name">${a.nome}</span>
                            <span class="config-price">+ R$ ${a.preco}</span>
                        </div>
                        <input type="checkbox" name="adicional" value="${idx}" onchange="window.atualizarPrecoModal()">
                    </label>
                `).join('')}
            </div>`;
    }

    content.innerHTML = html;
    document.getElementById('modalNome').innerText = configData.nome;
    
    const campoDescModal = document.getElementById('texto-descricao-modal');
    if(campoDescModal) {
        campoDescModal.innerText = itemAtualConfig.descricao || "Ingredientes tradicionais da casa.";
        const containerDescModal = document.getElementById('container-desc-modal');
        if(containerDescModal) containerDescModal.style.display = itemAtualConfig.descricao ? 'block' : 'none';
    }

    const campoObs = document.getElementById('gourmet-obs');
    if(campoObs) {
        campoObs.value = "";
        campoObs.placeholder = itemAtualConfig.isMontarGlobal ? "Como deseja sua montagem?" : "Alguma observação? (Ex: sem cebola)";
    }
    
    window.atualizarPrecoModal();
};

window.atualizarPrecoModal = () => {
    let total = itemAtualConfig.isMontarGlobal ? 0 : parseFloat(itemAtualConfig.preco.toString().replace(',', '.'));
    const varSelected = document.querySelector('input[name="variacao"]:checked');
    if(varSelected) total += parseFloat(itemAtualConfig.variacoes[varSelected.value].preco.replace(',', '.'));
    document.querySelectorAll('input[name="adicional"]:checked').forEach(cb => {
        total += parseFloat(itemAtualConfig.adicionais[cb.value].preco.replace(',', '.'));
    });
    document.getElementById('btnConfirmarConfig').innerText = `ADICIONAR R$ ${total.toFixed(2).replace('.', ',')}`;
    document.getElementById('btnConfirmarConfig').onclick = () => {
        let resumoConfig = "";
        if(varSelected) resumoConfig += ` (${itemAtualConfig.variacoes[varSelected.value].nome})`;
        let extras = [];
        document.querySelectorAll('input[name="adicional"]:checked').forEach(cb => { extras.push(itemAtualConfig.adicionais[cb.value].nome); });
        if(extras.length > 0) resumoConfig += itemAtualConfig.isMontarGlobal ? ` [Montagem: ${extras.join(', ')}]` : ` + ${extras.join(', ')}`;
        
        const obs = document.getElementById('gourmet-obs')?.value || "";
        if(obs) resumoConfig += ` [Obs: ${obs}]`;
        
        const descricaoFinal = (itemAtualConfig.descricao || "") + (resumoConfig ? " | Escolhas: " + resumoConfig : "");
        const linkProduto = gerarLinkVitrine(lojistaInfoCache.id, itemAtualConfig.id || 'montar_global', (new URLSearchParams(window.location.search)).get('modo') || 'produto');
        
        // Pega a imagem do produto ou da loja para a mini fotinha
        const imgItem = Array.isArray(itemAtualConfig.foto) ? itemAtualConfig.foto[0] : itemAtualConfig.foto;

        window.adicionarAoCarrinho(
            itemAtualConfig.id || 'montar_global', 
            itemAtualConfig.nome, 
            total.toFixed(2).replace('.', ','), 
            itemAtualConfig.owner, 
            itemAtualConfig.whatsapp, 
            imgItem || 'https://via.placeholder.com/100', 
            linkProduto, 
            descricaoFinal
        );
        
        document.getElementById('modalComida').classList.remove('active');
        exibirToastSucesso();
        document.getElementById('overlayComida').style.display = 'none';
    };
}
window.abrirAdicionaisProduto = (id, nome, preco, owner, whatsapp, imagem, link, desc, adicionais) => {
    const modal = document.getElementById('modalComida');
    const overlay = document.getElementById('overlayComida');
    document.getElementById('modalNome').innerText = nome;
    const descModal = document.getElementById('texto-descricao-modal');
    if(descModal) descModal.innerText = desc || '';

    let selecionados = {};

    document.getElementById('modalContent').innerHTML = `
        <div class="config-section-title">Adicionais opcionais</div>
        ${adicionais.map((a, i) => `
            <div class="config-item" onclick="toggleAdicionalProduto(${i}, '${a.nome}', '${a.preco}', this)">
                <div class="config-info">
                    <span class="config-name">${a.nome}</span>
                    <span class="config-price">${parseFloat(a.preco) > 0 ? '+ R$ ' + parseFloat(a.preco).toFixed(2) : 'Grátis'}</span>
                </div>
                <div id="check-adic-${i}" style="width:22px; height:22px; border-radius:50%; border:2px solid #ddd; display:flex; align-items:center; justify-content:center; font-size:12px; color:white;"></div>
            </div>
        `).join('')}
    `;

    const precoBase = parseFloat(preco) || 0;
    
    function atualizarBotaoConfirmar() {
        const extras = Object.values(selecionados);
        const totalExtras = extras.reduce((sum, e) => sum + e.preco, 0);
        const totalFinal = (precoBase + totalExtras).toFixed(2).replace('.', ',');
        document.getElementById('btnConfirmarConfig').innerText = `CONFIRMAR — R$ ${totalFinal}`;
    }

    atualizarBotaoConfirmar();

    window.toggleAdicionalProduto = (i, nome, preco, el) => {
        const check = document.getElementById(`check-adic-${i}`);
        if(selecionados[i]) {
            delete selecionados[i];
            check.style.background = '';
            check.style.borderColor = '#ddd';
            check.innerText = '';
        } else {
            selecionados[i] = { nome, preco: parseFloat(preco) || 0 };
            check.style.background = '#ea1d2c';
            check.style.borderColor = '#ea1d2c';
            check.innerText = '✓';
        }
        atualizarBotaoConfirmar();
    };

    document.getElementById('btnConfirmarConfig').onclick = () => {
        const obs = document.getElementById('gourmet-obs')?.value || '';
        const extras = Object.values(selecionados);
        const totalExtras = extras.reduce((sum, e) => sum + e.preco, 0);
        const totalFinal = (parseFloat(preco) + totalExtras).toFixed(2);
        const nomeFinal = extras.length > 0 
            ? `${nome} (+${extras.map(e => e.nome).join(', ')})` 
            : nome;
        const descFinal = obs ? `${desc} | Obs: ${obs}` : desc;
        window.adicionarAoCarrinho(id, nomeFinal, totalFinal, owner, whatsapp, imagem, link, descFinal);
        modal.classList.remove('active');
        exibirToastSucesso();
        overlay.style.display = 'none';
    };

    overlay.style.display = 'block';
    modal.classList.add('active');
};
let denunciaAtual = null;

window.abrirModalDenuncia = (sellerId, lojaNome) => {

    denunciaAtual = {
        sellerId,
        lojaNome
    };

    document.getElementById('modalDenuncia').style.display = 'block';
};

window.fecharModalDenuncia = () => {

    document.getElementById('modalDenuncia').style.display = 'none';

    document.getElementById('textoDenuncia').value = '';
};

window.enviarDenuncia = async () => {

    const texto = document.getElementById('textoDenuncia').value.trim();

    if(!texto) {
        if (typeof window.mostrarToastIOS === 'function') {
            window.mostrarToastIOS('Descreva o motivo da denúncia.', true);
        } else {
            alert('Descreva o motivo da denúncia.');
        }
        return;
    }

    try {

        await addDoc(collection(db, "denuncias"), {

            sellerId: denunciaAtual.sellerId,
            lojaNome: denunciaAtual.lojaNome,
            motivo: texto,

            data: serverTimestamp(),

            origem: "vitrine-lojista"
        });

        if (typeof window.mostrarToastIOS === 'function') {
            window.mostrarToastIOS('Denúncia enviada com sucesso!');
        } else {
            alert('Denúncia enviada com sucesso.');
        }

        window.fecharModalDenuncia();

    } catch(e) {

        console.error(e);

        if (typeof window.mostrarToastIOS === 'function') {
            window.mostrarToastIOS('Erro ao enviar denúncia.', true);
        } else {
            alert('Erro ao enviar denúncia.');
        }
    }
};

// Função auxiliar para renderizar o Toast elegante estilo App Premium (iOS/iFood/Shopee)
function exibirToastSucesso(mensagem = "Item adicionado com sucesso") {
    const toastExistente = document.getElementById('toast-sucesso-container');
    if (toastExistente) toastExistente.remove();

    const toast = document.createElement('div');
    toast.id = 'toast-sucesso-container';
    toast.style.cssText = `
        position: fixed;
        bottom: 50px;
        left: 50%;
        transform: translate(-50%, 30px);
        background: rgba(20, 20, 20, 0.94);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 50px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
        z-index: 999999;
        opacity: 0;
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        pointer-events: none;
        white-space: nowrap;
    `;

    toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span style="letter-spacing: 0.2px;">${mensagem}</span>
    `;

    document.body.appendChild(toast);

    // Ativa animação de entrada suave (fade-in + slide-up leve)
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%, 0)';
    }, 20);

    // Desaparece e remove do DOM automaticamente
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -15px)';
        setTimeout(() => toast.remove(), 400);
    }, 2300);
}
