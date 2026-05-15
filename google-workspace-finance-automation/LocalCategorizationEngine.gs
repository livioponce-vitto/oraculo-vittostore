// ─── INNOV-04: Motor de Categorización Local (sin Gemini) ─────────────────────
// Clasifica transacciones financieras usando reglas deterministas basadas en
// email de origen, patrones de asunto y moneda. Se invoca ANTES de Gemini.
// Si confidence === 'ALTA', Gemini se omite completamente (~80% de los casos).
// ──────────────────────────────────────────────────────────────────────────────

var LocalCategorizationEngine = (function () {

  // ── Tabla de reglas por email de origen (ordenadas por especificidad) ─────────
  var EMAIL_RULES = [
    // ── RUIDO: descartar antes de cualquier procesamiento ────────────────────────
    {
      emailPattern: /firebase-noreply@google\.com/,
      esRuido: true, motivoDescarte: 'Notificacion Firebase no financiera',
      confidence: 'ALTA'
    },
    {
      emailPattern: /transaction@notice\.aliexpress\.com|aliexpress\.com/,
      esRuido: true, motivoDescarte: 'Email AliExpress bloqueado por heuristica',
      confidence: 'ALTA'
    },
    {
      emailPattern: /noreply@accounts\.google\.com|no-reply@accounts\.google\.com/,
      esRuido: true, motivoDescarte: 'Notificacion de cuenta Google no financiera',
      confidence: 'ALTA'
    },

    // ── SHOPIFY: ventas (notificaciones de orden) ────────────────────────────────
    {
      emailPattern: /store\+.*@t\.shopifyemail\.com/,
      tipoMovimiento: 'INGRESO',
      categoria: 'Ventas',
      subcategoria: 'Venta de productos',
      proveedor: null,
      rutProveedor: null,
      origenVenta: 'Shopify',
      confidence: 'ALTA'
    },
    {
      emailPattern: /orders@shopify\.com|order-status@shopifyemail\.com/,
      tipoMovimiento: 'INGRESO',
      categoria: 'Ventas',
      subcategoria: 'Venta de productos',
      proveedor: null,
      rutProveedor: null,
      origenVenta: 'Shopify',
      confidence: 'ALTA'
    },

    // ── SHOPIFY: facturación y suscripciones ─────────────────────────────────────
    {
      email: 'billing@shopify.com',
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      proveedor: 'Shopify International',
      rutProveedor: 'SHOPIFY-CA',
      medioPago: 'Visa 5914',
      confidence: 'ALTA'
    },

    // ── ANTHROPIC ────────────────────────────────────────────────────────────────
    {
      emailPattern: /invoice\+statements@mail\.anthropic\.com|.*@anthropic\.com/,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      proveedor: 'Anthropic, PBC',
      rutProveedor: 'EIN-USA',
      moneda: 'USD',
      confidence: 'ALTA'
    },

    // ── GOOGLE CLOUD / WORKSPACE ─────────────────────────────────────────────────
    {
      email: 'payments-noreply@google.com',
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'INFRAESTRUCTURA_CLOUD',
      proveedor: 'Google LLC',
      rutProveedor: 'GOOGLE-USA',
      confidence: 'ALTA'
    },
    {
      emailPattern: /.*@google\.com/,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'INFRAESTRUCTURA_CLOUD',
      proveedor: 'Google LLC',
      rutProveedor: 'GOOGLE-USA',
      confidence: 'MEDIA'
    },

    // ── E-CERTCHILE (certificados digitales / DTE) ───────────────────────────────
    {
      emailPattern: /dte_prod_endce@smtp\.suiteelectronica\.com|.*suiteelectronica\.com/,
      tipoMovimiento: 'EGRESO',
      categoria: 'LEGAL_Y_COMPLIANCE',
      subcategoria: 'CERTIFICACION_DIGITAL',
      proveedor: 'e-certchile (Empresa Nac. Certificacion Electronica)',
      rutProveedor: '96928180-5',
      confidence: 'ALTA'
    },

    // ── MERCADO PAGO ─────────────────────────────────────────────────────────────
    {
      emailPattern: /.*@mercadopago\.com|no-reply@mercadopago\.cl/,
      tipoMovimiento: 'INGRESO',
      categoria: 'Ventas',
      subcategoria: 'Venta de productos',
      medioPago: 'Mercado pago checkout pro',
      confidence: 'ALTA'
    },

    // ── FLOW / WEBPAY (pagos nacionales) ─────────────────────────────────────────
    {
      emailPattern: /.*@flow\.cl|.*webpay\..*/,
      tipoMovimiento: 'INGRESO',
      categoria: 'Ventas',
      subcategoria: 'Venta Online',
      medioPago: 'Webpay via Flow',
      confidence: 'MEDIA'
    },

    // ── STRIPE ───────────────────────────────────────────────────────────────────
    {
      emailPattern: /receipts@stripe\.com|.*@stripe\.com/,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      proveedor: null,
      rutProveedor: null,
      confidence: 'MEDIA'
    },

    // ── PAYPAL ───────────────────────────────────────────────────────────────────
    {
      emailPattern: /service@paypal\.com|.*@paypal\..*/,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      medioPago: 'PayPal',
      confidence: 'MEDIA'
    }
  ];

  // ── Tabla de reglas por asunto (secundaria, se aplica si email no fue ALTA) ───
  var SUBJECT_RULES = [
    {
      subjectPattern: /order.*confirm|confirmaci[oó]n.*orden|nueva.*venta|new.*order/i,
      tipoMovimiento: 'INGRESO',
      categoria: 'Ventas',
      subcategoria: 'Venta de productos',
      confidence: 'MEDIA'
    },
    {
      subjectPattern: /suscripci[oó]n|subscription|plan mensual|monthly.*plan|billing.*cycle/i,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      confidence: 'MEDIA'
    },
    {
      subjectPattern: /factura.*electr[oó]nica|boleta.*electr[oó]nica|dte.*folio/i,
      tipoMovimiento: 'EGRESO',
      categoria: null,
      subcategoria: null,
      confidence: 'BAJA'
    },
    {
      subjectPattern: /registro.*dominio|domain.*registration|renovaci[oó]n.*dominio/i,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'REGISTRO_DOMINIO',
      confidence: 'MEDIA'
    },
    {
      subjectPattern: /google.*workspace|workspace.*google/i,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'SUSCRIPCION_SAAS',
      proveedor: 'Google Workspace',
      rutProveedor: '76.023.972-2',
      confidence: 'ALTA'
    },
    {
      subjectPattern: /google.*cloud|gcp.*invoice/i,
      tipoMovimiento: 'EGRESO',
      categoria: 'TECNOLOGIA_Y_SOFTWARE',
      subcategoria: 'INFRAESTRUCTURA_CLOUD',
      proveedor: 'Google LLC',
      rutProveedor: 'GOOGLE-USA',
      confidence: 'ALTA'
    }
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function normalizeEmail(email) {
    return String(email || '').toLowerCase().trim();
  }

  function matchEmailRule(email, rule) {
    var normalized = normalizeEmail(email);
    if (rule.email) {
      return normalized === rule.email.toLowerCase();
    }
    if (rule.emailPattern) {
      return rule.emailPattern.test(normalized);
    }
    return false;
  }

  function findEmailRule(emailOrigen) {
    for (var i = 0; i < EMAIL_RULES.length; i++) {
      if (matchEmailRule(emailOrigen, EMAIL_RULES[i])) {
        return EMAIL_RULES[i];
      }
    }
    return null;
  }

  function findSubjectRule(subject) {
    for (var i = 0; i < SUBJECT_RULES.length; i++) {
      var rule = SUBJECT_RULES[i];
      if (rule.subjectPattern && rule.subjectPattern.test(String(subject || ''))) {
        return rule;
      }
    }
    return null;
  }

  function buildResult(source, confidence, rule, extras) {
    extras = extras || {};
    return {
      source: source,
      confidence: confidence,
      esRuido: rule.esRuido || false,
      motivoDescarte: rule.motivoDescarte || null,
      tipoMovimiento: extras.tipoMovimiento || rule.tipoMovimiento || null,
      categoria: extras.categoria || rule.categoria || null,
      subcategoria: extras.subcategoria || rule.subcategoria || null,
      proveedor: extras.proveedor || rule.proveedor || null,
      rutProveedor: extras.rutProveedor || rule.rutProveedor || null,
      medioPago: extras.medioPago || rule.medioPago || null,
      origenVenta: extras.origenVenta || rule.origenVenta || null,
      needsGemini: false
    };
  }

  function geminiRequired() {
    return {
      source: 'LOCAL_ENGINE',
      confidence: 'NINGUNA',
      esRuido: false,
      motivoDescarte: null,
      tipoMovimiento: null,
      categoria: null,
      subcategoria: null,
      proveedor: null,
      rutProveedor: null,
      medioPago: null,
      origenVenta: null,
      needsGemini: true
    };
  }

  // ── Función principal ─────────────────────────────────────────────────────────

  /**
   * Clasifica una transacción sin invocar Gemini.
   *
   * @param {string} emailOrigen  - Remitente del email (ej. billing@shopify.com)
   * @param {string} subject      - Asunto del email
   * @param {number} monto        - Monto numérico (opcional, para validaciones futuras)
   * @param {string} moneda       - Moneda: CLP, USD, etc.
   * @returns {Object}            - Resultado con todos los campos de clasificación
   *                                y needsGemini:bool para decidir si invocar Gemini
   */
  function classify(emailOrigen, subject, monto, moneda) {
    // 1. Buscar regla exacta por email
    var emailRule = findEmailRule(emailOrigen);

    // 2. Ruido: descartar inmediatamente, sin Gemini
    if (emailRule && emailRule.esRuido) {
      return buildResult('LOCAL_ENGINE', emailRule.confidence, emailRule);
    }

    // 3. Alta confianza por email: categorizar, sin Gemini
    if (emailRule && emailRule.confidence === 'ALTA') {
      return buildResult('LOCAL_ENGINE', 'ALTA', emailRule);
    }

    // 4. Buscar regla por asunto
    var subjectRule = findSubjectRule(subject);

    // 5. Alta confianza por asunto (ej. "Google Workspace" en el subject)
    if (subjectRule && subjectRule.confidence === 'ALTA') {
      var merged = {};
      // Email rule puede aportar proveedor/RUT aunque sea MEDIA
      if (emailRule) {
        merged.proveedor = subjectRule.proveedor || emailRule.proveedor;
        merged.rutProveedor = subjectRule.rutProveedor || emailRule.rutProveedor;
        merged.medioPago = emailRule.medioPago;
      }
      return buildResult('LOCAL_ENGINE', 'ALTA', subjectRule, merged);
    }

    // 6. Confianza media combinada: email MEDIA + asunto MEDIA → resultado con needsGemini:false
    if (emailRule && emailRule.confidence === 'MEDIA' && subjectRule && subjectRule.confidence === 'MEDIA') {
      return buildResult('LOCAL_ENGINE', 'MEDIA', emailRule, {
        tipoMovimiento: subjectRule.tipoMovimiento || emailRule.tipoMovimiento,
        categoria: subjectRule.categoria || emailRule.categoria,
        subcategoria: subjectRule.subcategoria || emailRule.subcategoria
      });
    }

    // 7. Solo email MEDIA: categorizar con advertencia, igual evitar Gemini
    if (emailRule && emailRule.confidence === 'MEDIA') {
      var result = buildResult('LOCAL_ENGINE', 'MEDIA', emailRule);
      result.needsGemini = false;
      return result;
    }

    // 8. Solo asunto con categoría útil
    if (subjectRule && subjectRule.categoria && subjectRule.confidence !== 'BAJA') {
      return buildResult('LOCAL_ENGINE', subjectRule.confidence, subjectRule);
    }

    // 9. Sin clasificación local → delegar a Gemini
    return geminiRequired();
  }

  /**
   * Versión para uso en ingesta: wrappea classify() con logging de auditoría.
   * Retorna los campos listos para mapear al Libro Mayor.
   */
  function classifyForIngestion(emailOrigen, subject, monto, moneda) {
    var result = classify(emailOrigen, subject, monto, moneda);

    var logPayload = JSON.stringify({
      emailOrigen: emailOrigen,
      subject: String(subject || '').substring(0, 80),
      confidence: result.confidence,
      esRuido: result.esRuido,
      needsGemini: result.needsGemini,
      categoria: result.categoria,
      subcategoria: result.subcategoria
    });

    if (result.esRuido || result.needsGemini) {
      // Notable: ruido descartado o Gemini requerido → sheet de auditoría
      AuditService.logInfo('LocalCategorizationEngine clasificacion', logPayload);
    } else {
      // Clasificación rutinaria LOCAL_ENGINE_ALTA/MEDIA → solo Logger, no crece el sheet
      Logger.log('[LOCAL_ENGINE] ' + logPayload);
    }

    return result;
  }

  /**
   * Estadísticas de la tabla de reglas (para auditoría y dashboards).
   */
  function getStats() {
    var highConfidence = EMAIL_RULES.filter(function (r) { return r.confidence === 'ALTA'; }).length;
    var noiseRules = EMAIL_RULES.filter(function (r) { return r.esRuido; }).length;
    return {
      totalEmailRules: EMAIL_RULES.length,
      totalSubjectRules: SUBJECT_RULES.length,
      highConfidenceRules: highConfidence,
      noiseRules: noiseRules,
      estimatedGeminiBypass: '~80%'
    };
  }

  // ── API pública ───────────────────────────────────────────────────────────────
  return {
    classify: classify,
    classifyForIngestion: classifyForIngestion,
    getStats: getStats
  };

})();

// ─── INSTRUCCIONES DE INTEGRACIÓN EN GmailIngestion ──────────────────────────
//
// En tu función de ingesta, ANTES de llamar a Gemini, añade:
//
//   var local = LocalCategorizationEngine.classifyForIngestion(
//     emailOrigen,   // string: remitente del email
//     subject,       // string: asunto
//     montoDetectado,// number: monto si ya lo tienes
//     moneda         // string: 'CLP' | 'USD'
//   );
//
//   if (local.esRuido) {
//     AuditService.logInfo('Email descartado por heuristica local', local.motivoDescarte);
//     return;  // no procesar este email
//   }
//
//   var datosFinales;
//   if (!local.needsGemini) {
//     // Usar clasificación local directamente
//     datosFinales = {
//       tipoMovimiento: local.tipoMovimiento,
//       categoria:      local.categoria,
//       subcategoria:   local.subcategoria,
//       proveedor:      local.proveedor,
//       rutProveedor:   local.rutProveedor,
//       medioPago:      local.medioPago,
//       origenVenta:    local.origenVenta,
//       procesadoPorAI: 'LOCAL_ENGINE_' + local.confidence
//     };
//   } else {
//     // Invocar Gemini solo cuando el motor local no puede clasificar
//     datosFinales = callGemini(emailBody);
//   }
//
// ─────────────────────────────────────────────────────────────────────────────
