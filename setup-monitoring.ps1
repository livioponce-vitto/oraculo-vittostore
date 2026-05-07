# SETUP MONITOREO - Windows PowerShell
#
# Ejecución:
#  powershell -ExecutionPolicy Bypass -File setup-monitoring.ps1
#

Write-Host "`n$('═' * 80)" -ForegroundColor Cyan
Write-Host "🔧 SETUP MONITOREO: Render + Slack" -ForegroundColor Cyan
Write-Host "$('═' * 80)`n" -ForegroundColor Cyan

# ─────────────────────────────────────────────────────────────────────────────
# 1. RECOLECTAR CREDENCIALES
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "📋 PASO 1: Credenciales`n" -ForegroundColor Yellow

$RENDER_API_KEY = Read-Host "✓ Render API Key (https://dashboard.render.com/account/api-tokens)"
if ([string]::IsNullOrEmpty($RENDER_API_KEY)) {
  Write-Host "❌ Render API Key es requerido" -ForegroundColor Red
  exit 1
}

$RENDER_SERVICE_ID = Read-Host "✓ Render Service ID (ej: srv-c123d456e78f90g)"
if ([string]::IsNullOrEmpty($RENDER_SERVICE_ID)) {
  Write-Host "❌ Service ID es requerido" -ForegroundColor Red
  exit 1
}

$SLACK_WORKSPACE = Read-Host "✓ Tu Slack workspace domain (ej: mycompany.slack.com)"
if ([string]::IsNullOrEmpty($SLACK_WORKSPACE)) {
  Write-Host "❌ Slack workspace es requerido" -ForegroundColor Red
  exit 1
}

$SLACK_CHANNEL = Read-Host "✓ Tu canal Slack para alertas (ej: alerts-production)"
if ([string]::IsNullOrEmpty($SLACK_CHANNEL)) {
  Write-Host "❌ Canal Slack es requerido" -ForegroundColor Red
  exit 1
}

# Remove leading # if present
$SLACK_CHANNEL = $SLACK_CHANNEL -replace "^#", ""

Write-Host "`n✅ Credenciales recolectadas`n" -ForegroundColor Green

# ─────────────────────────────────────────────────────────────────────────────
# 2. GUÍA PARA CREAR SLACK WEBHOOK
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "📋 PASO 2: Crear Slack Incoming Webhook`n" -ForegroundColor Yellow
Write-Host "🔗 Abre esto en tu navegador:" -ForegroundColor Cyan
Write-Host "   https://api.slack.com/apps/new`n"

Write-Host "Sigue estos pasos:" -ForegroundColor Cyan
Write-Host "  1. Click en 'Create an App' o 'From scratch'"
Write-Host "  2. App Name: 'Oráculo Alerts'"
Write-Host "  3. Workspace: $SLACK_WORKSPACE"
Write-Host "  4. Click 'Create App'"
Write-Host "  5. En el menú izquierdo: 'Incoming Webhooks'"
Write-Host "  6. Turn ON el toggle"
Write-Host "  7. Click 'Add New Webhook to Workspace'"
Write-Host "  8. Selecciona #$SLACK_CHANNEL"
Write-Host "  9. Autoriza"
Write-Host "  10. Copia el Webhook URL (https://hooks.slack.com/services/...)`n"

$SLACK_WEBHOOK_URL = Read-Host "✓ Pega aquí tu Slack Webhook URL"
if ([string]::IsNullOrEmpty($SLACK_WEBHOOK_URL)) {
  Write-Host "❌ Webhook URL es requerido" -ForegroundColor Red
  exit 1
}

Write-Host "`n✅ Webhook Slack obtenido`n" -ForegroundColor Green

# ─────────────────────────────────────────────────────────────────────────────
# 3. OBTENER RENDER SERVICE DETAILS
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "📋 PASO 3: Obtener detalles del servicio Render`n" -ForegroundColor Yellow

$headers = @{
  "Authorization" = "Bearer $RENDER_API_KEY"
  "Content-Type" = "application/json"
}

