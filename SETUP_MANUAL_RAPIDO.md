# ⚡ SETUP MONITOREO - GUÍA RÁPIDA (10 min)

## 📋 Resumen

Tienes 3 acciones manuales rápidas:
1. Crear app Slack + webhook (2 min)
2. Agregar env vars en Render (3 min)  
3. Crear Cron Job en Render (3 min)
4. Validar que funciona (2 min)

---

## ✅ PASO 1: Crear Slack Webhook (2 minutos)

1. Abre: https://api.slack.com/apps/new
2. Selecciona: **"From scratch"**
3. App Name: `Oráculo Alerts`
4. Workspace: `Vittostore`
5. Click **"Create App"**
6. En el menú izquierdo: **"Incoming Webhooks"**
7. Turn ON el toggle (esquina superior derecha)
8. Click **"Add New Webhook to Workspace"**
9. Selecciona canal: **`#alerts-production`** (o el que prefieras)
10. Click **"Allow"**
11. **COPIA** el Webhook URL (comienza con `https://hooks.slack.com/services/...`)
12. **GUARDA** esta URL en un lugar seguro (la necesitarás en 2 minutos)

✅ **LISTO:** Tienes tu webhook URL

---

## ✅ PASO 2: Agregar Env Vars en Render (3 minutos)

1. Ve a: https://dashboard.render.com/services
2. Click en tu servicio: **`vittostore-oraculo-backend`** (Web Service)
3. En el menú izquierdo: **"Environment"**
4. Click **"Add Environment Variable"**
5. Crea 2 variables:

### Variable 1: SLACK_WEBHOOK_URL
```
Key:   SLACK_WEBHOOK_URL
Value: (pega aquí el webhook URL del PASO 1)
```
Click **"Save"**

### Variable 2: HEALTH_URL  
```
Key:   HEALTH_URL
Value: https://vittostore-oraculo-backend.onrender.com/health
```
Click **"Save"**

✅ **LISTO:** Environment variables agregadas

**⚠️ IMPORTANTE:** El servicio se redesplegará automáticamente. Espera ~2 minutos.

---

## ✅ PASO 3: Crear Cron Job en Render (3 minutos)

1. Ve a: https://dashboard.render.com/new
2. Click **"Cron Job"**
3. Conecta tu repositorio: **vittostore-oraculo-backend** (GitHub/GitLab)
4. Completa el formulario:

| Campo | Valor |
|-------|-------|
| **Name** | `oraculo-health-monitor` |
| **Build Command** | `npm install` |
| **Start Command** | `npx ts-node -T monitoring.ts` |
| **Branch** | `main` |
| **Schedule** | `*/5 * * * *` (cada 5 minutos) |

5. En **"Advanced"** → **"Environment"**: Agrega:

```
HEALTH_URL = https://vittostore-oraculo-backend.onrender.com/health
SLACK_WEBHOOK_URL = (pega el webhook del PASO 1)
```

6. Click **"Create Cron Job"**

✅ **LISTO:** Cron Job creado y ejecutándose cada 5 minutos

---

## ✅ PASO 4: Validar que todo funciona (2 minutos)

### Opción A: Esperar 5 minutos
El Cron Job se ejecutará automáticamente en 5 minutos y enviaráun mensaje a Slack.

### Opción B: Trigger manual (inmediato)
1. En Render Dashboard → Tu servicio **oraculo-health-monitor**
2. Click **"Trigger"** (botón azul arriba)
3. En ~30 segundos deberías recibir un mensaje en Slack #alerts-production

### Verificar Health Endpoint
```bash
curl https://vittostore-oraculo-backend.onrender.com/health | json_pp
```

Deberías ver:
```json
{
  "ok": true,
  "healthy": true,
  "alerts": {
    "hasAlerts": false,
    "count": 0,
    "messages": []
  }
}
```

---

## 📊 Qué verás en Slack

### ✅ Sistema Sano
```
✅ Oráculo Health Check - 2025-05-07T12:34:56Z
Overall Health: HEALTHY
Queue Saturation: ✅ PASS: 5/20
WhatsApp Connected: ✅ PASS
Reconnect Loop: ✅ PASS: 0 attempts
Delivery Failures: ✅ PASS: 0 failures
```

### ⚠️ Sistema con Problemas
```
🚨 Oráculo Health Check - 2025-05-07T12:34:56Z
Overall Health: DEGRADED
Queue Saturation: ❌ FAIL: 25/20
WhatsApp Connected: ❌ FAIL: Disconnected

Alerts:
• QUEUE_SATURATED: 25 > 20
• WHATSAPP_DISCONNECTED: Last disconnect code: 440
```

---

## 🎯 Checklist Final

- [ ] Paso 1: Webhook Slack creado ✅
- [ ] Paso 2: Env vars agregadas en Render ✅
- [ ] Paso 3: Cron Job creado ✅
- [ ] Paso 4: Recibí mensaje en Slack ✅

---

## 🆘 Si algo falla

### "El webhook URL no funciona"
→ Verifica que copiaste correctamente desde https://api.slack.com/apps
→ Asegúrate de que comienza con `https://hooks.slack.com/services/`

### "No recibo mensaje en Slack"
→ Verifica que SLACK_WEBHOOK_URL está exactamente igual en Render
→ Verifica que HEALTH_URL es accesible: https://vittostore-oraculo-backend.onrender.com/health
→ Revisa los logs del Cron Job en Render Dashboard

### "Cron Job no se ejecuta"
→ Verifica que `npm install` funciona en tu repo
→ Verifica que `npx ts-node -T monitoring.ts` se puede ejecutar
→ Revisa logs: Render Dashboard → Cron Job → Logs

---

## 📞 Testing Avanzado

### Test del Health Endpoint desde tu máquina:
```bash
npx ts-node -T verify-monitoring.ts
```

Debería mostrarte:
```
✅ Health Endpoint        Status 200, OK
✅ WhatsApp Connected     Ready
✅ Queue Health           5 pending (threshold: 20)
✅ Reconnect Loop         0 attempts (threshold: 3)
✅ Delivery Failures      0 failures (threshold: 5)
✅ Alerts System          0 current alerts
✅ Slack Webhook          Message sent successfully

✨ Results: 7/7 checks passed
```

---

## 💡 Tips

- **Commit f646291**: Ya está deployado con la lógica de alertas
- **Commit 2396228**: Scripts de setup y verificación
- **Monitoreo activo**: Tu sistema estará monitoreado 24/7 cada 5 minutos
- **Alertas solo cuando hay problemas**: Recibirás notificaciones SOLO si hay degradación

---

**¿Necesitas ayuda en algún paso? Avísame el número del paso y qué error ves.** 🚀
