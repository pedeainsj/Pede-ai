import { db, GetRegrasLojista, APP_URL } from './config.js';
import { doc, getDoc, collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const lojistaId = params.get('lojista') || params.get('seller');
const modo = params.get('modo') || 'produto';
const activeProductId = params.get('product');

let itemAtualConfig = null;
let lojistaInfoCache = null;
window.tamanhoSelecionadoAtual = null;

function esconderSkeletonCartao() {
    const skeleton = document.getElementById('vitrineSkeletonCartao');
    const mainContainer = document.getElementById('productDetail');
    if (!skeleton || !mainContainer) return;
    if (skeleton.dataset.removido) return;
    skeleton.dataset.removido = 'true';

    mainContainer.style.display = 'block';
    mainContainer.classList.add('conteudo-pronto-cartao');
    skeleton.classList.add('skeleton-saindo');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            skeleton.remove();
        });
    });
}

// Pré-carrega a imagem de capa antes de revelar o conteúdo.
// Resolve sempre (sucesso, erro ou timeout de 4s) para nunca travar o loading.
function preCarregarImagemCartao(url) {
    return new Promise((resolve) => {
        if (!url) { resolve(); return; }
        const img = new Image();
        const timeout = setTimeout(resolve, 4000);
        img.onload = () => { clearTimeout(timeout); resolve(); };
        img.onerror = () => { clearTimeout(timeout); resolve(); };
        img.src = url;
    });
}

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


function gerarLinkDestaque(prodId) {
    const base = `${APP_URL}/vitrine-cartao.html`;
    return `${base}?seller=${lojistaId}&product=${prodId}&modo=${modo}`;
}

async function init(tentativa = 0) {
    if (!lojistaId) {
        // Em alguns navegadores internos (ex: WebView do Instagram), a URL
        // pode ainda não estar 100% disponível no primeiro instante de execução
        // do módulo. Tenta novamente algumas vezes antes de desistir.
        if (tentativa < 5) {
            setTimeout(() => init(tentativa + 1), 200);
            return;
        }
        esconderSkeletonCartao();
        return;
    }
    if (modo === 'gourmet') document.body.classList.add('gourmet-mode');
    await carregarDadosEProdutos();
}

