// ─── INNOV-01: Servicio de Alertas WhatsApp en Tiempo Real ────────────────────
// Envía mensajes WhatsApp al dueño cuando el sistema detecta condiciones críticas.
// Se conecta al backend VITTOSTORE-ORACULO-BACKEND via POST /finance-alert.
// Tiene deduplicación: la misma alerta no se reenvía dentro de la ventana de silencio.
// ──────────────────────────────────────────────────────────────────────────────

var WhatsAppAlertsService = (function () {

  // ── Configuración ─────────────────────────────────────────────────────────────
  // Estas propiedades deben existir en FinanceConfig / PropertiesService:
  //   WHATSAPP_ALERT_BACKEND_URL  → URL del backend, ej: https://tu-backend.com
  //   WHATSAPP_ALERT_TOKEN        → Token secreto compartido (FINANCE_ALERT_TOKEN en .env)
  //   WHATSAPP_ALERT_PHONE        → Teléfono del dueño, ej: 56912345678
  //   WHATSAPP_ALERT_SILENCE_MIN  → Minutos de silencio entre alertas del mismo tipo (default: 60)

  var SILENCE_WINDOW_MINUTES = 60;
  var CACHE_KEY_PREFIX = 'WA_ALERT_SENT_';

  // ── Tipos de alerta y sus templates ──────────────────────────────────────────

  var ALERT_TEMPLATES = {

    SEV1_CIERRE_BLOQUEADO: function (snapshot) {
      return [
        '*[VITTOSTORE FINANZAS]* 🚨 SEV-1: Cierre del mes bloqueado',
        '',
        '📊 Estado actual:',
        '  • Errores calidad: ' + snapshot.quality.errorCount,
        '  • Banco pendiente: ' + snapshot.ledger.pendingBank + ' partidas',
        '  • Rechazados vencidos: ' + snapshot.queue.overdue,
        '  • Incidentes bloqueantes: ' + snapshot.contingency.blockingIncidents,
        '',
        '📅 Resultado del mes: ' + formatCLP(snapshot.ledger.resultadoMes),
        '',
        '▶ Acciones inmediatas:',
        '  1. runDataQualityChecks → depurar errores',
        '  2. processRejectedReviewQueue → resolver vencidos',
        '  3. Revisar Libro Mayor → conciliar banco',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    SEV1_INGESTION_DETENIDA: function (snapshot) {
      return [
        '*[VITTOSTORE FINANZAS]* 🔴 SEV-1: Ingesta detenida',
        '',
        'No se ha procesado ningún email financiero en las últimas 24 horas.',
        '',
        '🕐 Última ingesta: ' + (snapshot.lastIngestionAt || 'desconocida'),
        '',
        '▶ Acción: Revisar motor de ingesta y ejecutar runFinancialIngestion manualmente.',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    SEV2_BANCO_BACKLOG: function (snapshot) {
      return [
        '*[VITTOSTORE FINANZAS]* ⚠️ SEV-2: Backlog bancario alto',
        '',
        'Hay ' + snapshot.ledger.pendingBank + ' partidas sin conciliar con el banco.',
        '',
        '▶ Acción: Ejecutar runWeeklyBankReconciliation.',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    SEV2_RECHAZADOS_VENCIDOS: function (snapshot) {
      return [
        '*[VITTOSTORE FINANZAS]* ⚠️ SEV-2: Rechazados vencidos',
        '',
        'Hay ' + snapshot.queue.overdue + ' caso(s) con semáforo ROJO en la bandeja.',
        'Total pendientes: ' + snapshot.queue.pending,
        '',
        '▶ Acción: Abrir Bandeja_Revision_Rechazados y procesar los marcados en rojo.',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    CIERRE_MENSUAL_OK: function (snapshot) {
      return [
        '*[VITTOSTORE FINANZAS]* ✅ Cierre mensual completado',
        '',
        '📊 Resultado del mes:',
        '  • Ingresos: ' + formatCLP(snapshot.ledger.ingresosMes),
        '  • Egresos:  ' + formatCLP(snapshot.ledger.egresosMes),
        '  • Resultado: ' + formatCLP(snapshot.ledger.resultadoMes),
        '',
        '🏦 Banco: conciliado | Calidad: OK | Incidentes: 0',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    GEMINI_CAIDA: function (detail) {
      return [
        '*[VITTOSTORE FINANZAS]* 🤖 Gemini no disponible',
        '',
        'El motor de IA está respondiendo con errores 503.',
        'El motor local (INNOV-04) está tomando el control.',
        '',
        'Detalle: ' + String(detail || 'HTTP 503 high demand').substring(0, 120),
        '',
        '▶ No se requiere acción inmediata. El sistema opera con reglas locales.',
        '▶ Revisa en 30 min si Gemini se recuperó.',
        '',
        '⏱ ' + formatTimestamp(new Date())
      ].join('\n');
    },

    REPORTE_VENTAS_DIARIO_CONTADOR: function (data) {
      var lines = [
        '*[VITTOSTORE]* 📊 Reporte de Ventas Diario',
        'Fecha: ' + data.fecha,
        ''
      ];
      if (data.totalTransacciones > 0) {
        lines.push('💰 Total Ingresos: ' + formatCLP(data.totalIngresos));
        lines.push('📦 Transacciones: ' + data.totalTransacciones);
        if (data.desglose && data.desglose.length > 0) {
          lines.push('');
          lines.push('Desglose por canal:');
          data.desglose.forEach(function (d) {
            lines.push('  • ' + d.canal + ': ' + formatCLP(d.monto) + ' (' + d.count + ')');
          });
        }
      } else {
        lines.push('Sin ventas registradas hoy.');
      }
      if (data.egresos > 0) {
        lines.push('');
        lines.push('💸 Egresos del día: ' + formatCLP(data.egresos));
      }
      lines.push('');
      lines.push('⏱ ' + formatTimestamp(new Date()));
      return lines.join('\n');
    }
  };

  // ── Helpers de formato ────────────────────────────────────────────────────────

  function formatCLP(amount) {
    var n = Number(amount || 0);
    var prefix = n >= 0 ? '+' : '';
    return prefix + '$' + Math.abs(n).toLocaleString('es-CL') + ' CLP';
  }

  function formatTimestamp(date) {
    try {
      return Utilities.formatDate(date, 'America/Santiago', 'dd/MM/yyyy HH:mm') + ' (Santiago)';
    } catch (e) {
      return new Date().toISOString();
    }
  }

  // ── Deduplicación via PropertiesService (persiste entre ejecuciones) ──────────

  function getAlertCacheKey(alertType) {
    return CACHE_KEY_PREFIX + alertType;
  }

  function wasAlertRecentlySent(alertType) {
    try {
      var props = PropertiesService.getScriptProperties();
      var silenceMinutes = parseInt(
        props.getProperty('WHATSAPP_ALERT_SILENCE_MIN') || String(SILENCE_WINDOW_MINUTES),
        10
      );
      var key = getAlertCacheKey(alertType);
      var lastSent = props.getProperty(key);
      if (!lastSent) return false;
      var lastSentMs = parseInt(lastSent, 10);
      var elapsedMin = (Date.now() - lastSentMs) / 60000;
      return elapsedMin < silenceMinutes;
    } catch (e) {
      return false;
    }
  }

  function markAlertSent(alertType) {
    try {
      PropertiesService.getScriptProperties().setProperty(
        getAlertCacheKey(alertType),
        String(Date.now())
      );
    } catch (e) {
      // no bloquear el flujo si PropertiesService falla
    }
  }

  // ── Envío al backend ──────────────────────────────────────────────────────────

  function sendToBackend(alertType, message, overridePhone) {
    var props = PropertiesService.getScriptProperties();
    var backendUrl = props.getProperty('WHATSAPP_ALERT_BACKEND_URL');
    var token = props.getProperty('WHATSAPP_ALERT_TOKEN');
    var phone = overridePhone || props.getProperty('WHATSAPP_ALERT_PHONE');

    if (!backendUrl || !token || !phone) {
      AuditService.logWarn(
        'WhatsAppAlertsService: configuracion incompleta',
        'Faltan WHATSAPP_ALERT_BACKEND_URL, WHATSAPP_ALERT_TOKEN o WHATSAPP_ALERT_PHONE en PropertiesService'
      );
      return { ok: false, error: 'missing_config' };
    }

    var url = backendUrl.replace(/\/$/, '') + '/finance-alert';

    try {
      var response = UrlFetchApp.fetch(url, {
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'x-finance-alert-token': token
        },
        payload: JSON.stringify({
          phone: phone,
          alertType: alertType,
          message: message,
          sentAt: new Date().toISOString()
        }),
        muteHttpExceptions: true,
        followRedirects: true
      });

      var code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        markAlertSent(alertType);
        AuditService.logInfo('WhatsApp alerta enviada', JSON.stringify({ alertType: alertType, httpStatus: code }));
        return { ok: true, httpStatus: code };
      } else {
        AuditService.logWarn(
          'WhatsApp alerta fallida',
          JSON.stringify({ alertType: alertType, httpStatus: code, body: response.getContentText().substring(0, 200) })
        );
        return { ok: false, httpStatus: code };
      }
    } catch (e) {
      AuditService.logWarn('WhatsApp alerta error de red', String(e));
      return { ok: false, error: String(e) };
    }
  }

  // ── Función principal: evalúa el snapshot y decide qué alertas enviar ─────────

  /**
   * Analiza el snapshot del sistema y envía alertas WhatsApp si corresponde.
   * Llamar desde DashboardService.runExecutiveDashboardRefresh() o desde runDailyCompliance().
   *
   * @param {Object} snapshot - Resultado de DashboardService.getSystemHealthSnapshot()
   */
  function evaluateAndAlert(snapshot) {
    if (!snapshot) return;

    var results = [];

    // SEV-1: cierre bloqueado (errores de calidad + rechazados vencidos + incidentes)
    var cierresBloqueados = (
      snapshot.quality.errorCount > 0 ||
      snapshot.queue.overdue > 0 ||
      snapshot.contingency.blockingIncidents > 0
    );
    if (cierresBloqueados && !wasAlertRecentlySent('SEV1_CIERRE_BLOQUEADO')) {
      var msg = ALERT_TEMPLATES.SEV1_CIERRE_BLOQUEADO(snapshot);
      results.push(sendToBackend('SEV1_CIERRE_BLOQUEADO', msg));
    }

    // SEV-2: banco con backlog > 10 partidas
    if (snapshot.ledger.pendingBank > 10 && !wasAlertRecentlySent('SEV2_BANCO_BACKLOG')) {
      var msgBanco = ALERT_TEMPLATES.SEV2_BANCO_BACKLOG(snapshot);
      results.push(sendToBackend('SEV2_BANCO_BACKLOG', msgBanco));
    }

    // SEV-2: rechazados vencidos
    if (snapshot.queue.overdue > 0 && !wasAlertRecentlySent('SEV2_RECHAZADOS_VENCIDOS')) {
      var msgRej = ALERT_TEMPLATES.SEV2_RECHAZADOS_VENCIDOS(snapshot);
      results.push(sendToBackend('SEV2_RECHAZADOS_VENCIDOS', msgRej));
    }

    return results;
  }

  /**
   * Alerta específica cuando Gemini cae. Llamar desde el catch del bloque de Gemini.
   * @param {string} errorDetail - Mensaje de error de Gemini
   */
  function alertGeminiDown(errorDetail) {
    if (wasAlertRecentlySent('GEMINI_CAIDA')) return;
    var msg = ALERT_TEMPLATES.GEMINI_CAIDA(errorDetail);
    return sendToBackend('GEMINI_CAIDA', msg);
  }

  /**
   * Alerta de cierre mensual exitoso. Llamar al completar runMonthlyBalance().
   * @param {Object} snapshot
   */
  function alertCierreOk(snapshot) {
    var msg = ALERT_TEMPLATES.CIERRE_MENSUAL_OK(snapshot);
    return sendToBackend('CIERRE_MENSUAL_OK', msg);
  }

  /**
   * Reporte diario de ventas para el contador.
   * Lee ingresos/egresos del día desde el Libro Mayor y los envía por WhatsApp
   * al número configurado en CONTADOR_WHATSAPP_PHONE.
   */
  function sendDailySalesReportToAccountant() {
    var props = PropertiesService.getScriptProperties();
    var contadorPhone = props.getProperty('CONTADOR_WHATSAPP_PHONE');
    if (!contadorPhone) {
      AuditService.logWarn('WhatsAppAlertsService: CONTADOR_WHATSAPP_PHONE no configurado', '');
      return { ok: false, error: 'missing_config' };
    }

    var today      = FinanceUtils.getChileDate();
    var startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    var endOfDay   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    var rows       = LedgerService.getRowsForPeriod(startOfDay, endOfDay);

    var totalIngresos      = 0;
    var totalEgresos       = 0;
    var totalTransacciones = 0;
    var desgloseMap        = {};

    rows.forEach(function (row) {
      var tipo   = String(row[2] || '').toUpperCase();
      var monto  = FinanceUtils.normalizeCurrency(row[11]);
      var origen = String(row[14] || 'Sin canal').trim() || 'Sin canal';

      if (tipo === 'INGRESO') {
        totalIngresos      += monto;
        totalTransacciones += 1;
        if (!desgloseMap[origen]) desgloseMap[origen] = { monto: 0, count: 0 };
        desgloseMap[origen].monto += monto;
        desgloseMap[origen].count += 1;
      } else if (tipo === 'EGRESO') {
        totalEgresos += monto;
      }
    });

    var desglose = Object.keys(desgloseMap).map(function (canal) {
      return { canal: canal, monto: desgloseMap[canal].monto, count: desgloseMap[canal].count };
    }).sort(function (a, b) { return b.monto - a.monto; });

    var fechaStr = Utilities.formatDate(today, 'America/Santiago', 'dd/MM/yyyy');
    var message  = ALERT_TEMPLATES.REPORTE_VENTAS_DIARIO_CONTADOR({
      fecha:              fechaStr,
      totalIngresos:      totalIngresos,
      totalTransacciones: totalTransacciones,
      desglose:           desglose,
      egresos:            totalEgresos
    });

    var result = sendToBackend('REPORTE_VENTAS_DIARIO_CONTADOR', message, contadorPhone);
    AuditService.logInfo('Reporte ventas diario enviado al contador', JSON.stringify({
      fecha: fechaStr, totalIngresos: totalIngresos,
      totalTransacciones: totalTransacciones, ok: result.ok
    }));
    return result;
  }

  /**
   * Alerta manual con mensaje libre. Útil para pruebas y notificaciones ad-hoc.
   * @param {string} message - Texto libre del mensaje
   */
  function sendManual(message) {
    return sendToBackend('MANUAL', String(message));
  }

  /**
   * Test de conectividad: envía un mensaje de prueba al backend.
   * Ejecutar desde el editor de Apps Script para verificar la integración.
   */
  function testConnection() {
    var result = sendManual(
      '*[VITTOSTORE FINANZAS]* ✅ Test de conexión exitoso.\n\nEl canal WhatsApp de alertas financieras está operativo.\n⏱ ' +
      formatTimestamp(new Date())
    );
    Logger.log('WhatsAppAlertsService testConnection: ' + JSON.stringify(result));
    return result;
  }

  // ── API pública ───────────────────────────────────────────────────────────────
  return {
    evaluateAndAlert: evaluateAndAlert,
    alertGeminiDown: alertGeminiDown,
    alertCierreOk: alertCierreOk,
    sendManual: sendManual,
    sendDailySalesReportToAccountant: sendDailySalesReportToAccountant,
    testConnection: testConnection
  };

})();

// ─── INSTRUCCIONES DE INTEGRACIÓN ────────────────────────────────────────────
//
// 1. En Google Apps Script > Configuración del proyecto > Propiedades del script,
//    agregar las siguientes claves:
//
//    WHATSAPP_ALERT_BACKEND_URL  → https://tu-backend.com   (URL pública del backend)
//    WHATSAPP_ALERT_TOKEN        → (valor de FINANCE_ALERT_TOKEN del .env del backend)
//    WHATSAPP_ALERT_PHONE        → 56912345678              (tu número de WhatsApp)
//    WHATSAPP_ALERT_SILENCE_MIN  → 60                       (minutos entre alertas iguales)
//
// 2. En DashboardService.runExecutiveDashboardRefresh(), al final del try, agregar:
//
//    var snapshot = getSystemHealthSnapshot();
//    WhatsAppAlertsService.evaluateAndAlert(snapshot);
//
// 3. En GmailIngestion, en el catch del bloque de Gemini, agregar:
//
//    WhatsAppAlertsService.alertGeminiDown(error.message);
//
// 4. Para probar: ejecutar testWhatsAppConnection() desde el menú desplegable.
//
// ─────────────────────────────────────────────────────────────────────────────

// Wrapper global — aparece en el menú desplegable de Apps Script
function testWhatsAppConnection() {
  var result = WhatsAppAlertsService.testConnection();
  Logger.log(JSON.stringify(result));
  if (result && result.ok) {
    SpreadsheetApp.getUi().alert('✅ WhatsApp OK — revisa tu teléfono.');
  } else {
    SpreadsheetApp.getUi().alert('❌ Fallo: ' + JSON.stringify(result));
  }
}

// Wrapper global — reporte diario de ventas al contador
function runDailySalesReportToAccountant() {
  var result = WhatsAppAlertsService.sendDailySalesReportToAccountant();
  Logger.log('Reporte contador: ' + JSON.stringify(result));
  if (result && result.ok) {
    SpreadsheetApp.getUi().alert('✅ Reporte enviado al contador.');
  } else {
    SpreadsheetApp.getUi().alert('❌ Fallo: ' + JSON.stringify(result));
  }
}
function diagnosticoWhatsApp() {
  var props = PropertiesService.getScriptProperties();
  var url    = props.getProperty('WHATSAPP_ALERT_BACKEND_URL');
  var token  = props.getProperty('WHATSAPP_ALERT_TOKEN');
  var phone  = props.getProperty('WHATSAPP_ALERT_PHONE');

  var lineas = [
    'WHATSAPP_ALERT_BACKEND_URL : ' + (url   ? '✅ ' + url             : '❌ FALTA'),
    'WHATSAPP_ALERT_TOKEN       : ' + (token ? '✅ (presente)'         : '❌ FALTA'),
    'WHATSAPP_ALERT_PHONE       : ' + (phone ? '✅ ' + phone           : '❌ FALTA'),
  ];

  var msg = lineas.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
