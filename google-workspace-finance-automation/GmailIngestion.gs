var __VITTO_RUN_INGESTION_REF = null;
var __WARNED_DTE_SERVICE_MISSING__ = false;
var __WARNED_GEMINI_SERVICE_MISSING__ = false;
var VITTO_GMAIL_INGESTION_VERSION_20260508 = 'VITTO_GMAIL_INGESTION_VERSION_20260508';

function toDateStringLocal_(date) {
  return Utilities.formatDate(new Date(date), 'America/Santiago', 'yyyy-MM-dd');
}

function normalizeTextLocal_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeCurrencyLocal_(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }

  var s = String(value).trim().replace(/[^0-9.,]/g, '');
  if (!s) return 0;

  var hasDot   = s.indexOf('.') !== -1;
  var hasComma = s.indexOf(',') !== -1;
  var cleaned;

  if (hasDot && hasComma) {
    // Mixed separators: whichever comes last is the decimal separator
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
      // e.g. "1,234.56"  → remove commas → "1234.56"
      cleaned = s.replace(/,/g, '');
    } else {
      // e.g. "1.234,56"  → remove dots, comma→dot → "1234.56"
      cleaned = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma) {
    // Only comma: thousands separator if exactly 3 digits follow it, else decimal
    var afterComma = s.substring(s.lastIndexOf(',') + 1).replace(/[^0-9]/g, '');
    if (afterComma.length === 3) {
      // e.g. "25,000" → 25000
      cleaned = s.replace(/,/g, '');
    } else {
      // e.g. "25,5"  → 25.5
      cleaned = s.replace(',', '.');
    }
  } else if (hasDot) {
    // Only dot: thousands separator if exactly 3 digits follow it, else decimal
    var afterDot = s.substring(s.lastIndexOf('.') + 1).replace(/[^0-9]/g, '');
    if (afterDot.length === 3) {
      // e.g. "18.000" (Chilean) → 18000
      cleaned = s.replace(/\./g, '');
    } else {
      // e.g. "18.5" → 18.5
      cleaned = s;
    }
  } else {
    cleaned = s;
  }

  var parsed = Number(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function safeAuditLog_(level, eventName, detail) {
  if (typeof AuditService !== 'undefined' && AuditService) {
    if (level === 'ERROR' && typeof AuditService.logError === 'function') {
      AuditService.logError(eventName, detail);
      return;
    }
    if (level === 'WARN' && typeof AuditService.logWarn === 'function') {
      AuditService.logWarn(eventName, detail);
      return;
    }
    if (typeof AuditService.logInfo === 'function') {
      AuditService.logInfo(eventName, detail);
      return;
    }
  }

  try {
    Logger.log('[' + level + '] ' + eventName + ' | ' + String(detail || ''));
  } catch (e) {
    // No-op: avoid breaking ingestion due to logging failures.
  }
}

function safeRegisterIncident_(integrationName, source, errorText, metadata) {
  if (typeof ContingencyService !== 'undefined' && ContingencyService && typeof ContingencyService.registerIntegrationIncident === 'function') {
    ContingencyService.registerIntegrationIncident(integrationName, source, errorText, metadata || {});
    return;
  }

  safeAuditLog_('ERROR', 'ContingencyService no disponible', JSON.stringify({
    integrationName: integrationName,
    source: source,
    error: String(errorText || ''),
    metadata: metadata || {}
  }));
}

function safeRegisterRejectedRecord_(emailMeta, record, errors) {
  if (typeof DataQualityService !== 'undefined' && DataQualityService && typeof DataQualityService.registerRejectedRecord === 'function') {
    DataQualityService.registerRejectedRecord(emailMeta, record, errors || []);
    return;
  }

  safeAuditLog_('WARN', 'DataQualityService no disponible para rechazo', JSON.stringify({
    gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || '',
    numeroDocumento: (record && record.numeroDocumento) || '',
    errors: errors || []
  }));
}

function safeRunDataQualityChecks_() {
  if (typeof DataQualityService !== 'undefined' && DataQualityService && typeof DataQualityService.runLedgerDataQualityChecks === 'function') {
    return DataQualityService.runLedgerDataQualityChecks();
  }

  var dqDiag = {
    DataQualityService: typeof DataQualityService,
    runLedgerDataQualityChecks: (typeof DataQualityService !== 'undefined' && DataQualityService)
      ? typeof DataQualityService.runLedgerDataQualityChecks
      : 'n/a'
  };

  safeAuditLog_('WARN', 'DataQualityService no disponible en runtime', JSON.stringify(dqDiag));

  return {
    executed: false,
    reason: 'DataQualityService no disponible',
    diagnostics: dqDiag
  };
}

function safeSyncRejectedRecordsToReviewQueue_() {
  if (typeof ReviewQueueService !== 'undefined' && ReviewQueueService && typeof ReviewQueueService.syncRejectedRecordsToReviewQueue === 'function') {
    return ReviewQueueService.syncRejectedRecordsToReviewQueue();
  }

  var rqDiag = {
    ReviewQueueService: typeof ReviewQueueService,
    syncRejectedRecordsToReviewQueue: (typeof ReviewQueueService !== 'undefined' && ReviewQueueService)
      ? typeof ReviewQueueService.syncRejectedRecordsToReviewQueue
      : 'n/a'
  };

  safeAuditLog_('WARN', 'ReviewQueueService no disponible en runtime', JSON.stringify(rqDiag));

  return {
    synced: 0,
    pendingQueueRows: 0,
    reason: 'ReviewQueueService no disponible',
    diagnostics: rqDiag
  };
}

function safeRefreshExecutiveSuite_() {
  if (typeof DashboardService !== 'undefined' && DashboardService && typeof DashboardService.refreshExecutiveSuite === 'function') {
    return DashboardService.refreshExecutiveSuite();
  }
  return {
    updatedAt: toDateStringLocal_(new Date()),
    quality: { errorCount: 0 },
    queue: { pending: 0 },
    contingency: { blockingIncidents: 0 },
    reason: 'DashboardService no disponible'
  };
}

function safeEnsureCoreSheets_() {
  if (typeof LedgerService !== 'undefined' && LedgerService && typeof LedgerService.ensureCoreSheets === 'function') {
    LedgerService.ensureCoreSheets();
    return;
  }
  throw new Error('LedgerService.ensureCoreSheets no disponible en runtime');
}

function safeExtractXmlRecords_(message, emailMeta, defaultTipoMovimiento, defaultOrigenVenta) {
  if (typeof DteXmlService !== 'undefined' && DteXmlService && typeof DteXmlService.extractRecordsFromMessage === 'function') {
    return DteXmlService.extractRecordsFromMessage(message, emailMeta, defaultTipoMovimiento, defaultOrigenVenta);
  }

  if (!__WARNED_DTE_SERVICE_MISSING__) {
    safeAuditLog_('WARN', 'DteXmlService no disponible, se omite extraccion XML', JSON.stringify({
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || ''
    }));
    __WARNED_DTE_SERVICE_MISSING__ = true;
  }
  return [];
}

function safeExtractGeminiRecords_(documentType, emailMeta, bodyText) {
  if (typeof GeminiService !== 'undefined' && GeminiService && typeof GeminiService.extractFinancialRecords === 'function') {
    return GeminiService.extractFinancialRecords(documentType, emailMeta, bodyText);
  }

  if (!__WARNED_GEMINI_SERVICE_MISSING__) {
    safeAuditLog_('WARN', 'GeminiService no disponible, se omite extraccion IA', JSON.stringify({
      documentType: documentType,
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || ''
    }));
    __WARNED_GEMINI_SERVICE_MISSING__ = true;
  }
  return [];
}

function detectCurrencyHeuristic_(text) {
  var haystack = String(text || '');
  if (/\b(usd|us\$|dolares?)\b/i.test(haystack)) {
    return 'USD';
  }
  return 'CLP';
}

function extractAmountHeuristic_(text) {
  var haystack = String(text || '');
  var m;

  // Pass 1: labeled keywords (total, monto, amount, etc.) with optional currency prefix
  var reLabeled = /(?:total|amount|monto|pagado|paid|importe|subtotal)\s*[:=]?\s*(?:clp|usd|us\$|\$)?\s*([0-9][0-9\.,]{0,15})/gi;
  while ((m = reLabeled.exec(haystack)) !== null) {
    var parsedLabeled = normalizeCurrencyLocal_(m[1]);
    if (parsedLabeled > 0) {
      return parsedLabeled;
    }
  }

  // Pass 2: explicit currency symbol/code before number
  var maxAmount = 0;
  var reMoney = /(?:clp|usd|us\$|\$)\s*([0-9][0-9\.,]{2,15})/gi;
  while ((m = reMoney.exec(haystack)) !== null) {
    var parsedMoney = normalizeCurrencyLocal_(m[1]);
    if (parsedMoney > maxAmount) {
      maxAmount = parsedMoney;
    }
  }
  if (maxAmount > 0) {
    return maxAmount;
  }

  // Pass 3: any formatted number >= 100 (catches Chilean "18.000" or US "25,000" without prefix)
  var reBareNumber = /\b([0-9]{1,3}(?:[.,][0-9]{3})+(?:[.,][0-9]{1,2})?)\b/g;
  var maxBare = 0;
  while ((m = reBareNumber.exec(haystack)) !== null) {
    var parsedBare = normalizeCurrencyLocal_(m[1]);
    if (parsedBare > maxBare) {
      maxBare = parsedBare;
    }
  }
  return maxBare >= 100 ? maxBare : 0;
}

function extractDocumentNumberHeuristic_(text, fallbackId) {
  var haystack = String(text || '');
  var m = haystack.match(/(?:order|pedido|orden|invoice|factura|boleta|folio|numero|num|no)\s*[#:-]?\s*([A-Z0-9-]{4,30})/i);
  if (m && m[1]) {
    return String(m[1]).toUpperCase();
  }

  // MEJORA-13: always use gmailMessageId suffix — Date.now() alone causes hash collisions
  // when two emails arrive within the same millisecond
  var msgSuffix = String(fallbackId || '').replace(/[^A-Za-z0-9]/g, '').slice(-12);
  return 'AUTO-' + (msgSuffix || (String(new Date().getTime()).slice(-8) + Math.random().toString(36).slice(-4)));
}

function extractPartyHeuristic_(fromHeader) {
  var sender = String(fromHeader || '').trim();
  var m = sender.match(/^\s*([^<]+)\s*</);
  if (m && m[1]) {
    return String(m[1]).trim();
  }
  return sender;
}

function hasAnyKeyword_(text, keywords) {
  var haystack = String(text || '').toLowerCase();
  return keywords.some(function (kw) {
    return haystack.indexOf(String(kw).toLowerCase()) !== -1;
  });
}

function getNumericPropertyOrDefault_(key, fallback) {
  var raw = FinanceConfig.getOptionalProperty(key, String(fallback));
  var value = Number(raw);
  return isNaN(value) ? Number(fallback) : value;
}

function isSuspiciousHeuristicDocNumber_(value) {
  var doc = String(value || '').trim().toUpperCase();
  if (!doc || doc.length < 4) {
    return true;
  }

  if (/^(ACTUALIZASTE|ACTUALIZACION|ACTUALIZACIONE|NOTIFICACION|PERFIL|PROFILE|GOOGLE|BUSINESS)$/.test(doc)) {
    return true;
  }

  // Exigir al menos un digito para evitar textos puros de notificacion.
  return !/[0-9]/.test(doc);
}

function isHeuristicAmountPlausible_(currency, total) {
  var moneda = String(currency || 'CLP').toUpperCase();
  var amount = normalizeCurrencyLocal_(total);

  if (!(amount > 0)) {
    return false;
  }

  var maxClp = getNumericPropertyOrDefault_('HEURISTIC_MAX_CLP', 50000000);
  var maxUsd = getNumericPropertyOrDefault_('HEURISTIC_MAX_USD', 50000);

  if (moneda === 'USD') {
    return amount <= maxUsd;
  }
  return amount <= maxClp;
}

function getScopeExceptionSenders_() {
  var raw = FinanceConfig.getOptionalProperty(
    'VITTO_SCOPE_EXCEPTION_SENDERS',
    'sherice9821@gmail.com'
  );

  return String(raw || '')
    .split(',')
    .map(function (item) { return String(item || '').trim().toLowerCase(); })
    .filter(function (item) { return item.length > 0; });
}

function isScopeExceptionSender_(fromHeader) {
  var sender = String(fromHeader || '').toLowerCase();
  var exceptions = getScopeExceptionSenders_();
  return exceptions.some(function (email) {
    return sender.indexOf(email) !== -1;
  });
}

function getScopeKeywords_() {
  var raw = FinanceConfig.getOptionalProperty(
    'VITTO_SCOPE_KEYWORDS',
    'vittostore,vitto,shopify,pedido,order,orden de compra,invoice,factura,boleta,anthropic,claude,openai,aws,google workspace'
  );

  return String(raw || '')
    .split(',')
    .map(function (item) { return String(item || '').trim().toLowerCase(); })
    .filter(function (item) { return item.length > 0; });
}

function evaluateVittoScope_(documentType, emailMeta, bodyText) {
  if (String(documentType || '').toUpperCase() === 'SHOPIFY') {
    return {
      allowed: true,
      reason: 'shopify_flow'
    };
  }

  if (String(documentType || '').toUpperCase() === 'SII') {
    return {
      allowed: true,
      reason: 'tax_authority_flow'
    };
  }

  if (String(documentType || '').toUpperCase() === 'PATENTES') {
    return {
      allowed: true,
      reason: 'municipal_tax_flow'
    };
  }

  if (String(documentType || '').toUpperCase() === 'BANCARIOS') {
    return {
      allowed: true,
      reason: 'banking_commitments_flow'
    };
  }

  var haystack = [
    String((emailMeta && emailMeta.asunto) || ''),
    String((emailMeta && emailMeta.emailOrigen) || ''),
    String(bodyText || '')
  ].join('\n').toLowerCase();

  var keywords = getScopeKeywords_();
  var matched = keywords.filter(function (kw) {
    return haystack.indexOf(kw) !== -1;
  });

  return {
    allowed: matched.length > 0,
    matched: matched
  };
}

function enrichRecordWithOperationalContext_(record, documentType, emailMeta, bodyText) {
  var mergedText = [
    String((emailMeta && emailMeta.asunto) || ''),
    String(bodyText || ''),
    String((record && record.subcategoria) || ''),
    String((record && record.observaciones) || '')
  ].join('\n');

  var refundKeywords = ['devolucion', 'devolución', 'refund', 'reembolso', 'nota de credito', 'nota de crédito', 'credit note', 'nc'];
  var importKeywords = ['importacion', 'importación', 'aduana', 'agente aduanas', 'fob', 'cif', 'internacion'];
  var exportKeywords = ['exportacion', 'exportación', 'export', 'cliente extranjero', 'incoterm'];
  var importDutyKeywords = ['arancel', 'arancel aduanero', 'ad valorem', 'derechos aduaneros'];
  var importTaxKeywords = ['iva importacion', 'iva importación', 'impuesto importacion', 'impuesto importación', 'tasa aduanera'];
  var portLogisticsKeywords = ['retiro portuario', 'almacenaje', 'demurrage', 'desconsolidacion', 'desconsolidación', 'agencia de aduanas', 'terminal portuario', 'logistica portuaria', 'logística portuaria'];
  var vehicleRentalKeywords = ['arriendo vehiculo', 'arriendo vehículo', 'arriendo de vehiculo', 'arriendo de vehículo', 'rent a car', 'renta auto', 'rental car', 'leasing vehiculo', 'leasing vehículo'];
  var pettyCashKeywords = ['caja chica', 'rendicion gastos', 'rendición gastos', 'rendicion de gastos', 'rendición de gastos', 'boleta movilizacion', 'boleta movilización', 'fondo fijo'];
  var warehouseMachineryKeywords = ['arriendo bodega', 'arriendo de bodega', 'arriendo maquinaria', 'arriendo de maquinaria', 'arriendo equipo', 'arriendo de equipo', 'bodega', 'bodegas', 'maquinaria', 'alquiler bodega', 'alquiler maquinaria'];
  var tollKeywords = ['peaje', 'peajes', 'autopista', 'tag autopista', 'via express', 'vía express', 'vignette', 'paso peaje', 'cobro autopista'];
  var loadingEquipKeywords = ['carga y descarga', 'equipo de carga', 'equipos de carga', 'montacargas', 'grua', 'grúa', 'manipulacion de carga', 'manipulación de carga', 'estiba', 'descarga de productos', 'descarga de insumos'];
  var labelingKeywords = ['etiquetado', 'rotulacion', 'rotulación', 'codigo de barra', 'código de barra', 'codigo barra', 'código barra', 'barcode', 'qr', 'codigo qr', 'código qr', 'etiqueta', 'etiquetas', 'label', 'labels'];

  var isCreditNoteDte = String((record && record.subcategoria) || '').toUpperCase().indexOf('DTE_61') !== -1 ||
    String((record && record.subcategoria) || '').toUpperCase().indexOf('NOTA_CREDITO') !== -1;
  var isRefund = isCreditNoteDte || hasAnyKeyword_(mergedText, refundKeywords);
  var isImport = hasAnyKeyword_(mergedText, importKeywords);
  var isExport = hasAnyKeyword_(mergedText, exportKeywords);
  var isImportDuty = hasAnyKeyword_(mergedText, importDutyKeywords);
  var isImportTax = hasAnyKeyword_(mergedText, importTaxKeywords);
  var isPortLogistics = hasAnyKeyword_(mergedText, portLogisticsKeywords);
  var isVehicleRental = hasAnyKeyword_(mergedText, vehicleRentalKeywords);
  var isPettyCash = hasAnyKeyword_(mergedText, pettyCashKeywords);
  var isWarehouseMachinery = hasAnyKeyword_(mergedText, warehouseMachineryKeywords);
  var isToll = hasAnyKeyword_(mergedText, tollKeywords);
  var isLoadingEquip = hasAnyKeyword_(mergedText, loadingEquipKeywords);
  var isLabeling = hasAnyKeyword_(mergedText, labelingKeywords);

  if (isRefund) {
    record.tipoMovimiento = 'EGRESO';
    if (!record.categoria || record.categoria === 'VENTA_ONLINE' || record.categoria === 'SERVICIOS' || record.categoria === 'DTE_CHILE') {
      record.categoria = 'DEVOLUCIONES_Y_NC';
    }
    if (!record.subcategoria || record.subcategoria === 'HEURISTICA_EMAIL') {
      record.subcategoria = 'DEVOLUCION_O_NOTA_CREDITO';
    }
  }

  if (isImport) {
    if (!record.categoria || record.categoria === 'SERVICIOS' || record.categoria === 'DTE_CHILE') {
      record.categoria = 'IMPORTACIONES';
    }
    if (!record.subcategoria || record.subcategoria === 'HEURISTICA_EMAIL') {
      record.subcategoria = 'COMPRA_IMPORTADA';
    }
    record.tipoMovimiento = 'EGRESO';

    if (isImportDuty) {
      record.subcategoria = 'ARANCEL_ADUANERO';
    } else if (isImportTax) {
      record.subcategoria = 'IMPUESTOS_IMPORTACION';
    } else if (isPortLogistics) {
      record.subcategoria = 'LOGISTICA_Y_RETIRO_PORTUARIO';
    }
  }

  if (isExport) {
    if (!record.categoria || record.categoria === 'VENTA_ONLINE' || record.categoria === 'DTE_CHILE') {
      record.categoria = 'EXPORTACIONES';
    }
    if (!record.subcategoria || record.subcategoria === 'HEURISTICA_EMAIL') {
      record.subcategoria = 'VENTA_EXPORTACION';
    }
    if (!record.tipoMovimiento || documentType === 'SHOPIFY') {
      record.tipoMovimiento = 'INGRESO';
    }
  }

  if (isVehicleRental) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'OPERACIONES_Y_LOGISTICA';
    record.subcategoria = 'ARRIENDO_VEHICULOS';
  }

  if (isPettyCash) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'GASTOS_OPERACIONALES';
    record.subcategoria = 'CAJA_CHICA_Y_RENDICIONES';
  }

  if (isWarehouseMachinery) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'OPERACIONES_Y_LOGISTICA';
    record.subcategoria = 'ARRIENDO_BODEGAS_Y_MAQUINARIA';
  }

  if (isToll) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'OPERACIONES_Y_LOGISTICA';
    record.subcategoria = 'PEAJES_Y_AUTOPISTAS';
  }

  if (isLoadingEquip) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'OPERACIONES_Y_LOGISTICA';
    record.subcategoria = 'EQUIPOS_CARGA_Y_DESCARGA';
  }

  if (isLabeling) {
    record.tipoMovimiento = 'EGRESO';
    record.categoria = 'OPERACIONES_Y_LOGISTICA';
    record.subcategoria = 'ETIQUETADO_Y_ROTULACION';
  }

  if (isImport && (isImportDuty || isImportTax || isPortLogistics)) {
    var notes = [];
    if (isImportDuty) {
      notes.push('incluye arancel aduanero');
    }
    if (isImportTax) {
      notes.push('incluye impuestos de importacion');
    }
    if (isPortLogistics) {
      notes.push('incluye costos logistica/retiro portuario');
    }

    var existingObs = String(record.observaciones || '').trim();
    var extraObs = 'Clasificacion operativa importacion: ' + notes.join(', ') + '.';
    record.observaciones = existingObs ? (existingObs + ' ' + extraObs) : extraObs;
  }

  if (isVehicleRental || isPettyCash) {
    var localNotes = [];
    if (isVehicleRental) {
      localNotes.push('incluye arriendo de vehiculos');
    }
    if (isPettyCash) {
      localNotes.push('incluye rendicion/caja chica');
    }

    var obs = String(record.observaciones || '').trim();
    var localExtra = 'Clasificacion operativa local: ' + localNotes.join(', ') + '.';
    record.observaciones = obs ? (obs + ' ' + localExtra) : localExtra;
  }

  return record;
}

