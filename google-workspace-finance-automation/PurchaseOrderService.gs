var PurchaseOrderService = (function () {
  function safeSendMail_(payload, contextLabel) {
    try {
      MailApp.sendEmail(payload);
      return { sent: true };
    } catch (error) {
      AuditService.logWarn('MailApp no autorizado; envio omitido', JSON.stringify({
        context: contextLabel,
        message: String(error)
      }));
      return { sent: false, error: String(error) };
    }
  }

  function getNextFolio(documentType) {
    var sheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.FOLIOS, FinanceConfig.HEADERS.FOLIOS);
    var lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      sheet.appendRow([documentType, 1, FinanceUtils.nowIso()]);
      return 1;
    }

    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === documentType) {
        var next = Number(data[i][1]) + 1;
        sheet.getRange(i + 2, 2).setValue(next);
        sheet.getRange(i + 2, 3).setValue(FinanceUtils.nowIso());
        return next;
      }
    }

    sheet.appendRow([documentType, 1, FinanceUtils.nowIso()]);
    return 1;
  }

  function buildPurchaseOrderDoc(folio, rowData) {
    var docTitle = 'OC-VITTOSTORE-' + Utilities.formatString('%06d', folio);
    var doc = DocumentApp.create(docTitle);
    var body = doc.getBody();

    body.appendParagraph('VITTOSTORE - ORDEN DE COMPRA').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Folio: ' + docTitle);
    body.appendParagraph('Fecha emision: ' + FinanceUtils.toDateString(new Date()));
    body.appendParagraph('Solicitante: ' + rowData.solicitante);
    body.appendParagraph('Area/Gerencia: ' + rowData.gerenciaRol);
    body.appendParagraph('Proveedor: ' + rowData.proveedor);
    body.appendParagraph('RUT proveedor: ' + rowData.rutProveedor);
    body.appendParagraph('Descripcion: ' + rowData.descripcion);
    body.appendParagraph('Monto estimado: ' + rowData.moneda + ' ' + rowData.monto);
    body.appendParagraph('Centro de costo / Origen: ' + rowData.origenVenta);
    body.appendParagraph('Link firma digital: ' + rowData.signatureLink);

    doc.saveAndClose();
    return doc.getUrl();
  }

  function generatePurchaseOrderFromRow(rowNumber) {
    var requestsSheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.PURCHASE_REQUESTS, [
      'FechaSolicitud',
      'Solicitante',
      'GerenciaRol',
      'Proveedor',
      'RutProveedor',
      'Descripcion',
      'Moneda',
      'Monto',
      'OrigenVenta',
      'Estado',
      'Folio',
      'DocUrl',
      'FechaEnvioAprobacion'
    ]);

    var activeRow = rowNumber || requestsSheet.getActiveRange().getRow();
    if (activeRow < 2) {
      throw new Error('Selecciona una fila valida de Solicitudes_OC.');
    }

    var row = requestsSheet.getRange(activeRow, 1, 1, 13).getValues()[0];
    var rowData = {
      solicitante: row[1],
      gerenciaRol: row[2],
      proveedor: row[3],
      rutProveedor: row[4],
      descripcion: row[5],
      moneda: row[6] || 'CLP',
      monto: FinanceUtils.normalizeCurrency(row[7]),
      origenVenta: row[8] || 'Sin atribucion'
    };

    var folio = getNextFolio('OC');
    var signatureBase = FinanceConfig.getRequiredProperty('SIGNATURE_BASE_URL');
    rowData.signatureLink = signatureBase + '?folio=' + encodeURIComponent(folio);

    var docUrl = buildPurchaseOrderDoc(folio, rowData);

    requestsSheet.getRange(activeRow, 10).setValue('PENDIENTE_APROBACION_CEO');
    requestsSheet.getRange(activeRow, 11).setValue(folio);
    requestsSheet.getRange(activeRow, 12).setValue(docUrl);
    requestsSheet.getRange(activeRow, 13).setValue(FinanceUtils.nowIso());

    var ceoEmail = FinanceConfig.getRequiredProperty('CEO_EMAIL');
    var approvalEmail = safeSendMail_({
      to: ceoEmail,
      subject: '[Aprobacion requerida] Orden de Compra OC-' + Utilities.formatString('%06d', folio),
      body: [
        'CEO, hay una nueva Orden de Compra pendiente de aprobacion.',
        'Folio: OC-' + Utilities.formatString('%06d', folio),
        'Proveedor: ' + rowData.proveedor,
        'Monto: ' + rowData.moneda + ' ' + rowData.monto,
        'Documento: ' + docUrl,
        'Firma digital: ' + rowData.signatureLink
      ].join('\n')
    }, 'generatePurchaseOrderFromRow');

    if (!approvalEmail.sent) {
      AuditService.logWarn('OC generada sin envio de correo a CEO', approvalEmail.error);
    }

    AuditService.logInfo('OC generada y enviada a CEO', 'folio=' + folio + ' row=' + activeRow);

    return {
      folio: folio,
      docUrl: docUrl,
      status: 'PENDIENTE_APROBACION_CEO'
    };
  }

  return {
    generatePurchaseOrderFromRow: generatePurchaseOrderFromRow
  };
})();