try {
  $SERVICE_RESPONSE = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$RENDER_SERVICE_ID" `
    -Headers $headers -ErrorAction Stop
  $SERVICE_DATA = $SERVICE_RESPONSE.Content | ConvertFrom-Json
  
  $SERVICE_NAME = $SERVICE_DATA.name
  $SERVICE_URL = $SERVICE_DATA.serviceDetails.url
  
  Write-Host "✅ Servicio encontrado: $SERVICE_NAME" -ForegroundColor Green
  Write-Host "   URL: $SERVICE_URL`n" -ForegroundColor Gray
} catch {
  Write-Host "❌ Error: No se pudo obtener el servicio" -ForegroundColor Red
  Write-Host "   Verifica Service ID y API Key" -ForegroundColor Red
  Write-Host "   Error: $($_.Exception.Message)`n" -ForegroundColor Red
  exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# 4. AGREGAR ENV VARIABLES EN RENDER
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "📋 PASO 4: Agregar variables de entorno en Render`n" -ForegroundColor Yellow

$HEALTH_URL = "$SERVICE_URL/health"

# Agregar SLACK_WEBHOOK_URL
Write-Host "Agregando SLACK_WEBHOOK_URL..." -ForegroundColor Gray
$body = @{
  key = "SLACK_WEBHOOK_URL"
  value = $SLACK_WEBHOOK_URL
} | ConvertTo-Json

try {
  Invoke-WebRequest -Uri "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" `
    -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
  Write-Host "✅ SLACK_WEBHOOK_URL agregada" -ForegroundColor Green
} catch {
  Write-Host "⚠️  No se pudo agregar (ya existe): $($_.Exception.Message)" -ForegroundColor Yellow
}

# Agregar HEALTH_URL
Write-Host "Agregando HEALTH_URL..." -ForegroundColor Gray
$body = @{
  key = "HEALTH_URL"
  value = $HEALTH_URL
} | ConvertTo-Json

try {
  Invoke-WebRequest -Uri "https://api.render.com/v1/services/$RENDER_SERVICE_ID/env-vars" `
    -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
  Write-Host "✅ HEALTH_URL agregada" -ForegroundColor Green
} catch {
  Write-Host "⚠️  No se pudo agregar (ya existe): $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n" -ForegroundColor Green

# ─────────────────────────────────────────────────────────────────────────────
# 5. CREAR CRON JOB EN RENDER
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "📋 PASO 5: Crear Cron Job en Render`n" -ForegroundColor Yellow
Write-Host "⚠️  ATENCIÓN: Debes crear el Cron Job manualmente en Render Dashboard`n" -ForegroundColor Yellow

Write-Host "Sigue estos pasos:" -ForegroundColor Cyan
Write-Host "  1. Ve a: https://dashboard.render.com"
Write-Host "  2. Click '+' → Cron Job"
Write-Host "  3. Conecta tu repositorio (vittostore-oraculo-backend)"
Write-Host "  4. Name: oraculo-health-monitor"
Write-Host "  5. Build: npm install"
Write-Host "  6. Start: npx ts-node -T monitoring.ts"
Write-Host "  7. Schedule: */5 * * * * (cada 5 minutos)"
Write-Host "  8. Environment variables:"
Write-Host "      HEALTH_URL = $HEALTH_URL"
Write-Host "      SLACK_WEBHOOK_URL = (ya configurada)"
Write-Host "  9. Deploy`n"

$CRON_READY = Read-Host "¿Completaste la creación del Cron Job? (s/n)" 
if ($CRON_READY -ne "s" -and $CRON_READY -ne "S") {
  Write-Host "OK, puedes hacerlo después. Pero recuerda: es necesario para alertas automáticas.`n" -ForegroundColor Yellow
}

# ─────────────────────────────────────────────────────────────────────────────
# 6. RESUMEN Y PRÓXIMOS PASOS
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "$('═' * 80)" -ForegroundColor Cyan
Write-Host "✅ SETUP COMPLETADO" -ForegroundColor Cyan
Write-Host "$('═' * 80)`n" -ForegroundColor Cyan

Write-Host "📊 CONFIGURACIÓN:" -ForegroundColor Green
Write-Host "  Render Service: $SERVICE_NAME"
Write-Host "  Service URL: $SERVICE_URL"
Write-Host "  Slack Webhook: ✓ Configurado"
Write-Host "  Slack Channel: #$SLACK_CHANNEL"
Write-Host "  Health URL: $HEALTH_URL"
Write-Host "  Cron Schedule: */5 * * * *`n"

Write-Host "🧪 PRÓXIMOS PASOS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Verifica que el health endpoint funciona:" -ForegroundColor Cyan
Write-Host "   curl $HEALTH_URL`n" -ForegroundColor Gray

Write-Host "2. Valida que todo funciona:" -ForegroundColor Cyan
Write-Host "   npx ts-node -T verify-monitoring.ts`n" -ForegroundColor Gray

Write-Host "3. Espera a que Cron Job se ejecute (5 minutos) o triggéalo manualmente" -ForegroundColor Cyan
Write-Host "   desde Render Dashboard" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Deberías recibir un mensaje en Slack en #$SLACK_CHANNEL`n" -ForegroundColor Gray

Write-Host "5. Si todo funciona, irás recibiendo alertas cuando:" -ForegroundColor Cyan
Write-Host "   - Queue supere 20 mensajes"
Write-Host "   - WhatsApp se desconecte"
Write-Host "   - Haya >3 reintentos de conexión"
Write-Host "   - >5 mensajes fallen`n"

Write-Host "$('═' * 80)" -ForegroundColor Cyan