function applyAnthropicProviderRules_(record, documentType, emailMeta, bodyText) {
  if (!record) {
    return record;
  }

  var sourceText = [
    String((record && record.proveedorCliente) || ''),
    String((emailMeta && emailMeta.emailOrigen) || ''),
    String((emailMeta && emailMeta.asunto) || ''),
    String(bodyText || '')
  ].join('\n').toLowerCase();

  if (sourceText.indexOf('anthropic') === -1 && sourceText.indexOf('claude pro') === -1) {
    return record;
  }

  var neto = normalizeCurrencyLocal_(record.montoNeto);
  var iva = normalizeCurrencyLocal_(record.iva);
  var total = normalizeCurrencyLocal_(record.montoTotal);
  var moneda = String(record.moneda || 'USD').toUpperCase();

  record.tipoMovimiento = 'EGRESO';
  record.categoria = 'COSTO_OPERACIONAL';
  record.subcategoria = 'SUSCRIPCION_SAAS_IA';
  record.origenVenta = 'PROVEEDOR_EMAIL_DIRECTO';
  record.proveedorCliente = record.proveedorCliente || 'Anthropic, PBC';

  if (neto > 0 && iva <= 0 && total > 0) {
    var inferredIva = total - neto;
    if (inferredIva > 0) {
      iva = Math.round(inferredIva * 100) / 100;
      record.iva = iva;
    }
  }

  var notes = [];
  notes.push('PRV-001: deduplicar Anthropic por numero de factura.');
  notes.push('PRV-003: canal identificado como email directo de proveedor.');

  if (neto > 0 && iva > 0) {
    var expectedIva = Math.round((neto * 0.19) * 100) / 100;
    if (Math.abs(iva - expectedIva) > 0.03) {
      notes.push('PRV-002: alerta IVA esperado 19% no coincide con valores extraidos.');
    }
  }

  if (moneda === 'USD' && neto > 0 && Math.abs(neto - 20) > 5) {
    notes.push('PRV-004: posible cambio de plan Claude Pro (neto fuera de rango USD 20 +/- 5).');
  }

  var obs = String(record.observaciones || '').trim();
  var extra = notes.join(' ');
  record.observaciones = obs ? (obs + ' ' + extra) : extra;

  return record;
}

