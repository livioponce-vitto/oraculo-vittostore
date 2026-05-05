import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

// Inicializamos el bot con los permisos para Linux y guardando la sesión
import puppeteer from 'puppeteer';
// Forzar el path del ejecutable de Chrome para puppeteer-core (usado internamente por whatsapp-web.js)
process.env.PUPPETEER_EXECUTABLE_PATH = puppeteer.executablePath();
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: puppeteer.executablePath(),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

whatsappClient.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});
whatsappClient.on('ready', () => {
    console.log('✅ Módulo de WhatsApp conectado y listo para disparar.');
});

whatsappClient.initialize();

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    try {
        const chatId = `${numero}@c.us`;
        await whatsappClient.sendMessage(chatId, mensaje);
        console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numero}`);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};