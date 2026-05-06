import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    WASocket
} from '@whiskeysockets/baileys';

const ignoredBaileysNoise = [
    'failed to decrypt message',
    'sent retry receipt',
    'got history notification'
];

const shouldIgnoreBaileysLog = (args: unknown[]) => {
    const text = args
        .map((arg) => {
            if (typeof arg === 'string') {
                return arg;
            }

            try {
                return JSON.stringify(arg);
            } catch (_error) {
                return String(arg);
            }
        })
        .join(' ')
        .toLowerCase();

    return ignoredBaileysNoise.some((item) => text.includes(item));
};

const baileysLogger = {
    level: 'error',
    child: () => baileysLogger,
    trace: (..._args: unknown[]) => undefined,
    debug: (..._args: unknown[]) => undefined,
    info: (..._args: unknown[]) => undefined,
    warn: (...args: unknown[]) => {
        if (!shouldIgnoreBaileysLog(args)) {
            console.warn(...args);
        }
    },
    error: (...args: unknown[]) => {
        if (!shouldIgnoreBaileysLog(args)) {
            console.error(...args);
        }
    },
    fatal: (...args: unknown[]) => {
        if (!shouldIgnoreBaileysLog(args)) {
            console.error(...args);
        }
    }
};

let whatsappClient: WASocket | null = null;
let isWhatsappReady = false;
let hasAuthSignal = false;
const MAX_PENDING_MESSAGES = 100;
const pendingMessages: Array<{ numero: string; mensaje: string; createdAt: number }> = [];

export const getWhatsAppHealth = () => ({
    ready: isWhatsappReady,
    pendingMessages: pendingMessages.length
});

const sendMessageNow = async (numero: string, mensaje: string) => {
    if (!whatsappClient) {
        throw new Error('Cliente de WhatsApp no inicializado.');
    }

    const numeroNormalizado = numero.replace(/\D/g, '');
    const chatId = `${numeroNormalizado}@s.whatsapp.net`;
    await whatsappClient.sendMessage(chatId, { text: mensaje });
    console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numeroNormalizado}`);
};

const enqueuePendingMessage = (numero: string, mensaje: string) => {
    if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
        pendingMessages.shift();
    }

    pendingMessages.push({ numero, mensaje, createdAt: Date.now() });
    console.warn(`[WhatsApp] ⏳ Mensaje en cola. Pendientes: ${pendingMessages.length}`);
};

const flushPendingMessages = async () => {
    if (!whatsappClient || !isWhatsappReady || pendingMessages.length === 0) {
        return;
    }

    console.log(`[WhatsApp] ▶️ Enviando ${pendingMessages.length} mensaje(s) en cola...`);

    while (pendingMessages.length > 0 && whatsappClient && isWhatsappReady) {
        const next = pendingMessages.shift();
        if (!next) {
            break;
        }

        try {
            await sendMessageNow(next.numero, next.mensaje);
        } catch (error) {
            console.error('[WhatsApp] ❌ Error enviando mensaje en cola:', error);
            pendingMessages.unshift(next);
            break;
        }
    }
};

const waitForWhatsappReady = async (timeoutMs = 45000) => {
    if (isWhatsappReady) {
        return;
    }

    const start = Date.now();
    while (!isWhatsappReady && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!isWhatsappReady) {
        throw new Error('Cliente de WhatsApp no esta listo. Verifica sesion activa o escaneo de QR.');
    }
};

const startWhatsappClient = async () => {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
        const { version } = await fetchLatestBaileysVersion();

        whatsappClient = makeWASocket({
            auth: state,
            version,
            logger: baileysLogger as any,
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            syncFullHistory: false,
            fireInitQueries: false,
            shouldIgnoreJid: (jid) => jid.endsWith('@g.us')
        });

        whatsappClient.ev.on('creds.update', saveCreds);

        whatsappClient.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                hasAuthSignal = true;
                console.log('\n=========================================');
                console.log('📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP');
                console.log('=========================================\n');
                console.log('[WhatsApp] QR (texto):', qr);
                console.log('[WhatsApp] QR URL:', `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
            }

            if (connection === 'open') {
                hasAuthSignal = true;
                isWhatsappReady = true;
                console.log('✅ Módulo de WhatsApp conectado y listo para disparar.');
                void flushPendingMessages();
            }

            if (connection === 'close') {
                isWhatsappReady = false;
                const statusCode = Number((lastDisconnect?.error as any)?.output?.statusCode);
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.error('[WhatsApp] ⚠️ Cliente desconectado. Codigo:', statusCode || 'desconocido');
                if (shouldReconnect) {
                    console.log('[WhatsApp] Reintentando conexion...');
                    void startWhatsappClient();
                } else {
                    console.error('[WhatsApp] Sesion cerrada. Se requiere nuevo escaneo QR.');
                }
            }
        });

        console.log('[WhatsApp] Inicializando cliente y esperando QR/autenticacion...');

        setTimeout(() => {
            if (!hasAuthSignal && !isWhatsappReady) {
                console.error('[WhatsApp] ⚠️ No se recibio QR ni ready en 90s. Revisa logs y estado de red de Render.');
            }
        }, 90000);
    } catch (error) {
        isWhatsappReady = false;
        console.error('[WhatsApp] ❌ Error inicializando Baileys:', error);
    }
};

void startWhatsappClient();

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    try {
        if (!whatsappClient || !isWhatsappReady) {
            enqueuePendingMessage(numero, mensaje);
            return;
        }

        await sendMessageNow(numero, mensaje);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};