function safeExtractHeuristicRecords_(documentType, emailMeta, bodyText) {
  var sourceText = [
    String((emailMeta && emailMeta.asunto) || ''),
    String(bodyText || '')
  ].join('\n');

  var total = extractAmountHeuristic_(sourceText);
  if (!(total > 0)) {
    return [];
  }

  var moneda = detectCurrencyHeuristic_(sourceText);
  var numeroDocumento = extractDocumentNumberHeuristic_(sourceText, (emailMeta && emailMeta.gmailMessageId) || '');
  var categoria = documentType === 'SHOPIFY' ? 'VENTA_ONLINE' : 'SERVICIOS';
  var proveedorCliente = extractPartyHeuristic_((emailMeta && emailMeta.emailOrigen) || '');

  if (isSuspiciousHeuristicDocNumber_(numeroDocumento)) {
    safeAuditLog_('WARN', 'Heuristica descartada por numeroDocumento sospechoso', JSON.stringify({
      numeroDocumento: numeroDocumento,
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || '',
      asunto: (emailMeta && emailMeta.asunto) || ''
    }));
    // Cuarentena: registrar en Registros_Rechazados para trazabilidad y KPI anti-ruido.
    var rejMetaDoc = {
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || '',
      emailOrigen: (emailMeta && emailMeta.emailOrigen) || '',
      asunto: (emailMeta && emailMeta.asunto) || '',
      fuente: 'HEURISTICA_LOCAL',
      fechaEmail: (emailMeta && emailMeta.fechaEmail) || ''
    };
    safeRegisterRejectedRecord_(rejMetaDoc, {
      numeroDocumento: numeroDocumento,
      montoTotal: total,
      moneda: moneda
    }, ['HEURISTICA_DOC_SOSPECHOSO: ' + String(numeroDocumento)]);
    return [];
  }

  if (!isHeuristicAmountPlausible_(moneda, total)) {
    safeAuditLog_('WARN', 'Heuristica descartada por monto fuera de rango', JSON.stringify({
      moneda: moneda,
      montoDetectado: total,
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || '',
      asunto: (emailMeta && emailMeta.asunto) || ''
    }));
    // Cuarentena: registrar en Registros_Rechazados para trazabilidad y KPI anti-ruido.
    var rejMetaAmt = {
      gmailMessageId: (emailMeta && emailMeta.gmailMessageId) || '',
      emailOrigen: (emailMeta && emailMeta.emailOrigen) || '',
      asunto: (emailMeta && emailMeta.asunto) || '',
      fuente: 'HEURISTICA_LOCAL',
      fechaEmail: (emailMeta && emailMeta.fechaEmail) || ''
    };
    safeRegisterRejectedRecord_(rejMetaAmt, {
      numeroDocumento: numeroDocumento,
      montoTotal: total,
      moneda: moneda
    }, ['HEURISTICA_MONTO_NO_PLAUSIBLE: ' + String(total) + ' ' + moneda]);
    return [];
  }

  return [{
    fechaDocumento: (emailMeta && emailMeta.fechaEmail) || toDateStringLocal_(new Date()),
    tipoMovimiento: (emailMeta && emailMeta.tipoMovimiento) || (documentType === 'SHOPIFY' ? 'INGRESO' : 'EGRESO'),
    categoria: categoria,
    subcategoria: 'HEURISTICA_EMAIL',
    proveedorCliente: proveedorCliente,
    rutEmisorReceptor: '',
    numeroDocumento: numeroDocumento,
    moneda: moneda,
    montoNeto: total,
    iva: 0,
    montoTotal: total,
    estadoPago: 'PENDIENTE',
    medioPago: 'NO_IDENTIFICADO',
    origenVenta: (emailMeta && emailMeta.origenVenta) || 'Sin atribucion',
    observaciones: 'Generado por fallback heuristico local (sin DteXmlService/GeminiService)',
    socioRut: '',
    gerenciaRol: ''
  }];
}

