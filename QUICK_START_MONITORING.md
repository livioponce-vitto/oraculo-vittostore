# QUICK START: Configurar Monitoreo

## 🎯 Objetivo
Automatizar monitoreo de producción con alertas a Slack cada 5 minutos.

## ✅ Estado Actual
- ✅ Commit f646291 deployado en Render
- ⏳ Falta: Crear Slack webhook + agregar env vars + Cron Job

## 🚀 Ejecución (1 paso)

### En tu terminal local (en la carpeta del proyecto):

```bash
# 1. Dame permisos de ejecución
chmod +x setup-monitoring.sh

# 2. Ejecuta el script automatizado
./setup-monitoring.sh
```

El script te pedirá:
1. **Render API Key** → [Obtén aquí](https://dashboard.render.com/account/api-tokens)
2. **Service ID** → [Cópialo aquí](https://dashboard.render.com/web/services)
3. **Slack workspace domain** → Tu empresa.slack.com
4. **Canal Slack para alertas** → #alerts-production (o el que prefieras)
5. **Slack webhook URL** → Se abrirá navegador, sigue los pasos

---

## 📋 Qué hace el script

```
1. Valida credenciales Render
2. Te guía para crear Slack webhook (manual pero rápido)
3. Obtiene detalles del servicio
4. Agrega env vars en Render:
   - SLACK_WEBHOOK_URL
   - HEALTH_URL
5. Crea Cron Job: oraculo-health-monitor
   - Run: npx ts-node -T monitoring.ts
   - Schedule: */5 * * * *
```

---

## 🧪 Verificar que funciona

### Opción 1: Script de verificación

```bash
npx ts-node -T verify-monitoring.ts
```

Esto valida:
- ✅ Health endpoint responde
- ✅ WhatsApp conectado
- ✅ Queue sana
- ✅ Sistema de alertas
- ✅ Webhook Slack funciona

### Opción 2: Esperar 5 minutos
El Cron Job se ejecutará automáticamente y enviarás un mensaje a Slack.

### Opción 3: Trigger manual
```bash
# Después de crear el Cron Job, obtén su ID en Render dashboard
curl -X POST https://api.render.com/v1/crons/{CRON_ID}/run \
  -H "Authorization: Bearer {RENDER_API_KEY}"
```

---

## 📊 Qué alertas recibirás

| Alerta | Condición | Severidad |
|--------|-----------|-----------|
| QUEUE_SATURATED | >20 mensajes pendientes | ⚠️ WARN |
| WHATSAPP_DISCONNECTED | Conexión perdida | 🔴 CRITICAL |
| RECONNECT_LOOP | >3 reintentos en 5 min | ⚠️ WARN |
| DELIVERY_FAILURES | >5 mensajes fallidos | ⚠️ WARN |
| ENDPOINT_DOWN | Health no responde | 🔴 CRITICAL |

---

## 🔧 Troubleshooting

### "Error: No se pudo obtener el servicio"
→ Verifica que Service ID es correcto (ej: srv-abc123def)
→ Verifica que Render API Key es válido

### "Webhook URL no es válido"
→ Abre https://api.slack.com/apps
→ Crea NEW APP → "From scratch"
→ Incoming Webhooks → Turn ON
→ Add New Webhook → Selecciona canal → Copia URL

### "Cron Job no se ejecuta"
→ Verifica env vars en Render Dashboard
→ Verifica que commit f646291 está deployado
→ Triggea manualmente desde Render dashboard

---

## 📁 Archivos Generados

| Archivo | Propósito |
|---------|-----------|
| `setup-monitoring.sh` | Script de setup automatizado |
| `verify-monitoring.ts` | Script de verificación |
| `monitoring.ts` | Script que ejecuta Cron Job cada 5 min |
| `server.ts` | Actualizado con alertas + logging |
| `MONITORING_SETUP.md` | Documentación técnica completa |

---

## ✨ Ejemplo de Slack Alert

```
🚨 Oráculo Health Check - 2025-05-07T12:34:56.789Z

Overall Health: DEGRADED

Queue Saturation: ❌ FAIL: 25/20
WhatsApp Connected: ✅ PASS
Reconnect Loop: ✅ PASS
Delivery Failures: ✅ PASS

Alerts:
• QUEUE_SATURATED: 25 > 20
```

---

## 📞 Soporte

Si algo falla:
1. Lee los logs en Render Dashboard → Logs
2. Ejecuta: `npx ts-node -T verify-monitoring.ts`
3. Revisa que `/health` endpoint responde: `curl https://YOUR_URL/health`

¿Necesitas ayuda? Revisa `MONITORING_SETUP.md` para detalles técnicos.
