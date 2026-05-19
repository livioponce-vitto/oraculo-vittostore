
// --- CONFIGURACIÓN GLOBAL WHATSAPP API SOLO META CLOUD ---
const WHATSAPP_API_ENDPOINT = process.env.WHATSAPP_API_ENDPOINT ?? '';
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN ?? '';
const isWhatsAppCloudApi = WHATSAPP_API_ENDPOINT.startsWith('https://');

// No Baileys: solo Meta Cloud API

// --- Estado WhatsApp Cloud API ---
let isWhatsappReady = false;

// --- Funciones principales ---

const normalizePhoneForWhatsApp = (raw: string) => {
    const cleaned = String(raw || '').replace(/\+/g, '').replace(/\D/g, '');
    return cleaned;
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

    const responseBody = await response.text();

    if (!response.ok) {
        let errorData: any;
        try { errorData = JSON.parse(responseBody); } catch { errorData = { raw: responseBody }; }
        const errorCode    = errorData?.error?.code    ?? response.status;
        const errorMessage = errorData?.error?.message ?? responseBody;
        const errorType    = errorData?.error?.type    ?? 'UNKNOWN';

        console.error('[WhatsApp] Meta Cloud API Error:', JSON.stringify({
            status: response.status, errorCode, errorMessage, errorType,
            endpoint: WHATSAPP_API_ENDPOINT, to: numeroNormalizado,
            timestamp: new Date().toISOString()
        }));

        if (response.status === 401) throw new Error(`[401 Unauthorized] Token expirado o inválido. ${errorMessage}`);
        if (response.status === 403) throw new Error(`[403 Forbidden] Cuenta restringida o permisos insuficientes. ${errorMessage}`);
        if (response.status === 400) throw new Error(`[400 Bad Request] Número, template o JSON inválido. ${errorMessage}`);
        throw new Error(`[${errorCode}] WhatsApp Cloud API Error: ${errorMessage}`);
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
        mode: 'Meta Cloud API',
        endpoint: WHATSAPP_API_ENDPOINT ? 'set' : 'unset'
    };
};

// Valida el token contra la API de Meta sin enviar ningún mensaje.
// Marca isWhatsappReady = true si el token es válido.
export const validateWhatsAppToken = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!isWhatsAppCloudApi || !WHATSAPP_API_TOKEN) {
        return { ok: false, error: 'WhatsApp no configurado' };
    }

    const phoneNumberUrl = WHATSAPP_API_ENDPOINT.replace(/\/messages$/, '');

    try {
        const response = await fetch(phoneNumberUrl, {
            headers: { Authorization: `Bearer ${WHATSAPP_API_TOKEN}` }
        });

        if (response.ok) {
            isWhatsappReady = true;
            return { ok: true };
        }

        let errorData: any;
        try { errorData = JSON.parse(await response.text()); } catch { errorData = {}; }
        const msg = errorData?.error?.message ?? `HTTP ${response.status}`;

        if (response.status === 401 || response.status === 403) {
            return { ok: false, error: `Token inválido o expirado: ${msg}` };
        }
        return { ok: false, error: msg };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
};