function nowIsoLocal_() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return String(new Date());
  }
}

function buildDocHashLocal_(record, metadata) {
  var key = [
    String((record && record.numeroDocumento) || ''),
    String((record && record.fechaDocumento) || ''),
    String((record && record.montoTotal) || ''),
    String((record && record.tipoMovimiento) || ''),
    String((metadata && metadata.gmailMessageId) || ''),
    String((metadata && metadata.fuente) || '')
  ].join('|').toLowerCase();

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key);
  return digest.map(function (b) {
    var v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('').slice(0, 32);
}

function fallbackAppendLedgerRowLocal_(record, metadata) {
  if (typeof LedgerService === 'undefined' || !LedgerService || typeof LedgerService.getOrCreateSheet !== 'function') {
    throw new Error('LedgerService.getOrCreateSheet no disponible para fallback append');
  }
  if (typeof FinanceConfig === 'undefined' || !FinanceConfig || !FinanceConfig.SHEETS || !FinanceConfig.HEADERS) {
    throw new Error('FinanceConfig no disponible para fallback append');
  }

  var sheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
  var fechaRegistro = toDateStringLocal_(new Date());
  var fechaDocumento = String((record && record.fechaDocumento) || fechaRegistro);
  var tipoMovimiento = String((record && record.tipoMovimiento) || (metadata && metadata.tipoMovimiento) || '');
  var montoTotal = normalizeCurrencyLocal_((record && record.montoTotal) || 0);
  var montoNeto = normalizeCurrencyLocal_((record && record.montoNeto) || montoTotal);
  var iva = normalizeCurrencyLocal_((record && record.iva) || 0);
  var hashDocumento = buildDocHashLocal_(record, metadata);
  var isoNow = nowIsoLocal_();

  var row = [
    fechaRegistro,
    fechaDocumento,
    tipoMovimiento,
    String((record && record.categoria) || ''),
    String((record && record.subcategoria) || ''),
    String((record && record.proveedorCliente) || ''),
    String((record && record.rutEmisorReceptor) || ''),
    String((record && record.numeroDocumento) || ''),
    'CLP',
    montoNeto,
    iva,
    montoTotal,
    String((record && record.estadoPago) || 'PENDIENTE'),
    String((record && record.medioPago) || ''),
    String((record && record.origenVenta) || (metadata && metadata.origenVenta) || 'Sin atribucion'),
    String((metadata && metadata.emailOrigen) || ''),
    String((metadata && metadata.gmailMessageId) || ''),
    hashDocumento,
    String((metadata && metadata.fuente) || 'HEURISTICA_LOCAL'),
    String((record && record.observaciones) || 'Fallback append local'),
    String((metadata && metadata.procesadoPorAI) || 'FALLBACK'),
    String((record && record.socioRut) || ''),
    String((record && record.gerenciaRol) || ''),
    isoNow,
    isoNow,
    String((record && record.moneda) || 'CLP'),
    normalizeCurrencyLocal_((record && record.montoTotal) || 0),
    1,
    montoTotal,
    'PENDIENTE_BANCO',
    String((metadata && metadata.esExtranjero) || 'FALSE'),
    'FALLBACK_LEDGER_APPEND'
  ];

  sheet.appendRow(row);
  return { saved: true, duplicate: false, hash: hashDocumento, fallback: true };
}

function safeSaveExtractedEntry_(record, metadata) {
  if (typeof LedgerService !== 'undefined' && LedgerService && typeof LedgerService.saveExtractedEntry === 'function') {
    try {
      return LedgerService.saveExtractedEntry(record, metadata);
    } catch (err) {
      var message = String(err || '');
      if (message.indexOf('normalizeCurrency') !== -1 || message.indexOf('FinanceUtils') !== -1 || message.indexOf('buildDocHash') !== -1) {
        safeAuditLog_('WARN', 'Fallback append por fallo en LedgerService.saveExtractedEntry', message);
        return fallbackAppendLedgerRowLocal_(record, metadata);
      }
      throw err;
    }
  }

  return fallbackAppendLedgerRowLocal_(record, metadata);
}

var GmailIngestion = (function () {
  function extractAttachmentText(message) {
    var attachments = message.getAttachments({ includeInlineImages: false });
    if (!attachments || attachments.length === 0) {
      return '';
    }

    var chunks = [];
    attachments.forEach(function (att, index) {
      var fileName = att.getName() || 'adjunto_' + index;
      var mime = att.getContentType() || '';
      var size = att.getBytes().length;
      chunks.push('Adjunto: ' + fileName + ' | Mime: ' + mime + ' | Bytes: ' + size);

      if (mime.indexOf('text/') === 0 || mime.indexOf('json') !== -1 || mime.indexOf('xml') !== -1) {
        chunks.push(att.getDataAsString());
      }
    });

    return chunks.join('\n');
  }

  function processMessagesByQuery(searchQuery, documentType, allowedPropertyKey, defaultTipoMovimiento, defaultOrigenVenta) {
    var threads = GmailApp.search(searchQuery, 0, 100);

    var savedCount = 0;
    var duplicateCount = 0;
    var skippedCount = 0;
    var outOfScopeCount = 0;

    threads.forEach(function (thread) {
      var messages = thread.getMessages();
      messages.forEach(function (message) {
        var messageId = message.getId();
        var fromHeader = message.getFrom();
        var isExceptionSender = isScopeExceptionSender_(fromHeader);

        var senderValidation = ValidationService.validateEmailSenderAgainstAllowList(fromHeader, allowedPropertyKey);
        if (!senderValidation.valid && !isExceptionSender) {
          skippedCount += 1;
          safeAuditLog_('WARN', 'Email bloqueado por remitente', fromHeader);
          return;
        }

        if (!senderValidation.valid && isExceptionSender) {
          safeAuditLog_('WARN', 'Email permitido por excepcion de remitente', fromHeader);
        }

        var emailMeta = {
          gmailMessageId: messageId,
          emailOrigen: fromHeader,
          asunto: message.getSubject(),
          fechaEmail: toDateStringLocal_(message.getDate()),
          tipoMovimiento: defaultTipoMovimiento,
          origenVenta: defaultOrigenVenta,
          fuente: documentType
        };

        var bodyText = [
          'Asunto: ' + message.getSubject(),
          'Fecha: ' + message.getDate(),
          'Body plano:',
          message.getPlainBody(),
          'Body HTML simplificado:',
          message.getBody(),
          'Adjuntos:',
          extractAttachmentText(message)
        ].join('\n');

        var scope = evaluateVittoScope_(documentType, emailMeta, bodyText);
        if (!scope.allowed && !isExceptionSender) {
          skippedCount += 1;
          outOfScopeCount += 1;
          safeAuditLog_('INFO', 'Email fuera de alcance VittoStore', JSON.stringify({
            messageId: messageId,
            documentType: documentType,
            from: fromHeader,
            subject: message.getSubject(),
            matchedKeywords: scope.matched || []
          }));

          message.markRead();
          thread.addLabel(getOrCreateOutOfScopeLabel(documentType));
          return;
        }

        if (!scope.allowed && isExceptionSender) {
          safeAuditLog_('WARN', 'Email fuera de alcance permitido por excepcion', JSON.stringify({
            messageId: messageId,
            documentType: documentType,
            from: fromHeader,
            subject: message.getSubject()
          }));
        }

        try {
          var xmlRecords = safeExtractXmlRecords_(
            message,
            emailMeta,
            defaultTipoMovimiento,
            defaultOrigenVenta
          );

          var records = xmlRecords;
          var recordSource = 'DTE_XML';
          var processedByAI = 'NO';

          if (!records || records.length === 0) {
            // MEJORA-12: consult local engine before Gemini (~80% bypass rate for known senders)
            if (typeof LocalCategorizationEngine !== 'undefined' && LocalCategorizationEngine &&
                typeof LocalCategorizationEngine.classifyForIngestion === 'function') {
              var localClass = LocalCategorizationEngine.classifyForIngestion(
                emailMeta.emailOrigen, emailMeta.asunto, 0, 'CLP'
              );
              if (localClass.esRuido) {
                safeAuditLog_('INFO', 'Email descartado por motor local (ruido)', localClass.motivoDescarte);
                skippedCount += 1;
                message.markRead();
                thread.addLabel(getOrCreateOutOfScopeLabel(documentType));
                return;
              }
              if (!localClass.needsGemini) {
                var heuristicAmounts = safeExtractHeuristicRecords_(documentType, emailMeta, bodyText);
                if (heuristicAmounts && heuristicAmounts.length > 0) {
                  records = heuristicAmounts.map(function (r) {
                    if (localClass.tipoMovimiento) r.tipoMovimiento    = localClass.tipoMovimiento;
                    if (localClass.categoria)      r.categoria         = localClass.categoria;
                    if (localClass.subcategoria)   r.subcategoria      = localClass.subcategoria;
                    if (localClass.proveedor)      r.proveedorCliente  = localClass.proveedor;
                    if (localClass.rutProveedor)   r.rutEmisorReceptor = localClass.rutProveedor;
                    if (localClass.medioPago)      r.medioPago         = localClass.medioPago;
                    if (localClass.origenVenta)    r.origenVenta       = localClass.origenVenta;
                    return r;
                  });
                  recordSource  = 'LOCAL_ENGINE';
                  processedByAI = 'LOCAL_ENGINE_' + localClass.confidence;
                }
                // If no amounts found, fall through to Gemini below
              }
            }
          }

          if (!records || records.length === 0) {
            records = safeExtractGeminiRecords_(documentType, emailMeta, bodyText);
            recordSource = documentType;
            processedByAI = 'SI';
          }

          if (!records || records.length === 0) {
            records = safeExtractHeuristicRecords_(documentType, emailMeta, bodyText);
            recordSource = 'HEURISTICA_LOCAL';
            processedByAI = 'FALLBACK';
          }

          if (!records || records.length === 0) {
            safeAuditLog_('INFO', 'Sin registros financieros detectados', messageId);
            skippedCount += 1;
            return;
          }

          records.forEach(function (record) {
            record = enrichRecordWithOperationalContext_(record, documentType, emailMeta, bodyText);
            record = applyAnthropicProviderRules_(record, documentType, emailMeta, bodyText);

            var validation = ValidationService.validateExtractedRecord(record);
            if (!validation.valid) {
              skippedCount += 1;
              safeRegisterRejectedRecord_(emailMeta, record, validation.errors);
              safeAuditLog_('WARN', 'Registro descartado por validacion', JSON.stringify({
                messageId: messageId,
                errors: validation.errors,
                numeroDocumento: record.numeroDocumento || ''
              }));
              return;
            }

            if (validation.warnings && validation.warnings.length > 0) {
              safeAuditLog_('WARN', 'Registro con advertencias de validacion', JSON.stringify({
                messageId: messageId,
                warnings: validation.warnings,
                numeroDocumento: record.numeroDocumento || ''
              }));
            }

            var recordCurrency = String(record.moneda || 'CLP').toUpperCase();
            var isForeignInvoice =
              documentType === 'FACTURA' &&
              recordSource !== 'DTE_XML' &&
              recordCurrency !== 'CLP';

            var metadataForRecord = {
              gmailMessageId: emailMeta.gmailMessageId,
              emailOrigen: emailMeta.emailOrigen,
              asunto: emailMeta.asunto,
              fechaEmail: emailMeta.fechaEmail,
              tipoMovimiento: emailMeta.tipoMovimiento,
              origenVenta: emailMeta.origenVenta,
              fuente: recordSource,
              procesadoPorAI: processedByAI,
              esExtranjero: isForeignInvoice ? 'TRUE' : 'FALSE'
            };

            var saveResult = safeSaveExtractedEntry_(record, metadataForRecord);
            if (saveResult.duplicate) {
              duplicateCount += 1;
              return;
            }
            if (saveResult.saved) {
              savedCount += 1;
            }
          });

          message.markRead();
          thread.addLabel(getOrCreateProcessedLabel(documentType));
        } catch (error) {
          var errorStr = String(error);
          if (typeof WhatsAppAlertsService !== 'undefined' && /503|gemini|quota/i.test(errorStr)) {
            WhatsAppAlertsService.alertGeminiDown(errorStr.substring(0, 200));
          }
          safeRegisterIncident_('GMAIL_INGESTION', documentType, errorStr, {
            gmailMessageId: messageId,
            responsible: 'Finanzas',
            fallbackApplied: false
          });
          safeAuditLog_('ERROR', 'Fallo procesamiento Gmail/Gemini', JSON.stringify({
            messageId: messageId,
            error: errorStr
          }));
        }
      });
    });

    return {
      savedCount: savedCount,
      duplicateCount: duplicateCount,
      skippedCount: skippedCount,
      outOfScopeCount: outOfScopeCount,
      scannedThreads: threads.length
    };
  }

  function getOrCreateProcessedLabel(documentType) {
    var labelName = 'FINANCE_PROCESADO_' + documentType.toUpperCase();
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
    }
    return label;
  }

  function getOrCreateOutOfScopeLabel(documentType) {
    var labelName = 'FINANCE_FUERA_ALCANCE_' + documentType.toUpperCase();
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
    }
    return label;
  }

  function processShopifyOrdersEmails() {
    var query = FinanceConfig.getOptionalProperty(
      'SHOPIFY_QUERY',
      'newer_than:14d -label:FINANCE_PROCESADO_SHOPIFY (subject:(Order OR Pedido) OR from:shopify.com)'
    );

    return processMessagesByQuery(query, 'SHOPIFY', 'SHOPIFY_ORDER_SENDERS', 'INGRESO', 'Shopify');
  }

  function processServiceInvoicesEmails() {
    var query = FinanceConfig.getOptionalProperty(
      'BILLING_QUERY',
      'newer_than:30d -label:FINANCE_PROCESADO_FACTURA (subject:(invoice OR factura OR receipt OR boleta) OR from:(google.com OR openai.com OR aws.amazon.com))'
    );

    return processMessagesByQuery(query, 'FACTURA', 'ALLOWED_BILLING_SENDERS', 'EGRESO', 'Sin atribucion');
  }

  function processTaxServiceEmails() {
    var query = FinanceConfig.getOptionalProperty(
      'TAX_QUERY',
      'newer_than:30d -label:FINANCE_PROCESADO_SII (from:(sii.cl OR @sii.cl) OR subject:(SII OR "Servicio de Impuestos Internos" OR "impuestos internos" OR F29 OR "declaracion" OR "libro compra" OR "libro venta"))'
    );

    return processMessagesByQuery(query, 'SII', 'ALLOWED_TAX_SENDERS', 'EGRESO', 'Servicio Impuestos Internos');
  }

  function processPatentesComercialesEmails() {
    var query = FinanceConfig.getOptionalProperty(
      'PATENTES_QUERY',
      'newer_than:90d -label:FINANCE_PROCESADO_PATENTES (subject:(patente OR "patentes comerciales" OR "contribucion territorial" OR "impuesto territorial" OR "tasa municipal") OR from:(gob.cl OR municipalidad OR municipio))'
    );

    return processMessagesByQuery(query, 'PATENTES', 'ALLOWED_PATENTES_SENDERS', 'EGRESO', 'Patentes Comerciales');
  }

  function processBancariosEmails() {
    var query = FinanceConfig.getOptionalProperty(
      'BANCARIOS_QUERY',
      'newer_than:30d -label:FINANCE_PROCESADO_BANCARIOS (subject:(estado OR "estado de cuenta" OR "cartola" OR "extracto" OR "credito" OR "leasing" OR "factoring" OR "pago" OR "vencimiento" OR "dividendo") OR from:(banco OR bancochile OR santander OR bci OR itau OR scotiabank OR bbva OR "banco estado"))'
    );

    return processMessagesByQuery(query, 'BANCARIOS', 'ALLOWED_BANCARIOS_SENDERS', 'EGRESO', 'Compromisos Bancarios');
  }

  function runIngestion() {
    safeEnsureCoreSheets_();
    // Crear etiquetas operativas aunque aun no existan casos fuera de alcance.
    getOrCreateOutOfScopeLabel('FACTURA');
    getOrCreateOutOfScopeLabel('SHOPIFY');
    getOrCreateOutOfScopeLabel('SII');
    getOrCreateOutOfScopeLabel('PATENTES');
    getOrCreateOutOfScopeLabel('BANCARIOS');
    var shopifyResult = processShopifyOrdersEmails();
    var invoiceResult = processServiceInvoicesEmails();
    var taxResult = processTaxServiceEmails();
    var patentesResult = processPatentesComercialesEmails();
    var bancariosResult = processBancariosEmails();
    var dataQualityResult = safeRunDataQualityChecks_();
    var reviewQueueSyncResult = safeSyncRejectedRecordsToReviewQueue_();
    var dashboardResult = safeRefreshExecutiveSuite_();

    safeAuditLog_('INFO', 'Ejecucion ingestion completada', JSON.stringify({
      shopify: shopifyResult,
      invoices: invoiceResult,
      tax: taxResult,
      patentes: patentesResult,
      bancarios: bancariosResult,
      dataQuality: dataQualityResult,
      reviewQueue: reviewQueueSyncResult,
      dashboard: {
        updatedAt: dashboardResult.updatedAt,
        errors: dashboardResult.quality.errorCount,
        pendingRejected: dashboardResult.queue.pending,
        blockingIncidents: dashboardResult.contingency.blockingIncidents
      }
    }));

    return {
      shopify: shopifyResult,
      invoices: invoiceResult,
      tax: taxResult,
      patentes: patentesResult,
      bancarios: bancariosResult,
      dataQuality: dataQualityResult,
      reviewQueue: reviewQueueSyncResult,
      dashboard: dashboardResult
    };
  }

  __VITTO_RUN_INGESTION_REF = runIngestion;

  // Anti-collision runner, guaranteed to execute with __VITTO_RUN_INGESTION_REF properly set
  function runVittoForceIngestion_20260508_() {
    safeAuditLog_('INFO', 'runVittoForceIngestion_20260508 invocado', 'Bypass total de entrypoints legacy');
    if (typeof __VITTO_RUN_INGESTION_REF === 'function') {
      return __VITTO_RUN_INGESTION_REF();
    }
    throw new Error('runVittoForceIngestion_20260508: __VITTO_RUN_INGESTION_REF no está set.');
  }

  return {
    runIngestion: runIngestion,
    runVittoForceIngestion_20260508: runVittoForceIngestion_20260508_,
    processShopifyOrdersEmails: processShopifyOrdersEmails,
    processServiceInvoicesEmails: processServiceInvoicesEmails,
    processTaxServiceEmails: processTaxServiceEmails,
    processPatentesComercialesEmails: processPatentesComercialesEmails,
    processBancariosEmails: processBancariosEmails
  };
})();

