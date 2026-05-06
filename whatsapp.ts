import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    WASocket
} from '@whiskeysockets/baileys';
import { promises as fs } from 'fs';
import path from 'path';

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
const AUTH_STATE_DIR = 'baileys_auth_info';
const PENDING_MESSAGES_FILE = path.resolve(process.cwd(), 'pending_messages.json');
let lastReadyAt: number | null = null;

export const getWhatsAppHealth = () => ({
    ready: isWhatsappReady,
    pendingMessages: pendingMessages.length,
    oldestPendingAgeSeconds:
        pendingMessages.length > 0
            ? Math.floor((Date.now() - pendingMessages[0].createdAt) / 1000)
            : 0,
    lastReadyAt
});

const normalizePhoneForWhatsApp = (raw: string) => {
    // Shopify puede enviar +569..., espacios o guiones.
    const cleaned = String(raw || '').replace(/\+/g, '').replace(/\D/g, '');
    return cleaned;
};

const buildWhatsAppJid = (raw: string) => {
    const normalized = normalizePhoneForWhatsApp(raw);

    if (!/^\d{11,15}$/.test(normalized)) {
        throw new Error(`Numero invalido para WhatsApp: ${raw}`);
    }

    // En Baileys el JID correcto para usuario es @s.whatsapp.net.
    return `${normalized}@s.whatsapp.net`;
};

const persistPendingMessages = async () => {
    try {
        await fs.writeFile(PENDING_MESSAGES_FILE, JSON.stringify(pendingMessages, null, 2), 'utf-8');
    } catch (error) {
        console.error('[WhatsApp] ❌ No se pudo persistir cola pendiente:', error);
    }
};

const loadPendingMessages = async () => {
    try {
        const exists = await fs
            .access(PENDING_MESSAGES_FILE)
            .then(() => true)
            .catch(() => false);

        if (!exists) {
            return;
        }

        const raw = await fs.readFile(PENDING_MESSAGES_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Array<{ numero: string; mensaje: string; createdAt: number }>;

        pendingMessages.length = 0;
        for (const item of parsed.slice(-MAX_PENDING_MESSAGES)) {
            if (!item?.numero || !item?.mensaje || !item?.createdAt) {
                continue;
            }

            pendingMessages.push(item);
        }

        if (pendingMessages.length > 0) {
            console.log(`[WhatsApp] ♻️ Cola recuperada desde disco. Pendientes: ${pendingMessages.length}`);
        }
    } catch (error) {
        console.error('[WhatsApp] ❌ No se pudo cargar cola pendiente:', error);
    }
};

const sendMessageNow = async (numero: string, mensaje: string) => {
    if (!whatsappClient) {
        throw new Error('Cliente de WhatsApp no inicializado.');
    }

    const numeroNormalizado = normalizePhoneForWhatsApp(numero);
    const chatId = buildWhatsAppJid(numeroNormalizado);
    const safeMessage = String(mensaje || '').trim();

    if (!safeMessage) {
        throw new Error('Mensaje vacio. Se cancela envio.');
    }

    if (!isWhatsappReady) {
        throw new Error('Cliente no READY al intentar enviar.');
    }

    await whatsappClient.sendMessage(chatId, { text: safeMessage });
    console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numeroNormalizado}`);
};

const enqueuePendingMessage = (numero: string, mensaje: string) => {
    if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
        pendingMessages.shift();
    }

    pendingMessages.push({ numero, mensaje, createdAt: Date.now() });
    console.warn(`[WhatsApp] ⏳ Mensaje en cola. Pendientes: ${pendingMessages.length}`);
    void persistPendingMessages();
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
            await persistPendingMessages();
        } catch (error) {
            console.error('[WhatsApp] ❌ Error enviando mensaje en cola:', error);
            pendingMessages.unshift(next);
            await persistPendingMessages();
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
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_STATE_DIR);
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
            shouldIgnoreJid: (jid) => (jid ? jid.endsWith('@g.us') : false)
        });

        whatsappClient.ev.on('creds.update', () => {
            saveCreds();
            console.log(`[WhatsApp] 💾 Sesion actualizada en ${AUTH_STATE_DIR}`);
        });

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
                lastReadyAt = Date.now();
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

        console.log(`[WhatsApp] Inicializando cliente y esperando QR/autenticacion... (auth dir: ${AUTH_STATE_DIR})`);

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

void (async () => {
    await loadPendingMessages();
    await startWhatsappClient();
})();

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    try {
        const numeroNormalizado = normalizePhoneForWhatsApp(numero);
        const mensajeSimple = String(mensaje || '').trim();

        if (!mensajeSimple) {
            console.error('[WhatsApp] ❌ Mensaje vacio. No se envia.');
            return;
        }

        if (!whatsappClient || !isWhatsappReady) {
            enqueuePendingMessage(numeroNormalizado, mensajeSimple);
            return;
        }

        await waitForWhatsappReady(15000);
        await sendMessageNow(numeroNormalizado, mensajeSimple);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};