// ============================================================
// PAINEL ADMIN – GERENCIAR ANÚNCIOS (FIRESTORE)
// ============================================================

import { db } from './config.js';
import {
    collection, getDocs, doc, updateDoc, deleteDoc,
    query, where, orderBy, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ========== TOAST ==========
function mostrarToast(mensagem, tipo = 'info') {
    const toastExistente = document.querySelector('.toast-message');
    if (toastExistente) toastExistente.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.style.cssText = `
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        background: ${tipo === 'erro' ? '#DC2626' : '#16A34A'};
        color: white;
        padding: 11px 22px;
        border-radius: 30px;
        font-weight: 600;
        font-size: 13.5px;
        z-index: 10000;
        box-shadow: 0 6px 20px rgba(0,0,0,0.18);
        max-width: 80%;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
        transition: opacity 0.3s ease;
    `;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========== HELPERS ==========
function cloudThumb(url) {
    if (!url || !url.includes('res.cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/w_140,h_140,c_fill,q_auto,f_auto/');
}

function escapeHtml(texto) {
    if (!texto) return '';
    return texto.replace(/[&<>]/g, (m) => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatPreco(preco) {
    return typeof preco === 'number'
        ? preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : (preco ? `R$ ${preco}` : 'Não informado');
}

// ========== CONTADORES ==========
function atualizarContador(id, valor, usarAlert = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = valor;
    if (usarAlert && valor > 0) {
        el.classList.add('alert');
    } else {
        el.classList.remove('alert');
    }
}

// ========== TEMPLATE: CARD DE ANÚNCIO ==========
function renderCardAnuncio(a) {
    const badgeClass = `badge-${a.status || 'pendente'}`;
    const precoExibicao = formatPreco(a.preco);
    const precoRaw = (a.preco !== undefined && a.preco !== null && !isNaN(a.preco)) ? Number(a.preco) : 0;
    const foneAnunciante = a.whatsapp ? a.whatsapp.replace(/\D/g, '') : '';
    const msgAnunciante = encodeURIComponent(
        `Olá.\n\nSeu anúncio foi analisado pela administração.\n\nLembramos que após a venda é cobrada uma comissão de 7%.\n\nCaso deseje alterar o valor do produto para compensar essa comissão, responda esta mensagem e realizaremos a alteração para você.\n\nProduto:\n\n${a.titulo}\n\nValor atual:\n\n${precoExibicao}`
    );

    const fotoHtml = a.foto
        ? `<img src="${cloudThumb(a.foto)}" class="foto-admin">`
        : `<div class="foto-placeholder"><i class="fas fa-image"></i></div>`;

    const contatoHtml = foneAnunciante
        ? `<div class="contact-strip"><i class="fab fa-whatsapp"></i><span>${escapeHtml(a.whatsapp)}</span></div>`
        : '';

    const denunciaHtml = a.denuncias > 0
        ? `<span class="denuncia-chip alert"><i class="fas fa-flag"></i> ${a.denuncias} denúncia(s)</span>`
        : '';

    const whatsBtn = foneAnunciante
        ? `<a href="https://wa.me/55${foneAnunciante}?text=${msgAnunciante}" target="_blank" class="btn btn-whats"><i class="fab fa-whatsapp"></i> Falar</a>`
        : `<span class="btn btn-gray" style="opacity:0.5;cursor:not-allowed;">Sem telefone</span>`;

    return `
        <div class="card-admin">
            ${fotoHtml}
            <div class="info-admin">
                <div class="card-title">${escapeHtml(a.titulo)}</div>
                <div class="card-meta-row">
                    <span class="meta-chip"><i class="fas fa-tag"></i> ${escapeHtml(a.categoria)}</span>
                    <span class="meta-chip"><i class="fas fa-hashtag"></i> ${a.id.substring(0, 10)}</span>
                    <span class="badge ${badgeClass}">${a.status || 'pendente'}</span>
                    ${denunciaHtml}
                </div>
                <div class="card-price" id="preco-${a.id}">${precoExibicao}</div>
                ${contatoHtml}
                <div class="acoes">
                    <button onclick="window.alterarStatus('${a.id}', 'aprovado')" class="btn btn-aprovar"><i class="fas fa-check"></i> Aprovar</button>
                    <button onclick="window.alterarStatus('${a.id}', 'rejeitado')" class="btn btn-rejeitar"><i class="fas fa-times"></i> Rejeitar</button>
                    <button onclick="window.abrirModalEditarValor('${a.id}', ${precoRaw})" class="btn btn-editar-val"><i class="fas fa-pencil-alt"></i> Editar Valor</button>
                    ${whatsBtn}
                    <button onclick="window.excluirAnuncio('${a.id}')" class="btn btn-excluir"><i class="fas fa-trash-alt"></i> Excluir</button>
                </div>
            </div>
        </div>`;
}

// ========== CARREGAR ANÚNCIOS ==========
let numeroGlobalAnuncios = '';

async function carregarAdmin() {
    const containerPendentes = document.getElementById('listaPendentes');
    const containerAprovados = document.getElementById('listaAprovados');

    try {
        // Carregar número global
        const configSnap = await getDoc(doc(db, 'configuracoes', 'anuncios'));
        if (configSnap.exists() && configSnap.data().whatsappGlobal) {
            numeroGlobalAnuncios = configSnap.data().whatsappGlobal;
            const inputGlobal = document.getElementById('inputNumeroGlobal');
            if (inputGlobal) inputGlobal.value = numeroGlobalAnuncios;
        }

        const q = query(collection(db, 'anuncios'), where('status', '!=', 'vendido_historico'));
        const querySnapshot = await getDocs(q);

        const pendentes = [];
        const aprovados = [];

        querySnapshot.forEach((docSnap) => {
            const dados = docSnap.data();
            const a = { id: docSnap.id, ...dados };
            if (!a.status) a.status = 'pendente';
            if (a.denuncias === undefined) a.denuncias = 0;

            if (a.status === 'aprovado') {
                aprovados.push(a);
            } else {
                // pendente, rejeitado e qualquer outro ficam em Pendentes
                pendentes.push(a);
            }
        });

        // Renderizar Pendentes
        if (containerPendentes) {
            containerPendentes.innerHTML = pendentes.length > 0
                ? pendentes.map(renderCardAnuncio).join('')
                : `<div class="empty-state"><i class="fas fa-clock"></i><p>Nenhum anúncio pendente.</p></div>`;
        }

        // Renderizar Aprovados
        if (containerAprovados) {
            containerAprovados.innerHTML = aprovados.length > 0
                ? aprovados.map(renderCardAnuncio).join('')
                : `<div class="empty-state"><i class="fas fa-check-circle"></i><p>Nenhum anúncio aprovado.</p></div>`;
        }

        // Atualizar contadores
        atualizarContador('cnt-pendentes', pendentes.length, true);
        atualizarContador('cnt-aprovados', aprovados.length, false);

    } catch (error) {
        console.error('Erro ao carregar anúncios:', error);
        mostrarToast('Erro ao carregar anúncios', 'erro');
        if (containerPendentes) containerPendentes.innerHTML = `<div class="empty-state"><p>Falha no carregamento.</p></div>`;
        if (containerAprovados) containerAprovados.innerHTML = `<div class="empty-state"><p>Falha no carregamento.</p></div>`;
    }
}

// ========== ALTERAR STATUS ==========
async function alterarStatus(id, novoStatus) {
    try {
        await updateDoc(doc(db, 'anuncios', id), { status: novoStatus });
        mostrarToast(`Status alterado para ${novoStatus}`);
        carregarAdmin();
    } catch (error) {
        console.error('Erro ao alterar status:', error);
        mostrarToast('Erro ao alterar status', 'erro');
    }
}

// ========== EXCLUIR ANÚNCIO ==========
async function excluirAnuncio(id) {
    if (confirm('Tem certeza que deseja excluir permanentemente este anúncio?')) {
        try {
            await deleteDoc(doc(db, 'anuncios', id));
            mostrarToast('Anúncio excluído com sucesso');
            carregarAdmin();
        } catch (error) {
            console.error('Erro ao excluir:', error);
            mostrarToast('Erro ao excluir anúncio', 'erro');
        }
    }
}

// ========== EDITAR VALOR DO ANÚNCIO ==========
let _editarId = null;

function abrirModalEditarValor(id, precoAtual) {
    _editarId = id;
    const input = document.getElementById('inputNovoValor');
    if (input) input.value = (precoAtual !== null && precoAtual !== undefined && !isNaN(precoAtual)) ? precoAtual : '';
    document.getElementById('modalEditarValor').classList.add('ativo');
}

function fecharModalEditarValor() {
    _editarId = null;
    const input = document.getElementById('inputNovoValor');
    if (input) input.value = '';
    document.getElementById('modalEditarValor').classList.remove('ativo');
}

async function confirmarEdicaoValor() {
    const input = document.getElementById('inputNovoValor');
    const novoValor = parseFloat(input.value);

    if (isNaN(novoValor) || novoValor < 0) {
        mostrarToast('Informe um valor válido.', 'erro');
        return;
    }

    try {
        await updateDoc(doc(db, 'anuncios', _editarId), { preco: novoValor });

        // Invalida o cache da vitrine
        sessionStorage.removeItem('todosAnunciosCache');

        // Atualiza o span do preço no card sem recarregar
        const spanPreco = document.getElementById(`preco-${_editarId}`);
        if (spanPreco) {
            spanPreco.textContent = novoValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }

        mostrarToast('Valor atualizado com sucesso!');
        fecharModalEditarValor();
    } catch (error) {
        console.error('Erro ao atualizar valor:', error);
        mostrarToast('Erro ao atualizar valor.', 'erro');
    }
}

// ========== SALVAR NÚMERO GLOBAL ==========
async function salvarNumeroGlobal() {
    const inputNumero = document.getElementById('inputNumeroGlobal').value.trim();
    try {
        await setDoc(doc(db, 'configuracoes', 'anuncios'), { whatsappGlobal: inputNumero }, { merge: true });
        mostrarToast('Número global salvo com sucesso!');
    } catch (error) {
        console.error('Erro ao salvar número global:', error);
        mostrarToast('Erro ao salvar número', 'erro');
    }
}

// ========== DENÚNCIAS ==========
async function carregarDenuncias() {
    const container = document.getElementById('listaDenuncias');
    if (!container) return;

    try {
        const q = query(collection(db, 'denuncias_anuncios'), where('statusDenuncia', '==', 'pendente'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-flag"></i><p>Nenhuma denúncia pendente.</p></div>`;
            atualizarContador('cnt-denuncias', 0, true);
            return;
        }

        let html = '';
        querySnapshot.forEach((docSnap) => {
            const d = docSnap.data();
            const idDenuncia = docSnap.id;
            const dataFormatada = d.dataDenuncia && d.dataDenuncia.toDate
                ? d.dataDenuncia.toDate().toLocaleString('pt-BR')
                : 'Data indisponível';

            html += `
                <div class="card-admin accent-red">
                    <div class="info-admin" style="width:100%;">
                        <div class="denuncia-nome"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>${escapeHtml(d.nomeAnuncio)}</div>
                        <div class="denuncia-motivo"><strong>Motivo:</strong> ${escapeHtml(d.motivoDenuncia)}</div>
                        <div class="denuncia-data"><i class="fas fa-calendar-alt" style="margin-right:4px;"></i>${dataFormatada}</div>
                        <div class="acoes">
                            <a href="detalhe-anuncio.html?id=${d.idAnuncio}" target="_blank" class="btn btn-blue"><i class="fas fa-eye"></i> Ver Anúncio</a>
                            <button onclick="window.excluirAnuncioDenunciado('${d.idAnuncio}', '${idDenuncia}')" class="btn btn-excluir"><i class="fas fa-trash-alt"></i> Excluir Anúncio</button>
                            <button onclick="window.ignorarDenuncia('${idDenuncia}')" class="btn btn-gray"><i class="fas fa-times"></i> Ignorar</button>
                        </div>
                    </div>
                </div>`;
        });

        container.innerHTML = html;
        atualizarContador('cnt-denuncias', querySnapshot.size, true);

    } catch (error) {
        console.error('Erro ao carregar denúncias:', error);
        container.innerHTML = `<div class="empty-state"><p>Erro ao carregar denúncias.</p></div>`;
    }
}

async function excluirAnuncioDenunciado(idAnuncio, idDenuncia) {
    if (confirm('Deseja realmente excluir este anúncio e marcar a denúncia como resolvida?')) {
        try {
            await deleteDoc(doc(db, 'anuncios', idAnuncio));
            await updateDoc(doc(db, 'denuncias_anuncios', idDenuncia), { statusDenuncia: 'resolvida' });
            mostrarToast('Anúncio excluído e denúncia resolvida!');
            carregarAdmin();
            carregarDenuncias();
        } catch (error) {
            console.error('Erro ao processar exclusão por denúncia:', error);
            mostrarToast('Erro ao processar ação.', 'erro');
        }
    }
}

async function ignorarDenuncia(idDenuncia) {
    try {
        await updateDoc(doc(db, 'denuncias_anuncios', idDenuncia), { statusDenuncia: 'ignorada' });
        mostrarToast('Denúncia ignorada com sucesso.');
        carregarDenuncias();
    } catch (error) {
        console.error('Erro ao ignorar denúncia:', error);
        mostrarToast('Erro ao atualizar denúncia.', 'erro');
    }
}

// ========== TEMPLATE: CARD DE INTERMEDIAÇÃO ==========
function renderCardIntermediacao(data, idInteresse, accentClass, fotoUrl, precoAnuncio) {
    const dataFormatada = data.dataInteresse && data.dataInteresse.toDate
        ? data.dataInteresse.toDate().toLocaleString('pt-BR')
        : 'Data indisponível';

    const telLimpo = data.telefoneAnunciante ? data.telefoneAnunciante.replace(/\D/g, '') : '';
    const whatsBtn = telLimpo
        ? `<a href="https://wa.me/55${telLimpo}" target="_blank" class="btn btn-whats" style="padding:5px 10px; font-size:11.5px;"><i class="fab fa-whatsapp"></i> Falar</a>`
        : '';

    const btnExcluir = (data.status === 'Vendido' || data.status === 'Cancelado')
        ? `<button onclick="window.excluirIntermediacao('${idInteresse}', '${escapeHtml(data.nomeAnuncio)}')" class="btn btn-gray"><i class="fas fa-trash-alt"></i> Excluir Registro</button>`
        : '';

    const fotoHtml = fotoUrl
        ? `<img src="${cloudThumb(fotoUrl)}" class="foto-admin" alt="">`
        : `<div class="foto-placeholder"><i class="fas fa-image"></i></div>`;

    const precoHtml = (precoAnuncio !== undefined && precoAnuncio !== null)
        ? `<div class="inter-row"><i class="fas fa-tag"></i> <span style="font-weight:700;color:var(--text);">${formatPreco(precoAnuncio)}</span></div>`
        : '';

    return `
        <div class="card-admin ${accentClass}">
            <div class="info-admin">
                <div class="inter-title">${escapeHtml(data.nomeAnuncio)}</div>
                ${precoHtml}
                <div class="inter-row"><i class="fas fa-user"></i> <span>${escapeHtml(data.nomeAnunciante)}</span></div>
                <div class="inter-row">
                    <i class="fas fa-phone"></i>
                    <span>${escapeHtml(data.telefoneAnunciante)}</span>
                    ${whatsBtn}
                </div>
                <div class="inter-row"><i class="fas fa-calendar-alt"></i> <span>${dataFormatada}</span></div>
                <div class="acoes">
                    <button onclick="window.atualizarStatusIntermediacao('${idInteresse}', '${data.idAnuncio}', 'novo')" class="btn btn-novo"><i class="fas fa-inbox"></i> Novo</button>
                    <button onclick="window.atualizarStatusIntermediacao('${idInteresse}', '${data.idAnuncio}', 'Em negociação')" class="btn btn-negociar"><i class="fas fa-handshake"></i> Negociar</button>
                    <button onclick="window.atualizarStatusIntermediacao('${idInteresse}', '${data.idAnuncio}', 'Vendido')" class="btn btn-vendido-acao"><i class="fas fa-check-double"></i> Vendido</button>
                    <button onclick="window.atualizarStatusIntermediacao('${idInteresse}', '${data.idAnuncio}', 'Cancelado')" class="btn btn-cancelado-acao"><i class="fas fa-ban"></i> Cancelado</button>
                    ${btnExcluir}
                </div>
            </div>
            ${fotoHtml}
        </div>`;
}

// ========== CENTRAL DE INTERMEDIAÇÃO ==========
async function carregarIntermediacao() {
    const cInter      = document.getElementById('listaIntermediacao');
    const cNegoc      = document.getElementById('listaNegociacoes');
    const cVendidos   = document.getElementById('listaVendidos');
    const cCancelados = document.getElementById('listaCancelados');

    try {
        const q = query(collection(db, 'interessadosAnuncios'), orderBy('dataInteresse', 'desc'));
        const querySnapshot = await getDocs(q);

        const grupos = { novo: [], negociando: [], vendidos: [], cancelados: [] };

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const idInteresse = docSnap.id;
            const item = { data, idInteresse };
            const s = data.status || 'novo';

            if (s === 'Em negociação') grupos.negociando.push(item);
            else if (s === 'Vendido')  grupos.vendidos.push(item);
            else if (s === 'Cancelado') grupos.cancelados.push(item);
            else grupos.novo.push(item); // 'novo' ou qualquer outro
        });

        // Buscar foto e preço dos anúncios originais (uma leitura por idAnuncio único)
        const todosItens = [...grupos.novo, ...grupos.negociando, ...grupos.vendidos, ...grupos.cancelados];
        const idsUnicos = [...new Set(todosItens.map(({ data }) => data.idAnuncio).filter(Boolean))];

        const anuncioMap = {};
        await Promise.all(idsUnicos.map(async (idAn) => {
            try {
                const snap = await getDoc(doc(db, 'anuncios', idAn));
                if (snap.exists()) {
                    const d = snap.data();
                    anuncioMap[idAn] = {
                        foto: d.foto || (d.fotos && d.fotos[0]) || null,
                        preco: d.preco
                    };
                }
            } catch (_) {}
        }));

        // Preencher cada container
        if (cInter) {
            cInter.innerHTML = grupos.novo.length > 0
                ? grupos.novo.map(({ data, idInteresse }) => {
                    const an = anuncioMap[data.idAnuncio] || {};
                    return renderCardIntermediacao(data, idInteresse, 'accent-blue', an.foto, an.preco);
                }).join('')
                : `<div class="empty-state"><i class="fas fa-inbox"></i><p>Nenhum pedido novo.</p></div>`;
        }
        if (cNegoc) {
            cNegoc.innerHTML = grupos.negociando.length > 0
                ? grupos.negociando.map(({ data, idInteresse }) => {
                    const an = anuncioMap[data.idAnuncio] || {};
                    return renderCardIntermediacao(data, idInteresse, 'accent-amber', an.foto, an.preco);
                }).join('')
                : `<div class="empty-state"><i class="fas fa-handshake"></i><p>Nenhuma negociação em andamento.</p></div>`;
        }
        if (cVendidos) {
            cVendidos.innerHTML = grupos.vendidos.length > 0
                ? grupos.vendidos.map(({ data, idInteresse }) => {
                    const an = anuncioMap[data.idAnuncio] || {};
                    return renderCardIntermediacao(data, idInteresse, 'accent-green', an.foto, an.preco);
                }).join('')
                : `<div class="empty-state"><i class="fas fa-check-double"></i><p>Nenhuma venda registrada.</p></div>`;
        }
        if (cCancelados) {
            cCancelados.innerHTML = grupos.cancelados.length > 0
                ? grupos.cancelados.map(({ data, idInteresse }) => {
                    const an = anuncioMap[data.idAnuncio] || {};
                    return renderCardIntermediacao(data, idInteresse, 'accent-slate', an.foto, an.preco);
                }).join('')
                : `<div class="empty-state"><i class="fas fa-ban"></i><p>Nenhum cancelamento registrado.</p></div>`;
        }

        // Contadores
        atualizarContador('cnt-intermediacao', grupos.novo.length, true);
        atualizarContador('cnt-negociacoes',   grupos.negociando.length, false);
        atualizarContador('cnt-vendidos',      grupos.vendidos.length, false);
        atualizarContador('cnt-cancelados',    grupos.cancelados.length, false);

    } catch (error) {
        console.error('Erro ao carregar intermediação:', error);
        if (cInter) cInter.innerHTML = `<div class="empty-state"><p>Erro ao carregar.</p></div>`;
    }
}

async function atualizarStatusIntermediacao(idInteresse, idAnuncio, novoStatus) {
    try {
        await updateDoc(doc(db, 'interessadosAnuncios', idInteresse), { status: novoStatus });

        if (novoStatus === 'Vendido') {
            await updateDoc(doc(db, 'anuncios', idAnuncio), { status: 'vendido_historico' });
            mostrarToast('Intermediação concluída! Anúncio removido da vitrine.');
        } else {
            mostrarToast(`Status alterado para ${novoStatus}`);
        }

        carregarIntermediacao();
    } catch (error) {
        console.error('Erro ao atualizar intermediação:', error);
        mostrarToast('Erro ao atualizar status.', 'erro');
    }
}

async function excluirIntermediacao(idInteresse, nomeAnuncio) {
    if (confirm(`Excluir o registro "${nomeAnuncio}"?\n\nEsta ação não pode ser desfeita.`)) {
        try {
            await deleteDoc(doc(db, 'interessadosAnuncios', idInteresse));
            mostrarToast('Registro excluído com sucesso.');
            carregarIntermediacao();
        } catch (error) {
            console.error('Erro ao excluir registro:', error);
            mostrarToast('Erro ao excluir registro.', 'erro');
        }
    }
}

// ========== EXPOR FUNÇÕES GLOBAIS ==========
window.alterarStatus              = alterarStatus;
window.excluirAnuncio             = excluirAnuncio;
window.carregarAdmin              = carregarAdmin;
window.salvarNumeroGlobal         = salvarNumeroGlobal;
window.abrirModalEditarValor      = abrirModalEditarValor;
window.fecharModalEditarValor     = fecharModalEditarValor;
window.confirmarEdicaoValor       = confirmarEdicaoValor;
window.excluirAnuncioDenunciado   = excluirAnuncioDenunciado;
window.ignorarDenuncia            = ignorarDenuncia;
window.excluirIntermediacao       = excluirIntermediacao;
window.atualizarStatusIntermediacao = atualizarStatusIntermediacao;
window.carregarIntermediacao      = carregarIntermediacao;

// ========== INICIALIZAÇÃO ==========
document.addEventListener('DOMContentLoaded', () => {
    carregarAdmin();
    carregarDenuncias();
    carregarIntermediacao();
});
