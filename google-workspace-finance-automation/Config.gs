var FinanceConfig = (function () {
  var REQUIRED_PROPERTIES = [
    'FINANCE_SPREADSHEET_ID',
    'GEMINI_API_KEY',
    'CEO_EMAIL',
    'FINANCE_ALERT_EMAILS',
    'MARKETING_REPORT_EMAILS',
    'ALLOWED_BILLING_SENDERS',
    'SHOPIFY_ORDER_SENDERS',
    'ALLOWED_TAX_SENDERS',
    'ALLOWED_PATENTES_SENDERS',
    'ALLOWED_BANCARIOS_SENDERS',
    'SIGNATURE_BASE_URL'
  ];

  var SHEETS = {
    LEDGER: 'Libro_Mayor',
    DUPLICATES: 'Control_Duplicados',
    MONTHLY: 'Resumen_Mensual',
    PURCHASE_REQUESTS: 'Solicitudes_OC',
    FOLIOS: 'Control_Folios',
    AUDIT: 'Auditoria_Finanzas',
    FX_RATES: 'TipoCambio_USD',
    BANK_STATEMENT: 'Cartola_Banco',
    DATA_QUALITY: 'Control_Calidad_Datos',
    REJECTED_RECORDS: 'Registros_Rechazados',
    REVIEW_QUEUE: 'Bandeja_Revision_Rechazados',
    INTEGRATION_CONTINGENCY: 'Contingencia_Integraciones',
    EXECUTIVE_DASHBOARD: 'Dashboard_Ejecutivo',
    FINANCE_VIEW: 'Vista_Finanzas',
    COMMERCIAL_VIEW: 'Vista_Comercial',
    MANAGEMENT_VIEW: 'Vista_Gerencia',
    ACCOUNTANT_VIEW: 'Vista_Contador'
  };

  var HEADERS = {
    LEDGER: [
      'FechaRegistro',
      'FechaDocumento',
      'TipoMovimiento',
      'Categoria',
      'Subcategoria',
      'ProveedorCliente',
      'RutEmisorReceptor',
      'NumeroDocumento',
      'Moneda',
      'MontoNeto',
      'IVA',
      'MontoTotal',
      'EstadoPago',
      'MedioPago',
      'OrigenVenta',
      'EmailOrigen',
      'GmailMessageId',
      'HashDocumento',
      'Fuente',
      'Observaciones',
      'ProcesadoPorAI',
      'SocioRut',
      'GerenciaRol',
      'CreatedAt',
      'UpdatedAt',
      'MonedaOriginal',
      'MontoOriginal',
      'TipoCambioAplicado',
      'MontoTotalCLP',
      'EstadoConciliacionBanco',
      'EsExtranjero',
      'AlertaSistema'
    ],
    DUPLICATES: ['HashDocumento', 'FechaRegistro', 'GmailMessageId', 'NumeroDocumento', 'MontoTotal', 'TipoMovimiento'],
    MONTHLY: ['Periodo', 'Ingresos', 'Egresos', 'Resultado', 'EstadoConciliacion', 'GeneradoEn'],
    FOLIOS: ['TipoDocumento', 'UltimoFolio', 'ActualizadoEn'],
    AUDIT: ['Timestamp', 'Severidad', 'Evento', 'Detalle'],
    FX_RATES: ['Fecha', 'UsdObserved', 'Fuente', 'ActualizadoEn'],
    BANK_STATEMENT: ['Fecha', 'Descripcion', 'MontoCLP', 'TipoMovimiento', 'Referencia', 'Conciliado', 'LedgerHash'],
    DATA_QUALITY: ['EjecutadoEn', 'FilaLibroMayor', 'HashDocumento', 'Severidad', 'Regla', 'Detalle'],
    REJECTED_RECORDS: ['Timestamp', 'Fuente', 'GmailMessageId', 'EmailOrigen', 'NumeroDocumento', 'Severidad', 'Motivo', 'Payload'],
    REVIEW_QUEUE: ['RejectedKey', 'TimestampRechazo', 'Fuente', 'GmailMessageId', 'EmailOrigen', 'NumeroDocumentoOriginal', 'MotivoOriginal', 'EstadoRevision', 'Accion', 'TipoMovimiento', 'FechaDocumento', 'Categoria', 'Subcategoria', 'ProveedorCliente', 'RutEmisorReceptor', 'NumeroDocumentoCorregido', 'Moneda', 'MontoNeto', 'IVA', 'MontoTotal', 'EstadoPago', 'MedioPago', 'OrigenVenta', 'Observaciones', 'SocioRut', 'GerenciaRol', 'UltimaActualizacion', 'Resultado', 'Prioridad', 'Responsable', 'FechaVencimiento', 'Semaforo', 'NotasOperacion'],
    INTEGRATION_CONTINGENCY: ['Timestamp', 'Integracion', 'Operacion', 'Severidad', 'Estado', 'FallbackAplicado', 'Runbook', 'Detalle', 'GmailMessageId', 'Responsable', 'AccionSiguiente'],
    EXECUTIVE_DASHBOARD: ['Seccion', 'Indicador', 'Valor', 'Detalle'],
    FINANCE_VIEW: ['Seccion', 'Indicador', 'Valor', 'Detalle'],
    COMMERCIAL_VIEW: ['Seccion', 'Indicador', 'Valor', 'Detalle'],
    MANAGEMENT_VIEW: ['Seccion', 'Indicador', 'Valor', 'Detalle'],
    ACCOUNTANT_VIEW: ['Fecha', 'FechaDocumento', 'Movimiento', 'Categoria', 'Subcategoria', 'ProveedorCliente', 'RUT', 'NumDocumento', 'MonedaOrigen', 'MontoOriginal', 'TipoCambio', 'MontoNeto_CLP', 'IVA_CLP', 'Total_CLP', 'EstadoPago', 'MedioPago', 'OrigenVenta', 'Observaciones', 'Conciliacion']
  };

  function getScriptProperties() {
    return PropertiesService.getScriptProperties();
  }

  function getRequiredProperty(key) {
    var value = getScriptProperties().getProperty(key);
    if (!value) {
      throw new Error('Falta Script Property obligatoria: ' + key);
    }
    return value;
  }

  function getOptionalProperty(key, fallback) {
    var value = getScriptProperties().getProperty(key);
    return value || fallback;
  }

  function getSpreadsheet() {
    var spreadsheetId = getRequiredProperty('FINANCE_SPREADSHEET_ID');
    return SpreadsheetApp.openById(spreadsheetId);
  }

  function getArrayProperty(key) {
    var raw = getRequiredProperty(key);
    return raw
      .split(',')
      .map(function (v) {
        return v.trim().toLowerCase();
      })
      .filter(Boolean);
  }

  function validateRequiredProperties() {
    var properties = getScriptProperties();
    var missing = REQUIRED_PROPERTIES.filter(function (key) {
      return !properties.getProperty(key);
    });

    if (missing.length > 0) {
      throw new Error('Config incompleta. Faltan propiedades: ' + missing.join(', '));
    }

    return true;
  }

  return {
    SHEETS: SHEETS,
    HEADERS: HEADERS,
    getSpreadsheet: getSpreadsheet,
    getRequiredProperty: getRequiredProperty,
    getOptionalProperty: getOptionalProperty,
    getArrayProperty: getArrayProperty,
    validateRequiredProperties: validateRequiredProperties
  };
})();
