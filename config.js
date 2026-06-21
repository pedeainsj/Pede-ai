import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// SUAS CREDENCIAIS ORIGINAIS (MANTIDAS)
const firebaseConfig = {
    apiKey: "AIzaSyDQ8rwkKUpbiZ6zII2Pd62q-8sAK_CDLs0",
    authDomain: "ofcpedeai.firebaseapp.com",
    projectId: "ofcpedeai",
    storageBucket: "ofcpedeai.firebasestorage.app",
    messagingSenderId: "1013404177752",
    appId: "1:1013404177752:web:a3b175b55939e3ad47812d"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);

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
            preco: 55,
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