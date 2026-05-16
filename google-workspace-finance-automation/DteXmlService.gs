var DteXmlService = (function () {
  function getTagValue(xmlText, tagName) {
    var regex = new RegExp('<(?:\\w+:)?' + tagName + '>([\\s\\S]*?)<\\/(?:\\w+:)?' + tagName + '>', 'i');
    var match = xmlText.match(regex);
    return match ? String(match[1]).trim() : '';
  }

  function parseNumber(value) {
    return FinanceUtils.normalizeCurrency(value);
  }

  function looksLikeDte(xmlText) {
    return /<DTE[\s>]|<Documento[\s>]|<TED[\s>]|<Folio>/i.test(xmlText || '');
  }

  function mapTipoDteContext(tipoDte, defaultTipoMovimiento, defaultOrigenVenta) {
    var tipo = String(tipoDte || '').trim();
    var info = {
      tipoMovimiento: defaultTipoMovimiento,
      categoria: 'DTE_CHILE',
      subcategoria: tipo ? 'TipoDTE_' + tipo : 'TipoDTE_NO_INFORMADO',
      origenVenta: defaultOrigenVenta || 'Sin atribucion',
      observacionExtra: ''
    };

    // SII: 61 = Nota de Credito, tipicamente usada para anular/ajustar ventas.
    if (tipo === '61') {
      info.tipoMovimiento = 'EGRESO';
      info.categoria = 'DEVOLUCIONES_Y_NC';
      info.subcategoria = 'NOTA_CREDITO_DTE_61';
      info.origenVenta = defaultOrigenVenta || 'Ajuste devolucion/NC';
      info.observacionExtra = 'Clasificado automatico como Nota de Credito (DTE 61).';
      return info;
    }

    // SII exportacion: 110 Factura de Exportacion, 111 Nota Debito Exportacion, 112 Nota Credito Exportacion.
    if (tipo === '110' || tipo === '111' || tipo === '112') {
      info.tipoMovimiento = (tipo === '112') ? 'EGRESO' : 'INGRESO';
      info.categoria = 'EXPORTACIONES';
      info.subcategoria = 'DTE_EXPORTACION_' + tipo;
      info.origenVenta = defaultOrigenVenta || 'Exportacion';
      info.observacionExtra = 'Clasificado automatico como documento de exportacion (DTE ' + tipo + ').';
      return info;
    }

    return info;
  }

  function parseDteXml(xmlText, emailMeta, defaultTipoMovimiento, defaultOrigenVenta) {
    if (!xmlText || !looksLikeDte(xmlText)) {
      return null;
    }

    var fechaDocumento = getTagValue(xmlText, 'FchEmis') || emailMeta.fechaEmail;
    var numeroDocumento = getTagValue(xmlText, 'Folio');
    var rutEmisor = getTagValue(xmlText, 'RUTEmisor');
    var razonSocial = getTagValue(xmlText, 'RznSoc') || getTagValue(xmlText, 'RznSocEmisor');
    var tipoDte = getTagValue(xmlText, 'TipoDTE');

    var montoNeto = parseNumber(getTagValue(xmlText, 'MntNeto'));
    var iva = parseNumber(getTagValue(xmlText, 'IVA'));
    var montoTotal = parseNumber(getTagValue(xmlText, 'MntTotal'));

    if (!montoTotal && montoNeto > 0) {
      montoTotal = montoNeto + iva;
    }

    if (!numeroDocumento || montoTotal <= 0) {
      return null;
    }

    var mapped = mapTipoDteContext(tipoDte, defaultTipoMovimiento, defaultOrigenVenta);
    var baseObservation = 'Registro extraido desde XML DTE (deterministico).';
    var observation = mapped.observacionExtra ? (baseObservation + ' ' + mapped.observacionExtra) : baseObservation;

    return {
      tipoMovimiento: mapped.tipoMovimiento,
      fechaDocumento: fechaDocumento,
      categoria: mapped.categoria,
      subcategoria: mapped.subcategoria,
      proveedorCliente: razonSocial || 'Emisor DTE',
      rutEmisorReceptor: rutEmisor,
      numeroDocumento: numeroDocumento,
      moneda: 'CLP',
      montoNeto: montoNeto,
      iva: iva,
      montoTotal: montoTotal,
      estadoPago: 'PENDIENTE',
      medioPago: '',
      origenVenta: mapped.origenVenta,
      observaciones: observation,
      socioRut: '',
      gerenciaRol: ''
    };
  }

  function extractRecordsFromMessage(message, emailMeta, defaultTipoMovimiento, defaultOrigenVenta) {
    var attachments = message.getAttachments({ includeInlineImages: false });
    if (!attachments || attachments.length === 0) {
      return [];
    }

    var records = [];

    attachments.forEach(function (att) {
      var name = String(att.getName() || '').toLowerCase();
      var mime = String(att.getContentType() || '').toLowerCase();
      var isXml = name.slice(-4) === '.xml' || mime.indexOf('xml') !== -1 || mime.indexOf('text/plain') !== -1;
      if (!isXml) {
        return;
      }

      var xmlText = att.getDataAsString();
      var parsed = parseDteXml(xmlText, emailMeta, defaultTipoMovimiento, defaultOrigenVenta);
      if (parsed) {
        records.push(parsed);
      }
    });

    return records;
  }

  return {
    extractRecordsFromMessage: extractRecordsFromMessage
  };
})();
