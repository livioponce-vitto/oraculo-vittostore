
// --- CONFIGURACIÓN GLOBAL WHATSAPP API SOLO META CLOUD ---
const WHATSAPP_API_ENDPOINT = process.env.WHATSAPP_API_ENDPOINT ?? '';
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN ?? '';
const isWhatsAppCloudApi = WHATSAPP_API_ENDPOINT.startsWith('https://');

// No Baileys: solo Meta Cloud API

// --- Estado WhatsApp Cloud API ---
let isWhatsappReady = false;
const pendingMessages: Array<{ numero: string; mensaje: string; createdAt: number }> = [];
const MAX_PENDING_MESSAGES = 100;

// --- Funciones principales ---

const normalizePhoneForWhatsApp = (raw: string) => {
    // Shopify puede enviar +569..., espacios o guiones.
    const cleaned = String(raw || '').replace(/\+/g, '').replace(/\D/g, '');
    return cleaned;
};

const persistPendingMessages = async () => {
    // Opcional: implementar persistencia si se requiere
};

const sendMessageNow = async (numero: string, mensaje: string) => {
    const numeroNormalizado = normalizePhoneForWhatsApp(numero);
    const safeMessage = String(mensaje || '').trim();

    if (!safeMessage) {
        throw new Error('Mensaje vacio. Se cancela envio.');
    }

    if (!isWhatsAppCloudApi) {
        throw new Error('Solo Meta Cloud API soportado.');
    }

    if (!WHATSAPP_API_TOKEN) {
        throw new Error('WHATSAPP_API_TOKEN no está configurado.');
    }

    const response = await fetch(WHATSAPP_API_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: numeroNormalizado,
            type: 'text',
            text: { body: safeMessage }
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`WhatsApp Cloud API error ${response.status}: ${body}`);
    }

    isWhatsappReady = true;
    console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numeroNormalizado} via Meta Cloud API`);
    return;
};

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    await sendMessageNow(numero, mensaje);
};


export const enviarMensajeWhatsAppModo = async (
    numero: string,
    mensaje: string,
    requireImmediateDelivery = false
) => {
    await enviarMensajeWhatsApp(numero, mensaje);
};

// Health check para WhatsApp Cloud API
export const getWhatsAppHealth = () => {
    return {
        ready: isWhatsappReady,
        pendingMessages: pendingMessages.length,
        maxPending: MAX_PENDING_MESSAGES,
        mode: 'Meta Cloud API',
        endpoint: WHATSAPP_API_ENDPOINT ? 'set' : 'unset'
    };
};
