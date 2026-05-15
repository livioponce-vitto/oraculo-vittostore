var LedgerService = (function () {
  var ROW_EXPANSION_BLOCK = 1000;
  var MIN_FREE_ROWS_BUFFER = 200;

  var GERENCIA_MAP = {
    'Ventas':                  'Comercial',
    'TECNOLOGIA_Y_SOFTWARE':   'Operaciones',
    'LEGAL_Y_COMPLIANCE':      'Legal',
    'Servicios':               'Operaciones',
    'MARKETING':               'Comercial',
    'LOGISTICA':               'Operaciones'
  };

  function resolveGerenciaRol_(categoria) {
    return GERENCIA_MAP[String(categoria || '').toUpperCase().trim()] ||
           GERENCIA_MAP[String(categoria || '').trim()] ||
           'Finanzas';
  }

  var LEDGER_INDEX = {
    FECHA_DOCUMENTO: 1,
    TIPO_MOVIMIENTO: 2,
    PROVEEDOR_CLIENTE: 5,
    NUMERO_DOCUMENTO: 7,
    MONEDA_ORIGINAL: 25
  };

  function ensureSheetRowCapacity(sheet) {
    var maxRows = sheet.getMaxRows();
    var lastRow = sheet.getLastRow();
    var freeRows = maxRows - lastRow;

    if (freeRows > MIN_FREE_ROWS_BUFFER) {
      return;
    }

    sheet.insertRowsAfter(maxRows, ROW_EXPANSION_BLOCK);

    if (typeof AuditService !== 'undefined' && AuditService && typeof AuditService.logInfo === 'function') {
      AuditService.logInfo('Auto expansion de filas', JSON.stringify({
        sheet: sheet.getName(),
        previousMaxRows: maxRows,
        addedRows: ROW_EXPANSION_BLOCK,
        newMaxRows: sheet.getMaxRows()
      }));
    }
  }

  function getOrCreateSheet(sheetName, headers) {
    if (!headers || !headers.length) {
      throw new Error('Headers no definidos para hoja: ' + sheetName + '. Revisa FinanceConfig.HEADERS.');
    }

    var ss = FinanceConfig.getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }

    var currentCols = sheet.getLastColumn();
    if (currentCols < headers.length) {
      sheet.insertColumnsAfter(currentCols, headers.length - currentCols);
    }

    var existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    var needsHeaderUpdate = false;
    for (var i = 0; i < headers.length; i++) {
      if (String(existingHeaders[i] || '') !== String(headers[i])) {
        needsHeaderUpdate = true;
        break;
      }
    }

    if (needsHeaderUpdate) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }

    ensureSheetRowCapacity(sheet);

    return sheet;
  }

  function ensureCoreSheets() {
    getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
    getOrCreateSheet(FinanceConfig.SHEETS.DUPLICATES, FinanceConfig.HEADERS.DUPLICATES);
    getOrCreateSheet(FinanceConfig.SHEETS.MONTHLY, FinanceConfig.HEADERS.MONTHLY);
    getOrCreateSheet(FinanceConfig.SHEETS.FOLIOS, FinanceConfig.HEADERS.FOLIOS);
    getOrCreateSheet(FinanceConfig.SHEETS.AUDIT, FinanceConfig.HEADERS.AUDIT);
    getOrCreateSheet(FinanceConfig.SHEETS.FX_RATES, FinanceConfig.HEADERS.FX_RATES);
    getOrCreateSheet(FinanceConfig.SHEETS.BANK_STATEMENT, FinanceConfig.HEADERS.BANK_STATEMENT);
    getOrCreateSheet(FinanceConfig.SHEETS.DATA_QUALITY, FinanceConfig.HEADERS.DATA_QUALITY);
    getOrCreateSheet(FinanceConfig.SHEETS.REJECTED_RECORDS, FinanceConfig.HEADERS.REJECTED_RECORDS);
    getOrCreateSheet(FinanceConfig.SHEETS.REVIEW_QUEUE, FinanceConfig.HEADERS.REVIEW_QUEUE);
    getOrCreateSheet(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY);
    getOrCreateSheet(FinanceConfig.SHEETS.EXECUTIVE_DASHBOARD, FinanceConfig.HEADERS.EXECUTIVE_DASHBOARD);
    getOrCreateSheet(FinanceConfig.SHEETS.FINANCE_VIEW, FinanceConfig.HEADERS.FINANCE_VIEW);
    getOrCreateSheet(FinanceConfig.SHEETS.COMMERCIAL_VIEW, FinanceConfig.HEADERS.COMMERCIAL_VIEW);
    getOrCreateSheet(FinanceConfig.SHEETS.MANAGEMENT_VIEW, FinanceConfig.HEADERS.MANAGEMENT_VIEW);
  }

  function hasDuplicate(hashDocumento) {
    var duplicatesSheet = getOrCreateSheet(FinanceConfig.SHEETS.DUPLICATES, FinanceConfig.HEADERS.DUPLICATES);
    var lastRow = duplicatesSheet.getLastRow();
    if (lastRow < 2) {
      return false;
    }

    var hashes = duplicatesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    return hashes.some(function (row) {
      return String(row[0]) === hashDocumento;
    });
  }

  function registerDuplicateControl(entry) {
    var duplicatesSheet = getOrCreateSheet(FinanceConfig.SHEETS.DUPLICATES, FinanceConfig.HEADERS.DUPLICATES);
    duplicatesSheet.appendRow([
      entry.hashDocumento,
      entry.fechaRegistro,
      entry.gmailMessageId,
      entry.numeroDocumento,
      entry.montoTotal,
      entry.tipoMovimiento
    ]);
  }

  function appendLedgerEntry(entry) {
    var ledgerSheet = getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);

    var row = [
      entry.fechaRegistro,
      entry.fechaDocumento,
      entry.tipoMovimiento,
      entry.categoria,
      entry.subcategoria,
      entry.proveedorCliente,
      entry.rutEmisorReceptor,
      entry.numeroDocumento,
      entry.moneda,
      entry.montoNeto,
      entry.iva,
      entry.montoTotal,
      entry.estadoPago,
      entry.medioPago,
      entry.origenVenta,
      entry.emailOrigen,
      entry.gmailMessageId,
      entry.hashDocumento,
      entry.fuente,
      entry.observaciones,
      entry.procesadoPorAI,
      entry.socioRut,
      entry.gerenciaRol,
      entry.createdAt,
      entry.updatedAt,
      entry.monedaOriginal,
      entry.montoOriginal,
      entry.tipoCambioAplicado,
      entry.montoTotalCLP,
      entry.estadoConciliacionBanco,
      entry.esExtranjero,
      entry.alertaSistema
    ];

    ledgerSheet.appendRow(row);
  }

  function normalizeProviderForMatch(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function normalizeDocumentNumberForMatch(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/\s+/g, '');
  }

  function sameDayAsString(value) {
    if (!value) {
      return '';
    }

    try {
      return Utilities.formatDate(new Date(value), 'America/Santiago', 'yyyy-MM-dd');
    } catch (e) {
      return String(value);
    }
  }

  function isAnthropicProvider(providerText) {
    var p = normalizeProviderForMatch(providerText);
    return p.indexOf('anthropic') !== -1;
  }

  function findSemanticDuplicate(entry) {
    var ledgerSheet = getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
    var lastRow = ledgerSheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }

    var rows = ledgerSheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();
    var currentDoc = normalizeDocumentNumberForMatch(entry.numeroDocumento);
    var currentProvider = normalizeProviderForMatch(entry.proveedorCliente);
    var currentDate = sameDayAsString(entry.fechaDocumento);
    var currentType = String(entry.tipoMovimiento || '').toUpperCase();
    var currentCurrencyOriginal = String(entry.monedaOriginal || 'CLP').toUpperCase();
    var currentIsAnthropic = isAnthropicProvider(entry.proveedorCliente);

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowType = String(row[LEDGER_INDEX.TIPO_MOVIMIENTO] || '').toUpperCase();
      if (rowType !== currentType) {
        continue;
      }

      var rowDoc = normalizeDocumentNumberForMatch(row[LEDGER_INDEX.NUMERO_DOCUMENTO]);
      var rowProvider = normalizeProviderForMatch(row[LEDGER_INDEX.PROVEEDOR_CLIENTE]);
      var rowDate = sameDayAsString(row[LEDGER_INDEX.FECHA_DOCUMENTO]);
      var rowCurrencyOriginal = String(row[LEDGER_INDEX.MONEDA_ORIGINAL] || 'CLP').toUpperCase();

      if (currentIsAnthropic || isAnthropicProvider(row[LEDGER_INDEX.PROVEEDOR_CLIENTE])) {
        if (rowDoc && currentDoc && rowDoc === currentDoc && rowProvider.indexOf('anthropic') !== -1 && currentProvider.indexOf('anthropic') !== -1) {
          return {
            reason: 'ANTHROPIC_INVOICE_NUMBER_DUPLICATE',
            rowNumber: i + 2,
            numeroDocumento: row[LEDGER_INDEX.NUMERO_DOCUMENTO] || '',
            proveedorCliente: row[LEDGER_INDEX.PROVEEDOR_CLIENTE] || ''
          };
        }
        continue;
      }

      if (!rowDoc || !currentDoc) {
        continue;
      }

      if (
        rowDoc === currentDoc &&
        rowProvider === currentProvider &&
        rowDate === currentDate &&
        rowCurrencyOriginal === currentCurrencyOriginal
      ) {
        return {
          reason: 'PRIMARY_KEY_DUPLICATE',
          rowNumber: i + 2,
          numeroDocumento: row[LEDGER_INDEX.NUMERO_DOCUMENTO] || '',
          proveedorCliente: row[LEDGER_INDEX.PROVEEDOR_CLIENTE] || ''
        };
      }
    }

    return null;
  }

  function debugFindSemanticDuplicateEntry(entryLike) {
    var entry = {
      numeroDocumento: (entryLike && entryLike.numeroDocumento) || '',
      proveedorCliente: (entryLike && entryLike.proveedorCliente) || '',
      fechaDocumento: (entryLike && entryLike.fechaDocumento) || '',
      tipoMovimiento: String((entryLike && entryLike.tipoMovimiento) || '').toUpperCase(),
      monedaOriginal: String((entryLike && entryLike.monedaOriginal) || 'CLP').toUpperCase()
    };

    return findSemanticDuplicate(entry);
  }

  function buildLedgerEntry(extracted, metadata) {
    var fechaDocumento = extracted.fechaDocumento || FinanceUtils.toDateString(new Date());
    var monedaOriginal = String(extracted.moneda || 'CLP').toUpperCase();

    var netoOriginal = FinanceUtils.normalizeCurrency(extracted.montoNeto);
    var ivaOriginal = FinanceUtils.normalizeCurrency(extracted.iva);
    var totalOriginal = FinanceUtils.normalizeCurrency(extracted.montoTotal);

    var fxTotal = FxService.convertToClp(totalOriginal, monedaOriginal, fechaDocumento);
    var fxNeto = FxService.convertToClp(netoOriginal, monedaOriginal, fechaDocumento);
    var fxIva = FxService.convertToClp(ivaOriginal, monedaOriginal, fechaDocumento);

    // Redondeo correcto: CLP → entero, USD → 2 decimales.
    var clpNeto  = Math.round(fxNeto.amountClp);
    var clpIva   = Math.round(fxIva.amountClp);
    var clpTotal = Math.round(fxTotal.amountClp);
    var originalRounded = monedaOriginal === 'CLP'
      ? Math.round(fxTotal.amountOriginal)
      : Math.round(fxTotal.amountOriginal * 100) / 100;
    var fxRateRounded = Math.round(fxTotal.fxRate * 100) / 100;

    var draft = {
      fechaRegistro: FinanceUtils.toDateString(new Date()),
      fechaDocumento: fechaDocumento,
      tipoMovimiento: (extracted.tipoMovimiento || metadata.tipoMovimiento || '').toUpperCase(),
      categoria: extracted.categoria || '',
      subcategoria: extracted.subcategoria || '',
      proveedorCliente: extracted.proveedorCliente || '',
      rutEmisorReceptor: extracted.rutEmisorReceptor || '',
      numeroDocumento: extracted.numeroDocumento || '',
      moneda: 'CLP',
      montoNeto: clpNeto,
      iva: clpIva,
      montoTotal: clpTotal,
      estadoPago: extracted.estadoPago || 'PENDIENTE',
      medioPago: extracted.medioPago || '',
      origenVenta: extracted.origenVenta || metadata.origenVenta || 'Sin atribucion',
      emailOrigen: metadata.emailOrigen,
      gmailMessageId: metadata.gmailMessageId,
      hashDocumento: '',
      fuente: metadata.fuente,
      observaciones: extracted.observaciones || '',
      procesadoPorAI: metadata.procesadoPorAI || 'SI',
      socioRut: extracted.socioRut || metadata.socioRut || '',
      gerenciaRol: extracted.gerenciaRol || metadata.gerenciaRol || resolveGerenciaRol_(extracted.categoria || ''),
      createdAt: FinanceUtils.nowChile(),
      updatedAt: FinanceUtils.nowChile(),
      monedaOriginal: monedaOriginal,
      montoOriginal: originalRounded,
      tipoCambioAplicado: fxRateRounded,
      montoTotalCLP: clpTotal,
      estadoConciliacionBanco: 'PENDIENTE_BANCO',
      esExtranjero: String(metadata.esExtranjero || 'FALSE').toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
      alertaSistema: fxTotal.fxAlert || ''
    };

    draft.hashDocumento = FinanceUtils.buildDocHash(draft);
    return draft;
  }

  function saveExtractedEntry(extracted, metadata) {
    var entry = buildLedgerEntry(extracted, metadata);
    var semanticDuplicate = findSemanticDuplicate(entry);

    if (semanticDuplicate) {
      AuditService.logWarn('Duplicado semantico detectado', JSON.stringify({
        reason: semanticDuplicate.reason,
        existingRow: semanticDuplicate.rowNumber,
        numeroDocumento: entry.numeroDocumento,
        proveedorCliente: entry.proveedorCliente,
        messageId: entry.gmailMessageId
      }));
      return { saved: false, duplicate: true, hash: entry.hashDocumento, semanticReason: semanticDuplicate.reason };
    }

    if (hasDuplicate(entry.hashDocumento)) {
      AuditService.logWarn('Duplicado detectado', JSON.stringify({
        hash: entry.hashDocumento,
        numeroDocumento: entry.numeroDocumento,
        messageId: entry.gmailMessageId
      }));
      return { saved: false, duplicate: true, hash: entry.hashDocumento };
    }

    appendLedgerEntry(entry);
    registerDuplicateControl(entry);
    return { saved: true, duplicate: false, hash: entry.hashDocumento };
  }

  function getRowsForPeriod(startDate, endDate) {
    var ledgerSheet = getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
    var lastRow = ledgerSheet.getLastRow();

    if (lastRow < 2) {
      return [];
    }

    var values = ledgerSheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();
    return values.filter(function (row) {
      var rowDate = new Date(row[1]);
      return rowDate >= startDate && rowDate <= endDate;
    });
  }

  return {
    ensureCoreSheets: ensureCoreSheets,
    saveExtractedEntry: saveExtractedEntry,
    getRowsForPeriod: getRowsForPeriod,
    getOrCreateSheet: getOrCreateSheet,
    debugFindSemanticDuplicateEntry: debugFindSemanticDuplicateEntry
  };
})();
