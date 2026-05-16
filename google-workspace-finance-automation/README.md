# Sistema Financiero Automatizado - VittoStore (Google Workspace)

## Objetivo

- Capturar ingresos de Shopify y egresos de facturas desde Gmail usando Gemini, incluyendo emails del SII, municipalidades sobre patentes comerciales y bancos sobre compromisos financieros.
- Priorizar parseo deterministico de XML DTE chileno y usar IA solo como fallback.
- Registrar todo en Libro Mayor (Google Sheets) con control fuerte de duplicados.
- Convertir montos USD a CLP por dolar observado del dia de transaccion.
- Si falla la API cambiaria, usar ultimo TC disponible en cache y registrar alerta de degradacion.
- Ejecutar alertas SII/Chile (Previred mensual, F29 mensual, declaraciones anuales F22/F50/F21/F27, pagos anuales, patentes comerciales municipales, compromisos bancarios) y balance mensual automatizado.
- Aislar facturas extranjeras para control tributario F29.
- Generar Ordenes de Compra con folio correlativo, documento en Google Docs y correo de aprobacion al CEO.
- Enviar reporte semanal de rentabilidad por Origen de Venta para CEO/Marketing.
- Conciliar Libro Mayor vs Cartola_Banco semanalmente.

## Archivos principales

- Configuracion y propiedades: Config.gs
- Utilidades y hash: Utils.gs
- Validaciones: ValidationService.gs
- Auditoria: AuditService.gs
- Libro Mayor y duplicados: LedgerService.gs
- Integracion Gemini API: GeminiService.gs
- Parser XML DTE: DteXmlService.gs
- Tipo de cambio USD/CLP: FxService.gs
- Ingestion Gmail: GmailIngestion.gs
- Conciliacion bancaria: BankReconciliationService.gs
- Cumplimiento SII y balance mensual: ComplianceScheduler.gs
- Ordenes de Compra: PurchaseOrderService.gs
- Reporte semanal: ReportingService.gs
- Orquestador de despliegue: GoLiveService.gs
- Setup y triggers: Setup.gs

## Estructura de datos en Sheets

- Hoja Libro_Mayor
- Hoja Control_Duplicados
- Hoja Resumen_Mensual
- Hoja Solicitudes_OC
- Hoja Control_Folios
- Hoja Auditoria_Finanzas
- Hoja TipoCambio_USD
- Hoja Cartola_Banco

## Script Properties obligatorias

- FINANCE_SPREADSHEET_ID
- GEMINI_API_KEY
- CEO_EMAIL
- FINANCE_ALERT_EMAILS
- MARKETING_REPORT_EMAILS
- ALLOWED_BILLING_SENDERS
- SHOPIFY_ORDER_SENDERS
- ALLOWED_TAX_SENDERS
- ALLOWED_PATENTES_SENDERS
- ALLOWED_BANCARIOS_SENDERS
- SIGNATURE_BASE_URL

## Script Properties opcionales

- GEMINI_MODEL (default: gemini-1.5-pro)
- SHOPIFY_QUERY
- BILLING_QUERY

## Ejemplo rapido de propiedades

```env
CEO_EMAIL=livioponce@vittostore.store
FINANCE_ALERT_EMAILS=livioponce@vittostore.store,contabilidad@vittostore.store
MARKETING_REPORT_EMAILS=livioponce@vittostore.store,marketing@vittostore.store
SHOPIFY_ORDER_SENDERS=no-reply@shopify.com,shopify.com
ALLOWED_BILLING_SENDERS=google.com,openai.com,aws.amazon.com,docusign.net
ALLOWED_TAX_SENDERS=sii.cl
ALLOWED_PATENTES_SENDERS=gob.cl,municipalidad.cl
ALLOWED_BANCARIOS_SENDERS=banco.cl,santander.cl,bci.cl
SIGNATURE_BASE_URL=https://tu-plataforma-firma.com/aprobar
```

## Despliegue inmediato (hoy)

1. Crea un proyecto de Apps Script standalone.
2. Copia todos los archivos .gs y appsscript.json.
3. Configura Script Properties en Project Settings.
4. Ejecuta la funcion initializeFinanceAutomation una vez.
5. Autoriza permisos de Gmail, Sheets, Docs, Mail y UrlFetch.
6. Ejecuta runFinancialIngestion para prueba inicial.
7. Revisa Auditoria_Finanzas y Libro_Mayor.

## Go-Live automatico (recomendado)

1. Ejecuta runGoLivePreflight.
2. Si el preflight pasa, ejecuta runGoLiveSmokeSuite.
3. Ejecuta runGoLiveAutomation para consolidar reporte de salida.
4. Revisa el reporte y la hoja Auditoria_Finanzas.