var VittoGmailIngestion = GmailIngestion;

function runFinancialIngestionDirectVitto_20260508() {
  if (typeof GmailIngestion !== 'undefined' && GmailIngestion && typeof GmailIngestion.runIngestion === 'function') {
    return GmailIngestion.runIngestion();
  }

  if (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion && typeof VittoGmailIngestion.runIngestion === 'function') {
    return VittoGmailIngestion.runIngestion();
  }

  if (typeof __VITTO_RUN_INGESTION_REF === 'function') {
    return __VITTO_RUN_INGESTION_REF();
  }

  if (typeof runIngestionStandaloneFallback_ === 'function') {
    safeAuditLog_('WARN', 'Runner directo sin objeto IIFE; activando fallback interno', JSON.stringify({
      GmailIngestion: typeof GmailIngestion,
      GmailIngestionRunIngestion: (typeof GmailIngestion !== 'undefined' && GmailIngestion) ? typeof GmailIngestion.runIngestion : 'n/a',
      VittoGmailIngestion: typeof VittoGmailIngestion,
      VittoGmailIngestionRunIngestion: (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion) ? typeof VittoGmailIngestion.runIngestion : 'n/a',
      __VITTO_RUN_INGESTION_REF: typeof __VITTO_RUN_INGESTION_REF
    }));
    return runIngestionStandaloneFallback_();
  }

  throw new Error(
    'runFinancialIngestionDirectVitto_20260508: no hay runner valido. ' +
    'GmailIngestion=' + typeof GmailIngestion +
    ', GmailIngestion.runIngestion=' +
      ((typeof GmailIngestion !== 'undefined' && GmailIngestion) ? typeof GmailIngestion.runIngestion : 'n/a') +
    ', VittoGmailIngestion=' + typeof VittoGmailIngestion +
    ', VittoGmailIngestion.runIngestion=' +
      ((typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion) ? typeof VittoGmailIngestion.runIngestion : 'n/a') +
    ', __VITTO_RUN_INGESTION_REF=' + typeof __VITTO_RUN_INGESTION_REF
  );
}

