import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// SUAS CREDENCIAIS ORIGINAIS (MANTIDAS)
const firebaseConfig = {
    apiKey: "AIzaSyDQ8rwkKUpbiZ6zII2Pd62q-8sAK_CDLs0",
    authDomain: "ofcpedeai.firebaseapp.com",
    projectId: "ofcpedeai",
    storageBucket: "ofcpedeai.firebasestorage.app",
    messagingSenderId: "1013404177752",
    appId: "1:1013404177752:web:a3b175b55939e3ad47812d"
};

// CORREÇÃO ESTRUTURAL (iOS/WKWebView): duas tentativas anteriores de
// sincronizar terminate()+nova instância não eliminaram o travamento de
// ~30s confirmado pelo diagnóstico, presente SOMENTE no iOS/WKWebView
// (Android nunca apresentou o problema, e não é rede). Isso aponta para a
// causa descrita pelo próprio WebKit: ele é mais restritivo que o Chromium
// quanto a conexões de streaming/long-polling simultâneas para o mesmo
// host. Criar uma instância de Firebase App NOVA a cada navegação (mesmo
// com terminate() da anterior) sempre gera uma janela de handshake
// concorrente. A correção definitiva é parar de criar instâncias novas:
// reutilizamos UMA ÚNICA instância para toda a sessão do app (guardada em
// window, sobrevive entre navegações da mesma aba), com terminate()
// chamado apenas quando o app realmente é fechado/recarregado do zero —
// nunca a cada navegação entre index e vitrine.
let app;
if (window.__pedeaiFirebaseApp) {
    app = window.__pedeaiFirebaseApp;
} else {
    app = initializeApp(firebaseConfig, 'pedeai-app-unico');
    window.__pedeaiFirebaseApp = app;
}
export const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
});
export const dbPronto = Promise.resolve();

// Flag para evitar terminate() duplicado: setada para true pelo terminate()
// manual feito em navegarParaProduto (index.js) e voltarParaIndex (vitrine.js)
// ANTES de window.location mudar, prevenindo que o fallback abaixo execute
// uma segunda finalização sobre o mesmo canal.
window.__pedeaiDbTerminado = false;

// IMPORTANTE: o fechamento do canal Firestore é feito SOMENTE de forma manual
// e síncrona com o clique do usuário (em navegarParaProduto no index.js e em
// voltarParaIndex no vitrine.js), nunca aqui no 'pagehide'. Esse listener
// global existia antes e causava uma SEGUNDA chamada de terminate() sobre o
// mesmo objeto 'db' logo depois da primeira (a manual), porque mudar
// window.location dispara 'pagehide' na própria página de origem após o
// terminate() manual já ter sido concluído. Essa dupla finalização do canal
// WebChannel é cumulativa: a cada ida e volta entre Index e Vitrine, o canal
// fica mais propenso a ficar "zumbi" (uma segunda operação de fechamento de
// socket enfileirada sobre uma conexão que já estava finalizando), o que
// após várias navegações trava silenciosamente o próximo getDocs/getDoc sem
// nunca rejeitar — exatamente o sintoma de skeleton/loading preso. Por isso
// o terminate() deve acontecer em exatamente um lugar por navegação, nunca
// dois.

/**
 * DOMÍNIO PÚBLICO DO APP
 * Alterar aqui quando o domínio próprio estiver pronto.
 * Usado para links compartilháveis, WhatsApp, vitrine e cartão.
 */
export const APP_URL = 'https://pedeainsj.github.io/Pede-ai/';

/**
 * CONFIGURAÇÕES CENTRALIZADAS DE PLANOS E REGRAS DE NEGÓCIO
 */
export const CONFIG_SISTEMA = {
    pix: "SUA-CHAVE-PIX-AQUI", 
    whatsappSuporte: localStorage.getItem('zapSuporteGeral') || "5511999999999",
    mensagens: {
        bloqueio: "Sua conta está temporariamente bloqueada. Entre em contato com o administrador para regularizar."
    },
    planos: {
        basico: { 
            nome: "Básico", 
            preco: 35,
            limiteProdutos: 70, 
            limiteFotosPorProduto: 1, 
            limiteTurbos: 1,
            limiteVideos: 2,
            temDireitoTurbo: true,
            cor: "#6c757d" 
        },
        premium: { 
            nome: "Premium", 
            preco: 65,
            limiteProdutos: 120, 
            limiteFotosPorProduto: 3, 
            limiteTurbos: 3,
            limiteVideos: 5,
            temDireitoTurbo: true,
            cor: "#ee4d2d" 
        },
        vip: { 
            nome: "VIP", 
            preco: 85,
            limiteProdutos: 9999, 
            limiteFotosPorProduto: 6, 
            limiteTurbos: 5,
            limiteVideos: 8,
            temDireitoTurbo: true,
            cor: "#ffc107" 
        }
    }
};

/**
 * LÓGICA DE VALIDAÇÃO DE PERMISSÕES (HELPERS)
 */
export const GetRegrasLojista = (dadosLojista) => {
    const planoChave = dadosLojista?.planoAtivo || "basico";
    
    // Normalização rigorosa do status para compatibilidade Produção/NoSQL
    const statusRaw = dadosLojista?.status;
    const status = (statusRaw !== null && statusRaw !== undefined) 
        ? String(statusRaw).trim().toLowerCase() 
        : (dadosLojista ? "ativo" : "bloqueado");
    
    const configuracaoPlano = CONFIG_SISTEMA.planos[planoChave] || CONFIG_SISTEMA.planos.basico;

    // SISTEMA PROFISSIONAL DE VENCIMENTO
const hoje = new Date();

// Usa o vencimento salvo no banco
const dataVencimento = dadosLojista?.proximoVencimento
    ? new Date(dadosLojista.proximoVencimento)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

// Diferença em dias
const diffTime = dataVencimento - hoje;
const diasRestantes = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
        isAprovado: status === "ativo",
        isBloqueado: status === "bloqueado",
        podeExibirProdutos: status === "ativo",
        planoNome: configuracaoPlano.nome,
        valorMensal: configuracaoPlano.preco,
        diasParaVencer: diasRestantes,
        vencido: diasRestantes <= 0,
        limiteProdutos: configuracaoPlano.limiteProdutos,
        limiteTurbos: configuracaoPlano.limiteTurbos,
        podeAdicionarFoto: (qtdAtual) => qtdAtual < configuracaoPlano.limiteFotosPorProduto,
        temAcessoTurbo: configuracaoPlano.temDireitoTurbo,
        corPlano: configuracaoPlano.cor,
        msgBloqueio: CONFIG_SISTEMA.mensagens.bloqueio
    };
};