Funciones disponibles:

- runGoLivePreflight
- runGoLiveSmokeSuite
- runGoLiveAutomation
- showPropertyTemplate

## Operacion diaria automatica

- runFinancialIngestion cada hora.
- runDailyFxRate cada dia (08:00).
- runDailyCompliance cada dia (avisa dia 7 y dia 17).
- runMonthlyBalance diario con guardia (solo ultimo dia del mes).
- runWeeklyCEOReport cada lunes.
- runWeeklyBankReconciliation cada lunes.

## Ruta de captura recomendada

- Paso 1: buscar XML DTE en adjuntos y extraer campos tributarios por parser deterministico.
- Paso 2: si no hay XML DTE valido, activar Gemini para extraccion fallback.
- Paso 3: validar registro y convertir USD a CLP por tipo de cambio observado de la fecha.
- Paso 3b: si la API no responde, aplicar fallback al ultimo TC disponible y dejar AlertaSistema.
- Paso 4: registrar en Libro Mayor con estado de conciliacion bancaria pendiente.

## Cobertura contable adicional (devoluciones, NC, importaciones y exportaciones)

Devoluciones y Notas de Credito:

- XML DTE Tipo 61 se clasifica automaticamente como EGRESO.
- Categoria objetivo: DEVOLUCIONES_Y_NC.
- Se mantiene monto positivo y la direccion contable se representa con TipoMovimiento=EGRESO.

Exportaciones:

- DTE tipos 110, 111 y 112 se clasifican como EXPORTACIONES.
- Regla de movimiento: 110/111 -> INGRESO y 112 -> EGRESO (ajuste/NC de exportacion).

Importaciones:

- Correos o documentos con contexto aduanero (aduana, FOB, CIF, importacion) se clasifican como IMPORTACIONES.
- Regla de movimiento por defecto: EGRESO.
- Desglose operativo esperado por subcategoria: ARANCEL_ADUANERO, IMPUESTOS_IMPORTACION y LOGISTICA_Y_RETIRO_PORTUARIO.

Arriendo de vehiculos y rendicion de gastos:

- Arriendo de vehiculos se clasifica como EGRESO en OPERACIONES_Y_LOGISTICA / ARRIENDO_VEHICULOS.
- Caja chica y rendiciones se clasifican como EGRESO en GASTOS_OPERACIONALES / CAJA_CHICA_Y_RENDICIONES.
- Se deja trazabilidad en Observaciones para revision contable y auditoria.

Consideraciones contables para importaciones y exportaciones:

- El arancel aduanero y costos de retiro portuario se registran como EGRESO y deben quedar trazables en Observaciones.
- Los impuestos de importacion deben quedar clasificados para facilitar control de cumplimiento y cierre mensual.
- En exportaciones, separar ventas y ajustes (NC exportacion) para no distorsionar margen comercial.

Trazabilidad:

- La clasificacion queda en Categoria/Subcategoria/Observaciones.
- El cierre mensual sigue consolidando por TipoMovimiento (INGRESO/EGRESO).

## Control de duplicados

- Se genera hash SHA-256 por documento (tipo, proveedor, RUT, numero, fecha, monto).
- Si hash ya existe en Control_Duplicados, no se vuelve a registrar.
- Todo evento queda auditado en Auditoria_Finanzas.

## Seguridad de datos

- Se procesan solo remitentes en allow-list.
- Se usan Script Properties para secretos (no hardcode).
- Se reduce logging sensible a eventos de auditoria controlados.
- Validaciones basicas de monto, tipo, moneda y RUT previo a guardado.
- Se etiqueta EsExtranjero=TRUE para invoices internacionales sin DTE y se separa en alerta F29.

## Escalabilidad para socios y gerencias

- Libro_Mayor incluye columnas SocioRut y GerenciaRol.
- Puedes agregar socios/roles sin tocar estructura base, solo alimentando datos en Gemini o reglas posteriores.

## Pruebas recomendadas de aceptacion

- Caso 1: correo Shopify valido -> crea INGRESO en Libro_Mayor.
- Caso 2: misma factura reenviada -> detecta duplicado.
- Caso 3: correo fuera de allow-list -> se bloquea y audita.
- Caso 4: dia 7 y dia 17 -> alerta enviada.
- Caso 5: ultimo dia del mes -> resumen mensual generado.
- Caso 6: cartola pegada en Cartola_Banco -> conciliacion y alertas de ingresos no identificados.
- Caso 7: fila Solicitudes_OC -> crea folio, Doc y correo al CEO.