function runFinancialIngestionBridge() {
  if (typeof runFinancialIngestionDirectVitto_20260508 === 'function') {
    return runFinancialIngestionDirectVitto_20260508();
  }

  if (typeof GmailIngestion !== 'undefined' && GmailIngestion && typeof GmailIngestion.runIngestion === 'function') {
    return GmailIngestion.runIngestion();
  }

  if (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion && typeof VittoGmailIngestion.runIngestion === 'function') {
    return VittoGmailIngestion.runIngestion();
  }

  if (typeof __VITTO_RUN_INGESTION_REF === 'function') {
    return __VITTO_RUN_INGESTION_REF();
  }

  if (typeof runIngestionEntrypoint === 'function') {
    return runIngestionEntrypoint();
  }

  if (typeof GmailIngestionService !== 'undefined' && GmailIngestionService && typeof GmailIngestionService.runIngestion === 'function') {
    return GmailIngestionService.runIngestion();
  }

  throw new Error('Bridge: No se encontro objeto de ingestion. Revisa colisiones de nombre para GmailIngestion/GmailIngestionService en el proyecto Apps Script.');
}

function runIngestionEntrypoint() {
  // Try GmailIngestion.runIngestion FIRST (this is the IIFE result)
  if (typeof GmailIngestion !== 'undefined' && GmailIngestion && typeof GmailIngestion.runIngestion === 'function') {
    return GmailIngestion.runIngestion();
  }

  // Try VittoGmailIngestion (backup reference to same IIFE)
  if (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion && typeof VittoGmailIngestion.runIngestion === 'function') {
    return VittoGmailIngestion.runIngestion();
  }

  // Try __VITTO_RUN_INGESTION_REF (global set inside IIFE)
  if (typeof __VITTO_RUN_INGESTION_REF === 'function') {
    return __VITTO_RUN_INGESTION_REF();
  }

  // Try GmailIngestionService (legacy alternative)
  if (typeof GmailIngestionService !== 'undefined' && GmailIngestionService && typeof GmailIngestionService.runIngestion === 'function') {
    return GmailIngestionService.runIngestion();
  }

  return runIngestionStandaloneFallback_();
}

function extractAttachmentTextStandalone_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false });
  if (!attachments || attachments.length === 0) {
    return '';
  }

  var chunks = [];
  attachments.forEach(function (att, index) {
    var fileName = att.getName() || 'adjunto_' + index;
    var mime = att.getContentType() || '';
    var size = att.getBytes().length;
    chunks.push('Adjunto: ' + fileName + ' | Mime: ' + mime + ' | Bytes: ' + size);

    if (mime.indexOf('text/') === 0 || mime.indexOf('json') !== -1 || mime.indexOf('xml') !== -1) {
      chunks.push(att.getDataAsString());
    }
  });

  return chunks.join('\n');
}

