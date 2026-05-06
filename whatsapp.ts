import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    WASocket
} from '@whiskeysockets/baileys';

let whatsappClient: WASocket | null = null;
let isWhatsappReady = false;
let hasAuthSignal = false;

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
            printQRInTerminal: false,
            markOnlineOnConnect: false
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
        if (!whatsappClient) {
            throw new Error('Cliente de WhatsApp no inicializado.');
        }

        await waitForWhatsappReady();

        const numeroNormalizado = numero.replace(/\D/g, '');
        const chatId = `${numeroNormalizado}@s.whatsapp.net`;

        await whatsappClient.sendMessage(chatId, { text: mensaje });
        console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numeroNormalizado}`);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};