async function carregarDadosEProdutos() {
    const mainContainer = document.getElementById('productDetail');
    if (!mainContainer) { esconderSkeletonCartao(); return; }
    try {
        const userDoc = await getDoc(doc(db, "usuarios", lojistaId));
        if (!userDoc.exists()) { esconderSkeletonCartao(); return; }

        lojistaInfoCache = userDoc.data();
        lojistaInfoCache.id = lojistaId;

        const regras = GetRegrasLojista(lojistaInfoCache);
        if (!regras.podeExibirProdutos || regras.isBloqueado) {
            const nomeEl = document.getElementById('nomeLojista');
            const fotoEl = document.getElementById('fotoLojista');
            if (nomeEl) nomeEl.innerText = "";
            if (fotoEl) fotoEl.style.display = 'none';
            if (mainContainer) mainContainer.innerHTML = "";
            esconderSkeletonCartao();
            return;
        }

        const nomeLoja = (modo === 'gourmet' ? lojistaInfoCache.nomeLojaComida : lojistaInfoCache.nomeLojaGeral) || lojistaInfoCache.nomeLoja || "Loja";
        const fotoLoja = (modo === 'gourmet' ? lojistaInfoCache.fotoPerfilComida : lojistaInfoCache.fotoPerfilGeral) || lojistaInfoCache.fotoPerfil;
        
        document.getElementById('nomeLojista').innerText = nomeLoja;
        document.getElementById('fotoLojista').src = otimizarURL(fotoLoja, 150);
        
        const snap = await getDocs(collection(db, "produtos"));
        let htmlDestaque = "";
        let htmlGridLojista = "";
        let imagemCapaAtivaCartao = "";

        snap.forEach(d => {
            const p = d.data();
            if (p.owner !== lojistaId) return;
            if (p.status === "pausado" || p.visivel === false) return; 
            if (modo === 'gourmet' && p.categoria !== 'Comida') return;
            if (modo !== 'gourmet' && p.categoria === 'Comida') return;

            const fotos = Array.isArray(p.foto) ? p.foto : [p.foto];
            const imgCapa = otimizarURL(fotos[0], 1000);
            const linkDestaque = gerarLinkDestaque(d.id);
            
            // Sanitização para evitar quebra de strings no HTML/JS
            const descReal = (p.descricao || "").replace(/'/g, "\\'").replace(/\n/g, " ");
            const nomeReal = p.nome.replace(/'/g, "\\'");
            const adicionaisKey = `adic_${d.id}`;
            window[adicionaisKey] = p.adicionais || [];
            
            if (d.id === activeProductId) {
                imagemCapaAtivaCartao = imgCapa;
                if (modo === 'gourmet') {
                    htmlDestaque = `
                        <div class="container-gourmet-destaque">
                            <img src="${imgCapa}" class="img-gourmet-destaque">
                            <div class="gourmet-destaque-info">
                                <h2 class="titulo-gourmet-destaque">${p.nome}</h2>
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0;">
                                    <div class="preco-gourmet-destaque">R$ ${p.preco}</div>
                                    <div class="menu-produto-wrap" onclick="event.stopPropagation()">
                                        <button class="btn-menu-produto" onclick="window.toggleMenuDenuncia(event, '${d.id}')">
                                            <i class="fas fa-ellipsis-v"></i>
                                        </button>
                                        <div class="menu-flutuante-produto" id="menu-${d.id}">
                                            <div class="menu-item-produto" onclick="window.denunciarProduto('${d.id}', '${nomeReal}')">
                                                <i class="fas fa-flag"></i>
                                                Denunciar produto
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="card-desc-gourmet">
                                <i class="fas fa-quote-left"></i>
                                <p class="texto-desc-gourmet">${p.descricao || 'Sem descrição disponível.'}</p>
                            </div>
                            <div class="container-botoes-gourmet">
                              <button onclick="window.tratarBotaoAdicionar('${d.id}', '${nomeReal}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${otimizarURL(fotos[0], 100)}', '${gerarLinkDestaque(d.id)}', '${descReal}')" class="btn-action-main" style="background:var(--ifood-red); box-shadow:0 4px 16px rgba(234,29,44,0.3);">
                                <i class="fas fa-cart-plus"></i> ADICIONAR
                              </button>
                              ${lojistaInfoCache.montarAtivo && p.permiteMontar === true ? `<button onclick="window.abrirConfigComida('montar_global', true)" class="btn-action-main btn-montar-inline"><i class="fas fa-utensils"></i> MONTAR</button>` : ''}
                            </div>
                        </div>
                        <div style="height:8px; background:#f2f2f7; margin:0;"></div>`;
                } else {
                    htmlDestaque = `
    <div class="destaque-produto-modo-prod">
        <div class="container-img-padrao">
            <img src="${imgCapa}" class="img-padrao-display"
                onload="
                    const w = this.naturalWidth, h = this.naturalHeight;
                    if(h > w) {
                        this.style.objectFit = 'contain';
                        this.style.transform = 'scale(1.15) scaleX(1.12)';
                    } else if(w > h) {
                        this.style.objectFit = 'cover';
                        this.style.transform = 'scale(1.02) scaleX(1.01)';
                    } else {
                        this.style.objectFit = 'contain';
                        this.style.transform = 'scale(1.08) scaleX(1.02)';
                    }
                "
                style="width:100%; height:100%; object-position:center; transition:0.2s;"
            >
        </div>
        <div class="info-area-prod">
            ...
        </div>
                            <div class="info-area-prod">
                                <h2>${p.nome}</h2>
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
                                    <div class="preco-destaque" style="margin-bottom:0;">R$ ${p.preco}</div>
                                    <div class="menu-produto-wrap" onclick="event.stopPropagation()">
                                        <button class="btn-menu-produto" onclick="window.toggleMenuDenuncia(event, '${d.id}')">
                                            <i class="fas fa-ellipsis-v"></i>
                                        </button>
                                        <div class="menu-flutuante-produto" id="menu-${d.id}">
                                            <div class="menu-item-produto" onclick="window.denunciarProduto('${d.id}', '${nomeReal}')">
                                                <i class="fas fa-flag"></i>
                                                Denunciar produto
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="desc-produto-simples">${p.descricao || 'Nenhuma descrição informada.'}</div>
                                ${p.tipoProduto === 'roupa' ? (() => {
    let opcoes = (p.tamanhosDisponiveis && p.tamanhosDisponiveis.length > 0) ? p.tamanhosDisponiveis : (p.numeracoes ? p.numeracoes.split(',').map(s => s.trim()) : []);
    if(opcoes.length === 0) return '';
    return `
        <div class="tamanho-container">
            <div class="tamanho-label">Selecione o Tamanho:</div>
            <div class="tamanho-grid">
                ${opcoes.map(t => `<div class="btn-tamanho" onclick="window.selecionarTamanho(this, '${t}')">${t}</div>`).join('')}
            </div>
        </div>
    `;
})() : ''}
                                <button onclick="window.adicionarProdutoComTamanho('${d.id}', '${nomeReal}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${otimizarURL(fotos[0], 100)}', '${linkDestaque}', '${descReal}', '${p.tipoProduto}')" class="btn-action-main" style="background:var(--orange);">
                                    <i class="fas fa-cart-plus"></i> ADICIONAR AO CARRINHO
                                </button>
                            </div>
                        </div>
                        <div style="height:8px; background:#f2f2f7; margin:0;"></div>`;
                }
            } else {
                // Aplica lógica visual idêntica ao vitrine.js: cover para gourmet, contain para outros
                let estiloImagemCard = `
    object-fit: cover;
    padding: 0;
    background: none;
`;

// AJUSTE SOMENTE PRODUTOS
if (modo !== 'gourmet') {
    estiloImagemCard = `
        width: 100%;
        height: 200px;
        background: #f8f8f8;
        padding: 6px;
        display: block;
        transition: 0.2s;
    `;
}

htmlGridLojista += `
    <div class="card-p" onclick="if(!event.target.closest('.menu-produto-wrap')) window.location.href='?lojista=${lojistaId}&product=${d.id}&modo=${modo}'">
        <div style="position: relative; overflow: hidden;">
            <img src="${otimizarURL(fotos[0], 300)}" style="width: 100%; height: 230px; background: #fcfcfc; padding: 4px; border-radius: 14px 14px 0 0; display: block; transition: 0.2s; object-fit: cover;">
        </div>
        <div class="card-p-info">
            <div class="card-p-name">${p.nome}</div>
            <div class="card-p-price">R$ ${p.preco}</div>
        </div>
    </div>
`;
                
            }
        });

        // Label "MAIS PRODUTOS" com classe dedicada para melhor estilo
        mainContainer.innerHTML = htmlDestaque + (htmlGridLojista ? `<div class="grid-label">${modo === 'gourmet' ? 'Mais do cardápio' : 'Mais produtos'}</div><div class="grid-produtos">${htmlGridLojista}</div>` : "");

        // Só revela o conteúdo após a imagem de capa carregar (ou falhar/expirar) —
        // evita o "pop" de imagem e garante que o layout já está estável.
        await preCarregarImagemCartao(imagemCapaAtivaCartao);
        esconderSkeletonCartao();
    } catch (e) {
        console.error(e);
        esconderSkeletonCartao();
    }
}

window.selecionarTamanho = (btn, tamanho) => {
    document.querySelectorAll('.btn-tamanho').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    window.tamanhoSelecionadoAtual = tamanho;
};

// Toast personalizado (sem alert nativo)
function mostrarToastPersonalizado(mensagem, tipo = 'erro') {
    let toast = document.getElementById('toastPersonalizado');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastPersonalizado';
        toast.style.cssText = `
            position: fixed; bottom: calc(env(safe-area-inset-bottom, 0px) + 90px);
            left: 20px; right: 20px;
            background: rgba(20,20,20,0.92); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: white; text-align: center; padding: 14px 20px;
            border-radius: 50px; font-size: 14px; font-weight: 500;
            z-index: 20000; transform: translateY(100px);
            transition: transform 0.28s cubic-bezier(0.32,0.72,0,1);
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
        `;
        document.body.appendChild(toast);
    }
    const prefixo = tipo === 'erro' ? '⚠️ ' : '✅ ';
    toast.innerText = prefixo + mensagem;
    toast.style.transform = 'translateY(0px)';
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
    }, 3000);
}