function getOrCreateProcessedLabelStandalone_(documentType) {
  var labelName = 'FINANCE_PROCESADO_' + String(documentType || '').toUpperCase();
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

function getOrCreateOutOfScopeLabelStandalone_(documentType) {
  var labelName = 'FINANCE_FUERA_ALCANCE_' + String(documentType || '').toUpperCase();
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

function validateEmailSenderStandalone_(fromHeader, listKey) {
  if (typeof ValidationService !== 'undefined' && ValidationService && typeof ValidationService.validateEmailSenderAgainstAllowList === 'function') {
    return ValidationService.validateEmailSenderAgainstAllowList(fromHeader, listKey);
  }

  var allowed = FinanceConfig.getArrayProperty(listKey);
  var sender = normalizeTextLocal_(fromHeader);
  var ok = allowed.some(function (entry) {
    return sender.indexOf(entry) !== -1;
  });

  return {
    valid: ok,
    allowed: allowed
  };
}

function validateExtractedRecordStandalone_(record) {
  if (typeof ValidationService !== 'undefined' && ValidationService && typeof ValidationService.validateExtractedRecord === 'function') {
    return ValidationService.validateExtractedRecord(record);
  }

  var errors = [];
  var warnings = [];
  var tipo = String(record.tipoMovimiento || '').toUpperCase();
  var total = normalizeCurrencyLocal_(record.montoTotal);
  var moneda = String(record.moneda || 'CLP').toUpperCase();
  var fecha = new Date(record.fechaDocumento);

  if (tipo !== 'INGRESO' && tipo !== 'EGRESO') {
    errors.push('tipoMovimiento invalido');
  }
  if (total <= 0) {
    errors.push('montoTotal invalido');
  }
  if (!record.fechaDocumento || isNaN(fecha.getTime())) {
    errors.push('fechaDocumento invalida');
  }
  if (!record.categoria) {
    errors.push('categoria vacia');
  }
  if (!record.numeroDocumento) {
    errors.push('numeroDocumento vacio');
  }
  if (moneda !== 'CLP' && moneda !== 'USD') {
    errors.push('moneda no soportada');
  }
  if (tipo === 'INGRESO' && !record.origenVenta) {
    warnings.push('origenVenta vacio para ingreso');
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

function processMessagesByQueryStandalone_(searchQuery, documentType, allowedPropertyKey, defaultTipoMovimiento, defaultOrigenVenta) {
  var threads = GmailApp.search(searchQuery, 0, 100);
  var savedCount = 0;
  var duplicateCount = 0;
  var skippedCount = 0;
  var outOfScopeCount = 0;

  threads.forEach(function (thread) {
    var messages = thread.getMessages();
    messages.forEach(function (message) {
      var messageId = message.getId();
      var fromHeader = message.getFrom();
      var isExceptionSender = isScopeExceptionSender_(fromHeader);

      var senderValidation = validateEmailSenderStandalone_(fromHeader, allowedPropertyKey);
      if (!senderValidation.valid && !isExceptionSender) {
        skippedCount += 1;
        safeAuditLog_('WARN', 'Email bloqueado por remitente', fromHeader);
        return;
      }

      if (!senderValidation.valid && isExceptionSender) {
        safeAuditLog_('WARN', 'Email permitido por excepcion de remitente', fromHeader);
      }

      var emailMeta = {
        gmailMessageId: messageId,
        emailOrigen: fromHeader,
        asunto: message.getSubject(),
        fechaEmail: toDateStringLocal_(message.getDate()),
        tipoMovimiento: defaultTipoMovimiento,
        origenVenta: defaultOrigenVenta,
        fuente: documentType
      };

      var bodyText = [
        'Asunto: ' + message.getSubject(),
        'Fecha: ' + message.getDate(),
        'Body plano:',
        message.getPlainBody(),
        'Body HTML simplificado:',
        message.getBody(),
        'Adjuntos:',
        extractAttachmentTextStandalone_(message)
      ].join('\n');

      var scope = evaluateVittoScope_(documentType, emailMeta, bodyText);
      if (!scope.allowed && !isExceptionSender) {
        skippedCount += 1;
        outOfScopeCount += 1;
        safeAuditLog_('INFO', 'Email fuera de alcance VittoStore (fallback)', JSON.stringify({
          messageId: messageId,
          documentType: documentType,
          from: fromHeader,
          subject: message.getSubject(),
          matchedKeywords: scope.matched || []
        }));

        message.markRead();
        thread.addLabel(getOrCreateOutOfScopeLabelStandalone_(documentType));
        return;
      }

      if (!scope.allowed && isExceptionSender) {
        safeAuditLog_('WARN', 'Email fuera de alcance permitido por excepcion (fallback)', JSON.stringify({
          messageId: messageId,
          documentType: documentType,
          from: fromHeader,
          subject: message.getSubject()
        }));
      }

      try {
        var xmlRecords = safeExtractXmlRecords_(message, emailMeta, defaultTipoMovimiento, defaultOrigenVenta);
        var records = xmlRecords;
        var recordSource = 'DTE_XML';
        var processedByAI = 'NO';

        if (!records || records.length === 0) {
          if (typeof LocalCategorizationEngine !== 'undefined' && LocalCategorizationEngine &&
              typeof LocalCategorizationEngine.classifyForIngestion === 'function') {
            var localClassSA = LocalCategorizationEngine.classifyForIngestion(
              emailMeta.emailOrigen, emailMeta.asunto, 0, 'CLP'
            );
            if (localClassSA.esRuido) {
              safeAuditLog_('INFO', 'Email descartado por motor local (ruido)', localClassSA.motivoDescarte);
              skippedCount += 1;
              message.markRead();
              thread.addLabel(getOrCreateOutOfScopeLabelStandalone_(documentType));
              return;
            }
            if (!localClassSA.needsGemini) {
              var heuristicAmtsSA = safeExtractHeuristicRecords_(documentType, emailMeta, bodyText);
              if (heuristicAmtsSA && heuristicAmtsSA.length > 0) {
                records = heuristicAmtsSA.map(function (r) {
                  if (localClassSA.tipoMovimiento) r.tipoMovimiento    = localClassSA.tipoMovimiento;
                  if (localClassSA.categoria)      r.categoria         = localClassSA.categoria;
                  if (localClassSA.subcategoria)   r.subcategoria      = localClassSA.subcategoria;
                  if (localClassSA.proveedor)      r.proveedorCliente  = localClassSA.proveedor;
                  if (localClassSA.rutProveedor)   r.rutEmisorReceptor = localClassSA.rutProveedor;
                  if (localClassSA.medioPago)      r.medioPago         = localClassSA.medioPago;
                  if (localClassSA.origenVenta)    r.origenVenta       = localClassSA.origenVenta;
                  return r;
                });
                recordSource  = 'LOCAL_ENGINE';
                processedByAI = 'LOCAL_ENGINE_' + localClassSA.confidence;
              }
            }
          }
        }

        if (!records || records.length === 0) {
          records = safeExtractGeminiRecords_(documentType, emailMeta, bodyText);
          recordSource = documentType;
          processedByAI = 'SI';
        }

        if (!records || records.length === 0) {
          records = safeExtractHeuristicRecords_(documentType, emailMeta, bodyText);
          recordSource = 'HEURISTICA_LOCAL';
          processedByAI = 'FALLBACK';
        }

        if (!records || records.length === 0) {
          safeAuditLog_('INFO', 'Sin registros financieros detectados', messageId);
          skippedCount += 1;
          return;
        }

        records.forEach(function (record) {
          var validation = validateExtractedRecordStandalone_(record);
          if (!validation.valid) {
            skippedCount += 1;
            safeRegisterRejectedRecord_(emailMeta, record, validation.errors);
            safeAuditLog_('WARN', 'Registro descartado por validacion', JSON.stringify({
              messageId: messageId,
              errors: validation.errors,
              numeroDocumento: record.numeroDocumento || ''
            }));
            return;
          }

          if (validation.warnings && validation.warnings.length > 0) {
            safeAuditLog_('WARN', 'Registro con advertencias de validacion', JSON.stringify({
              messageId: messageId,
              warnings: validation.warnings,
              numeroDocumento: record.numeroDocumento || ''
            }));
          }

          var recordCurrency = String(record.moneda || 'CLP').toUpperCase();
          var isForeignInvoice = documentType === 'FACTURA' && recordSource !== 'DTE_XML' && recordCurrency !== 'CLP';

          var metadataForRecord = {
            gmailMessageId: emailMeta.gmailMessageId,
            emailOrigen: emailMeta.emailOrigen,
            asunto: emailMeta.asunto,
            fechaEmail: emailMeta.fechaEmail,
            tipoMovimiento: emailMeta.tipoMovimiento,
            origenVenta: emailMeta.origenVenta,
            fuente: recordSource,
            procesadoPorAI: processedByAI,
            esExtranjero: isForeignInvoice ? 'TRUE' : 'FALSE'
          };

          var saveResult = safeSaveExtractedEntry_(record, metadataForRecord);
          if (saveResult.duplicate) {
            duplicateCount += 1;
            return;
          }
          if (saveResult.saved) {
            savedCount += 1;
          }
        });

        message.markRead();
        thread.addLabel(getOrCreateProcessedLabelStandalone_(documentType));
      } catch (error) {
        var errorStrSA = String(error);
        if (typeof WhatsAppAlertsService !== 'undefined' && /503|gemini|quota/i.test(errorStrSA)) {
          WhatsAppAlertsService.alertGeminiDown(errorStrSA.substring(0, 200));
        }
        safeRegisterIncident_('GMAIL_INGESTION', documentType, errorStrSA, {
          gmailMessageId: messageId,
          responsible: 'Finanzas',
          fallbackApplied: false
        });
        safeAuditLog_('ERROR', 'Fallo procesamiento Gmail/Gemini', JSON.stringify({
          messageId: messageId,
          error: errorStrSA
        }));
      }
    });
  });

  return {
    savedCount: savedCount,
    duplicateCount: duplicateCount,
    skippedCount: skippedCount,
    outOfScopeCount: outOfScopeCount,
    scannedThreads: threads.length
  };
}

function runIngestionStandaloneFallback_() {
  safeAuditLog_('WARN', 'VITTO_DIAG_FALLBACK_HIT_20260508', 'Se activo fallback standalone por colision de entrypoint legacy');

  safeEnsureCoreSheets_();
  // Crear etiquetas operativas tambien en modo fallback.
  getOrCreateOutOfScopeLabelStandalone_('FACTURA');
  getOrCreateOutOfScopeLabelStandalone_('SHOPIFY');

  var shopifyQuery = FinanceConfig.getOptionalProperty(
    'SHOPIFY_QUERY',
    'newer_than:14d -label:FINANCE_PROCESADO_SHOPIFY (subject:(Order OR Pedido) OR from:shopify.com)'
  );

  var billingQuery = FinanceConfig.getOptionalProperty(
    'BILLING_QUERY',
    'newer_than:30d -label:FINANCE_PROCESADO_FACTURA (subject:(invoice OR factura OR receipt OR boleta) OR from:(google.com OR openai.com OR aws.amazon.com))'
  );

  var shopifyResult = processMessagesByQueryStandalone_(
    shopifyQuery,
    'SHOPIFY',
    'SHOPIFY_ORDER_SENDERS',
    'INGRESO',
    'Shopify'
  );

  var invoiceResult = processMessagesByQueryStandalone_(
    billingQuery,
    'FACTURA',
    'ALLOWED_BILLING_SENDERS',
    'EGRESO',
    'Sin atribucion'
  );

  var dataQualityResult = safeRunDataQualityChecks_();
  var reviewQueueSyncResult = safeSyncRejectedRecordsToReviewQueue_();
  var dashboardResult = safeRefreshExecutiveSuite_();

  var finalResult = {
    shopify: shopifyResult,
    invoices: invoiceResult,
    dataQuality: dataQualityResult,
    reviewQueue: reviewQueueSyncResult,
    dashboard: dashboardResult,
    fallbackActivated: true
  };

  safeAuditLog_('WARN', 'Fallback standalone completado', JSON.stringify({
    fallbackActivated: true,
    shopify: shopifyResult,
    invoices: invoiceResult,
    dataQuality: dataQualityResult,
    reviewQueue: reviewQueueSyncResult,
    dashboard: {
      updatedAt: dashboardResult.updatedAt,
      errors: dashboardResult.quality.errorCount,
      pendingRejected: dashboardResult.queue.pending,
      blockingIncidents: dashboardResult.contingency.blockingIncidents
    }
  }));

  return finalResult;
}

function debugEmailHeuristic() {
  var queries = [
    'newer_than:14d (subject:(Order OR Pedido) OR from:shopify.com)',
    'newer_than:30d (subject:(invoice OR factura OR receipt OR boleta) OR from:(google.com OR openai.com OR aws.amazon.com))'
  ];

  var results = [];

  queries.forEach(function (query, qi) {
    var threads = GmailApp.search(query, 0, 3);
    threads.forEach(function (thread) {
      thread.getMessages().slice(0, 1).forEach(function (message) {
        var subject = message.getSubject();
        var plainBody = (message.getPlainBody() || '').slice(0, 500);
        var htmlText = message.getBody().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
        var sourceText = [subject, plainBody, htmlText].join('\n');
        var amount = extractAmountHeuristic_(sourceText);
        var docNum = extractDocumentNumberHeuristic_(sourceText, message.getId());
        results.push({
          q: qi,
          from: message.getFrom().slice(0, 60),
          subject: subject.slice(0, 80),
          plainBodyPreview: plainBody.slice(0, 300),
          htmlTextPreview: htmlText.slice(0, 200),
          detectedAmount: amount,
          detectedDocNum: docNum
        });
      });
    });
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function debugServices() {
  var report = {
    VITTO_GMAIL_INGESTION_VERSION_20260508: typeof VITTO_GMAIL_INGESTION_VERSION_20260508 !== 'undefined' ? VITTO_GMAIL_INGESTION_VERSION_20260508 : 'missing',
    runFinancialIngestionDirectVitto_20260508: typeof runFinancialIngestionDirectVitto_20260508,
    FinanceUtils:        typeof FinanceUtils,
    FinanceConfig:       typeof FinanceConfig,
    LedgerService:       typeof LedgerService,
    AuditService:        typeof AuditService,
    ValidationService:   typeof ValidationService,
    DataQualityService:  typeof DataQualityService,
    ReviewQueueService:  typeof ReviewQueueService,
    DashboardService:    typeof DashboardService,
    ContingencyService:  typeof ContingencyService,
    DteXmlService:       typeof DteXmlService,
    GeminiService:       typeof GeminiService
  };

  // Verify key methods exist on each service
  var methods = {
    'DataQualityService.runLedgerDataQualityChecks':        typeof DataQualityService !== 'undefined' && typeof DataQualityService.runLedgerDataQualityChecks,
    'DataQualityService.registerRejectedRecord':            typeof DataQualityService !== 'undefined' && typeof DataQualityService.registerRejectedRecord,
    'ReviewQueueService.syncRejectedRecordsToReviewQueue':  typeof ReviewQueueService !== 'undefined' && typeof ReviewQueueService.syncRejectedRecordsToReviewQueue,
    'ReviewQueueService.processReviewQueue':                typeof ReviewQueueService !== 'undefined' && typeof ReviewQueueService.processReviewQueue,
    'LedgerService.saveExtractedEntry':                     typeof LedgerService !== 'undefined' && typeof LedgerService.saveExtractedEntry,
    'FinanceUtils.normalizeCurrency':                       typeof FinanceUtils !== 'undefined' && typeof FinanceUtils.normalizeCurrency,
    'DashboardService.refreshExecutiveSuite':               typeof DashboardService !== 'undefined' && typeof DashboardService.refreshExecutiveSuite
  };

  Logger.log(JSON.stringify({ types: report, methods: methods }, null, 2));
  return { types: report, methods: methods };
}

function runFinancialIngestionBridgeV2() {
  // Collision-safe bridge: avoid old global entrypoints from other files.
  safeAuditLog_('INFO', 'BridgeV2 invocado', 'Usando runner anti-colision');
  if (typeof runFinancialIngestionDirectVitto_20260508 === 'function') {
    return runFinancialIngestionDirectVitto_20260508();
  }

  if (typeof GmailIngestion !== 'undefined' && GmailIngestion && typeof GmailIngestion.runIngestion === 'function') {
    return GmailIngestion.runIngestion();
  }

  if (typeof __VITTO_RUN_INGESTION_REF === 'function') {
    return __VITTO_RUN_INGESTION_REF();
  }

  if (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion && typeof VittoGmailIngestion.runIngestion === 'function') {
    return VittoGmailIngestion.runIngestion();
  }

  throw new Error('BridgeV2: no hay runner valido. Verifica colisiones: GmailIngestion=' + typeof GmailIngestion + ', __VITTO_RUN_INGESTION_REF=' + typeof __VITTO_RUN_INGESTION_REF + ', VittoGmailIngestion=' + typeof VittoGmailIngestion);
}

function debugEntrypoints() {
  var report = {
    VITTO_GMAIL_INGESTION_VERSION_20260508: typeof VITTO_GMAIL_INGESTION_VERSION_20260508 !== 'undefined' ? VITTO_GMAIL_INGESTION_VERSION_20260508 : 'missing',
    runFinancialIngestionDirectVitto_20260508: typeof runFinancialIngestionDirectVitto_20260508,
    runFinancialIngestionBridge: typeof runFinancialIngestionBridge,
    runIngestionEntrypoint: typeof runIngestionEntrypoint,
    runFinancialIngestionBridgeV2: typeof runFinancialIngestionBridgeV2,
    GmailIngestion: typeof GmailIngestion,
    GmailIngestionRunIngestion: typeof GmailIngestion !== 'undefined' && GmailIngestion ? typeof GmailIngestion.runIngestion : 'n/a',
    VittoGmailIngestion: typeof VittoGmailIngestion,
    VittoGmailIngestionRunIngestion: typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion ? typeof VittoGmailIngestion.runIngestion : 'n/a',
    __VITTO_RUN_INGESTION_REF: typeof __VITTO_RUN_INGESTION_REF
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function ensureOutOfScopeLabelsNow_20260513() {
  var names = [
    'FINANCE_FUERA_ALCANCE_FACTURA',
    'FINANCE_FUERA_ALCANCE_SHOPIFY'
  ];

  var result = names.map(function (name) {
    var label = GmailApp.getUserLabelByName(name);
    if (!label) {
      label = GmailApp.createLabel(name);
    }
    return {
      name: name,
      createdOrExists: !!label
    };
  });

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
