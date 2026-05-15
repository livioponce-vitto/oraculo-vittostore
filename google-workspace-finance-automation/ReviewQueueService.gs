var VITTO_REVIEW_QUEUE_VERSION_20260508 = 'VITTO_REVIEW_QUEUE_VERSION_20260508';

var ReviewQueueService = (function () {
  var QUEUE_INDEX = {
    REJECTED_KEY: 0,
    TIMESTAMP_RECHAZO: 1,
    FUENTE: 2,
    GMAIL_MESSAGE_ID: 3,
    EMAIL_ORIGEN: 4,
    NUMERO_DOCUMENTO_ORIGINAL: 5,
    MOTIVO_ORIGINAL: 6,
    ESTADO_REVISION: 7,
    ACCION: 8,
    TIPO_MOVIMIENTO: 9,
    FECHA_DOCUMENTO: 10,
    CATEGORIA: 11,
    SUBCATEGORIA: 12,
    PROVEEDOR_CLIENTE: 13,
    RUT_EMISOR_RECEPTOR: 14,
    NUMERO_DOCUMENTO_CORREGIDO: 15,
    MONEDA: 16,
    MONTO_NETO: 17,
    IVA: 18,
    MONTO_TOTAL: 19,
    ESTADO_PAGO: 20,
    MEDIO_PAGO: 21,
    ORIGEN_VENTA: 22,
    OBSERVACIONES: 23,
    SOCIO_RUT: 24,
    GERENCIA_ROL: 25,
    ULTIMA_ACTUALIZACION: 26,
    RESULTADO: 27,
    PRIORIDAD: 28,
    RESPONSABLE: 29,
    FECHA_VENCIMIENTO: 30,
    SEMAFORO: 31,
    NOTAS_OPERACION: 32
  };

  function addDays(date, days) {
    var result = new Date(date.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }

  function derivePriority(reason) {
    var text = String(reason || '').toLowerCase();
    if (text.indexOf('fecha') !== -1 || text.indexOf('monto') !== -1 || text.indexOf('tipo') !== -1) {
      return 'ALTA';
    }
    if (text.indexOf('categoria') !== -1 || text.indexOf('rut') !== -1) {
      return 'MEDIA';
    }
    return 'BAJA';
  }

  function deriveOwner(source) {
    var normalized = String(source || '').toUpperCase();
    if (normalized === 'SHOPIFY') {
      return 'Comercial';
    }
    if (normalized === 'FACTURA' || normalized === 'DTE_XML') {
      return 'Finanzas';
    }
    return 'Operaciones';
  }

  function deriveDueDate(priority, timestamp) {
    var baseDate = new Date(timestamp || new Date());
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date();
    }

    if (priority === 'ALTA') {
      return FinanceUtils.toDateString(addDays(baseDate, 1));
    }
    if (priority === 'MEDIA') {
      return FinanceUtils.toDateString(addDays(baseDate, 3));
    }
    return FinanceUtils.toDateString(addDays(baseDate, 5));
  }

  function deriveSemaphore(status, dueDate) {
    if (status === 'REPROCESADO_OK' || status === 'REVISADO') {
      return 'VERDE';
    }

    var due = new Date(dueDate);
    if (isNaN(due.getTime())) {
      return 'AMARILLO';
    }

    var today = FinanceUtils.getChileDate();
    if (today.getTime() > due.getTime()) {
      return 'ROJO';
    }

    var warningDate = addDays(today, 1);
    if (warningDate.getTime() >= due.getTime()) {
      return 'AMARILLO';
    }

    return 'VERDE';
  }

  function refreshOperationalFields(sheet, rowNumber, queueRow) {
    var status = String(queueRow[QUEUE_INDEX.ESTADO_REVISION] || 'PENDIENTE');
    var priority = String(queueRow[QUEUE_INDEX.PRIORIDAD] || derivePriority(queueRow[QUEUE_INDEX.MOTIVO_ORIGINAL]));
    var owner = String(queueRow[QUEUE_INDEX.RESPONSABLE] || deriveOwner(queueRow[QUEUE_INDEX.FUENTE]));
    var dueDate = String(queueRow[QUEUE_INDEX.FECHA_VENCIMIENTO] || deriveDueDate(priority, queueRow[QUEUE_INDEX.TIMESTAMP_RECHAZO]));
    var semaphore = deriveSemaphore(status, dueDate);

    sheet.getRange(rowNumber, QUEUE_INDEX.PRIORIDAD + 1).setValue(priority);
    sheet.getRange(rowNumber, QUEUE_INDEX.RESPONSABLE + 1).setValue(owner);
    sheet.getRange(rowNumber, QUEUE_INDEX.FECHA_VENCIMIENTO + 1).setValue(dueDate);
    sheet.getRange(rowNumber, QUEUE_INDEX.SEMAFORO + 1).setValue(semaphore);
  }

  function getRejectedSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.REJECTED_RECORDS, FinanceConfig.HEADERS.REJECTED_RECORDS);
  }

  function getQueueSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.REVIEW_QUEUE, FinanceConfig.HEADERS.REVIEW_QUEUE);
  }

  function buildRejectedKey(rowIndex, rejectedRow) {
    // REJECTED_RECORDS: [0]=Timestamp [1]=Fuente [2]=GmailMessageId ...
    var gmailId = rejectedRow ? String(rejectedRow[2] || '').trim() : '';
    if (gmailId) {
      var ts = rejectedRow[0]
        ? Math.floor(new Date(rejectedRow[0]).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      return 'REJ-' + gmailId.slice(-8) + '-' + ts;
    }
    // Fallback para registros sin GmailMessageId
    return 'REJ-AUTO-' + Math.floor(Date.now() / 1000) + '-' + rowIndex;
  }

  function getExistingQueueKeys() {
    var sheet = getQueueSheet();
    var lastRow = sheet.getLastRow();
    var keys = {};

    if (lastRow < 2) {
      return keys;
    }

    // Leer RejectedKey (col 1) y GmailMessageId (col 4) para indexar ambos
    // REVIEW_QUEUE: [0]=RejectedKey [1]=TimestampRechazo [2]=Fuente [3]=GmailMessageId
    var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    values.forEach(function (row) {
      var key     = String(row[0] || '').trim();
      var gmailId = String(row[3] || '').trim();
      if (key)     keys[key] = true;
      if (gmailId) keys['__gmail__' + gmailId] = true; // índice secundario
    });

    return keys;
  }

  function parseRejectedPayload(payloadText) {
    var parsed = FinanceUtils.safeJsonParse(payloadText);
    return parsed || { metadata: {}, record: {}, errors: [] };
  }

  function buildQueueRow(rejectedKey, rejectedRow) {
    var payload = parseRejectedPayload(rejectedRow[7]);
    var metadata = payload.metadata || {};
    var record = payload.record || {};

    var priority = derivePriority(rejectedRow[6]);
    var owner = deriveOwner(rejectedRow[1]);
    var dueDate = deriveDueDate(priority, rejectedRow[0]);

    return [
      rejectedKey,
      rejectedRow[0] || '',
      rejectedRow[1] || '',
      rejectedRow[2] || '',
      rejectedRow[3] || '',
      rejectedRow[4] || '',
      rejectedRow[6] || '',
      'PENDIENTE',
      'REVISAR',
      record.tipoMovimiento || metadata.tipoMovimiento || '',
      record.fechaDocumento || '',
      record.categoria || '',
      record.subcategoria || '',
      record.proveedorCliente || '',
      record.rutEmisorReceptor || '',
      record.numeroDocumento || '',
      record.moneda || 'CLP',
      record.montoNeto || 0,
      record.iva || 0,
      record.montoTotal || 0,
      record.estadoPago || '',
      record.medioPago || '',
      record.origenVenta || metadata.origenVenta || '',
      record.observaciones || '',
      record.socioRut || metadata.socioRut || '',
      record.gerenciaRol || metadata.gerenciaRol || '',
      FinanceUtils.nowIso(),
      '',
      priority,
      owner,
      dueDate,
      deriveSemaphore('PENDIENTE', dueDate),
      ''
    ];
  }

  function syncRejectedRecordsToReviewQueue() {
    LedgerService.ensureCoreSheets();

    var rejectedSheet = getRejectedSheet();
    var queueSheet = getQueueSheet();
    var rejectedLastRow = rejectedSheet.getLastRow();
    var existingKeys = getExistingQueueKeys();
    var inserted = 0;

    if (rejectedLastRow < 2) {
      return { synced: 0, pendingQueueRows: Math.max(queueSheet.getLastRow() - 1, 0) };
    }

    var rows = rejectedSheet.getRange(2, 1, rejectedLastRow - 1, FinanceConfig.HEADERS.REJECTED_RECORDS.length).getValues();

    rows.forEach(function (row, index) {
      var rejectedKey = buildRejectedKey(index + 2, row);
      var gmailId = String(row[2] || '').trim();

      // Deduplicar por key directo O por GmailMessageId (cubre entradas legacy REJ-N / REJ-AUTO)
      if (existingKeys[rejectedKey] || (gmailId && existingKeys['__gmail__' + gmailId])) {
        return;
      }

      var queueRow = buildQueueRow(rejectedKey, row);
      queueSheet.appendRow(queueRow);
      refreshOperationalFields(queueSheet, queueSheet.getLastRow(), queueRow);
      existingKeys[rejectedKey] = true;
      if (gmailId) existingKeys['__gmail__' + gmailId] = true;
      inserted += 1;
    });

    AuditService.logInfo('Bandeja rechazados sincronizada', JSON.stringify({ inserted: inserted }));
    return { synced: inserted, pendingQueueRows: Math.max(queueSheet.getLastRow() - 1, 0) };
  }

  function buildCorrectedRecord(queueRow) {
    return {
      tipoMovimiento: queueRow[QUEUE_INDEX.TIPO_MOVIMIENTO],
      fechaDocumento: queueRow[QUEUE_INDEX.FECHA_DOCUMENTO],
      categoria: queueRow[QUEUE_INDEX.CATEGORIA],
      subcategoria: queueRow[QUEUE_INDEX.SUBCATEGORIA],
      proveedorCliente: queueRow[QUEUE_INDEX.PROVEEDOR_CLIENTE],
      rutEmisorReceptor: queueRow[QUEUE_INDEX.RUT_EMISOR_RECEPTOR],
      numeroDocumento: queueRow[QUEUE_INDEX.NUMERO_DOCUMENTO_CORREGIDO],
      moneda: queueRow[QUEUE_INDEX.MONEDA],
      montoNeto: queueRow[QUEUE_INDEX.MONTO_NETO],
      iva: queueRow[QUEUE_INDEX.IVA],
      montoTotal: queueRow[QUEUE_INDEX.MONTO_TOTAL],
      estadoPago: queueRow[QUEUE_INDEX.ESTADO_PAGO],
      medioPago: queueRow[QUEUE_INDEX.MEDIO_PAGO],
      origenVenta: queueRow[QUEUE_INDEX.ORIGEN_VENTA],
      observaciones: queueRow[QUEUE_INDEX.OBSERVACIONES],
      socioRut: queueRow[QUEUE_INDEX.SOCIO_RUT],
      gerenciaRol: queueRow[QUEUE_INDEX.GERENCIA_ROL]
    };
  }

  function buildMetadata(queueRow) {
    return {
      gmailMessageId: queueRow[QUEUE_INDEX.GMAIL_MESSAGE_ID],
      emailOrigen: queueRow[QUEUE_INDEX.EMAIL_ORIGEN],
      tipoMovimiento: queueRow[QUEUE_INDEX.TIPO_MOVIMIENTO],
      origenVenta: queueRow[QUEUE_INDEX.ORIGEN_VENTA],
      fuente: queueRow[QUEUE_INDEX.FUENTE],
      procesadoPorAI: 'REPROCESO_MANUAL',
      esExtranjero: String(queueRow[QUEUE_INDEX.MONEDA] || 'CLP').toUpperCase() !== 'CLP' ? 'TRUE' : 'FALSE',
      gerenciaRol: queueRow[QUEUE_INDEX.GERENCIA_ROL],
      socioRut: queueRow[QUEUE_INDEX.SOCIO_RUT]
    };
  }

  function updateQueueRow(sheet, rowNumber, estado, accion, resultado) {
    sheet.getRange(rowNumber, QUEUE_INDEX.ESTADO_REVISION + 1).setValue(estado);
    sheet.getRange(rowNumber, QUEUE_INDEX.ACCION + 1).setValue(accion);
    sheet.getRange(rowNumber, QUEUE_INDEX.ULTIMA_ACTUALIZACION + 1).setValue(FinanceUtils.nowIso());
    sheet.getRange(rowNumber, QUEUE_INDEX.RESULTADO + 1).setValue(resultado);

    var queueRow = sheet.getRange(rowNumber, 1, 1, FinanceConfig.HEADERS.REVIEW_QUEUE.length).getValues()[0];
    refreshOperationalFields(sheet, rowNumber, queueRow);
  }

  function processReviewQueue() {
    var queueSheet = getQueueSheet();
    var lastRow = queueSheet.getLastRow();
    var processed = 0;
    var saved = 0;
    var duplicates = 0;
    var blocked = 0;

    if (lastRow < 2) {
      return { processed: 0, saved: 0, duplicates: 0, blocked: 0 };
    }

    var rows = queueSheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.REVIEW_QUEUE.length).getValues();

    rows.forEach(function (row, index) {
      var rowNumber = index + 2;
      refreshOperationalFields(queueSheet, rowNumber, row);
      var action = String(row[QUEUE_INDEX.ACCION] || '').toUpperCase();
      if (action !== 'REPROCESAR') {
        return;
      }

      processed += 1;
      var correctedRecord = buildCorrectedRecord(row);
      var metadata = buildMetadata(row);
      var validation = ValidationService.validateExtractedRecord(correctedRecord);

      if (!validation.valid) {
        blocked += 1;
        updateQueueRow(queueSheet, rowNumber, 'BLOQUEADO', 'REVISAR', 'Errores de validacion: ' + validation.errors.join(', '));
        return;
      }

      var saveResult = LedgerService.saveExtractedEntry(correctedRecord, metadata);
      if (saveResult.saved) {
        saved += 1;
        updateQueueRow(queueSheet, rowNumber, 'REPROCESADO_OK', 'REVISADO', 'Registro guardado correctamente en Libro_Mayor.');
        return;
      }

      if (saveResult.duplicate) {
        duplicates += 1;
        updateQueueRow(queueSheet, rowNumber, 'DUPLICADO', 'REVISADO', 'El registro ya existia en Libro_Mayor.');
        return;
      }

      blocked += 1;
      updateQueueRow(queueSheet, rowNumber, 'BLOQUEADO', 'REVISAR', 'No fue posible reprocesar el registro.');
    });

    AuditService.logInfo('Bandeja rechazados procesada', JSON.stringify({
      processed: processed,
      saved: saved,
      duplicates: duplicates,
      blocked: blocked
    }));

    return {
      processed: processed,
      saved: saved,
      duplicates: duplicates,
      blocked: blocked
    };
  }

  return {
    syncRejectedRecordsToReviewQueue: syncRejectedRecordsToReviewQueue,
    processReviewQueue: processReviewQueue
  };
})();

function probeReviewQueueRuntime_20260508() {
  var report = {
    VITTO_REVIEW_QUEUE_VERSION_20260508: typeof VITTO_REVIEW_QUEUE_VERSION_20260508 !== 'undefined' ? VITTO_REVIEW_QUEUE_VERSION_20260508 : 'missing',
    ReviewQueueService: typeof ReviewQueueService,
    ReviewQueueService_syncRejectedRecordsToReviewQueue: (typeof ReviewQueueService !== 'undefined' && ReviewQueueService)
      ? typeof ReviewQueueService.syncRejectedRecordsToReviewQueue
      : 'n/a'
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
