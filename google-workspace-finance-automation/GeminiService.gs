var GeminiService = (function () {
  // ── Circuit breaker — estado en PropertiesService ─────────────────────────
  var CB_STATE_KEY     = 'GEMINI_CB_STATE';       // 'CLOSED' | 'OPEN'
  var CB_FAIL_KEY      = 'GEMINI_CB_FAIL_COUNT';  // número de fallos consecutivos
  var CB_OPENED_AT_KEY = 'GEMINI_CB_OPENED_AT';   // timestamp ms de apertura

  var CB_DEFAULT_FAIL_THRESHOLD = 3;   // fallos 5xx antes de abrir
  var CB_DEFAULT_OPEN_WINDOW_MIN = 10; // minutos que permanece abierto

  function getCbConfig() {
    try {
      var props = PropertiesService.getScriptProperties();
      var threshold = parseInt(props.getProperty('GEMINI_CB_FAIL_THRESHOLD') || '', 10);
      var windowMin  = parseInt(props.getProperty('GEMINI_CB_OPEN_MIN')      || '', 10);
      return {
        failThreshold: isNaN(threshold) ? CB_DEFAULT_FAIL_THRESHOLD : threshold,
        openWindowMin:  isNaN(windowMin)  ? CB_DEFAULT_OPEN_WINDOW_MIN  : windowMin
      };
    } catch (e) {
      return { failThreshold: CB_DEFAULT_FAIL_THRESHOLD, openWindowMin: CB_DEFAULT_OPEN_WINDOW_MIN };
    }
  }

  function isCircuitOpen() {
    try {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty(CB_STATE_KEY) !== 'OPEN') return false;
      var openedAt  = parseInt(props.getProperty(CB_OPENED_AT_KEY) || '0', 10);
      var elapsedMin = (Date.now() - openedAt) / 60000;
      if (elapsedMin >= getCbConfig().openWindowMin) {
        // Ventana expirada → half-open: dejar pasar un intento
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function recordSuccess() {
    try {
      var props = PropertiesService.getScriptProperties();
      props.setProperty(CB_STATE_KEY, 'CLOSED');
      props.setProperty(CB_FAIL_KEY, '0');
      props.deleteProperty(CB_OPENED_AT_KEY);
    } catch (e) { /* no bloquear flujo */ }
  }

  function recordFailure(errorDetail) {
    try {
      var props = PropertiesService.getScriptProperties();
      var config    = getCbConfig();
      var failCount = parseInt(props.getProperty(CB_FAIL_KEY) || '0', 10) + 1;
      props.setProperty(CB_FAIL_KEY, String(failCount));

      if (failCount >= config.failThreshold) {
        props.setProperty(CB_STATE_KEY, 'OPEN');
        props.setProperty(CB_OPENED_AT_KEY, String(Date.now()));
        AuditService.logWarn('GeminiService circuit breaker ABIERTO',
          'Fallos consecutivos: ' + failCount + ' | Ventana: ' + config.openWindowMin + ' min | Detalle: ' + String(errorDetail).substring(0, 200));
        try { WhatsAppAlertsService.alertGeminiDown(errorDetail); } catch (e) { /* opcional */ }
      }
    } catch (e) { /* no bloquear flujo */ }
  }

  function buildPrompt(documentType, emailMeta, bodyText) {
    var schema = {
      registros: [
        {
          tipoMovimiento: 'INGRESO|EGRESO',
          fechaDocumento: 'YYYY-MM-DD',
          categoria: 'texto',
          subcategoria: 'texto',
          proveedorCliente: 'texto',
          rutEmisorReceptor: 'texto',
          numeroDocumento: 'texto',
          moneda: 'CLP',
          montoNeto: 0,
          iva: 0,
          montoTotal: 0,
          estadoPago: 'PAGADO|PENDIENTE',
          medioPago: 'texto',
          origenVenta: 'Meta Ads|Google Ads|Email|Organico|Marketplace|Sin atribucion',
          observaciones: 'texto',
          socioRut: 'texto opcional',
          gerenciaRol: 'texto opcional'
        }
      ]
    };

    return [
      'Eres un extractor contable para Chile. Devuelve SOLO JSON valido, sin markdown, sin comentarios.',
      'Tipo de documento esperado: ' + documentType + '.',
      'Si falta un campo, usa string vacio o 0.',
      'Si no hay informacion financiera util, devuelve {"registros":[]}.',
      'Normaliza moneda a CLP cuando corresponda.',
      'No inventes RUT ni folios.',
      'Metadatos email: ' + JSON.stringify(emailMeta),
      'Contenido email y adjuntos en texto:',
      bodyText,
      'Schema de salida estricto: ' + JSON.stringify(schema)
    ].join('\n');
  }

  function callGemini(promptText) {
    if (isCircuitOpen()) {
      throw new Error('CIRCUIT_OPEN: Gemini no disponible — circuit breaker activo. Reintentando en ' + getCbConfig().openWindowMin + ' min.');
    }

    var apiKey = FinanceConfig.getRequiredProperty('GEMINI_API_KEY');
    var model = FinanceConfig.getOptionalProperty('GEMINI_MODEL', 'gemini-2.0-flash');
    var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

    var payload = {
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    };

    var response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var status = response.getResponseCode();
    var responseText = response.getContentText();

    if (status >= 500) {
      var errMsg = 'Gemini error HTTP ' + status + ': ' + responseText.substring(0, 200);
      recordFailure(errMsg);
      throw new Error(errMsg);
    }

    if (status < 200 || status > 299) {
      // Errores 4xx (auth, quota, bad request) — no activan el circuit breaker
      throw new Error('Gemini error HTTP ' + status + ': ' + responseText.substring(0, 200));
    }

    var parsed = FinanceUtils.safeJsonParse(responseText);
    var firstCandidate =
      parsed &&
      parsed.candidates &&
      parsed.candidates[0] &&
      parsed.candidates[0].content &&
      parsed.candidates[0].content.parts &&
      parsed.candidates[0].content.parts[0] &&
      parsed.candidates[0].content.parts[0].text;

    if (!firstCandidate) {
      throw new Error('Gemini sin contenido util.');
    }

    var asJson = FinanceUtils.safeJsonParse(firstCandidate);
    if (!asJson || !asJson.registros) {
      throw new Error('Gemini devolvio JSON invalido para schema esperado.');
    }

    recordSuccess();
    return asJson.registros;
  }

  function extractFinancialRecords(documentType, emailMeta, fullText) {
    try {
      var prompt = buildPrompt(documentType, emailMeta, fullText);
      return callGemini(prompt);
    } catch (error) {
      var errStr = String(error);

      if (errStr.indexOf('CIRCUIT_OPEN') === 0) {
        // Circuit abierto: incidente ya registrado al abrir — solo loguear, no re-lanzar
        AuditService.logInfo('GeminiService omitido por circuit breaker', errStr.substring(0, 200));
        return [];
      }

      ContingencyService.registerIntegrationIncident('GEMINI', 'extractFinancialRecords', errStr, {
        gmailMessageId: emailMeta && emailMeta.gmailMessageId,
        responsible: 'Finanzas',
        fallbackApplied: false
      });
      throw error;
    }
  }

  function getCircuitStatus() {
    try {
      var props = PropertiesService.getScriptProperties();
      var state     = props.getProperty(CB_STATE_KEY) || 'CLOSED';
      var failCount = parseInt(props.getProperty(CB_FAIL_KEY) || '0', 10);
      var openedAt  = props.getProperty(CB_OPENED_AT_KEY);
      var config    = getCbConfig();
      return {
        state:          state,
        failCount:      failCount,
        openedAt:       openedAt || null,
        failThreshold:  config.failThreshold,
        openWindowMin:  config.openWindowMin,
        circuitOpen:    isCircuitOpen()
      };
    } catch (e) {
      return { state: 'UNKNOWN', error: String(e) };
    }
  }

  return {
    extractFinancialRecords: extractFinancialRecords,
    getCircuitStatus: getCircuitStatus
  };
})();

// Wrapper global — aparece en el desplegable de Apps Script
function checkGeminiCircuitStatus() {
  var s = GeminiService.getCircuitStatus();
  var icon = s.circuitOpen ? '🔴 ABIERTO' : '🟢 CERRADO';
  var lines = [
    'Circuit breaker Gemini: ' + icon,
    '',
    'Estado       : ' + s.state,
    'Fallos consec: ' + s.failCount + ' / ' + s.failThreshold,
    'Abierto en   : ' + (s.openedAt ? new Date(parseInt(s.openedAt, 10)).toISOString() : '—'),
    'Ventana      : ' + s.openWindowMin + ' min',
  ];
  var msg = lines.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}

function resetGeminiCircuit() {
  PropertiesService.getScriptProperties().setProperties({
    'GEMINI_CB_STATE':      'CLOSED',
    'GEMINI_CB_FAIL_COUNT': '0'
  });
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_CB_OPENED_AT');
  SpreadsheetApp.getUi().alert('✅ Circuit breaker Gemini reseteado a CLOSED.');
  Logger.log('GeminiService circuit breaker reseteado manualmente.');
}