window.adicionarProdutoComTamanho = (id, nome, preco, owner, whatsapp, imagem, link, desc, tipoProduto) => {
    if (tipoProduto === 'roupa') {
        if (!window.tamanhoSelecionadoAtual) {
            mostrarToastPersonalizado('Selecione o tamanho antes de adicionar ao carrinho.', 'erro');
            // Destaca visualmente os botões de tamanho
            const grid = document.querySelector('.tamanho-grid');
            if (grid) {
                grid.style.animation = 'none';
                grid.offsetHeight; // força reflow
                grid.style.animation = 'shake 0.4s ease';
            }
            return;
        }
        const nomeComTamanho = `${nome} (Tam: ${window.tamanhoSelecionadoAtual})`;
        window.adicionarAoCarrinho(id, nomeComTamanho, preco, owner, whatsapp, imagem, link, desc);
    } else {
        window.adicionarAoCarrinho(id, nome, preco, owner, whatsapp, imagem, link, desc);
    }
};

window.tratarBotaoAdicionar = (id, nome, preco, owner, whatsapp, imagem, link, desc) => {
    const adicionaisKey = `adic_${id}`;
    const adicionaisProduto = window[adicionaisKey] || [];
    
    if (adicionaisProduto.length > 0) {
        const modal = document.getElementById('modalComida');
        const overlay = document.getElementById('overlayComida');
        document.getElementById('modalNome').innerText = nome;
        const descModal = document.getElementById('texto-descricao-gourmet');
        if(descModal) descModal.innerText = desc || '';

        let selecionados = {};
        const precoBase = parseFloat(preco) || 0;

        function atualizarBotaoConfirmar() {
            const extras = Object.values(selecionados);
            const totalExtras = extras.reduce((sum, e) => sum + e.preco, 0);
            const totalFinal = (precoBase + totalExtras).toFixed(2).replace('.', ',');
            document.getElementById('btnConfirmarConfig').innerText = `CONFIRMAR — R$ ${totalFinal}`;
        }

        document.getElementById('modalContent').innerHTML = `
            <div style="padding:10px 16px; background:#f9f9f9; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#888;">Adicionais opcionais</div>
            ${adicionaisProduto.map((a, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid #f5f5f5; cursor:pointer;" onclick="toggleAdicionalCartao(${i}, '${a.nome}', '${a.preco}')">
                    <div>
                        <div style="font-size:14px; font-weight:600; color:#111;">${a.nome}</div>
                        <div style="font-size:13px; color:#888; margin-top:2px;">${parseFloat(a.preco) > 0 ? '+ R$ ' + parseFloat(a.preco).toFixed(2) : 'Grátis'}</div>
                    </div>
                    <div id="check-cartao-${i}" style="width:24px; height:24px; border-radius:50%; border:2px solid #ddd; display:flex; align-items:center; justify-content:center; font-size:12px; color:white; transition:all 0.15s; flex-shrink:0;"></div>
                </div>
            `).join('')}
        `;

        window.toggleAdicionalCartao = (i, nome, preco) => {
            const check = document.getElementById(`check-cartao-${i}`);
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

        atualizarBotaoConfirmar();

        document.getElementById('btnConfirmarConfig').onclick = () => {
            const obs = document.getElementById('gourmet-obs')?.value || '';
            const extras = Object.values(selecionados);
            const totalExtras = extras.reduce((sum, e) => sum + e.preco, 0);
            const totalFinal = (precoBase + totalExtras).toFixed(2);
            const nomeFinal = extras.length > 0 ? `${nome} (+${extras.map(e => e.nome).join(', ')})` : nome;
            const descFinal = obs ? `${desc} | Obs: ${obs}` : desc;
            window.adicionarAoCarrinho(id, nomeFinal, totalFinal, owner, whatsapp, imagem, link, descFinal);
            window.fecharModalComida();
        };

        overlay.style.display = 'block';
        modal.style.bottom = '0';

    } else {
        window.abrirConfigComida(id, false, true);
    }
};

window.toggleMenuDenuncia = (event, id) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    document.querySelectorAll('.menu-flutuante-produto').forEach(menu => {
        if(menu.id !== `menu-${id}`) {
            menu.style.display = 'none';
        }
    });

    const menu = document.getElementById(`menu-${id}`);
    if(menu) {
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
        } else {
            menu.style.display = 'block';
        }
    }
};

// Denúncia sem alert/confirm nativos — usa toast customizado
window.denunciarProduto = async (produtoId, nomeProduto) => {
    // Modal de confirmação customizado (substitui confirm() nativo)
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:30000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:20px;padding:28px 22px 20px;max-width:300px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.2);animation:fadeInUp 0.22s ease;';
    box.innerHTML = `
        <div style="font-size:36px;margin-bottom:12px;">🚩</div>
        <div style="font-size:16px;font-weight:800;color:#222;margin-bottom:8px;">Denunciar produto?</div>
        <div style="font-size:13px;color:#777;margin-bottom:22px;line-height:1.5;">"${nomeProduto}"<br>Sua denúncia será analisada.</div>
        <div style="display:flex;gap:10px;">
            <button id="btnCancelarDenuncia" style="flex:1;padding:13px;background:#f2f2f2;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:#555;">Cancelar</button>
            <button id="btnConfirmarDenuncia" style="flex:1;padding:13px;background:#e53935;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;color:white;">Denunciar</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('btnCancelarDenuncia').onclick = () => overlay.remove();

    document.getElementById('btnConfirmarDenuncia').onclick = async () => {
        overlay.remove();
        try {
            await addDoc(collection(db, "denuncias"), {
                produtoId: produtoId || "",
                nomeProduto: nomeProduto || "",
                lojistaId: lojistaId || "",
                denunciante: "anonimo",
                data: new Date().toISOString(),
                status: "pendente"
            });

            mostrarToastPersonalizado('Denúncia enviada com sucesso.', 'sucesso');

            document.querySelectorAll('.menu-flutuante-produto').forEach(menu => {
                menu.style.display = 'none';
            });

        } catch(e) {
            console.error("Erro ao enviar denúncia para o Firestore: ", e);
            mostrarToastPersonalizado('Erro ao enviar denúncia. Tente novamente.', 'erro');
        }
    };
};

