import { db } from './config.js';
import { collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Helper interno — nunca usa alert() nativo.
 * Usa window.mostrarToast se disponível (registrado pelo login.html).
 * Fallback seguro: console.warn — nunca trava o fluxo.
 */
function notificarErro(msg) {
    if (typeof window.mostrarToast === 'function') {
        window.mostrarToast(msg, 'erro');
    } else {
        console.warn('[Pede Aí]', msg);
    }
}

/**
 * Função de Login com tratamento de status
 */
export async function realizarLogin(email, senha) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(String(senha));
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const senhaHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        const q = query(
            collection(db, "usuarios"),
            where("email", "==", email.toLowerCase()),
            where("senha", "==", senhaHash)
        );

        const snap = await getDocs(q);

        if (snap.empty) {
            notificarErro('E-mail ou senha incorretos.\nVerifique e tente novamente.');
            return;
        }

        const docUser = snap.docs[0];
        const dados = docUser.data();

        // Armazenamento de Sessão (Login permitido mesmo se pendente)
        localStorage.setItem('userId', docUser.id);
        localStorage.setItem('nomeLoja', dados.nomeLoja);

        // Redirecionamento — inalterado
        window.location.href = 'painel-lojista.html';

    } catch (error) {
        console.error("Erro no processo de login:", error);
        notificarErro('Falha ao conectar com o servidor.\nVerifique sua conexão e tente novamente.');
    }
}

/**
 * Função de Cadastro com status pendente
 */
export async function cadastrarLojista(nomeLoja, email, senha, whatsapp) {
    try {
        const q = query(collection(db, "usuarios"), where("email", "==", email.toLowerCase()));
        const snap = await getDocs(q);

        if (!snap.empty) {
            notificarErro('Este e-mail já está cadastrado em nosso sistema.\nTente fazer login ou use outro e-mail.');
            return;
        }

        // WhatsApp com prefixo fixo — inalterado
        const zapFixo = whatsapp.startsWith('+55') ? whatsapp : '+55' + whatsapp.replace(/\D/g, '');

        await addDoc(collection(db, "usuarios"), {
            nomeLoja:  nomeLoja,
            email:     email.toLowerCase(),
            senha:     String(senha),
            whatsapp:  zapFixo,
            status:    "pendente",
            createdAt: new Date()
        });

        // Notifica via toast se disponível; o redirect é controlado pelo HTML de cadastro
        if (typeof window.mostrarToast === 'function') {
            window.mostrarToast('Cadastro realizado! Agora escolha seu plano.', 'sucesso');
        }

    } catch (error) {
        console.error("Erro no cadastro:", error);
        notificarErro('Erro ao enviar solicitação.\nTente novamente em instantes.');
    }
}