document.addEventListener('click', () => {
    document.querySelectorAll('.menu-flutuante-produto').forEach(menu => {
        menu.style.display = 'none';
    });
});

window.abrirConfigComida = async (id, isGlobal = false, isIntermediario = false) => {
    if (isGlobal) {
        itemAtualConfig = { id: 'montar_global', nome: lojistaInfoCache.montarTitulo || "Personalizado", preco: "0,00", variacoes: lojistaInfoCache.montarVariacoes || [], adicionais: lojistaInfoCache.montarAdicionais || [], isMontarGlobal: true, owner: lojistaInfoCache.id, whatsapp: lojistaInfoCache.whatsapp, foto: lojistaInfoCache.fotoPerfilComida, descricao: "" };
    } else {
        const d = await getDoc(doc(db, "produtos", id));
        const data = d.data();
        itemAtualConfig = { ...data, id: d.id, adicionais: data.adicionais || [] };
    }
    renderizarModalConfig(isIntermediario);
};

function renderizarModalConfig(isIntermediario = false) {
    const content = document.getElementById('modalContent');
    document.getElementById('modalNome').innerText = itemAtualConfig.nome;
    
    const descBox = document.getElementById('texto-descricao-gourmet');
    if (descBox) {
        descBox.innerHTML = `<b style="color:var(--ifood-red);">R$ ${itemAtualConfig.preco}</b><br>${itemAtualConfig.descricao || ''}`;
    }

    let html = '';

    if (isIntermediario) {
        html += `
            <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                <div style="font-weight:800; font-size:16px; color:#111;">${itemAtualConfig.nome}</div>
            </div>

            ${itemAtualConfig.adicionais?.length > 0 ? `
                <div id="btn-toggle-adicionais" 
                     onclick="const lista = document.getElementById('secao-adicionais-oculta'); lista.style.display = (lista.style.display === 'none') ? 'block' : 'none';"
                     style="margin: 14px 16px; padding: 14px 16px; border: 1.5px solid #e8e8e8; background: #fdfdfd; color: #333; text-align: center; border-radius: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size:14px;">
                    <i class="fas fa-plus" style="color: var(--ifood-red);"></i> 
                    ADICIONAR EXTRAS
                </div>
                
                <div id="secao-adicionais-oculta" style="display: none;">
                    <div style="padding:10px 16px; background:#f9f9f9; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#888;">ADICIONAIS:</div>
                    ${itemAtualConfig.adicionais.map((a, i) => `
                        <label style="display:flex; align-items:center; padding:14px 16px; border-bottom:1px solid #f5f5f5; cursor:pointer;">
                            <input type="checkbox" name="adicional" value="${i}" style="width:18px;height:18px;"> 
                            <div style="margin-left:12px; flex:1; font-size:14px; font-weight:500;">${a.nome}</div> 
                            <div style="color:var(--ifood-red); font-weight:700;">+ R$ ${a.preco}</div>
                        </label>`).join('')}
                </div>
            ` : ''}`;
    } else {
        
        if (itemAtualConfig.variacoes?.length > 0) {
            html += `<div style="padding:10px 16px; background:#f9f9f9; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#888;">ESCOLHA UMA OPÇÃO:</div>`;
            itemAtualConfig.variacoes.forEach((v, i) => {
                html += `<label style="display:flex; align-items:center; padding:14px 16px; border-bottom:1px solid #f5f5f5; cursor:pointer;"><input type="radio" name="variacao" value="${i}" ${i===0?'checked':''} style="width:18px;height:18px;"> <div style="margin-left:12px; flex:1; font-size:14px; font-weight:500;">${v.nome}</div> <div style="color:var(--ifood-red); font-weight:700;">+ R$ ${v.preco}</div></label>`;
            });
        }
        if (itemAtualConfig.adicionais?.length > 0) {
            html += `<div style="padding:10px 16px; background:#f9f9f9; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#888;">ADICIONAIS:</div>`;
            itemAtualConfig.adicionais.forEach((a, i) => {
                html += `<label style="display:flex; align-items:center; padding:14px 16px; border-bottom:1px solid #f5f5f5; cursor:pointer;"><input type="checkbox" name="adicional" value="${i}" style="width:18px;height:18px;"> <div style="margin-left:12px; flex:1; font-size:14px; font-weight:500;">${a.nome}</div> <div style="color:var(--ifood-red); font-weight:700;">+ R$ ${a.preco}</div></label>`;
            });
        }
    }

    content.innerHTML = html;

    const atualizarPrecoModalLocal = () => {
        let precoBaseStr = itemAtualConfig.isMontarGlobal ? "0,00" : (itemAtualConfig.preco || "0,00");
        let total = parseFloat(precoBaseStr.toString().replace(',', '.')) || 0;
        
        const varSel = document.querySelector('input[name="variacao"]:checked');
        if (varSel && itemAtualConfig.variacoes) {
            let vPreco = itemAtualConfig.variacoes[varSel.value].preco.toString().replace(',', '.');
            total += parseFloat(vPreco) || 0;
        }

        document.querySelectorAll('input[name="adicional"]:checked').forEach(cb => {
            if (itemAtualConfig.adicionais && itemAtualConfig.adicionais[cb.value]) {
                let aPreco = itemAtualConfig.adicionais[cb.value].preco.toString().replace(',', '.');
                total += parseFloat(aPreco) || 0;
            }
        });

        const btn = document.getElementById('btnConfirmarConfig');
        if (btn) btn.innerText = `Confirmar — R$ ${total.toFixed(2).replace('.', ',')}`;
    };

    content.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', atualizarPrecoModalLocal);
    });

    atualizarPrecoModalLocal();
    document.getElementById('modalComida').style.bottom = '0';
    document.getElementById('overlayComida').style.display = 'block';

    document.getElementById('btnConfirmarConfig').onclick = () => {
        let totalFinal = parseFloat((itemAtualConfig.isMontarGlobal ? "0,00" : itemAtualConfig.preco).toString().replace(',','.'));
        let detalhesPedido = [];
        const varSel = document.querySelector('input[name="variacao"]:checked');
        
        if(varSel) {
            const v = itemAtualConfig.variacoes[varSel.value];
            totalFinal += parseFloat(v.preco.toString().replace(',','.'));
            detalhesPedido.push(`Opção: ${v.nome}`);
        }
        
        const adds = [];
        document.querySelectorAll('input[name="adicional"]:checked').forEach(cb => {
            const a = itemAtualConfig.adicionais[cb.value];
            totalFinal += parseFloat(a.preco.toString().replace(',','.'));
            adds.push(a.nome);
        });
        
        if(adds.length > 0) detalhesPedido.push(`Adicionais: ${adds.join(', ')}`);
        
        const obs = document.getElementById('gourmet-obs').value;
        if(obs) detalhesPedido.push(`Obs: ${obs}`);

        const configTexto = detalhesPedido.length > 0 ? ` | Escolhas: ${detalhesPedido.join(' | ')}` : "";
        const descricaoFinal = (itemAtualConfig.descricao || "") + configTexto;

        window.adicionarAoCarrinho(
            itemAtualConfig.id, 
            itemAtualConfig.nome, 
            totalFinal.toFixed(2).replace('.', ','), 
            itemAtualConfig.owner, 
            itemAtualConfig.whatsapp, 
            otimizarURL(itemAtualConfig.foto ? (Array.isArray(itemAtualConfig.foto) ? itemAtualConfig.foto[0] : itemAtualConfig.foto) : lojistaInfoCache.fotoPerfilComida, 100),
            gerarLinkDestaque(itemAtualConfig.id),
            descricaoFinal
        );
        
        document.getElementById('gourmet-obs').value = '';
        window.fecharModalComida();
    };
}

init();
