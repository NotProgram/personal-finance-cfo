/**
 * ==============================================================================
 * SISTEMA AUTOMATIZADO DE TRACKING FINANCIERO Y ASESORÍA IA
 * Stack: Apple Pay (iOS Wallet) + Nequi/Davivienda (Audios/Fotos) -> Google Apps Script -> Google Sheets + Telegram Bot + Gemini Multimodal (Con Fallback)
 * Contexto: Finanzas Personales Dinámicas (Colombia - COP)
 * ==============================================================================
 */

// ==========================================
// CONFIGURACIÓN GLOBAL Y CREDENCIALES
// ==========================================
const CONFIG = {
  // Credenciales (Gestionadas de forma segura en ScriptProperties)
  TELEGRAM_TOKEN: PropertiesService.getScriptProperties().getProperty("TELEGRAM_TOKEN") || "TU_TELEGRAM_BOT_TOKEN",
  TELEGRAM_CHAT_ID: PropertiesService.getScriptProperties().getProperty("TELEGRAM_CHAT_ID") || "TU_TELEGRAM_CHAT_ID",
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "TU_GEMINI_API_KEY",

  // Datos Laborales y Nómina
  EMPRESA: PropertiesService.getScriptProperties().getProperty("EMPRESA") || "Aviatur S.A.S.",
  SUELDO_BASICO: 3200000,
  QUINCENA_15_NETO: 1472000, // Día 15 de cada mes
  QUINCENA_30_NETO: 1721095, // Día 30 de cada mes (incluye auxilio transporte $249.095)
  DEFAULT_SALARIO: 3193095, // Neto mensual consolidado
  DEFAULT_PRESUPUESTO_VARIABLE: 638619, // 20.0% del salario neto mensual (Gastos diarios y ocio)
  DEFAULT_BOLSILLO_OBLIGACIONES: 863610, // 27.0% Fijos (Arriendo $600k, Nu $160k, Claro $44k, Gasolina $60k)
  DEFAULT_BOLSILLO_AHORRO: 1690866, // 53.0% Ahorro e Inversión Puro (Bolsillo Ahorro Davivienda)
  DEFAULT_SALDO_CUENTA: 0, // Saldo disponible real tras traslado de $500k a ahorro ($616.005 - $500.000)
  DEFAULT_SALDO_BOLSILLO_AHORRO: 0, // Saldo real en Bolsillo Ahorro tras traslado ($1.561.218 + $500.000)
  DEFAULT_SALDO_BOLSILLO_OBLIGACIONES: 0, // Saldo real en Bolsillo Obligaciones Davivienda
  DEFAULT_SALDO_TOTAL_BANCO: 0, // Saldo total consolidado Davivienda (Disponible + Bolsillos: $116.005 + $2.061.218 + $836.624)
  DEFAULT_DEUDA_TARJETA: 0,
  DEFAULT_DIA_PAGO_TARJETA: 11,
  DEFAULT_DIA_PAGO_ARRIENDO: 30,
  DEFAULT_VALOR_ARRIENDO: 600000,
  ZONA_HORARIA: "America/Bogota",
  WEB_APP_URL: PropertiesService.getScriptProperties().getProperty("WEB_APP_URL") || "https://script.google.com/macros/s/AKfycbxjz1Y8xXd5vv6D3PuNxw16LI3UQByPnb_m3pCoDw9FTacTz7QVTmHmtUXQCaWT8qQ1LA/exec?view=webapp",

  // Nombres de Hojas
  HOJA_TRANSACCIONES: "Transacciones",
  HOJA_GASTOS_FIJOS: "Gastos_Fijos",
  HOJA_CONFIGURACION: "Configuracion",
  HOJA_METAS: "Metas",
  HOJA_INVERSIONES: "Inversiones",

  // Mapa de Calor y Coordenadas por defecto (Bogotá)
  DEFAULT_MAPA_LAT: 4.6097,
  DEFAULT_MAPA_LNG: -74.0817,
  DEFAULT_MAPA_ZOOM: 12
};

// Auto-guardado en ScriptProperties para persistencia permanente (solo si no son placeholders)
(function asegurarScriptProperties() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (CONFIG.TELEGRAM_TOKEN && !CONFIG.TELEGRAM_TOKEN.startsWith("TU_") && !props.getProperty("TELEGRAM_TOKEN")) {
      props.setProperty("TELEGRAM_TOKEN", CONFIG.TELEGRAM_TOKEN);
    }
    if (CONFIG.TELEGRAM_CHAT_ID && !CONFIG.TELEGRAM_CHAT_ID.startsWith("TU_") && !props.getProperty("TELEGRAM_CHAT_ID")) {
      props.setProperty("TELEGRAM_CHAT_ID", CONFIG.TELEGRAM_CHAT_ID);
    }
    if (CONFIG.GEMINI_API_KEY && !CONFIG.GEMINI_API_KEY.startsWith("TU_") && !props.getProperty("GEMINI_API_KEY")) {
      props.setProperty("GEMINI_API_KEY", CONFIG.GEMINI_API_KEY);
    }
    if (CONFIG.WEB_APP_URL && !CONFIG.WEB_APP_URL.startsWith("TU_") && !props.getProperty("WEB_APP_URL")) {
      props.setProperty("WEB_APP_URL", CONFIG.WEB_APP_URL);
    }
    if (CONFIG.EMPRESA && !props.getProperty("EMPRESA")) {
      props.setProperty("EMPRESA", CONFIG.EMPRESA);
    }
  } catch (e) {}
})();

// ==========================================
// FUNCIÓN PARA AUTORIZAR PERMISOS OAUTH EN GOOGLE
// ==========================================
function autorizarPermisos() {
  UrlFetchApp.fetch("https://api.telegram.org");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("✅ Permisos de Internet (UrlFetchApp) y Google Sheets autorizados correctamente.");
}

// ==========================================
// TELEGRAM MINI APP: WEB APP DASHBOARD FINANCIERO 📱
// ==========================================
function servirWebAppDashboard(conf) {
  conf = conf || obtenerConfiguracionActual();
  var resumen = obtenerResumenMesActual();
  var html = generarHtmlDashboard(conf, resumen);
  return HtmlService.createHtmlOutput(html)
    .setTitle("Mi Dashboard Financiero")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function generarHtmlDashboard(conf, resumen) {
  var saldoTotal = conf.saldoTotalBanco || 0;
  var saldoDisp = conf.saldoCuenta || 0;
  var saldoAh = conf.saldoBolsilloAhorro || 0;
  var saldoOb = conf.saldoBolsilloObligaciones || 0;
  var deudaNu = conf.deudaTarjetaNu || 0;
  var proxNu = conf.proximaFechaPagoTarjeta || "11 de cada mes";

  var flujo = conf.flujoQuincenal || {};
  var proxNominaTexto = flujo.fechaProximaNominaTexto || "Día 15 / 30";
  var diasParaNomina = flujo.diasParaProximaNomina || 1;
  var cupoDiario = flujo.cupoDiarioSugeridoQuincena || 21190;

  var pctAh = conf.pctAhorroReal || ((saldoAh / (saldoTotal || 1)) * 100).toFixed(1);
  var pctOb = conf.pctObligacionesReal || ((saldoOb / (saldoTotal || 1)) * 100).toFixed(1);
  var pctDi = conf.pctDisponibleReal || ((saldoDisp / (saldoTotal || 1)) * 100).toFixed(1);

  return '<!DOCTYPE html>\n' +
    '<html lang="es">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
    '  <title>Dashboard Financiero Personal</title>\n' +
    '  <script src="https://telegram.org/js/telegram-web-app.js"></script>\n' +
    '  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n' +
    '  <style>\n' +
    '    :root {\n' +
    '      --bg: #090d16;\n' +
    '      --card-bg: #111827;\n' +
    '      --card-border: #1f2937;\n' +
    '      --text: #f9fafb;\n' +
    '      --muted: #9ca3af;\n' +
    '      --purple: #8b5cf6;\n' +
    '      --blue: #38bdf8;\n' +
    '      --green: #22c55e;\n' +
    '      --red: #f43f5e;\n' +
    '      --accent: #6366f1;\n' +
    '    }\n' +
    '    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }\n' +
    '    body { background: var(--bg); color: var(--text); padding: 14px; padding-bottom: 28px; -webkit-font-smoothing: antialiased; }\n' +
    '    .header { text-align: center; margin-bottom: 16px; }\n' +
    '    .header h1 { font-size: 19px; font-weight: 700; color: #fff; }\n' +
    '    .badge { display: inline-block; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; font-size: 11px; padding: 3px 10px; border-radius: 12px; margin-top: 4px; font-weight: 600; }\n' +
    '    .hero-card { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); border: 1px solid rgba(165, 180, 252, 0.25); border-radius: 16px; padding: 18px; text-align: center; margin-bottom: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }\n' +
    '    .hero-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #c7d2fe; font-weight: 600; }\n' +
    '    .hero-amount { font-size: 30px; font-weight: 800; color: #fff; margin: 4px 0; }\n' +
    '    .hero-sub { font-size: 12px; color: #a5b4fc; }\n' +
    '    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }\n' +
    '    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 12px; }\n' +
    '    .card.full { grid-column: span 2; }\n' +
    '    .card-label { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px; }\n' +
    '    .card-val { font-size: 17px; font-weight: 700; color: #fff; margin-top: 4px; }\n' +
    '    .card-pct { font-size: 11px; font-weight: 600; margin-top: 2px; }\n' +
    '    .purple { color: var(--purple); }\n' +
    '    .blue { color: var(--blue); }\n' +
    '    .green { color: var(--green); }\n' +
    '    .red { color: var(--red); }\n' +
    '    .chart-box { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 14px; margin-bottom: 14px; }\n' +
    '    .chart-title { font-size: 13px; font-weight: 700; color: #e5e7eb; margin-bottom: 10px; display: flex; justify-content: space-between; }\n' +
    '    .canvas-wrap { position: relative; height: 180px; width: 100%; }\n' +
    '    .fijo-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; }\n' +
    '    .fijo-row:last-child { border-bottom: none; }\n' +
    '    .fijo-nom { color: #d1d5db; }\n' +
    '    .fijo-val { font-weight: 700; color: #fff; text-align: right; }\n' +
    '    .fijo-tag { font-size: 10px; color: var(--muted); }\n' +
    '    .sim-box { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 14px; margin-bottom: 14px; }\n' +
    '    .slider { width: 100%; -webkit-appearance: none; height: 6px; border-radius: 3px; background: #374151; outline: none; margin: 12px 0 6px; }\n' +
    '    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); cursor: pointer; box-shadow: 0 0 10px rgba(99,102,241,0.5); }\n' +
    '    .tabs { display: flex; gap: 6px; margin: 10px 0; }\n' +
    '    .tab { flex: 1; padding: 7px; text-align: center; border-radius: 8px; background: #1f2937; color: var(--muted); font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }\n' +
    '    .tab.active { background: var(--accent); color: #fff; }\n' +
    '    .sim-res { background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 10px; padding: 10px; font-size: 12px; line-height: 1.5; }\n' +
    '    .btn-close { width: 100%; background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 12px; border-radius: 12px; font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 8px; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <div class="header">\n' +
    '    <h1>🏦 Finanzas Personales</h1>\n' +
    '    <span class="badge">CFO Privado • Guardián Patrimonial</span>\n' +
    '  </div>\n' +
    '  <div class="hero-card">\n' +
    '    <div class="hero-title">Patrimonio Total Davivienda</div>\n' +
    '    <div class="hero-amount">$' + formatearCOP(saldoTotal) + '</div>\n' +
    '    <div class="hero-sub">Ingreso Neto: $' + formatearCOP(conf.salario) + ' COP / mes</div>\n' +
    '  </div>\n' +
    '  <div class="grid">\n' +
    '    <div class="card">\n' +
    '      <div class="card-label purple">💎 Ahorro Puro</div>\n' +
    '      <div class="card-val">$' + formatearCOP(saldoAh) + '</div>\n' +
    '      <div class="card-pct purple">' + pctAh + '% actual (53% meta)</div>\n' +
    '    </div>\n' +
    '    <div class="card">\n' +
    '      <div class="card-label blue">🛡️ Obligaciones</div>\n' +
    '      <div class="card-val">$' + formatearCOP(saldoOb) + '</div>\n' +
    '      <div class="card-pct blue">' + pctOb + '% actual (27% meta)</div>\n' +
    '    </div>\n' +
    '    <div class="card">\n' +
    '      <div class="card-label green">🛒 Disponible Ocio</div>\n' +
    '      <div class="card-val">$' + formatearCOP(saldoDisp) + '</div>\n' +
    '      <div class="card-pct green">' + pctDi + '% actual (20% meta)</div>\n' +
    '    </div>\n' +
    '    <div class="card">\n' +
    '      <div class="card-label red">🟣 Tarjeta Nu</div>\n' +
    '      <div class="card-val">$' + formatearCOP(deudaNu) + '</div>\n' +
    '      <div class="card-pct red">Vence los ' + proxNu + '</div>\n' +
    '    </div>\n' +
    '    <div class="card full">\n' +
    '      <div class="card-label">🏢 Flujo Quincenal de Nómina</div>\n' +
    '      <div class="card-val">~$' + formatearCOP(cupoDiario) + ' COP / día</div>\n' +
    '      <div class="card-pct" style="color:#a5b4fc">Próxima nómina en ' + diasParaNomina + ' días (' + proxNominaTexto + ')</div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '  <div class="chart-box">\n' +
    '    <div class="chart-title"><span>Distribución de Bolsillos</span><span style="color:#a5b4fc">100%</span></div>\n' +
    '    <div class="canvas-wrap">\n' +
    '      <canvas id="donutChart"></canvas>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '  <div class="sim-box">\n' +
    '    <div class="chart-title"><span>🧮 Simulador de CDT Digital</span><span id="txtPlazo">90 días</span></div>\n' +
    '    <div style="display:flex; justify-content:space-between; font-size:12px; color:#c7d2fe;">\n' +
    '      <span>Monto:</span>\n' +
    '      <b id="txtMonto">$100.000 COP</b>\n' +
    '    </div>\n' +
    '    <input type="range" class="slider" id="sliderMonto" min="50000" max="1000000" step="50000" value="100000">\n' +
    '    <div class="tabs">\n' +
    '      <div class="tab active" onclick="cambiarPlazo(90, 10.5, this)">90 días (10.5%)</div>\n' +
    '      <div class="tab" onclick="cambiarPlazo(180, 10.5, this)">180 días (10.5%)</div>\n' +
    '      <div class="tab" onclick="cambiarPlazo(360, 11.3, this)">360 días (11.3%)</div>\n' +
    '    </div>\n' +
    '    <div class="sim-res" id="resSim"></div>\n' +
    '  </div>\n' +
    '  <div class="card full" style="margin-bottom:14px;">\n' +
    '    <div class="card-label" style="margin-bottom:6px;">📋 Compromisos Fijos Mensuales</div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Arriendo</span><div><div class="fijo-val">$600.000</div><div class="fijo-tag">Día 30 • Obligaciones</div></div></div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Tarjeta Nu (Suscripciones)</span><div><div class="fijo-val">$' + formatearCOP(deudaNu) + '</div><div class="fijo-tag">Día 11 • 1 cuota 0%</div></div></div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Gimnasio SmartFit</span><div><div class="fijo-val">$92.600</div><div class="fijo-tag">Día 11 • En Tarjeta Nu</div></div></div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Claude Code</span><div><div class="fijo-val">~$63.110</div><div class="fijo-tag">Día 06 • En Tarjeta Nu</div></div></div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Plan Celular Claro</span><div><div class="fijo-val">$44.000</div><div class="fijo-tag">Día 14 • Débito/PSE</div></div></div>\n' +
    '    <div class="fijo-row"><span class="fijo-nom">Gasolina Moto</span><div><div class="fijo-val">$60.000</div><div class="fijo-tag">Día 15 • Efectivo</div></div></div>\n' +
    '  </div>\n' +
    '  <a href="' + getUrlWebAppConParametros("view=mapa") + '" style="display:flex; align-items:center; justify-content:center; gap:8px; background:linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%); color:#fff; text-decoration:none; padding:12px; border-radius:12px; font-size:13px; font-weight:700; border:1px solid rgba(165,180,252,0.3); margin-bottom:10px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">🗺️ Ver Mapa de Calor de Gastos (GPS)</a>\n' +
    '  <button class="btn-close" onclick="cerrar()">✕ Cerrar Dashboard</button>\n' +
    '  <script>\n' +
    '    if (window.Telegram && window.Telegram.WebApp) {\n' +
    '      Telegram.WebApp.ready();\n' +
    '      Telegram.WebApp.expand();\n' +
    '    }\n' +
    '    function cerrar() {\n' +
    '      if (window.Telegram && window.Telegram.WebApp) {\n' +
    '        Telegram.WebApp.close();\n' +
    '      } else {\n' +
    '        window.close();\n' +
    '      }\n' +
    '    }\n' +
    '    var ctx = document.getElementById("donutChart").getContext("2d");\n' +
    '    new Chart(ctx, {\n' +
    '      type: "doughnut",\n' +
    '      data: {\n' +
    '        labels: ["Ahorro (' + pctAh + '%)", "Obligaciones (' + pctOb + '%)", "Disponible (' + pctDi + '%)"],\n' +
    '        datasets: [{\n' +
    '          data: [' + saldoAh + ', ' + saldoOb + ', ' + saldoDisp + '],\n' +
    '          backgroundColor: ["#8b5cf6", "#38bdf8", "#22c55e"],\n' +
    '          borderColor: "#111827",\n' +
    '          borderWidth: 3\n' +
    '        }]\n' +
    '      },\n' +
    '      options: {\n' +
    '        responsive: true,\n' +
    '        maintainAspectRatio: false,\n' +
    '        plugins: {\n' +
    '          legend: { position: "bottom", labels: { color: "#d1d5db", font: { size: 11 }, padding: 12 } }\n' +
    '        }\n' +
    '      }\n' +
    '    });\n' +
    '    var plazoActual = 90;\n' +
    '    var tasaActual = 10.5;\n' +
    '    function fmtCOP(n) { return Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, "."); }\n' +
    '    function actualizarSim() {\n' +
    '      var m = parseFloat(document.getElementById("sliderMonto").value);\n' +
    '      document.getElementById("txtMonto").innerText = "$" + fmtCOP(m) + " COP";\n' +
    '      var tasaEfectivaPeriodo = Math.pow(1 + (tasaActual / 100), plazoActual / 365) - 1;\n' +
    '      var bruto = m * tasaEfectivaPeriodo;\n' +
    '      var retencion = bruto * 0.04;\n' +
    '      var neto = bruto - retencion;\n' +
    '      var total = m + neto;\n' +
    '      document.getElementById("resSim").innerHTML = "💰 <b>Rendimiento Neto:</b> +$" + fmtCOP(neto) + " COP<br>💵 <b>Recibes al vencer:</b> $" + fmtCOP(total) + " COP (4% retención deducida).";\n' +
    '    }\n' +
    '    function cambiarPlazo(p, t, el) {\n' +
    '      plazoActual = p;\n' +
    '      tasaActual = t;\n' +
    '      document.querySelectorAll(".tab").forEach(function(tb){ tb.classList.remove("active"); });\n' +
    '      el.classList.add("active");\n' +
    '      document.getElementById("txtPlazo").innerText = p + " días (" + t + "% E.A.)";\n' +
    '      actualizarSim();\n' +
    '    }\n' +
    '    document.getElementById("sliderMonto").addEventListener("input", actualizarSim);\n' +
    '    actualizarSim();\n' +
    '  </script>\n' +
    '</body>\n' +
    '</html>';
}

// ==========================================
// TELEGRAM MINI APP: MAPA DE CALOR DE GASTOS 🗺️
// ==========================================
function servirWebAppMapaCalor(conf) {
  conf = conf || obtenerConfiguracionActual();
  var datosMapa = obtenerPuntosMapaCalor();
  var html = generarHtmlMapaCalor(conf, datosMapa);
  return HtmlService.createHtmlOutput(html)
    .setTitle("Mapa de Calor de Gastos")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function generarHtmlMapaCalor(conf, datosMapa) {
  conf = conf || obtenerConfiguracionActual();
  datosMapa = datosMapa || obtenerPuntosMapaCalor();

  var totalFmt = datosMapa.totalGastadoFmt || "$0 COP";
  var conteo = datosMapa.conteo || 0;
  var topLugar = (datosMapa.epicentros && datosMapa.epicentros.length > 0) ? datosMapa.epicentros[0].lugar : "Sin registros GPS";
  var topLugarTotal = (datosMapa.epicentros && datosMapa.epicentros.length > 0) ? ("$" + formatearCOP(datosMapa.epicentros[0].total) + " COP") : "$0";

  var puntosJson = JSON.stringify(datosMapa.puntos || []);
  var defLat = CONFIG.DEFAULT_MAPA_LAT || 4.6097;
  var defLng = CONFIG.DEFAULT_MAPA_LNG || -74.0817;
  var defZoom = CONFIG.DEFAULT_MAPA_ZOOM || 12;

  var epicentrosHtml = "";
  if (datosMapa.epicentros && datosMapa.epicentros.length > 0) {
    for (var i = 0; i < datosMapa.epicentros.length; i++) {
      var item = datosMapa.epicentros[i];
      var medalla = (i === 0) ? "🥇" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : "📍"));
      var pct = Math.round((item.total / (datosMapa.totalGastado || 1)) * 100);
      epicentrosHtml += '<div class="epicentro-row">\n' +
        '  <div class="epicentro-info">\n' +
        '    <span class="epicentro-badge">' + medalla + '</span>\n' +
        '    <div class="epicentro-txt">\n' +
        '      <div class="epicentro-nom">' + item.lugar + '</div>\n' +
        '      <div class="epicentro-sub">' + item.transacciones + ' transacciones • ' + pct + '% del gasto geolocalizado</div>\n' +
        '    </div>\n' +
        '  </div>\n' +
        '  <div class="epicentro-val">$' + formatearCOP(item.total) + ' COP</div>\n' +
        '</div>\n';
    }
  } else {
    epicentrosHtml = '<div style="text-align:center; padding:18px 10px; color:#9ca3af; font-size:12px;">\n' +
      '  <div style="font-size:26px; margin-bottom:6px;">📍</div>\n' +
      '  Aún no tienes gastos con coordenadas GPS registradas.<br>\n' +
      '  Al pagar con <b>Apple Pay</b> en tu iPhone o enviar tu <b>ubicación</b> en Telegram, aparecerán aquí automáticamente.\n' +
      '</div>\n';
  }

  return '<!DOCTYPE html>\n' +
    '<html lang="es">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
    '  <title>Mapa de Calor de Gastos</title>\n' +
    '  <script src="https://telegram.org/js/telegram-web-app.js"></script>\n' +
    '  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />\n' +
    '  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>\n' +
    '  <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>\n' +
    '  <style>\n' +
    '    :root {\n' +
    '      --bg: #090d16;\n' +
    '      --card-bg: #111827;\n' +
    '      --card-border: #1f2937;\n' +
    '      --text: #f9fafb;\n' +
    '      --muted: #9ca3af;\n' +
    '      --accent: #6366f1;\n' +
    '      --green: #22c55e;\n' +
    '      --red: #ef4444;\n' +
    '    }\n' +
    '    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }\n' +
    '    body { background: var(--bg); color: var(--text); padding: 14px; padding-bottom: 30px; -webkit-font-smoothing: antialiased; }\n' +
    '    .header { text-align: center; margin-bottom: 14px; }\n' +
    '    .header h1 { font-size: 19px; font-weight: 700; color: #fff; }\n' +
    '    .badge { display: inline-block; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; font-size: 11px; padding: 3px 10px; border-radius: 12px; margin-top: 4px; font-weight: 600; }\n' +
    '    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }\n' +
    '    .kpi-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 12px; }\n' +
    '    .kpi-card.full { grid-column: span 2; background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); border-color: rgba(165, 180, 252, 0.25); }\n' +
    '    .kpi-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }\n' +
    '    .kpi-val { font-size: 20px; font-weight: 800; color: #fff; margin-top: 3px; }\n' +
    '    .kpi-sub { font-size: 11px; color: #a5b4fc; margin-top: 2px; }\n' +
    '    #map { width: 100%; height: 380px; border-radius: 16px; border: 1px solid var(--card-border); margin-bottom: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); z-index: 1; }\n' +
    '    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 14px; margin-bottom: 12px; }\n' +
    '    .card-title { font-size: 13px; font-weight: 700; color: #e5e7eb; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }\n' +
    '    .epicentro-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px; }\n' +
    '    .epicentro-row:last-child { border-bottom: none; }\n' +
    '    .epicentro-info { display: flex; align-items: center; gap: 8px; }\n' +
    '    .epicentro-badge { font-size: 16px; }\n' +
    '    .epicentro-nom { font-weight: 600; color: #f3f4f6; }\n' +
    '    .epicentro-sub { font-size: 10px; color: var(--muted); }\n' +
    '    .epicentro-val { font-weight: 700; color: #38bdf8; text-align: right; font-size: 12px; }\n' +
    '    .nav-actions { display: flex; gap: 8px; margin-top: 10px; }\n' +
    '    .btn-nav { flex: 1; background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 11px; border-radius: 12px; font-size: 12px; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }\n' +
    '    .btn-nav.primary { background: var(--accent); color: #fff; border-color: var(--accent); }\n' +
    '    .leaflet-popup-content-wrapper { background: #111827 !important; color: #f9fafb !important; border: 1px solid #374151 !important; border-radius: 12px !important; box-shadow: 0 10px 25px rgba(0,0,0,0.6) !important; }\n' +
    '    .leaflet-popup-tip { background: #111827 !important; }\n' +
    '    .leaflet-container { background: #090d16 !important; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <div class="header">\n' +
    '    <h1>🗺️ Mapa de Calor de Gastos</h1>\n' +
    '    <span class="badge">CFO Privado • Epicentros de Consumo</span>\n' +
    '  </div>\n' +
    '  <div class="kpi-grid">\n' +
    '    <div class="kpi-card full">\n' +
    '      <div class="kpi-title" style="color:#c7d2fe;">Gasto Total Geolocalizado</div>\n' +
    '      <div class="kpi-val">' + totalFmt + '</div>\n' +
    '      <div class="kpi-sub">' + conteo + ' transacciones mapeadas en tiempo real</div>\n' +
    '    </div>\n' +
    '    <div class="kpi-card">\n' +
    '      <div class="kpi-title">📍 Compras GPS</div>\n' +
    '      <div class="kpi-val" style="font-size:18px;">' + conteo + '</div>\n' +
    '      <div class="kpi-sub">Apple Pay y Telegram</div>\n' +
    '    </div>\n' +
    '    <div class="kpi-card">\n' +
    '      <div class="kpi-title">🥇 Epicentro #1</div>\n' +
    '      <div class="kpi-val" style="font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + topLugar + '">' + topLugar + '</div>\n' +
    '      <div class="kpi-sub">' + topLugarTotal + '</div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '  <div id="map"></div>\n' +
    '  <div class="card">\n' +
    '    <div class="card-title"><span>🔥 Epicentros de Mayor Fuga de Dinero</span></div>\n' +
    epicentrosHtml +
    '  </div>\n' +
    '  <div class="nav-actions">\n' +
    '    <a href="' + getUrlWebAppConParametros("view=webapp") + '" class="btn-nav primary">📊 Ir al Dashboard</a>\n' +
    '    <button class="btn-nav" onclick="cerrar()">✕ Cerrar</button>\n' +
    '  </div>\n' +
    '  <script>\n' +
    '    if (window.Telegram && window.Telegram.WebApp) {\n' +
    '      Telegram.WebApp.ready();\n' +
    '      Telegram.WebApp.expand();\n' +
    '    }\n' +
    '    function cerrar() {\n' +
    '      if (window.Telegram && window.Telegram.WebApp) {\n' +
    '        Telegram.WebApp.close();\n' +
    '      } else {\n' +
    '        window.close();\n' +
    '      }\n' +
    '    }\n' +
    '    var puntos = ' + puntosJson + ';\n' +
    '    var map = L.map("map", { zoomControl: true });\n' +
    '    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {\n' +
    '      attribution: "&copy; OpenStreetMap &copy; CARTO",\n' +
    '      maxZoom: 19\n' +
    '    }).addTo(map);\n' +
    '    if (puntos && puntos.length > 0) {\n' +
    '      var heatPoints = puntos.map(function(p) { return [p.lat, p.lng, p.peso || 0.5]; });\n' +
    '      L.heatLayer(heatPoints, {\n' +
    '        radius: 28,\n' +
    '        blur: 18,\n' +
    '        maxZoom: 16,\n' +
    '        minOpacity: 0.35,\n' +
    '        gradient: { 0.2: "#38bdf8", 0.4: "#22c55e", 0.6: "#eab308", 0.8: "#f97316", 1.0: "#ef4444" }\n' +
    '      }).addTo(map);\n' +
    '      puntos.forEach(function(p) {\n' +
    '        var marker = L.circleMarker([p.lat, p.lng], {\n' +
    '          radius: 7,\n' +
    '          fillColor: "#8b5cf6",\n' +
    '          color: "#ffffff",\n' +
    '          weight: 1.5,\n' +
    '          opacity: 0.9,\n' +
    '          fillOpacity: 0.85\n' +
    '        }).addTo(map);\n' +
    '        var popupHtml = "<div style=\\"min-width:180px; padding:2px; font-family:sans-serif;\\">" +\n' +
    '          "<div style=\\"font-weight:700; font-size:13px; color:#fff; margin-bottom:3px;\\">🏪 " + p.comercio + "</div>" +\n' +
    '          "<div style=\\"font-size:16px; font-weight:800; color:#22c55e; margin-bottom:4px;\\">" + p.montoFmt + "</div>" +\n' +
    '          "<div style=\\"color:#9ca3af; font-size:11px;\\">📅 " + p.fecha + "</div>" +\n' +
    '          "<div style=\\"color:#a5b4fc; font-size:11px;\\">🏷️ " + p.categoria + " • 💳 " + p.tarjeta + "</div>" +\n' +
    '          (p.ubicacion ? "<div style=\\"color:#cbd5e1; font-size:10px; margin-top:4px; padding-top:3px; border-top:1px solid #374151;\\">📍 " + p.ubicacion + "</div>" : "") +\n' +
    '          "</div>";\n' +
    '        marker.bindPopup(popupHtml);\n' +
    '      });\n' +
    '      if (puntos.length === 1) {\n' +
    '        map.setView([puntos[0].lat, puntos[0].lng], 15);\n' +
    '      } else {\n' +
    '        var bounds = L.latLngBounds(puntos.map(function(p) { return [p.lat, p.lng]; }));\n' +
    '        map.fitBounds(bounds.pad(0.25));\n' +
    '      }\n' +
    '    } else {\n' +
    '      map.setView([' + defLat + ', ' + defLng + '], ' + defZoom + ');\n' +
    '    }\n' +
    '  </script>\n' +
    '</body>\n' +
    '</html>';
}

// ==========================================
// CONSULTA DE PUNTOS GEOLOCALIZADOS PARA HEATMAP
// ==========================================
function obtenerPuntosMapaCalor() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { puntos: [], totalGastado: 0, totalGastadoFmt: "$0 COP", conteo: 0, epicentros: [] };
  }

  var rows = sheet.getDataRange().getValues();
  var headers = rows[0] || [];
  var tieneColTipo = headers.length > 1 && headers[1].toString().trim().toLowerCase() === "tipo";

  var puntos = [];
  var totalGastado = 0;
  var conteo = 0;
  var porLugar = {};
  var maxMonto = 1;

  for (var i = 1; i < rows.length; i++) {
    var fila = rows[i];
    var fechaStr = fila[0];
    var tipoStr = tieneColTipo ? (fila[1] || "").toString().toLowerCase() : "";
    var comercio = tieneColTipo ? (fila[2] || "Comercio").toString() : (fila[1] || "Comercio").toString();
    var monto = tieneColTipo ? (parseFloat(fila[3]) || 0) : (parseFloat(fila[2]) || 0);
    var tarjeta = tieneColTipo ? (fila[4] || "Apple Pay").toString() : (fila[3] || "Apple Pay").toString();
    var categoria = tieneColTipo ? (fila[5] || "General").toString() : (fila[4] || "General").toString();

    var lat = parseFloat(fila[8]);
    var lng = parseFloat(fila[9]);
    var ubicacion = (fila[10] || "").toString().trim();

    var esGasto = tipoStr.indexOf("gasto") !== -1 || tipoStr === "";

    if (esGasto && !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && monto > 0) {
      if (monto > maxMonto) maxMonto = monto;
      totalGastado += monto;
      conteo++;

      var claveLugar = ubicacion || comercio || "Zona de gasto";
      if (!porLugar[claveLugar]) {
        porLugar[claveLugar] = { lugar: claveLugar, total: 0, transacciones: 0, lat: lat, lng: lng };
      }
      porLugar[claveLugar].total += monto;
      porLugar[claveLugar].transacciones++;

      var fFormateada = "";
      try {
        var d = new Date(fechaStr);
        if (!isNaN(d.getTime())) {
          fFormateada = Utilities.formatDate(d, CONFIG.ZONA_HORARIA, "dd/MM/yyyy HH:mm");
        } else {
          fFormateada = fechaStr.toString();
        }
      } catch (eF) {
        fFormateada = fechaStr.toString();
      }

      puntos.push({
        lat: lat,
        lng: lng,
        monto: monto,
        montoFmt: "$" + formatearCOP(monto) + " COP",
        comercio: comercio,
        tarjeta: tarjeta,
        categoria: categoria,
        ubicacion: ubicacion,
        fecha: fFormateada
      });
    }
  }

  for (var p = 0; p < puntos.length; p++) {
    puntos[p].peso = Math.min(Math.max((puntos[p].monto / maxMonto), 0.25), 1.0);
  }

  var epicentrosArr = [];
  for (var k in porLugar) {
    epicentrosArr.push(porLugar[k]);
  }
  epicentrosArr.sort(function(a, b) { return b.total - a.total; });

  return {
    puntos: puntos,
    totalGastado: totalGastado,
    totalGastadoFmt: "$" + formatearCOP(totalGastado) + " COP",
    conteo: conteo,
    epicentros: epicentrosArr.slice(0, 5)
  };
}

// ==========================================
// SEGURIDAD Y AUTENTICACIÓN DE MINIAPPS WEB
// ==========================================
function obtenerAuthToken() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("AUTH_TOKEN");
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, "").substring(0, 24);
    props.setProperty("AUTH_TOKEN", token);
  }
  return token;
}

function validarAccesoWeb(e) {
  var tokenEsperado = obtenerAuthToken();
  if (!tokenEsperado) return true; // Si no hay token configurado, no bloquear

  if (!e || !e.parameter) return false;

  var tokenRecibido = e.parameter.auth || e.parameter.token || e.parameter.key || "";
  return tokenRecibido === tokenEsperado;
}

function servirPantallaAccesoRestringido() {
  var html = '<!DOCTYPE html>\n' +
    '<html lang="es">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
    '  <title>Acceso Restringido - Personal Finance CFO</title>\n' +
    '  <style>\n' +
    '    * { margin:0; padding:0; box-sizing:border-box; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }\n' +
    '    body { background:#0a0e17; color:#f3f4f6; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }\n' +
    '    .card { background:#111827; border:1px solid #1f2937; border-radius:20px; padding:36px 24px; max-width:400px; width:100%; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.6); }\n' +
    '    .icon-box { width:64px; height:64px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); border-radius:18px; display:flex; align-items:center; justify-content:center; font-size:30px; margin:0 auto 20px auto; }\n' +
    '    h1 { font-size:20px; font-weight:800; margin-bottom:12px; color:#f87171; letter-spacing:-0.3px; }\n' +
    '    p { font-size:13px; color:#9ca3af; line-height:1.6; margin-bottom:24px; }\n' +
    '    .footer { font-size:11px; color:#6b7280; border-top:1px solid #1f2937; padding-top:16px; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <div class="card">\n' +
    '    <div class="icon-box">🔒</div>\n' +
    '    <h1>Acceso Restringido</h1>\n' +
    '    <p>Este CFO y sus MiniApps son de uso personal privado.<br><br>Para acceder al <b>Dashboard Financiero</b> o al <b>Mapa de Calor</b>, utiliza los accesos directos autorizados desde tu chat de Telegram.</p>\n' +
    '    <div class="footer">Personal Finance CFO • Sistema Protegido</div>\n' +
    '  </div>\n' +
    '</body>\n' +
    '</html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle("Acceso Restringido")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

// ==========================================
// UTILIDADES DE UBICACIÓN, MONEDA Y RUTAS
// ==========================================
function getUrlWebAppConParametros(params) {
  var baseUrl = "";
  try {
    if (typeof ScriptApp !== "undefined" && ScriptApp.getService && ScriptApp.getService().getUrl()) {
      baseUrl = ScriptApp.getService().getUrl();
    }
  } catch (e) {}
  if (!baseUrl || baseUrl.indexOf("TU_DEPLOYMENT_ID") !== -1) {
    baseUrl = (CONFIG.WEB_APP_URL && CONFIG.WEB_APP_URL.indexOf("TU_DEPLOYMENT_ID") === -1) 
      ? CONFIG.WEB_APP_URL.split("?")[0] 
      : "https://script.google.com/macros/s/AKfycbxjz1Y8xXd5vv6D3PuNxw16LI3UQByPnb_m3pCoDw9FTacTz7QVTmHmtUXQCaWT8qQ1LA/exec";
  }
  var authToken = obtenerAuthToken();
  var authParam = "auth=" + encodeURIComponent(authToken);
  var finalParams = params ? (params + "&" + authParam) : authParam;
  return baseUrl + (baseUrl.indexOf("?") !== -1 ? "&" : "?") + finalParams;
}

function sanitizarImporteCOP(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return Math.round(valor);

  var str = valor.toString().trim();
  str = str.replace(/[$A-Za-z\s]/g, "");
  if (!str) return 0;

  if (str.indexOf(".") !== -1 && str.indexOf(",") !== -1) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      str = str.split(",")[0].replace(/\./g, "");
    } else {
      str = str.split(".")[0].replace(/,/g, "");
    }
  } else if (str.indexOf(",") !== -1) {
    var partesC = str.split(",");
    if (partesC.length === 2 && partesC[1].length === 2) {
      str = partesC[0];
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (str.indexOf(".") !== -1) {
    var partesP = str.split(".");
    if (partesP.length === 2 && partesP[1].length === 2) {
      str = partesP[0];
    } else {
      str = str.replace(/\./g, "");
    }
  }

  var num = parseFloat(str.replace(/[^0-9]/g, "")) || 0;
  return Math.round(num);
}

function procesarUbicacionTransaccion(latVal, lngVal, ubiNombre) {
  var lat = null;
  var lng = null;
  var nombre = (ubiNombre || "").toString().trim();

  if (latVal !== null && latVal !== undefined && latVal !== "") {
    var pLat = parseFloat(latVal);
    if (!isNaN(pLat)) lat = pLat;
  }
  if (lngVal !== null && lngVal !== undefined && lngVal !== "") {
    var pLng = parseFloat(lngVal);
    if (!isNaN(pLng)) lng = pLng;
  }

  // Geocodificación inversa nativa si tenemos coordenadas y no hay nombre legible
  if (lat !== null && lng !== null && (!nombre || nombre.length < 3 || nombre.toLowerCase() === "mi ubicación")) {
    try {
      var geocoder = Maps.newGeocoder();
      var response = geocoder.reverseGeocode(lat, lng);
      if (response && response.status === "OK" && response.results && response.results.length > 0) {
        var formatted = response.results[0].formatted_address || "";
        nombre = formatted.split(",").slice(0, 2).join(",").trim() || formatted;
      }
    } catch (eGeo) {
      Logger.log("Aviso en geocodificación inversa: " + eGeo.toString());
    }
  }

  return {
    lat: lat,
    lng: lng,
    ubicacion: nombre
  };
}

function asegurarColumnasUbicacion(sheet) {
  if (!sheet) return;
  try {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 11) {
      var maxCols = sheet.getMaxColumns();
      if (maxCols < 11) {
        sheet.insertColumnsAfter(maxCols, 11 - maxCols);
      }
      var headers = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0];
      if (lastCol < 9 || !(headers[8])) {
        sheet.getRange(1, 9).setValue("Latitud");
      }
      if (lastCol < 10 || !(headers[9])) {
        sheet.getRange(1, 10).setValue("Longitud");
      }
      if (lastCol < 11 || !(headers[10])) {
        sheet.getRange(1, 11).setValue("Ubicación");
      }
      sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#1A73E8").setFontColor("#FFFFFF");
    }
  } catch (eCol) {
    Logger.log("Error asegurando columnas de ubicación: " + eCol.toString());
  }
}

// ==========================================
// ENDPOINT GET (Health Check y Mini App)
// ==========================================
function doGet(e) {
  // 1. Fallback de Apple Pay / iOS Shortcuts si alguna vez envía por GET
  if (e && e.parameter && (e.parameter.importe !== undefined || e.parameter.monto !== undefined || (e.parameter.comercio && e.parameter.comercio !== ""))) {
    var resGet = procesarTransaccionApplePay(e.parameter);
    return HtmlService.createHtmlOutput(JSON.stringify(resGet));
  }

  // 2. Control de Acceso y Autenticación: Todas las MiniApps, APIs y comandos administrativos requieren auth
  if (!validarAccesoWeb(e)) {
    if (e && e.parameter && (e.parameter.api || e.parameter.format === "json" || e.parameter.json === "true")) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Acceso denegado: Token de autenticación inválido o ausente." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return servirPantallaAccesoRestringido();
  }

  var conf = obtenerConfiguracionActual();
  if (e && e.parameter) {
    if (e.parameter.view === "mapa" || e.parameter.mapa === "true") {
      return servirWebAppMapaCalor(conf);
    }
    if (e.parameter.api === "puntos_mapa") {
      return ContentService.createTextOutput(JSON.stringify(obtenerPuntosMapaCalor()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.check_keys === "true") {
      var keys = PropertiesService.getScriptProperties().getKeys();
      var safeProps = {};
      for (var k = 0; k < keys.length; k++) {
        var keyName = keys[k];
        var val = PropertiesService.getScriptProperties().getProperty(keyName) || "";
        safeProps[keyName] = val ? (val.length > 8 ? val.substring(0, 4) + "..." + val.substring(val.length - 4) : "SET") : "EMPTY";
      }
      return ContentService.createTextOutput(JSON.stringify({ keys: keys, props: safeProps })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.re_register_tg === "true") {
      var targetUrl = e.parameter.url || "https://script.google.com/macros/s/AKfycbxjz1Y8xXd5vv6D3PuNxw16LI3UQByPnb_m3pCoDw9FTacTz7QVTmHmtUXQCaWT8qQ1LA/exec";
      var resReg = UrlFetchApp.fetch("https://api.telegram.org/bot" + CONFIG.TELEGRAM_TOKEN + "/setWebhook?url=" + encodeURIComponent(targetUrl));
      return ContentService.createTextOutput(resReg.getContentText()).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.view === "webapp" || e.parameter.webapp === "true") {
      return servirWebAppDashboard(conf);
    }
    if (e.parameter.reset_saldos === "true") {
      actualizarSaldoCuenta(CONFIG.DEFAULT_SALDO_CUENTA);
      actualizarSaldoBolsillo("ahorro", CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO);
      actualizarSaldoBolsillo("obligaciones", CONFIG.DEFAULT_SALDO_BOLSILLO_OBLIGACIONES);
      recalcularSaldoTotalBanco();
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.set_saldo_total !== undefined) {
      actualizarSaldoTotalBanco(parseFloat(e.parameter.set_saldo_total) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.set_saldo !== undefined) {
      actualizarSaldoCuenta(parseFloat(e.parameter.set_saldo) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.set_bolsillo_ahorro !== undefined) {
      actualizarSaldoBolsillo("ahorro", parseFloat(e.parameter.set_bolsillo_ahorro) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.traslado_bolsillo !== undefined && e.parameter.monto !== undefined) {
      trasladarABolsillo(e.parameter.traslado_bolsillo, parseFloat(e.parameter.monto) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.retirar_bolsillo !== undefined && e.parameter.monto !== undefined) {
      trasladarDeBolsillo(e.parameter.retirar_bolsillo, parseFloat(e.parameter.monto) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.set_bolsillo_obligaciones !== undefined) {
      actualizarSaldoBolsillo("obligaciones", parseFloat(e.parameter.set_bolsillo_obligaciones) || 0);
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.sync === "true") {
      sincronizarHojasYParametros(e.parameter.force_reset_saldos === "true");
      conf = obtenerConfiguracionActual();
    }
    if (e.parameter.setup_triggers === "true") {
      configurarTriggersAutomaticos();
    }
    if (e.parameter.test_reminder === "true") {
      ejecutarRecordatoriosDiarios(true);
    }
    if (e.parameter.test_radar === "true") {
      var rTexto = generarTextoRadarHormiga(conf);
      if (e.parameter.send_tg === "true") {
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, "🐜 *RADAR DE GASTOS HORMIGA (TEST)*\n\n" + rTexto.texto, [
          [
            { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
            { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }
          ]
        ]);
      }
    }
    if (e.parameter.test_cripto === "true") {
      var criptoData = obtenerDatosCriptoBinance();
      if (e.parameter.send_tg === "true") {
        var msgCrip = generarMensajeCriptoBinance(conf);
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, msgCrip.texto, msgCrip.inlineKb);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        criptoData: criptoData
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.test_invertir === "true") {
      var hubInv = generarMensajeHubInversiones(conf);
      if (e.parameter.send_tg === "true") {
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, hubInv.texto, hubInv.inlineKb);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        subBolsillos: obtenerSubBolsillosVirtuales(conf),
        simulacionCDT_100k_90dias: calcularRendimientoCDT(100000, 90, 10.5)
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.clear_inversiones === "true") {
      limpiarTodasLasInversiones();
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        message: "Inversiones eliminadas con éxito."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.borrar_inversion !== undefined) {
      var resB = borrarInversionEnHoja(e.parameter.borrar_inversion);
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        result: resB
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.test_timing === "true") {
      var timData = analizarTimingMercadoInversiones(conf);
      if (e.parameter.send_tg === "true") {
        var msgTimGet = generarMensajeTimingMercado(conf);
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, msgTimGet.texto, msgTimGet.inlineKb);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        timing: timData
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.setup_commands === "true") {
      var resCmd = configurarComandosTelegram();
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        commands_configured: resCmd
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.test_cuotas === "true") {
      var montoCuotas = parseFloat(e.parameter.monto) || 1200000;
      var numCuotas = parseInt(e.parameter.cuotas) || 6;
      var simCuotas = calcularSimulacionCuotas(montoCuotas, numCuotas);
      if (e.parameter.send_tg === "true") {
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, simCuotas.mensaje, [
          [{ text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }]
        ]);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        simulacion: simCuotas
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.test_cierre_mes === "true") {
      var scoreMsg = generarReporteCierreMes(conf);
      if (e.parameter.send_tg === "true") {
        sendTelegram(CONFIG.TELEGRAM_CHAT_ID, scoreMsg, [
          [{ text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }]
        ]);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        reporteCierreMes: scoreMsg
      })).setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.limpiar_pruebas === "true") {
      var ssL = SpreadsheetApp.getActiveSpreadsheet();
      var shT = ssL.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
      var filasBorradas = 0;
      if (shT && shT.getLastRow() > 1) {
        var numR = shT.getLastRow();
        for (var rIdx = numR; rIdx >= 2; rIdx--) {
          var valTipo = (shT.getRange(rIdx, 2).getValue() || "").toString().trim();
          var valCom = (shT.getRange(rIdx, 3).getValue() || "").toString().trim();
          if (valTipo === "Sin comercio" || valCom === "Comercio no especificado" || valTipo === "" || valCom === "0") {
            shT.deleteRow(rIdx);
            filasBorradas++;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "ok", filasBorradas: filasBorradas }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  var radarActual = analizarGastosHormigaYDesviacion(conf);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojasSnapshot = {};
  ["Configuracion", "Gastos_Fijos", "Metas", "Inversiones", "Transacciones"].forEach(function(h) {
    var sh = ss.getSheetByName(h);
    if (sh && sh.getLastRow() > 0) {
      if (h === "Transacciones") {
        var lR = sh.getLastRow();
        var sR = Math.max(1, lR - 20);
        hojasSnapshot[h] = sh.getRange(sR, 1, lR - sR + 1, sh.getLastColumn()).getValues();
      } else {
        hojasSnapshot[h] = sh.getDataRange().getValues();
      }
    }
  });

  if (e && e.parameter && e.parameter.json === "true") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      message: "Webhook de Finanzas Personales activo.",
      timestamp: new Date().toISOString(),
      zonaHoraria: CONFIG.ZONA_HORARIA,
      configuracionVigente: {
        salario: conf.salario,
        saldoCuenta: conf.saldoCuenta,
        saldoBolsilloAhorro: conf.saldoBolsilloAhorro,
        saldoBolsilloObligaciones: conf.saldoBolsilloObligaciones,
        saldoTotalBanco: conf.saldoTotalBanco,
        deudaTarjetaNu: conf.deudaTarjetaNu,
        diaPagoTarjetaNu: conf.diaPagoTarjetaNu,
        proximaFechaPagoTarjeta: conf.proximaFechaPagoTarjeta,
        diasParaPagoTarjeta: conf.diasParaPagoTarjeta,
        liquidezNetaReal: conf.liquidezNetaReal,
        gastosFijosTotal: conf.gastosFijosTotal,
        listaFijos: conf.listaFijos,
        presupuestoVariable: conf.presupuestoVariable,
        metaAhorroMensual: conf.metaAhorroMensual,
        flujoQuincenal: conf.flujoQuincenal,
        radarHormiga: radarActual
      },
      hojasSnapshot: hojasSnapshot
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return servirWebAppDashboard(conf);
}

// ==========================================
// ==========================================
// PROCESADOR ROBUSTO DE GASTOS APPLE PAY
// ==========================================
function procesarTransaccionApplePay(payload) {
  if (!payload) return { status: "error", error: "Payload vacío" };
  if (payload.entrada) {
    try {
      payload = typeof payload.entrada === 'string' ? JSON.parse(payload.entrada) : payload.entrada;
    } catch(eEnt) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!sheet) {
    inicializarHojas();
    sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  }
  asegurarColumnasUbicacion(sheet);

  // Sanitización robusta de comercio (busca variaciones)
  var rawCom = payload.comercio !== undefined ? payload.comercio : 
              (payload.Comercio !== undefined ? payload.Comercio : 
              (payload.commerce !== undefined ? payload.commerce : 
              (payload.store !== undefined ? payload.store : null)));
  var comercio = "Comercio no especificado";
  if (rawCom) {
    if (typeof rawCom === "object") {
      comercio = rawCom.name || rawCom.nombre || "Comercio no especificado";
    } else {
      comercio = rawCom.toString().trim() || "Comercio no especificado";
    }
  }

  // Sanitización robusta de importe en pesos colombianos
  var rawMontoVal = payload.importe !== undefined ? payload.importe : 
                   (payload.Importe !== undefined ? payload.Importe : 
                   (payload.monto !== undefined ? payload.monto : 
                   (payload.Monto !== undefined ? payload.Monto : 
                   (payload.cantidad !== undefined ? payload.cantidad : 
                   (payload.Cantidad !== undefined ? payload.Cantidad : 0)))));
  var importeNum = sanitizarImporteCOP(rawMontoVal);

  // Sanitización de tarjeta
  var rawTarj = payload.tarjeta !== undefined ? payload.tarjeta : 
               (payload.Tarjeta !== undefined ? payload.Tarjeta : 
               (payload.medio !== undefined ? payload.medio : 
               (payload.Medio !== undefined ? payload.Medio : 
               (payload.card !== undefined ? payload.card : null))));
  var tarjeta = "Apple Pay";
  if (rawTarj) {
    if (typeof rawTarj === "object") {
      tarjeta = rawTarj.name || rawTarj.nombre || "Apple Pay";
    } else {
      tarjeta = rawTarj.toString().trim() || "Apple Pay";
    }
  }

  // Sanitización de categoría
  var rawCat = payload.categoria !== undefined ? payload.categoria : 
              (payload.Categoria !== undefined ? payload.Categoria : 
              (payload.category !== undefined ? payload.category : "General"));
  var categoria = "General";
  if (rawCat) {
    var cStr = rawCat.toString().trim();
    if (cStr.length > 0 && cStr.length < 35 && cStr.indexOf("{") === -1 && cStr.indexOf("Entrada de atajo") === -1) {
      categoria = cStr;
    }
  }

  // Ubicación GPS (lat, lng, ubicacion)
  var latVal = payload.lat !== undefined ? payload.lat : 
              (payload.Lat !== undefined ? payload.Lat : 
              (payload.latitud !== undefined ? payload.latitud : 
              (payload.Latitud !== undefined ? payload.Latitud : 
              (payload.latitude !== undefined ? payload.latitude : null))));

  var lngVal = payload.lng !== undefined ? payload.lng : 
              (payload.Lng !== undefined ? payload.Lng : 
              (payload.Ing !== undefined ? payload.Ing : 
              (payload.ing !== undefined ? payload.ing : 
              (payload.longitud !== undefined ? payload.longitud : 
              (payload.Longitud !== undefined ? payload.Longitud : 
              (payload.longitude !== undefined ? payload.longitude : 
              (payload.lon !== undefined ? payload.lon : null)))))));

  var ubiNombre = payload.ubicacion || payload.Ubicacion || payload.direccion || payload.Direccion || payload.location || payload.nombre || payload.Nombre || "";

  var datosUbicacion = procesarUbicacionTransaccion(latVal, lngVal, ubiNombre);

  var fechaActual = new Date();
  var fechaTexto = Utilities.formatDate(fechaActual, CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
  var idTimestamp = new Date().getTime();

  sheet.appendRow([
    payload.fecha || fechaTexto,
    "🔴 Gasto",
    comercio,
    importeNum,
    tarjeta,
    categoria,
    "Apple Pay (iOS Shortcut)",
    idTimestamp,
    datosUbicacion.lat !== null ? datosUbicacion.lat : "",
    datosUbicacion.lng !== null ? datosUbicacion.lng : "",
    datosUbicacion.ubicacion || ""
  ]);

  // Guardar ID en cache para vinculación inmediata si se requiere
  var cacheScript = CacheService.getScriptCache();
  cacheScript.put("ultimo_gasto_id", idTimestamp.toString(), 600);

  // Descontar automáticamente del saldo en cuenta bancaria
  var nuevoSaldo = 0;
  if (importeNum > 0) {
    nuevoSaldo = descontarSaldoCuenta(importeNum);
  }

  // Notificación inmediata a Telegram con Ubicación, Conversor a Horas de Trabajo y Botón Ver en Mapa
  if (CONFIG.TELEGRAM_CHAT_ID && CONFIG.TELEGRAM_CHAT_ID !== "TU_CHAT_ID" && CONFIG.TELEGRAM_CHAT_ID !== "TU_TELEGRAM_CHAT_ID") {
    var horasTrabajo = (importeNum / 19957).toFixed(1);
    var diasCupo = (importeNum / 21190).toFixed(1);

    var msgApplePay = "💳 *COMPRA CON APPLE PAY REGISTRADA*\n\n" +
                      "💵 Monto: *$" + formatearCOP(importeNum) + " COP*\n" +
                      "🏪 Comercio: *" + comercio + "*\n" +
                      "💳 Tarjeta/Medio: *" + tarjeta + "*\n" +
                      (datosUbicacion.ubicacion ? "📍 Ubicación: *" + datosUbicacion.ubicacion + "*\n" : "") +
                      "💰 Saldo restante en cuenta: ||*$" + formatearCOP(nuevoSaldo || 0) + " COP*||\n\n" +
                      "⏳ *Impacto en Horas de Trabajo:*\n" +
                      "• Equivale a *" + horasTrabajo + " horas* de tu trabajo (~*" + diasCupo + " días* de cupo diario).";

    var urlMapa = getUrlWebAppConParametros("view=mapa");
    var inlineKb = [
      [
        { text: "↩️ Deshacer Gasto", callback_data: "cb:deshacer:" + idTimestamp },
        { text: "🗺️ Ver en Mapa", web_app: { url: urlMapa } }
      ],
      [
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ];

    sendTelegram(CONFIG.TELEGRAM_CHAT_ID, msgApplePay, inlineKb);
  }

  // Verificar límites y enviar alerta si sobrepasa
  if (importeNum > 0) {
    checkBudgetAlert(importeNum, comercio);
  }

  return {
    status: "success",
    monto: importeNum,
    comercio: comercio,
    ubicacion: datosUbicacion.ubicacion || null
  };
}

// ==========================================
// ROUTER PRINCIPAL POST (Apple Pay, Textos, Audios y Fotos)
// ==========================================
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    var data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (eParse) {
        if (typeof raw === "string" && raw.indexOf("=") !== -1) {
          var pairs = raw.split("&");
          for (var p = 0; p < pairs.length; p++) {
            var kv = pairs[p].split("=");
            if (kv.length === 2) {
              data[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1].replace(/\+/g, " "));
            }
          }
        }
      }
    }
    if ((!data || Object.keys(data).length === 0) && e && e.parameter) {
      data = e.parameter;
    }

    if (!data || Object.keys(data).length === 0) {
      return HtmlService.createHtmlOutput("OK");
    }

    // -------------------------------------------------------------
    // CASO 1: Mensajes desde Telegram (Texto, Audio, Foto)
    // -------------------------------------------------------------
    if (data.message) {
      var msg = data.message;
      var chatId = msg.chat.id.toString();

      // Deduplicación robusta por reintentos de Telegram (evita respuestas dobles)
      var updateId = data.update_id ? data.update_id : (chatId + "_" + msg.message_id);
      var updateKey = "tg_upd_" + updateId;
      var cache = CacheService.getScriptCache();
      if (cache.get(updateKey)) {
        Logger.log("Update duplicado ignorado: " + updateKey);
        return HtmlService.createHtmlOutput("OK");
      }
      cache.put(updateKey, "PROCESSING", 300);

      // Validación de seguridad por Chat ID
      if (CONFIG.TELEGRAM_CHAT_ID && CONFIG.TELEGRAM_CHAT_ID !== "TU_CHAT_ID" && CONFIG.TELEGRAM_CHAT_ID !== "TU_TELEGRAM_CHAT_ID" && chatId !== CONFIG.TELEGRAM_CHAT_ID.toString()) {
        sendTelegram(chatId, "⛔ *Acceso no autorizado.* Este bot es privado para gestión financiera personal.");
        return HtmlService.createHtmlOutput("OK");
      }

      // 1.1 Si es una Foto / Captura de pantalla (Nequi, Davivienda, etc.)
      if (msg.photo && msg.photo.length > 0) {
        handleTelegramPhoto(msg);
        return HtmlService.createHtmlOutput("OK");
      }

      // 1.1b Si es un Documento de tipo Imagen (enviado como archivo sin comprimir)
      if (msg.document && msg.document.mime_type && msg.document.mime_type.indexOf("image") !== -1) {
        handleTelegramPhoto(msg);
        return HtmlService.createHtmlOutput("OK");
      }

      // 1.2 Si es una Nota de Voz o Audio
      if (msg.voice || msg.audio) {
        handleTelegramVoice(msg);
        return HtmlService.createHtmlOutput("OK");
      }

      // 1.2b Si es una Ubicación enviada por Telegram (📍)
      if (msg.location) {
        handleTelegramLocation(msg);
        return HtmlService.createHtmlOutput("OK");
      }

      // 1.3 Si es Texto o Comandos
      if (msg.text) {
        handleTelegramMessage(msg);
        return HtmlService.createHtmlOutput("OK");
      }

      return HtmlService.createHtmlOutput("OK");
    }

    // -------------------------------------------------------------
    // CASO 1.5: Botones Interactivos de Telegram (Callback Queries)
    // -------------------------------------------------------------
    if (data.callback_query) {
      handleTelegramCallbackQuery(data.callback_query);
      return HtmlService.createHtmlOutput("OK");
    }

    // -------------------------------------------------------------
    // CASO 2: Transacciones desde Apple Pay (iOS Shortcuts)
    // -------------------------------------------------------------
    var resultado = procesarTransaccionApplePay(data);
    return HtmlService.createHtmlOutput(JSON.stringify(resultado));

  } catch (error) {
    Logger.log("Error en doPost: " + error.toString());
    return HtmlService.createHtmlOutput(JSON.stringify({
      status: "error",
      error: error.toString()
    }));
  }
}

// ==========================================
// SOLICITAR UBICACIÓN DESPUÉS DE REGISTRAR UN GASTO
// ==========================================
function solicitarUbicacionPostGasto(chatId) {
  try {
    // Verificar si ya hay una ubicación pendiente (el usuario mandó ubicación ANTES del gasto)
    var cache = CacheService.getScriptCache();
    var yaConUbi = cache.get("pending_location_" + chatId);
    if (yaConUbi) return; // Ya tiene ubicación, no preguntar

    var token = CONFIG.TELEGRAM_TOKEN;
    if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var payload = {
      chat_id: chatId,
      text: "📍 <b>¿Dónde estás?</b>\nComparte tu ubicación para agregarla al gasto en tu mapa de calor. Puedes omitirlo si prefieres.",
      parse_mode: "HTML",
      reply_markup: JSON.stringify({
        keyboard: [
          [{ text: "📍 Compartir Ubicación", request_location: true }],
          [{ text: "⏭️ Omitir" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      })
    };

    UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Error solicitando ubicación: " + e.toString());
  }
}

// ==========================================
// REMOVER TECLADO DE UBICACIÓN (después de recibir o saltar)
// ==========================================
function removerTecladoUbicacion(chatId, mensajeConfirmacion) {
  try {
    var token = CONFIG.TELEGRAM_TOKEN;
    if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;

    var url = "https://api.telegram.org/bot" + token + "/sendMessage";
    var payload = {
      chat_id: chatId,
      text: mensajeConfirmacion,
      parse_mode: "HTML",
      reply_markup: JSON.stringify({ remove_keyboard: true })
    };

    UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Error removiendo teclado: " + e.toString());
  }
}

// ==========================================
// GESTOR DE UBICACIÓN RECIBIDA POR TELEGRAM (📍)
// ==========================================
function handleTelegramLocation(msg) {
  var chatId = msg.chat.id.toString();
  var loc = msg.location;
  if (!loc || loc.latitude === undefined || loc.longitude === undefined) {
    sendTelegram(chatId, "⚠️ No se recibieron coordenadas válidas.");
    return;
  }

  var lat = parseFloat(loc.latitude);
  var lng = parseFloat(loc.longitude);
  var ubi = procesarUbicacionTransaccion(lat, lng, "");
  var nombreLugar = ubi.ubicacion || (lat.toFixed(4) + ", " + lng.toFixed(4));

  var cache = CacheService.getScriptCache();
  var ultimoId = cache.get("ultimo_gasto_id");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);

  var vinculado = false;
  var comercioGasto = "";
  var montoGasto = 0;

  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var targetRow = -1;

    if (ultimoId) {
      for (var i = rows.length - 1; i >= 1; i--) {
        var rowId = (rows[i][7] || "").toString();
        if (rowId === ultimoId) {
          targetRow = i + 1;
          comercioGasto = rows[i][2] || "Compra";
          montoGasto = parseFloat(rows[i][3]) || 0;
          break;
        }
      }
    } else {
      var hoyMs = new Date().getTime();
      for (var j = rows.length - 1; j >= 1; j--) {
        var tFila = (rows[j][1] || "").toString().toLowerCase();
        if (tFila.indexOf("gasto") !== -1 || tFila === "") {
          var fVal = rows[j][0];
          var fDate = new Date(fVal);
          if (!isNaN(fDate.getTime()) && (hoyMs - fDate.getTime() < 15 * 60 * 1000)) {
            targetRow = j + 1;
            comercioGasto = rows[j][2] || "Compra";
            montoGasto = parseFloat(rows[j][3]) || 0;
            break;
          }
        }
      }
    }

    if (targetRow > 1) {
      asegurarColumnasUbicacion(sheet);
      sheet.getRange(targetRow, 9).setValue(lat);
      sheet.getRange(targetRow, 10).setValue(lng);
      sheet.getRange(targetRow, 11).setValue(nombreLugar);
      vinculado = true;
    }
  }

  var webAppUrlMapa = getUrlWebAppConParametros("view=mapa");
  if (vinculado) {
    // Remover el teclado de solicitud de ubicación
    removerTecladoUbicacion(chatId, "✅ Ubicación recibida correctamente.");
    var msgExito = "📍 *¡Ubicación vinculada a tu gasto!*\n\n" +
                   "🏪 Comercio: *" + comercioGasto + "*\n" +
                   "💵 Monto: *$" + formatearCOP(montoGasto) + " COP*\n" +
                   "🗺️ Lugar: *" + nombreLugar + "*\n\n" +
                   "Ya puedes visualizarlo en tu mapa de calor interactivo.";
    sendTelegram(chatId, msgExito, [
      [
        { text: "🗺️ Ver Mapa de Calor", web_app: { url: webAppUrlMapa } },
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
      ]
    ]);
  } else {
    cache.put("pending_location_" + chatId, JSON.stringify({ lat: lat, lng: lng, ubicacion: nombreLugar }), 900);
    var msgPendiente = "📍 *Ubicación recibida:*\n*" + nombreLugar + "*\n\n" +
                       "¿Cuánto gastaste aquí? Puedes responder con:\n" +
                       "`/gasto 25000 Almuerzo` o `25000 Café`\n" +
                       "y quedará guardado automáticamente con estas coordenadas.";
    sendTelegram(chatId, msgPendiente);
  }
}

// ==========================================
// GESTOR DE MENSAJES DE TEXTO Y COMANDOS DE TELEGRAM
// ==========================================
function handleTelegramMessage(msg) {
  var chatId = msg.chat.id.toString();
  var text = msg.text.trim();
  var conf = obtenerConfiguracionActual();
  var resumenMes = obtenerResumenMesActual();

  // Normalización de texto proveniente de botones del teclado inferior
  var textLower = text.toLowerCase().trim();
  if (textLower === "💳 mi saldo" || textLower === "mi saldo") text = "/saldo";
  else if (textLower === "🏦 bolsillos" || textLower === "bolsillos") text = "/bolsillos";
  else if (textLower === "📊 resumen mes" || textLower === "resumen mes" || textLower === "resumen") text = "/reporte";
  else if (textLower === "🏢 quincena" || textLower === "quincena") text = "/quincena";
  else if (textLower === "⚖️ calculadora cuotas" || textLower === "calculadora cuotas" || textLower === "cuotas") text = "/cuotas";
  else if (textLower === "🐜 radar hormiga" || textLower === "radar hormiga" || textLower === "radar") text = "/radar";
  else if (textLower === "📈 inversiones" || textLower === "inversiones") text = "/invertir";
  else if (textLower === "🏆 cierre de mes" || textLower === "cierre de mes" || textLower === "cierre") text = "/cierre_mes";
  else if (textLower === "☀️ briefing" || textLower === "briefing") text = "/briefing";
  else if (textLower === "🟣 tarjeta nu" || textLower === "tarjeta nu" || textLower === "tarjeta" || textLower === "nu") text = "/deuda";
  else if (textLower === "🗺️ mapa de calor" || textLower === "mapa de calor" || textLower === "mapa" || textLower === "/mapa" || textLower === "/calor") text = "/mapa";
  else if (textLower === "⏭️ omitir" || textLower === "omitir") {
    // El usuario omitió compartir ubicación después de un gasto
    removerTecladoUbicacion(chatId, "👍 Sin problema, gasto registrado sin ubicación.");
    return;
  }

  // 1. Comando /start
  if (text === "/start") {
    var menu = "👋 *¡Hola! Soy tu Asesor Financiero Personal y CFO Privado con IA.*\n\n" +
               "🚀 *Formas de registrar tus transacciones:*\n" +
               "💳 *Apple Pay:* Automático en tiempo real con GPS al pagar con tu iPhone.\n" +
               "📸 *Capturas de Pantalla:* Envíame fotos de comprobantes (*Nequi, Davivienda, Nu, Bancolombia*).\n" +
               "🎙️ *Notas de Voz:* Envíame un audio diciendo lo que gastaste o consultando dudas.\n" +
               "📍 *Ubicación:* Envíame un pin de ubicación para geolocalizar tu última compra.\n" +
               "💸 *Manual:* Usa `/gasto 25000 Almuerzo`.\n\n" +
               "📊 *Comandos de Consulta Rápida:*\n" +
               "📖 /comandos - Ver lista completa y detallada de todos los comandos\n" +
               "📱 /menu - Activar o actualizar el teclado de botones rápidos en pantalla\n" +
               "🗺️ /mapa - Ver mapa de calor interactivo de lugares donde más gastas\n" +
               "🏦 /bolsillos - Ver saldos en cada bolsillo Davivienda y reglas de fondeo\n" +
               "💳 /saldo - Saldo disponible, bolsillos y saldo total en Davivienda\n" +
               "⚖️ `/cuotas [monto] [cuotas]` - Calculadora anti-intereses y horas de trabajo\n" +
               "🏆 /cierre_mes - Scorecard patrimonial mensual y calificación A+/A/B/C\n" +
               "🟣 /deuda - Estado de la Tarjeta Nu y días para pagar (los 11)\n" +
               "📈 /invertir - Opciones de inversión (CDTs Colombia y Cripto Binance)\n" +
               "📁 /portafolio - Ver estado de tus inversiones activas y vencimientos\n" +
               "🐜 /radar - Radar de gastos hormiga y cupo diario seguro\n" +
               "🏢 /quincena - Calendario de nómina quincenal (15 y 30) y flujo de caja\n" +
               "🎉 `/cobro_quincena` - Registrar cobro de nómina recibido y reparto en bolsillos\n" +
               "📋 /fijos - Gastos fijos programados (Arriendo el 30, Nu el 11, etc.)\n" +
               "📊 /reporte - Estado de gastos del mes actual\n" +
               "🎯 /metas - Progreso de metas y fondo de emergencia\n" +
               "🧹 /reset - Reiniciar memoria y contexto de conversación\n\n" +
                "⚙️ *Comandos de Tarjetas y Cuentas:*\n" +
                "🔄 `/traslado [ahorro|obligaciones] [monto]` - Mover dinero de disponible a bolsillo\n" +
                "🔄 `/retirar_bolsillo [ahorro|obligaciones] [monto]` - Devolver dinero de bolsillo a disponible\n" +
                "🏦 `/set_bolsillo [ahorro|obligaciones] [monto]` - Calibrar saldos de bolsillos\n" +
                "💰 `/set_saldo_total [monto]` (o `/set_total`) - Calibrar Saldo Total Davivienda\n" +
                "🛒 `/set_disponible [monto]` (o `/set_saldo`) - Actualizar disponible en banco\n" +
                "🟣 `/set_deuda [monto]` - Registrar deuda pendiente de Tarjeta Nu\n" +
                "🎉 `/pagar_tarjeta [monto]` - Registrar pago de la tarjeta Nu\n" +
                "📥 `/ingreso [monto] [concepto]` - Registrar entrada de dinero\n" +
                "💰 `/set_presupuesto [monto]` - Cambiar tope de gastos variables\n\n" +
                "💬 _Pregúntame: '¿Puedo comprarme X cosa?' o '¿Cuánto me puedo gastar hoy?' y simularé el riesgo financiero en tiempo real._";

    var inlineKbStart = [
      [
        { text: "🗺️ Mapa de Calor", web_app: { url: getUrlWebAppConParametros("view=mapa") } },
        { text: "📱 Dashboard Web", web_app: { url: getUrlWebAppConParametros("view=webapp") } }
      ],
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Saldo en Cuenta", callback_data: "cb:saldo" }
      ],
      [
        { text: "📈 Invertir & Radar", callback_data: "cb:invertir" },
        { text: "⚖️ Calculadora Cuotas", callback_data: "cb:cuotas" }
      ],
      [
        { text: "🏆 Cierre de Mes", callback_data: "cb:cierre_mes" },
        { text: "🟣 Tarjeta Nu (los 11)", callback_data: "cb:deuda" }
      ],
      [
        { text: "☀️ Briefing Matutino", callback_data: "cb:briefing" },
        { text: "🏢 Nómina y Quincenas", callback_data: "cb:quincena" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" },
        { text: "📋 Gastos Fijos", callback_data: "cb:fijos" }
      ]
    ];
    sendTelegram(chatId, menu, inlineKbStart);
    sendTelegram(chatId, "📱 *Menú de accesos rápidos fijado abajo en tu pantalla.*", obtenerTecladoPrincipalTelegram());
    return;
  }

  // 1.0b Comando /mapa o /calor
  if (text === "/mapa" || text.startsWith("/mapa") || text === "/calor") {
    var datosMapa = obtenerPuntosMapaCalor();
    var urlMapa = getUrlWebAppConParametros("view=mapa");

    var msgMapa = "🗺️ *MAPA DE CALOR DE GASTOS Y SALIDAS*\n\n" +
                  "He analizado tus transacciones geolocalizadas con Apple Pay y Telegram:\n\n" +
                  "• 📍 *Compras Mapeadas:* *" + datosMapa.conteo + " gastos*\n" +
                  "• 💵 *Total Geolocalizado:* *" + datosMapa.totalGastadoFmt + "*\n\n";

    if (datosMapa.epicentros && datosMapa.epicentros.length > 0) {
      msgMapa += "🔥 *Top Epicentros de Gasto (Donde más se te va la plata):*\n";
      for (var ep = 0; ep < datosMapa.epicentros.length; ep++) {
        var itemEp = datosMapa.epicentros[ep];
        var med = (ep === 0) ? "🥇" : (ep === 1 ? "🥈" : (ep === 2 ? "🥉" : "📍"));
        msgMapa += med + " *" + itemEp.lugar + ":* $" + formatearCOP(itemEp.total) + " COP (" + itemEp.transacciones + " compras)\n";
      }
      msgMapa += "\n";
    } else {
      msgMapa += "💡 _Aún no tienes compras geolocalizadas. Al pagar con Apple Pay en tu iPhone o enviar tu ubicación por Telegram, aparecerán aquí automáticamente._\n\n";
    }

    msgMapa += "👉 _Toca el botón de abajo para abrir el mapa interactivo en modo oscuro con puntos de calor y marcadores._";

    var inlineKbMapa = [
      [
        { text: "🗺️ Abrir Mapa de Calor Interactivo", web_app: { url: urlMapa } }
      ],
      [
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" },
        { text: "📱 Dashboard Completo", web_app: { url: getUrlWebAppConParametros("view=webapp") } }
      ]
    ];

    sendTelegram(chatId, msgMapa, inlineKbMapa);
    return;
  }

  // 1.0c Comando /menu o /teclado
  if (text === "/menu" || text === "/teclado") {
    var msgMenu = "📱 *MENÚ PRINCIPAL Y ACCESOS RÁPIDOS*\n\n" +
                  "He fijado los accesos directos en tu teclado inferior de Telegram para que consultes y controles tus finanzas con un solo toque:\n\n" +
                  "• 💳 *Mi Saldo:* Disponible y bolsillos Davivienda en tiempo real.\n" +
                  "• 🏦 *Bolsillos:* Reglas del 53% Ahorro, 27% Obligaciones y 20% Ocio.\n" +
                  "• 📊 *Resumen Mes:* Auditoría de gastos y presupuesto mensual.\n" +
                  "• 🏢 *Quincena:* Flujo de nómina quincenal (15 y 30) y cupo diario.\n" +
                  "• ⚖️ *Calculadora Cuotas:* Simulación anti-intereses y horas de trabajo.\n" +
                  "• 🐜 *Radar Hormiga:* Fugas de dinero y cupo seguro diario.\n" +
                  "• 📈 *Inversiones:* Rendimientos CDTs Colombia y Radar Cripto.\n" +
                  "• 🏆 *Cierre de Mes:* Scorecard patrimonial y calificación A+/A/B/C.\n" +
                  "• ☀️ *Briefing:* Notificación matutina con compromisos y saldo.\n" +
                  "• 🟣 *Tarjeta Nu:* Factura, fecha de corte y pago los 11 sin intereses.\n\n" +
                  "💡 _Toca cualquiera de los botones de abajo para consultar inmediatamente._";
    sendTelegram(chatId, msgMenu, obtenerTecladoPrincipalTelegram());
    return;
  }

  // 1.0 Comando /comandos, /ayuda o /help
  if (text === "/comandos" || text === "/ayuda" || text === "/help") {
    var listaComandos = "📖 *GUÍA COMPLETA DE COMANDOS DEL SISTEMA*\n\n" +
      "📊 *Consultas y Liquidez:*\n" +
      "• `/briefing` (o `/recordatorios`) - Ver el briefing matutino de próximos pagos y alertas.\n" +
      "• `/bolsillos` (o `/presupuesto`) - Consultar saldo en cada bolsillo Davivienda y reglas automáticas.\n" +
      "• `/saldo` - Saldo disponible en cuenta, bolsillos y saldo total en Davivienda.\n" +
      "• `/invertir` (o `/inversiones`) - Centro de inversiones, CDTs, Binance y simulación.\n" +
      "• `/portafolio` - Resumen de tus CDTs vigentes y compras cripto registradas.\n" +
      "• `/radar` (o `/hormiga`) - Radar de micro-gastos y recalibración de cupo diario seguro.\n" +
      "• `/quincena` (o `/nomina`) - Flujo quincenal de nómina (15 y 30) y cupo diario seguro.\n" +
      "• `/deuda` (o `/tarjeta`) - Deuda de Tarjeta Nu, días para pagar (los 11) y consejos.\n" +
      "• `/fijos` (o `/arriendo`) - Calendario y detalle de tus gastos fijos mensuales.\n" +
      "• `/reporte` (o `/resumen`) - Resumen de gastos variables del mes y desglose por categorías.\n" +
      "• `/metas` - Estado de tus metas de ahorro y fondo de emergencia.\n" +
      "• `/cuotas [monto] [cuotas]` - Calculadora de intereses bancarios y horas de trabajo.\n" +
      "• `/cierre_mes` - Auditoría patrimonial y calificación de cierre de mes.\n\n" +
      "💸 *Registro de Movimientos:*\n" +
      "• `/cobro_quincena` - Acreditar nómina recibida de nómina y calcular distribución en bolsillos.\n" +
      "• `/traslado [ahorro|obligaciones] [monto]` - Pasar plata de disponible a un bolsillo interno.\n" +
      "• `/retirar_bolsillo [ahorro|obligaciones] [monto]` - Sacar plata de un bolsillo hacia disponible.\n" +
      "• `/registrar_inversion [cdt|cripto] [monto] [detalles]` - Registrar inversión manualmente.\n" +
      "• `/gasto [monto] [concepto]` - Registrar gasto manual (ej: `/gasto 25000 Almuerzo`).\n" +
      "• `/ingreso [monto] [concepto]` - Sumar entrada extra (ej: `/ingreso 150000 Venta`).\n" +
      "• `/pagar_tarjeta [monto]` - Registrar pago a la tarjeta Nu y descontar del banco.\n" +
      "• `/abono [meta] [monto]` - Abonar a una meta (ej: `/abono Fondo 200000`).\n\n" +
      "⚙️ *Ajustes y Configuración:*\n" +
      "• `/activar_recordatorios` - Programar alertas automáticas diarias a las 8:00 AM.\n" +
      "• `/set_bolsillo [ahorro|obligaciones] [monto]` - Ajustar saldos de bolsillos Davivienda.\n" +
      "• `/set_saldo_total [monto]` (o `/set_total`) - Calibrar tu saldo total consolidado Davivienda.\n" +
      "• `/set_disponible [monto]` (o `/set_saldo`) - Ajustar tu saldo disponible real en banco.\n" +
      "• `/set_deuda [monto]` - Registrar la deuda actual de tu Tarjeta Nu.\n" +
      "• `/set_presupuesto [monto]` - Modificar el presupuesto de gastos variables.\n" +
      "• `/set_salario [monto]` - Actualizar tu sueldo mensual neto.\n" +
      "• `/nueva_meta [nombre] [monto]` - Crear una nueva meta de ahorro.\n" +
      "• `/corregir_arriendo` - Sanear cobro accidental de arriendo.\n" +
      "• `/reset` (o `/limpiar`) - Reiniciar la memoria de conversación con Gemini.\n\n" +
      "🤖 *Funciones Inteligentes con IA:*\n" +
      "• 📸 *Fotos / Capturas:* Envíame comprobantes de Nequi, Davivienda, Nu o PSE.\n" +
      "• 🎙️ *Notas de Voz:* Grábame un audio diciendo qué compraste o qué dudas tienes.\n" +
      "• 💬 *Consultas Libres:* Pregúntame si puedes comprar algo o cuánto puedes gastar hoy.";

    var inlineKbComandos = [
      [
        { text: "💳 Mi Saldo", callback_data: "cb:saldo" },
        { text: "🏦 Bolsillos", callback_data: "cb:bolsillos" }
      ],
      [
        { text: "📊 Resumen Mes", callback_data: "cb:reporte" },
        { text: "🏢 Quincena", callback_data: "cb:quincena" }
      ],
      [
        { text: "📈 Inversiones", callback_data: "cb:invertir" },
        { text: "⚖️ Calculadora Cuotas", callback_data: "cb:cuotas" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" },
        { text: "🟣 Tarjeta Nu", callback_data: "cb:deuda" }
      ],
      [
        { text: "🏆 Cierre de Mes", callback_data: "cb:cierre_mes" },
        { text: "☀️ Briefing", callback_data: "cb:briefing" }
      ]
    ];
    sendTelegram(chatId, listaComandos, inlineKbComandos);
    return;
  }

  // 1.0b Comando /briefing o /recordatorios o /alertas
  if (text === "/briefing" || text === "/recordatorios" || text === "/alertas") {
    ejecutarRecordatoriosDiarios(true);
    return;
  }

  // 1.0d Comando /radar o /hormiga (Radar de Gastos Hormiga y Cupo Seguro)
  if (text === "/radar" || text === "/hormiga") {
    var rInfo = generarTextoRadarHormiga(conf);
    var msgR = "🐜 *RADAR FINANCIERO Y CONTROL DE FUGAS*\n\n" + rInfo.texto;
    var inlineKbR = [
      [
        { text: "📊 Resumen Mes", callback_data: "cb:reporte" },
        { text: "⚖️ Calculadora Cuotas", callback_data: "cb:cuotas" }
      ],
      [
        { text: "☀️ Briefing Matutino", callback_data: "cb:briefing" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ];
    sendTelegram(chatId, msgR, inlineKbR);
    return;
  }

  // 1.0e Comando /invertir o /inversiones o /inversion
  if (text === "/invertir" || text === "/inversiones" || text === "/inversion") {
    var hub = generarMensajeHubInversiones(conf);
    sendTelegram(chatId, hub.texto, hub.inlineKb);
    return;
  }

  // 1.0f Comando /portafolio
  if (text === "/portafolio") {
    var port = generarMensajePortafolio();
    sendTelegram(chatId, port.texto, port.inlineKb);
    return;
  }

  // 1.0g Comando /registrar_inversion
  if (text.startsWith("/registrar_inversion")) {
    handleRegistrarInversionComando(chatId, text, conf);
    return;
  }

  // 1.0h Comando /borrar_inversion o /borrar_inversiones
  if (text.startsWith("/borrar_inversion") || text.startsWith("/borrar_inversiones") || text.startsWith("/eliminar_inversion") || text === "/limpiar_inversiones") {
    handleBorrarInversionComando(chatId, text, conf);
    return;
  }

  // 1.0i Comando /momento_invertir o /senales o /timing (Radar cuantitativo)
  if (text === "/momento_invertir" || text === "/senales" || text === "/timing") {
    var msgTimCmd = generarMensajeTimingMercado(conf);
    sendTelegram(chatId, msgTimCmd.texto, msgTimCmd.inlineKb);
    return;
  }

  // 1.0c Comando /activar_recordatorios
  if (text === "/activar_recordatorios") {
    var resTrig = configurarTriggersAutomaticos();
    if (resTrig.ok) {
      sendTelegram(chatId, "⏰ *¡Alertas automáticas programadas con éxito!*\n\n" +
                           "Todos los días a las *8:00 AM (Hora Colombia)* tu bot revisará tu calendario y te enviará alertas proactivas:\n" +
                           "• Vencimientos a 3 días, 1 día y el mismo día de cada pago.\n" +
                           "• Recordatorios de nómina quincenal (días 14/15 y 29/30).\n" +
                           "• Resumen de saldo disponible, bolsillos y cupo seguro del día.");
    } else {
      sendTelegram(chatId, "⚠️ Nota sobre triggers: " + resTrig.error + "\n\n💡 _Puedes activarlo también en Google Apps Script -> Triggers -> Agregar Trigger -> ejecutarRecordatoriosDiarios -> Basado en tiempo -> Diario 8 AM._");
    }
    return;
  }

  // 1.1 Comando /reset o /limpiar (Wipe conversational memory)
  if (text === "/reset" || text === "/limpiar") {
    limpiarHistorialChat(chatId);
    sendTelegram(chatId, "🧹 *Memoria y contexto de conversación reiniciados.*\nEmpezamos un diálogo nuevo desde cero.");
    return;
  }

  // 1.2 Comando /corregir_arriendo (Reversión manual)
  if (text === "/corregir_arriendo") {
    verificarYSanearArriendoSiEsNecesario(SpreadsheetApp.getActiveSpreadsheet());
    var confSaneada = obtenerConfiguracionActual();
    sendTelegram(chatId, "✅ *Saneamiento completado:*\n" +
                         "• Cobro de arriendo eliminado de transacciones diarias.\n" +
                         "• Arriendo programado como gasto fijo mensual para los días 30.\n" +
                         "• Saldo bancario real restablecido a ||*$" + formatearCOP(confSaneada.saldoCuenta) + " COP*||.");
    return;
  }

  // 1.3 Comando /quincena o /nomina (Flujo de Caja de Nómina)
  if (text === "/quincena" || text === "/nomina") {
    var objQ = generarMensajeQuincena(conf);
    sendTelegram(chatId, objQ.texto, objQ.inlineKb);
    return;
  }

  // 1.3b Comando /bolsillos o /presupuesto (Modelo Davivienda 53 / 27 / 20)
  if (text === "/bolsillos" || text === "/presupuesto") {
    var objB = generarMensajeBolsillos(conf);
    sendTelegram(chatId, objB.texto, objB.inlineKb);
    return;
  }

  // 1.3c Comando /cobro_quincena o /pago_nomina o /ya_me_pagaron
  if (text.startsWith("/cobro_quincena") || text.startsWith("/pago_nomina") || text.startsWith("/ya_me_pagaron")) {
    var partesCQ = text.split(" ");
    var montoPersonalizado = partesCQ[1] ? parseFloat(partesCQ[1].replace(/[^0-9.]/g, '')) : null;
    var resCobro = cobrarQuincenaNomina(montoPersonalizado);
    var msgCobro = generarMensajeCobroQuincena(resCobro);
    var inlineKbC = [
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ],
      [
        { text: "📈 Explorar Inversiones", callback_data: "cb:invertir" },
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ];
    sendTelegram(chatId, msgCobro, inlineKbC);
    return;
  }

  // 1.4 Comando /fijos o /arriendo (Detalle de compromisos mensuales)
  if (text === "/fijos" || text === "/arriendo" || text === "/gastos_fijos") {
    var objF = generarMensajeGastosFijos(conf);
    sendTelegram(chatId, objF.texto, objF.inlineKb);
    return;
  }

  // 1.5 Comando /cuotas (Calculadora Anti-Cuotas y Costo de Oportunidad)
  if (text.startsWith("/cuotas")) {
    var partesCuotas = text.split(" ").filter(function(p) { return p.length > 0; });
    if (partesCuotas.length >= 3) {
      var montoCuotas = parseFloat(partesCuotas[1].replace(/[^0-9.]/g, ''));
      var numCuotas = parseInt(partesCuotas[2].replace(/[^0-9]/g, ''));
      var tasaEACuotas = partesCuotas[3] ? parseFloat(partesCuotas[3].replace(/[^0-9.]/g, '')) : 25.85;

      if (!isNaN(montoCuotas) && montoCuotas > 0 && !isNaN(numCuotas) && numCuotas > 0) {
        var sim = calcularSimulacionCuotas(montoCuotas, numCuotas, tasaEACuotas > 1 ? tasaEACuotas / 100 : tasaEACuotas);
        sendTelegram(chatId, sim.mensaje, [
          [
            { text: "🟣 Factura Tarjeta Nu", callback_data: "cb:deuda" },
            { text: "⚖️ Otra Simulación", callback_data: "cb:cuotas" }
          ],
          [
            { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
          ]
        ]);
        return;
      }
    }

    var menuCuotas = "⚖️ *CALCULADORA ANTI-CUOTAS Y COSTO FINANCIERO*\n\n" +
                     "Simula antes de diferir una compra con tarjeta de crédito para descubrir exactamente cuánto dinero le regalarías al banco en intereses y cuántas horas de trabajo te costaría:\n\n" +
                     "📌 *Uso del comando:*\n" +
                     "`/cuotas [monto] [cuotas]`\n" +
                     "`/cuotas [monto] [cuotas] [tasa_EA_opcional]`\n\n" +
                     "📌 *Ejemplos prácticos:*\n" +
                     "• `/cuotas 1200000 6` (Simula $1.2M a 6 cuotas con tasa Nu ~25.85% E.A.)\n" +
                     "• `/cuotas 3000000 12` (Simula $3.0M a 12 cuotas)\n" +
                     "• `/cuotas 600000 3 23` (Simula $600k a 3 cuotas con tasa 23% E.A.)\n\n" +
                     "🛡️ _Regla de oro: ¡Con tu Tarjeta Nu siempre compras a 1 cuota (0% interés)!_";

    sendTelegram(chatId, menuCuotas, [
      [
        { text: "Simular $600k a 3 ctas", callback_data: "cb:cuotas_sim:600000:3" },
        { text: "Simular $1.2M a 6 ctas", callback_data: "cb:cuotas_sim:1200000:6" }
      ],
      [
        { text: "Simular $3.0M a 12 ctas", callback_data: "cb:cuotas_sim:3000000:12" },
        { text: "Simular $5.0M a 24 ctas", callback_data: "cb:cuotas_sim:5000000:24" }
      ],
      [
        { text: "🟣 Estado Tarjeta Nu", callback_data: "cb:deuda" }
      ]
    ]);
    return;
  }

  // 1.6 Comando /cierre_mes o /scorecard (Auditoría Patrimonial de Fin de Mes)
  if (text === "/cierre_mes" || text === "/scorecard" || text === "/cierre") {
    var reporteScore = generarReporteCierreMes(conf);
    sendTelegram(chatId, reporteScore, [
      [
        { text: "📊 Resumen Mes", callback_data: "cb:reporte" },
        { text: "📈 Inversiones", callback_data: "cb:invertir" }
      ],
      [
        { text: "🎯 Ver Metas", callback_data: "cb:metas" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ]);
    return;
  }

  // 2. Consulta de Saldo en Cuenta Bancaria: /saldo
  if (text === "/saldo") {
    var objSaldo = generarMensajeSaldo(conf);
    sendTelegram(chatId, objSaldo.texto, objSaldo.inlineKb);
    return;
  }

  // 2.1 Consulta de Deuda de Tarjeta Nu: /deuda o /tarjeta
  if (text === "/deuda" || text === "/tarjeta") {
    var objDeuda = generarMensajeDeuda(conf);
    sendTelegram(chatId, objDeuda.texto, objDeuda.inlineKb);
    return;
  }

  // 2.2 Actualizar Deuda de Tarjeta: /set_deuda <monto>
  if (text.startsWith("/set_deuda")) {
    var partesD = text.split(" ");
    var montoD = parseFloat(partesD[1] ? partesD[1].replace(/[^0-9.]/g, '') : "-1");
    if (montoD >= 0) {
      actualizarDeudaTarjeta(montoD);
      var confUpd = obtenerConfiguracionActual();
      sendTelegram(chatId, "✅ *Deuda de Tarjeta Nu registrada:*\n" +
                           "💳 Saldo pendiente a pagar: ||*$" + formatearCOP(montoD) + " COP*||.\n" +
                           "📅 Fecha de pago: *" + confUpd.proximaFechaPagoTarjeta + "* (en " + confUpd.diasParaPagoTarjeta + " días).\n" +
                           "🛡️ Tu liquidez neta real actual es de: ||*$" + formatearCOP(confUpd.liquidezNetaReal) + " COP*||.");
    } else {
      sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/set_deuda 450000`");
    }
    return;
  }

  // 2.3 Registrar Pago de Tarjeta: /pagar_tarjeta [monto]
  if (text.startsWith("/pagar_tarjeta")) {
    var partesP = text.split(" ");
    var montoP = partesP[1] ? parseFloat(partesP[1].replace(/[^0-9.]/g, '')) : null;
    var resPago = pagarTarjetaCredito(montoP);
    if (resPago.error) {
      sendTelegram(chatId, "⚠️ " + resPago.error);
    } else {
      var msgConfirm = "🎉 *¡Pago de Tarjeta Nu registrado con éxito!*\n\n" +
                       "💵 Monto pagado: *$" + formatearCOP(resPago.montoPagado) + " COP*\n" +
                       "💳 Deuda restante de la tarjeta: ||*$" + formatearCOP(resPago.nuevaDeuda) + " COP*||\n" +
                       "💰 Saldo restante en banco: ||*$" + formatearCOP(resPago.nuevoSaldo) + " COP*||\n\n" +
                       "🛡️ _¡Excelente hábito financiero! Pagando a tiempo construyes un historial crediticio intachable._";
      sendTelegram(chatId, msgConfirm);
    }
    return;
  }

  // 3. Ajuste de Saldo Total: /set_saldo_total <monto> o /set_total <monto>
  if (text.startsWith("/set_saldo_total") || text.startsWith("/set_total")) {
    var partesST = text.split(" ");
    var montoST = parseFloat(partesST[1] ? partesST[1].replace(/[^0-9.]/g, '') : "0");
    if (!isNaN(montoST) && montoST >= 0) {
      actualizarSaldoTotalBanco(montoST);
      var confPostST = obtenerConfiguracionActual();
      var msgST = "✅ *Saldo Total Davivienda calibrado con éxito:*\n\n" +
                  "💰 *Saldo Total Banco:* ||*$" + formatearCOP(confPostST.saldoTotalBanco) + " COP*|| *(100%)*\n" +
                  "💎 *Bolsillo Ahorros:* ||*$" + formatearCOP(confPostST.saldoBolsilloAhorro) + " COP*|| *(" + confPostST.pctAhorroReal + "% actual | Regla base: 53%)*\n" +
                  "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(confPostST.saldoBolsilloObligaciones) + " COP*|| *(" + confPostST.pctObligacionesReal + "% actual | Regla base: 27%)*\n" +
                  "🛒 *Saldo Disponible Calculado:* ||*$" + formatearCOP(confPostST.saldoCuenta) + " COP*|| *(" + confPostST.pctDisponibleReal + "% actual | Regla base: 20%)*\n\n" +
                  "📐 _Cálculo exacto: Total ($" + formatearCOP(confPostST.saldoTotalBanco) + ") = Disponible ($" + formatearCOP(confPostST.saldoCuenta) + ") + Ahorros ($" + formatearCOP(confPostST.saldoBolsilloAhorro) + ") + Obligaciones ($" + formatearCOP(confPostST.saldoBolsilloObligaciones) + ")_";
      sendTelegram(chatId, msgST);
      return;
    } else {
      sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/set_saldo_total 3013847`");
      return;
    }
  }

  // 3.1 Ajuste de Saldo Disponible: /set_disponible <monto> o /set_saldo <monto>
  if (text.startsWith("/set_disponible") || text.startsWith("/set_saldo")) {
    var partesS = text.split(" ");
    var montoS = parseFloat(partesS[1] ? partesS[1].replace(/[^0-9.]/g, '') : "0");
    if (!isNaN(montoS) && montoS >= 0) {
      var confPrevS = obtenerConfiguracionActual();
      var sumaBolsillos = (confPrevS.saldoBolsilloAhorro || 0) + (confPrevS.saldoBolsilloObligaciones || 0);

      // Si el usuario ejecutó /set_saldo con un monto mayor a la suma de bolsillos (ej: >$2.3M),
      // es evidente que se trata del saldo total de la cuenta y no solo el disponible de ocio.
      if (montoS > sumaBolsillos && !text.startsWith("/set_disponible") && !text.startsWith("/set_saldo_disponible")) {
        actualizarSaldoTotalBanco(montoS);
        var confPostST = obtenerConfiguracionActual();
        var msgAutoTotal = "💡 *Detecté que ingresaste el Saldo Total de Davivienda ($" + formatearCOP(montoS) + " COP)*\n\n" +
                           "Calibré tu saldo total y deduje tu saldo disponible restando los bolsillos:\n" +
                           "🛒 *Saldo Disponible en Cuenta:* ||*$" + formatearCOP(confPostST.saldoCuenta) + " COP*|| *(" + confPostST.pctDisponibleReal + "% actual)*\n" +
                           "💎 *Bolsillo Ahorros:* ||*$" + formatearCOP(confPostST.saldoBolsilloAhorro) + " COP*|| *(" + confPostST.pctAhorroReal + "% actual)*\n" +
                           "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(confPostST.saldoBolsilloObligaciones) + " COP*|| *(" + confPostST.pctObligacionesReal + "% actual)*\n" +
                           "─────────────────────────────\n" +
                           "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(confPostST.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                           "_(Nota: Para ajustar exclusivamente el disponible líquido, usa `/set_disponible " + montoS + "`)_";
        sendTelegram(chatId, msgAutoTotal);
        return;
      }

      actualizarSaldoCuenta(montoS);
      var confPostS = obtenerConfiguracionActual();
      sendTelegram(chatId, "✅ *Saldo disponible en cuenta actualizado:* ||*$" + formatearCOP(montoS) + " COP*|| *(" + confPostS.pctDisponibleReal + "% actual)*\n" +
                           "💎 *Bolsillo Ahorro:* ||*$" + formatearCOP(confPostS.saldoBolsilloAhorro) + " COP*|| *(" + confPostS.pctAhorroReal + "% actual)*\n" +
                           "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(confPostS.saldoBolsilloObligaciones) + " COP*|| *(" + confPostS.pctObligacionesReal + "% actual)*\n" +
                           "─────────────────────────────\n" +
                           "💰 *Saldo Total en Cuenta Davivienda:* ||*$" + formatearCOP(confPostS.saldoTotalBanco) + " COP*|| *(100%)*");
      return;
    } else {
      sendTelegram(chatId, "⚠️ Formato inválido.\nEjemplos:\n• `/set_disponible 616005`\n• `/set_saldo_total 3013847`");
      return;
    }
  }

  // 3.1 Ajuste de Bolsillo Davivienda: /set_bolsillo <ahorro|obligaciones> <monto>
  if (text.startsWith("/set_bolsillo")) {
    var partesSB = text.split(" ");
    if (partesSB.length >= 3) {
      var tipoB = partesSB[1].toLowerCase();
      var montoS = parseFloat(partesSB[2].replace(/[^0-9.]/g, ''));
      if (!isNaN(montoS) && montoS >= 0) {
        var paramNom = (tipoB.indexOf("ahorro") !== -1) ? "Saldo Bolsillo Ahorro" : "Saldo Bolsillo Obligaciones";
        actualizarParametroConfig(paramNom, montoS);
        if (tipoB.indexOf("ahorro") !== -1) {
          try {
            var ss = SpreadsheetApp.getActiveSpreadsheet();
            var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
            if (shMetas && shMetas.getLastRow() > 1) {
              var rowsM = shMetas.getDataRange().getValues();
              for (var m = 1; m < rowsM.length; m++) {
                var nomM = (rowsM[m][0] || "").toString().toLowerCase();
                if (nomM.indexOf("ahorro") !== -1 || nomM.indexOf("bolsillo") !== -1) {
                  shMetas.getRange(m + 1, 3).setValue(montoS);
                  break;
                }
              }
            }
          } catch(eM) {}
        }
        var confPostB = obtenerConfiguracionActual();
        actualizarParametroConfig("Saldo Total Banco", confPostB.saldoTotalBanco);
        var msgSB = "✅ *Bolsillo Davivienda actualizado con éxito:*\n" +
                    "🏦 *" + paramNom + ":* ||*$" + formatearCOP(montoS) + " COP*||\n\n" +
                    "💰 *Estado Consolidado Davivienda:*\n" +
                    "💎 *Bolsillo Ahorros:* ||*$" + formatearCOP(confPostB.saldoBolsilloAhorro) + " COP*|| *(" + confPostB.pctAhorroReal + "% actual)*\n" +
                    "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(confPostB.saldoBolsilloObligaciones) + " COP*|| *(" + confPostB.pctObligacionesReal + "% actual)*\n" +
                    "🛒 *Disponible en Cuenta:* ||*$" + formatearCOP(confPostB.saldoCuenta) + " COP*|| *(" + confPostB.pctDisponibleReal + "% actual)*\n" +
                    "─────────────────────────────\n" +
                    "💳 *Saldo Total Banco:* ||*$" + formatearCOP(confPostB.saldoTotalBanco) + " COP*|| *(100%)*";
        sendTelegram(chatId, msgSB);
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido.\nEjemplos:\n• `/set_bolsillo ahorro 1561218`\n• `/set_bolsillo obligaciones 836624`");
    return;
  }

  // 3.2 Traslado Interno a Bolsillo: /traslado <ahorro|obligaciones> <monto>
  if (text.startsWith("/traslado") || text.startsWith("/pasar") || text.startsWith("/mover")) {
    var partesTr = text.split(" ");
    if (partesTr.length >= 3) {
      var tipoTr = partesTr[1].toLowerCase();
      var montoTr = parseFloat(partesTr[2].replace(/[^0-9.]/g, ''));
      if (!isNaN(montoTr) && montoTr > 0) {
        var resTr = trasladarABolsillo(tipoTr, montoTr);
        var msgTr = "🔄 *Traslado Interno Davivienda exitoso:*\n\n" +
                    "💵 *Monto trasladado:* ||*$" + formatearCOP(montoTr) + " COP*||\n" +
                    "🛒 *Nuevo Saldo Disponible:* ||*$" + formatearCOP(resTr.nuevoDisponible) + " COP*|| *(" + resTr.pctDisponible + "% actual)*\n" +
                    "🏦 *Nuevo Saldo Bolsillo " + resTr.bolsilloNom + ":* ||*$" + formatearCOP(resTr.nuevoBolsillo) + " COP*|| *(" + (resTr.bolsilloNom === "Ahorro" ? resTr.pctAhorro : resTr.pctObligaciones) + "% actual)*\n" +
                    "─────────────────────────────\n" +
                    "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(resTr.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                    "✨ _Tu plata total sigue intacta ($" + formatearCOP(resTr.saldoTotalBanco) + " COP), únicamente redistribuiste entre disponible y bolsillo._";
        sendTelegram(chatId, msgTr);
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido.\nEjemplos:\n• `/traslado ahorro 500000`\n• `/traslado obligaciones 200000`");
    return;
  }

  // 3.3 Retiro de Bolsillo a Disponible: /retirar_bolsillo <ahorro|obligaciones> <monto>
  if (text.startsWith("/retirar_bolsillo") || text.startsWith("/sacar_bolsillo")) {
    var partesRet = text.split(" ");
    if (partesRet.length >= 3) {
      var tipoRet = partesRet[1].toLowerCase();
      var montoRet = parseFloat(partesRet[2].replace(/[^0-9.]/g, ''));
      if (!isNaN(montoRet) && montoRet > 0) {
        var resRet = trasladarDeBolsillo(tipoRet, montoRet);
        var msgRet = "🔄 *Retiro de Bolsillo a Disponible exitoso:*\n\n" +
                     "💵 *Monto devuelto:* ||*$" + formatearCOP(montoRet) + " COP*||\n" +
                     "🛒 *Nuevo Saldo Disponible:* ||*$" + formatearCOP(resRet.nuevoDisponible) + " COP*|| *(" + resRet.pctDisponible + "% actual)*\n" +
                     "🏦 *Saldo restante en Bolsillo " + resRet.bolsilloNom + ":* ||*$" + formatearCOP(resRet.nuevoBolsillo) + " COP*|| *(" + (resRet.bolsilloNom === "Ahorro" ? resRet.pctAhorro : resRet.pctObligaciones) + "% actual)*\n" +
                     "─────────────────────────────\n" +
                     "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(resRet.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                     "✨ _Tu plata total sigue intacta ($" + formatearCOP(resRet.saldoTotalBanco) + " COP)._";
        sendTelegram(chatId, msgRet);
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido.\nEjemplos:\n• `/retirar_bolsillo ahorro 200000`\n• `/sacar_bolsillo ahorro 100000`");
    return;
  }

  // 4. Registro de Ingreso: /ingreso <monto> <concepto>
  if (text.startsWith("/ingreso")) {
    var partesIng = text.split(" ");
    if (partesIng.length >= 3) {
      var montoIng = parseFloat(partesIng[1].replace(/[^0-9.]/g, ''));
      var conceptoIng = partesIng.slice(2).join(" ");
      if (montoIng > 0) {
        var nuevoS = agregarIngresoCuenta(montoIng, conceptoIng);
        sendTelegram(chatId, "🎉 *¡Ingreso registrado!*\n💵 +*$" + formatearCOP(montoIng) + " COP* (" + conceptoIng + ")\n💰 *Nuevo Saldo en Cuenta:* ||*$" + formatearCOP(nuevoS) + " COP*||");
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/ingreso 3200000 Pago de Nómina`");
    return;
  }

  // 5. Registro Manual: /gasto <monto> <concepto>
  if (text.startsWith("/gasto")) {
    handleGastoManual(chatId, text);
    return;
  }

  // 6. Modificación Directa: /set_presupuesto <monto>
  if (text.startsWith("/set_presupuesto")) {
    var partes = text.split(" ");
    var monto = parseFloat(partes[1] ? partes[1].replace(/[^0-9.]/g, '') : "0");
    if (monto > 0) {
      actualizarParametroConfig("Presupuesto Gastos Variables", monto);
      sendTelegram(chatId, "✅ *Presupuesto variable actualizado:* Nuevo límite mensual de *$" + formatearCOP(monto) + " COP*.");
    } else {
      sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/set_presupuesto 1000000`");
    }
    return;
  }

  // 7. Modificación Directa: /set_salario <monto>
  if (text.startsWith("/set_salario")) {
    var partesSal = text.split(" ");
    var montoSal = parseFloat(partesSal[1] ? partesSal[1].replace(/[^0-9.]/g, '') : "0");
    if (montoSal > 0) {
      actualizarParametroConfig("Salario Mensual Neto", montoSal);
      sendTelegram(chatId, "✅ *Salario actualizado:* Nuevo ingreso mensual registrado de *$" + formatearCOP(montoSal) + " COP*.");
    } else {
      sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/set_salario 3500000`");
    }
    return;
  }

  // 8. Creación de Meta: /nueva_meta <nombre> <monto>
  if (text.startsWith("/nueva_meta")) {
    var partesMeta = text.split(" ");
    if (partesMeta.length >= 3) {
      var montoM = parseFloat(partesMeta[partesMeta.length - 1].replace(/[^0-9.]/g, ''));
      var nombreM = partesMeta.slice(1, partesMeta.length - 1).join(" ");
      if (montoM > 0 && nombreM) {
        crearMetaAhorro(nombreM, montoM, 6);
        sendTelegram(chatId, "🎯 *Nueva meta creada:* *" + nombreM + "* con objetivo de *$" + formatearCOP(montoM) + " COP*.");
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/nueva_meta Moto Nueva 6000000`");
    return;
  }

  // 9. Abono a Meta: /abono <nombre_meta> <monto>
  if (text.startsWith("/abono")) {
    var partesAb = text.split(" ");
    if (partesAb.length >= 3) {
      var montoAb = parseFloat(partesAb[partesAb.length - 1].replace(/[^0-9.]/g, ''));
      var nombreAb = partesAb.slice(1, partesAb.length - 1).join(" ");
      if (montoAb > 0 && nombreAb) {
        var resAbono = abonarAMeta(nombreAb, montoAb);
        sendTelegram(chatId, resAbono);
        return;
      }
    }
    sendTelegram(chatId, "⚠️ Formato inválido. Ejemplo: `/abono Fondo 200000`");
    return;
  }

  // 10. Comando /reporte o /resumen
  if (text === "/reporte" || text === "/resumen") {
    var reporteObj = generarMensajeReporte(resumenMes, conf);
    sendTelegram(chatId, reporteObj.texto, reporteObj.inlineKb);
    return;
  }

  // 11. Comando /metas
  if (text === "/metas") {
    var metasObj = generarMensajeMetas(conf);
    sendTelegram(chatId, metasObj.texto, metasObj.inlineKb);
    return;
  }

  // 12. Conversación Libre o Asesoría con Gemini (Con Memoria Conversacional)
  enviarAccionChat(chatId, "typing");

  var historial = obtenerHistorialChat(chatId);
  var systemInstruction = construirSystemInstructionFinanciero(resumenMes, conf);
  var respuestaIA = llamarGeminiConversacional(systemInstruction, text, null, null, historial);

  var respuestaProcesada = procesarAccionesGemini(respuestaIA);

  // Guardar en el historial de conversación (texto limpio sin tags de acción)
  var textoParaHistorial = respuestaIA.replace(/\[ACCION:\s*([A-Z_]+)\s*(.*?)\]/gi, "").trim();
  historial.push({ role: "user", text: text });
  historial.push({ role: "model", text: textoParaHistorial });
  guardarHistorialChat(chatId, historial);

  sendTelegram(chatId, respuestaProcesada);

  // Si Gemini registró un gasto en la conversación, solicitar ubicación
  if (/\[ACCION:\s*REGISTRAR_GASTO/i.test(respuestaIA)) {
    solicitarUbicacionPostGasto(chatId);
  }
}

// ==========================================
// GESTOR DE CAPTURAS DE PANTALLA / FOTOS (Nequi, Davivienda, etc.)
// ==========================================
function handleTelegramPhoto(msg) {
  var chatId = msg.chat.id.toString();
  enviarAccionChat(chatId, "upload_photo");
  sendTelegram(chatId, "📸 *Analizando comprobante de pago con Gemini Multimodal...*");
  enviarAccionChat(chatId, "typing");

  try {
    var fileId;
    if (msg.photo && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.document) {
      fileId = msg.document.file_id;
    }

    if (!fileId) {
      sendTelegram(chatId, "⚠️ No pude encontrar la imagen enviada.");
      return;
    }

    var fileData = descargarArchivoTelegram(fileId);
    if (!fileData) {
      sendTelegram(chatId, "⚠️ No pude descargar la imagen del comprobante.");
      return;
    }

    var conf = obtenerConfiguracionActual();
    var resumenMes = obtenerResumenMesActual();

    var promptVision = "Analiza minuciosamente esta imagen (comprobante bancario, recibo de pago, comprobante de ingreso o captura de app financiera como Nequi, Davivienda, Nu, Bancolombia, DaviPlata, PSE, etc.).\n\n" +
      "DETERMINA EL TIPO EXACTO DE OPERACIÓN:\n\n" +
      "1. 🔴 GASTO / COMPRA / SALIDA DE DINERO (pago a un comercio, restaurante, factura, compra o transferencia enviada a otra persona):\n" +
      "   - Extrae importe exacto en COP, comercio/destinatario, categoría sugerida y medio/banco.\n" +
      "   - Agrega al final: [ACCION: REGISTRAR_GASTO <monto_numerico> | <comercio> | <categoria> | <banco_o_medio>]\n\n" +
      "2. 🟢 INGRESO / ENTRADA DE DINERO (dinero recibido a favor del usuario, consignación recibida, pago de nómina, transferencia recibida de un tercero):\n" +
      "   - Si es nómina quincenal: [ACCION: COBRAR_QUINCENA]\n" +
      "   - Si es otro ingreso externo: [ACCION: AGREGAR_INGRESO <monto_numerico> | <concepto>]\n\n" +
      "3. 🔄 TRASLADO INTERNO ENTRE BOLSILLOS (dinero movido entre la cuenta disponible y un bolsillo de ahorro u obligaciones dentro de Davivienda):\n" +
      "   - Si el dinero se metió/trasladó al bolsillo: [ACCION: TRASLADAR_A_BOLSILLO <ahorro|obligaciones> | <monto_numerico>]\n" +
      "   - Si el dinero se sacó del bolsillo a la cuenta: [ACCION: TRASLADAR_DE_BOLSILLO <ahorro|obligaciones> | <monto_numerico>]\n\n" +
      "4. 🟣 TARJETA NU:\n" +
      "   - Si muestra extracto o deuda pendiente a pagar: [ACCION: SET_DEUDA_TARJETA <monto_numerico>]\n" +
      "   - Si es comprobante de pago de la tarjeta Nu: [ACCION: PAGAR_TARJETA <monto_numerico>]\n\n" +
      "ESTILO OBLIGATORIO: Sé ultra conciso (máximo 2 a 3 líneas). Resume la transacción con viñetas limpias y emojis. Si no contiene datos financieros legibles, indícalo en una sola frase breve.";

    var historial = obtenerHistorialChat(chatId);
    var systemInstruction = construirSystemInstructionFinanciero(resumenMes, conf);
    var respuestaIA = llamarGeminiConversacional(systemInstruction, promptVision, fileData.mimeType, fileData.base64, historial);
    var respuestaProcesada = procesarAccionesGemini(respuestaIA);

    var textoParaHistorial = respuestaIA.replace(/\[ACCION:\s*([A-Z_]+)\s*(.*?)\]/gi, "").trim();
    historial.push({ role: "user", text: "[Comprobante bancario o imagen enviada]" });
    historial.push({ role: "model", text: textoParaHistorial });
    guardarHistorialChat(chatId, historial);

    sendTelegram(chatId, respuestaProcesada);

    // Si Gemini registró un gasto, solicitar ubicación
    if (/\[ACCION:\s*REGISTRAR_GASTO/i.test(respuestaIA)) {
      solicitarUbicacionPostGasto(chatId);
    }

  } catch (err) {
    Logger.log("Error procesando foto: " + err.toString());
    sendTelegram(chatId, "⚠️ Ocurrió un error al analizar la imagen: " + err.toString());
  }
}

// ==========================================
// GESTOR DE NOTAS DE VOZ Y AUDIOS
// ==========================================
function handleTelegramVoice(msg) {
  var chatId = msg.chat.id.toString();
  enviarAccionChat(chatId, "record_voice");
  sendTelegram(chatId, "🎙️ *Escuchando tu nota de voz con Gemini...*");
  enviarAccionChat(chatId, "typing");

  try {
    var voice = msg.voice || msg.audio;
    var fileData = descargarArchivoTelegram(voice.file_id);
    if (!fileData) {
      sendTelegram(chatId, "⚠️ No pude procesar el audio.");
      return;
    }

    var conf = obtenerConfiguracionActual();
    var resumenMes = obtenerResumenMesActual();

    var promptAudio = "Escucha atentamente esta nota de voz del usuario y determina el tipo exacto de operación:\n\n" +
      "1. 🔴 GASTO (El usuario gastó, compró, pagó un servicio/comida o envió una transferencia de pago):\n" +
      "   [ACCION: REGISTRAR_GASTO <monto_numerico> | <concepto> | <categoria> | Audio Telegram]\n\n" +
      "2. 🟢 INGRESO EXTERNO (El usuario recibió dinero nuevo del exterior, le pagaron o le consignaron):\n" +
      "   - Si menciona su nómina/quincena de nómina: [ACCION: COBRAR_QUINCENA]\n" +
      "   - Si es otro ingreso externo recibido: [ACCION: AGREGAR_INGRESO <monto_numerico> | <concepto>]\n\n" +
      "3. 🔄 TRASLADO INTERNO ENTRE BOLSILLOS (¡ATENCIÓN! El usuario movió plata entre disponible y sus bolsillos Davivienda):\n" +
      "   - Si pasó, metió o guardó dinero en el bolsillo: [ACCION: TRASLADAR_A_BOLSILLO <ahorro|obligaciones> | <monto_numerico>]\n" +
      "   - Si sacó o retiró dinero del bolsillo a la cuenta disponible: [ACCION: TRASLADAR_DE_BOLSILLO <ahorro|obligaciones> | <monto_numerico>]\n" +
      "   - (Recuerda: Un traslado NO es un gasto ni un ingreso; la plata total de Davivienda se mantiene intacta).\n\n" +
      "4. 🟣 TARJETA NU:\n" +
      "   - Si menciona cuánto debe en Nu: [ACCION: SET_DEUDA_TARJETA <monto_numerico>]\n" +
      "   - Si menciona que pagó la tarjeta Nu: [ACCION: PAGAR_TARJETA <monto_numerico>]\n\n" +
      "5. 🏦 CALIBRACIÓN SALDO BANCO:\n" +
      "   - Si menciona su saldo total en Davivienda: [ACCION: SET_SALDO_TOTAL <monto_numerico>]\n" +
      "   - Si menciona su saldo disponible libre: [ACCION: SET_SALDO_DISPONIBLE <monto_numerico>]\n\n" +
      "ESTILO OBLIGATORIO: Sé ultra conciso (máximo 2 a 3 líneas), directo y al grano. Cero rodeos.";

    var historial = obtenerHistorialChat(chatId);
    var systemInstruction = construirSystemInstructionFinanciero(resumenMes, conf);
    var respuestaIA = llamarGeminiConversacional(systemInstruction, promptAudio, fileData.mimeType || "audio/ogg", fileData.base64, historial);
    var respuestaProcesada = procesarAccionesGemini(respuestaIA);

    var textoParaHistorial = respuestaIA.replace(/\[ACCION:\s*([A-Z_]+)\s*(.*?)\]/gi, "").trim();
    historial.push({ role: "user", text: "[Nota de voz enviada]" });
    historial.push({ role: "model", text: textoParaHistorial });
    guardarHistorialChat(chatId, historial);

    sendTelegram(chatId, respuestaProcesada);

    // Si Gemini registró un gasto, solicitar ubicación
    if (/\[ACCION:\s*REGISTRAR_GASTO/i.test(respuestaIA)) {
      solicitarUbicacionPostGasto(chatId);
    }

  } catch (err) {
    Logger.log("Error procesando audio: " + err.toString());
    sendTelegram(chatId, "⚠️ Ocurrió un error al escuchar el audio: " + err.toString());
  }
}

// ==========================================
// DESCARGADOR DE ARCHIVOS DESDE TELEGRAM (FOTOS / AUDIOS)
// ==========================================
function descargarArchivoTelegram(fileId) {
  var token = CONFIG.TELEGRAM_TOKEN;
  var getFileUrl = "https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileId;
  var res = UrlFetchApp.fetch(getFileUrl);
  var json = JSON.parse(res.getContentText());

  if (!json.ok || !json.result || !json.result.file_path) {
    return null;
  }

  var filePath = json.result.file_path;
  var downloadUrl = "https://api.telegram.org/file/bot" + token + "/" + filePath;
  var fileBlob = UrlFetchApp.fetch(downloadUrl).getBlob();

  var rawMime = fileBlob.getContentType();
  var lowerPath = filePath.toLowerCase();
  var finalMime = "image/jpeg";

  // Mapear estrictamente los tipos MIME admitidos por Gemini Multimodal
  if (lowerPath.indexOf(".png") !== -1 || rawMime === "image/png") {
    finalMime = "image/png";
  } else if (lowerPath.indexOf(".webp") !== -1 || rawMime === "image/webp") {
    finalMime = "image/webp";
  } else if (lowerPath.indexOf(".oga") !== -1 || lowerPath.indexOf(".ogg") !== -1 || rawMime === "audio/ogg") {
    finalMime = "audio/ogg";
  } else if (lowerPath.indexOf(".mp3") !== -1 || rawMime === "audio/mp3") {
    finalMime = "audio/mp3";
  } else if (lowerPath.indexOf(".m4a") !== -1 || rawMime === "audio/m4a") {
    finalMime = "audio/m4a";
  } else if (lowerPath.indexOf("voice") !== -1) {
    finalMime = "audio/ogg";
  } else {
    finalMime = "image/jpeg";
  }

  Logger.log("Archivo descargado de Telegram: " + filePath + " | MIME: " + finalMime + " | Tam: " + fileBlob.getBytes().length);

  return {
    mimeType: finalMime,
    base64: Utilities.base64Encode(fileBlob.getBytes())
  };
}

// ==========================================
// GESTIÓN DE SALDO BANCARIO
// ==========================================
function descontarSaldoCuenta(monto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig) return;
  var datos = shConfig.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] === "Saldo en Cuenta Bancaria") {
      var saldoActual = parseFloat(datos[i][1]) || 0;
      var nuevoSaldo = saldoActual - monto;
      shConfig.getRange(i + 1, 2).setValue(nuevoSaldo);
      recalcularSaldoTotalBanco();
      return nuevoSaldo;
    }
  }
  shConfig.appendRow(["Saldo en Cuenta Bancaria", -monto, "Dinero disponible actualmente en bancos"]);
  recalcularSaldoTotalBanco();
  return -monto;
}

function actualizarSaldoCuenta(nuevoSaldo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig) return;
  var datos = shConfig.getDataRange().getValues();
  var encontrado = false;
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] === "Saldo en Cuenta Bancaria") {
      shConfig.getRange(i + 1, 2).setValue(nuevoSaldo);
      encontrado = true;
      break;
    }
  }
  if (!encontrado) {
    shConfig.appendRow(["Saldo en Cuenta Bancaria", nuevoSaldo, "Dinero disponible actualmente en bancos"]);
  }
  recalcularSaldoTotalBanco();
  return nuevoSaldo;
}

function actualizarSaldoTotalBanco(nuevoMontoTotal) {
  var conf = obtenerConfiguracionActual();
  var sAhorro = conf.saldoBolsilloAhorro || 0;
  var sOblig = conf.saldoBolsilloObligaciones || 0;
  var nuevoDisponible = Math.max(0, nuevoMontoTotal - (sAhorro + sOblig));
  actualizarSaldoCuenta(nuevoDisponible);
  return recalcularSaldoTotalBanco();
}

function agregarIngresoCuenta(monto, concepto, medio) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  var nuevoSaldo = 0;
  if (shConfig) {
    var datos = shConfig.getDataRange().getValues();
    var encontrado = false;
    for (var i = 1; i < datos.length; i++) {
      if (datos[i][0] === "Saldo en Cuenta Bancaria") {
        var saldoActual = parseFloat(datos[i][1]) || 0;
        nuevoSaldo = saldoActual + monto;
        shConfig.getRange(i + 1, 2).setValue(nuevoSaldo);
        encontrado = true;
        break;
      }
    }
    if (!encontrado) {
      nuevoSaldo = monto;
      shConfig.appendRow(["Saldo en Cuenta Bancaria", monto, "Dinero disponible actualmente en bancos"]);
    }
    recalcularSaldoTotalBanco();
  }

  // Registrar en Hoja de Transacciones como 🟢 Ingreso
  try {
    var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
    if (sheet) {
      var fStr = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
      sheet.appendRow([
        fStr,
        "🟢 Ingreso",
        concepto || "Ingreso adicional",
        monto,
        medio || "Transferencia / Consignación",
        "Ingreso Adicional",
        "Telegram Bot",
        new Date().getTime()
      ]);
    }
  } catch(e) {
    Logger.log("Error registrando ingreso en hoja: " + e.toString());
  }

  return nuevoSaldo;
}

function actualizarSaldoBolsillo(tipo, nuevoMonto) {
  var paramNom = (tipo.toLowerCase().indexOf("ahorro") !== -1) ? "Saldo Bolsillo Ahorro" : "Saldo Bolsillo Obligaciones";
  actualizarParametroConfig(paramNom, nuevoMonto);
  if (tipo.toLowerCase().indexOf("ahorro") !== -1) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
      if (shMetas && shMetas.getLastRow() > 1) {
        var rowsM = shMetas.getDataRange().getValues();
        for (var m = 1; m < rowsM.length; m++) {
          var nomM = (rowsM[m][0] || "").toString().toLowerCase();
          if (nomM.indexOf("ahorro") !== -1 || nomM.indexOf("bolsillo") !== -1) {
            shMetas.getRange(m + 1, 3).setValue(nuevoMonto);
            break;
          }
        }
      }
    } catch(eM) {}

    // Sincronizar sub-bolsillos virtuales (70% Emergencia, 20% CDT, 10% Cripto)
    try {
      actualizarParametroConfig("Sub-Bolsillo Emergencia (70%)", Math.round(nuevoMonto * 0.70));
      actualizarParametroConfig("Sub-Bolsillo Micro-CDT (20%)", Math.round(nuevoMonto * 0.20));
      actualizarParametroConfig("Sub-Bolsillo Micro-Cripto (10%)", Math.round(nuevoMonto * 0.10));
    } catch(eSub) {}
  }
  return recalcularSaldoTotalBanco();
}

function trasladarABolsillo(tipo, monto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = obtenerConfiguracionActual();
  var sDisp = conf.saldoCuenta;
  var sAhorro = conf.saldoBolsilloAhorro;
  var sOblig = conf.saldoBolsilloObligaciones;

  var nuevoDisp = sDisp - monto;
  actualizarParametroConfig("Saldo en Cuenta Bancaria", nuevoDisp);

  var esAhorro = (tipo.toLowerCase().indexOf("ahorro") !== -1);
  var nomBolsillo = esAhorro ? "Ahorro" : "Obligaciones";
  var nuevoBolsillo = 0;

  if (esAhorro) {
    nuevoBolsillo = sAhorro + monto;
    actualizarSaldoBolsillo("ahorro", nuevoBolsillo);
  } else {
    nuevoBolsillo = sOblig + monto;
    actualizarSaldoBolsillo("obligaciones", nuevoBolsillo);
  }

  var totalFinal = recalcularSaldoTotalBanco();
  var confActual = obtenerConfiguracionActual();

  return {
    monto: monto,
    bolsilloNom: nomBolsillo,
    nuevoDisponible: nuevoDisp,
    nuevoBolsillo: nuevoBolsillo,
    saldoTotalBanco: totalFinal,
    pctDisponible: confActual.pctDisponibleReal,
    pctAhorro: confActual.pctAhorroReal,
    pctObligaciones: confActual.pctObligacionesReal
  };
}

function trasladarDeBolsillo(tipo, monto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = obtenerConfiguracionActual();
  var sDisp = conf.saldoCuenta;
  var sAhorro = conf.saldoBolsilloAhorro;
  var sOblig = conf.saldoBolsilloObligaciones;

  var nuevoDisp = sDisp + monto;
  actualizarParametroConfig("Saldo en Cuenta Bancaria", nuevoDisp);

  var esAhorro = (tipo.toLowerCase().indexOf("ahorro") !== -1);
  var nomBolsillo = esAhorro ? "Ahorro" : "Obligaciones";
  var nuevoBolsillo = 0;

  if (esAhorro) {
    nuevoBolsillo = Math.max(0, sAhorro - monto);
    actualizarSaldoBolsillo("ahorro", nuevoBolsillo);
  } else {
    nuevoBolsillo = Math.max(0, sOblig - monto);
    actualizarSaldoBolsillo("obligaciones", nuevoBolsillo);
  }

  var totalFinal = recalcularSaldoTotalBanco();
  var confActual = obtenerConfiguracionActual();

  // Registrar en hoja de Transacciones como 🔄 Traslado Interno
  try {
    var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
    if (sheet) {
      var fStr = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
      sheet.appendRow([
        fStr,
        "🔄 Traslado Interno",
        "Retiro de Bolsillo " + nomBolsillo,
        monto,
        "Davivienda",
        "Bolsillos / " + nomBolsillo,
        "Telegram Bot",
        new Date().getTime()
      ]);
    }
  } catch(eT) {
    Logger.log("Error registrando retiro de bolsillo: " + eT.toString());
  }

  return {
    monto: monto,
    bolsilloNom: nomBolsillo,
    nuevoDisponible: nuevoDisp,
    nuevoBolsillo: nuevoBolsillo,
    saldoTotalBanco: totalFinal,
    pctDisponible: confActual.pctDisponibleReal,
    pctAhorro: confActual.pctAhorroReal,
    pctObligaciones: confActual.pctObligacionesReal
  };
}

function recalcularSaldoTotalBanco() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig || shConfig.getLastRow() < 2) return 0;
  var datos = shConfig.getDataRange().getValues();
  var sDisp = 0, sAhorro = 0, sOblig = 0;
  var filaTotal = -1;
  for (var i = 1; i < datos.length; i++) {
    var p = datos[i][0];
    var v = parseFloat(datos[i][1]) || 0;
    if (p === "Saldo en Cuenta Bancaria") sDisp = v;
    if (p === "Saldo Bolsillo Ahorro") sAhorro = v;
    if (p === "Saldo Bolsillo Obligaciones") sOblig = v;
    if (p === "Saldo Total Banco") filaTotal = i + 1;
  }
  var total = sDisp + sAhorro + sOblig;
  if (filaTotal > 0) {
    shConfig.getRange(filaTotal, 2).setValue(total);
  } else {
    shConfig.appendRow(["Saldo Total Banco", total, "Total consolidado en cuenta Davivienda (Disponible + Bolsillos)"]);
  }
  return total;
}

// ==========================================
// REGISTRO DE PAGO DE NÓMINA (NÓMINA EMPRESA)
// ==========================================
function cobrarQuincenaNomina(montoPersonalizado) {
  var conf = obtenerConfiguracionActual();
  var hoy = new Date();
  var diaHoy = hoy.getDate();
  var esQuincena1 = (diaHoy <= 20);

  var monto = montoPersonalizado && montoPersonalizado > 0 ? montoPersonalizado :
              (esQuincena1 ? CONFIG.QUINCENA_15_NETO : CONFIG.QUINCENA_30_NETO);
  var nombreQ = esQuincena1 ? "1ª Quincena (Día 15)" : "2ª Quincena (Día 30)";

  // En Davivienda:
  // Día 15 (Q1):
  //   - Se fondea automáticamente el Bolsillo Obligaciones con $863.610 COP (cubre Arriendo $600k, Nu, Claro, Gasolina)
  //   - $0 COP a Bolsillo Ahorro
  //   - Deja el disponible en ~$608.390 COP + remanentes previos
  // Día 30 (Q2):
  //   - Se fondea automáticamente el Bolsillo Ahorro con $1.690.866 COP (53% ahorro puro)
  //   - Pago de Arriendo ($600.000 COP) desde Bolsillo Obligaciones
  //   - Suma +$30.229 COP al disponible
  var debitoObligaciones = esQuincena1 ? (conf.gastosFijosTotal || CONFIG.DEFAULT_BOLSILLO_OBLIGACIONES || 863610) : 0;
  var debitoAhorro = esQuincena1 ? 0 : (conf.metaAhorroMensual || CONFIG.DEFAULT_BOLSILLO_AHORRO || 1690866);
  var incrementoDisponible = esQuincena1 ? (monto - debitoObligaciones) : (monto - debitoAhorro);

  var nuevoSaldoBolsilloObligaciones = conf.saldoBolsilloObligaciones;
  var nuevoSaldoBolsilloAhorro = conf.saldoBolsilloAhorro;

  if (esQuincena1) {
    nuevoSaldoBolsilloObligaciones += debitoObligaciones;
    actualizarParametroConfig("Saldo Bolsillo Obligaciones", nuevoSaldoBolsilloObligaciones);
  } else {
    nuevoSaldoBolsilloAhorro += debitoAhorro;
    actualizarParametroConfig("Saldo Bolsillo Ahorro", nuevoSaldoBolsilloAhorro);
    // En Q2 se ejecuta el pago de arriendo debitándolo del bolsillo de obligaciones
    nuevoSaldoBolsilloObligaciones = Math.max(nuevoSaldoBolsilloObligaciones - (CONFIG.DEFAULT_VALOR_ARRIENDO || 600000), 0);
    actualizarParametroConfig("Saldo Bolsillo Obligaciones", nuevoSaldoBolsilloObligaciones);

    // Actualizar meta en Hoja Metas
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
      if (shMetas && shMetas.getLastRow() > 1) {
        var rowsM = shMetas.getDataRange().getValues();
        for (var m = 1; m < rowsM.length; m++) {
          var nomM = (rowsM[m][0] || "").toString().toLowerCase();
          if (nomM.indexOf("ahorro") !== -1 || nomM.indexOf("bolsillo") !== -1) {
            shMetas.getRange(m + 1, 3).setValue(nuevoSaldoBolsilloAhorro);
            break;
          }
        }
      }
    } catch(eMetas) {
      Logger.log("Error actualizando meta de ahorro: " + eMetas.toString());
    }
  }

  // Actualizar saldo disponible en cuenta
  var nuevoSaldoDisponible = conf.saldoCuenta + incrementoDisponible;
  actualizarSaldoCuenta(nuevoSaldoDisponible);

  // Recalcular saldo total del banco
  var nuevoSaldoTotalBanco = recalcularSaldoTotalBanco();

  // Registrar en hoja de Transacciones
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
    if (sheet) {
      var fechaTexto = Utilities.formatDate(hoy, CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
      sheet.appendRow([
        fechaTexto,
        "🟢 Ingreso",
        "Nómina Quincenal (" + nombreQ + ")",
        monto,
        "Transferencia Bancaria",
        "Nómina / Salario",
        "Telegram Bot",
        new Date().getTime()
      ]);
      if (!esQuincena1) {
        sheet.appendRow([
          fechaTexto,
          "🔄 Transferencia",
          "Pago Arriendo (Débito Bolsillo Obligaciones)",
          CONFIG.DEFAULT_VALOR_ARRIENDO || 600000,
          "Bolsillo Davivienda",
          "Arriendo / Vivienda",
          "Sistema Quincenal",
          new Date().getTime() + 1
        ]);
      }
    }
  } catch (e) {
    Logger.log("Error registrando transacción de nómina: " + e.toString());
  }

  var confPost = obtenerConfiguracionActual();
  var flujo = confPost.flujoQuincenal;
  var diasRestantesPeriodo = esQuincena1 ? 30 : 15;
  var cupoDiarioQ = Math.max(Math.round(nuevoSaldoDisponible / diasRestantesPeriodo), 0);

  return {
    monto: monto,
    nombreQ: nombreQ,
    esQuincena1: esQuincena1,
    nuevoSaldo: nuevoSaldoDisponible,
    saldoDisponible: nuevoSaldoDisponible,
    saldoBolsilloAhorro: nuevoSaldoBolsilloAhorro,
    saldoBolsilloObligaciones: nuevoSaldoBolsilloObligaciones,
    saldoTotalBanco: nuevoSaldoTotalBanco,
    debitoObligaciones: debitoObligaciones,
    debitoAhorro: debitoAhorro,
    incrementoDisponible: incrementoDisponible,
    cupoDiarioQ: cupoDiarioQ,
    diaProximoPago: flujo.diaProximoPago,
    diasRestantes: diasRestantesPeriodo
  };
}

// ==========================================
// GESTIÓN DE TARJETA DE CRÉDITO NU (PAGO DÍA 11)
// ==========================================
function actualizarDeudaTarjeta(nuevaDeuda) {
  actualizarParametroConfig("Deuda Tarjeta de Crédito Nu", nuevaDeuda);
  return nuevaDeuda;
}

function pagarTarjetaCredito(monto) {
  var conf = obtenerConfiguracionActual();
  var montoPagado = monto !== null && monto !== undefined && monto > 0 ? monto : conf.deudaTarjetaNu;
  if (montoPagado <= 0) {
    return { error: "No tienes deuda registrada o el monto es inválido." };
  }

  // 1. Descontar del saldo bancario disponible
  var nuevoSaldo = descontarSaldoCuenta(montoPagado);

  // 2. Reducir la deuda registrada en la tarjeta Nu
  var nuevaDeuda = Math.max(conf.deudaTarjetaNu - montoPagado, 0);
  actualizarParametroConfig("Deuda Tarjeta de Crédito Nu", nuevaDeuda);

  // 3. Registrar en Transacciones para trazabilidad
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
    if (sheet) {
      var fechaTexto = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
      sheet.appendRow([
        fechaTexto,
        "🔄 Transferencia",
        "Pago Tarjeta de Crédito Nu",
        montoPagado,
        "Transferencia / Débito",
        "Pago Tarjeta de Crédito",
        "Telegram Bot",
        new Date().getTime()
      ]);
    }
  } catch (e) {
    Logger.log("Error registrando fila de pago de tarjeta: " + e.toString());
  }

  return {
    montoPagado: montoPagado,
    nuevoSaldo: nuevoSaldo,
    nuevaDeuda: nuevaDeuda
  };
}

// ==========================================
// REGISTRO DE GASTO MANUAL (/gasto 20000 Gasolina)
// ==========================================
function handleGastoManual(chatId, text) {
  var partes = text.split(" ");
  if (partes.length < 3) {
    sendTelegram(chatId, "⚠️ *Formato incorrecto.* Usa:\n`/gasto 25000 Almuerzo con amigos`\n`/gasto 60000 Gasolina moto`");
    return;
  }

  var monto = sanitizarImporteCOP(partes[1]);
  var concepto = partes.slice(2).join(" ");

  if (isNaN(monto) || monto <= 0) {
    sendTelegram(chatId, "⚠️ El monto indicado no es válido.");
    return;
  }

  var cache = CacheService.getScriptCache();
  var pendingLocStr = cache.get("pending_location_" + chatId);
  var ubiGasto = { lat: null, lng: null, ubicacion: "" };
  if (pendingLocStr) {
    try {
      ubiGasto = JSON.parse(pendingLocStr);
      cache.remove("pending_location_" + chatId);
    } catch(eLoc) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (sheet) {
    asegurarColumnasUbicacion(sheet);
  }
  var fechaActual = new Date();
  var fechaTexto = Utilities.formatDate(fechaActual, CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
  var idTimestamp = new Date().getTime();

  sheet.appendRow([
    fechaTexto,
    "🔴 Gasto",
    concepto,
    monto,
    "Efectivo / PSE",
    "Gasto Manual",
    "Telegram Bot",
    idTimestamp,
    ubiGasto.lat !== null ? ubiGasto.lat : "",
    ubiGasto.lng !== null ? ubiGasto.lng : "",
    ubiGasto.ubicacion || ""
  ]);

  cache.put("ultimo_gasto_id", idTimestamp.toString(), 600);

  // Descontar del saldo bancario
  var nuevoSaldo = descontarSaldoCuenta(monto);
  var horasTrabajo = (monto / 19957).toFixed(1);
  var diasCupo = (monto / 21190).toFixed(1);

  var confGasto = obtenerConfiguracionActual();
  var infoAlerta = evaluarAlertaDisponibleCritico(nuevoSaldo, confGasto);

  var confirmacion = "✅ *Gasto registrado correctamente:*\n" +
                     "💵 Monto: *$" + formatearCOP(monto) + " COP*\n" +
                     "🏷️ Concepto: *" + concepto + "*\n" +
                     (ubiGasto.ubicacion ? "📍 Ubicación: *" + ubiGasto.ubicacion + "*\n" : "") +
                     "💰 Saldo restante en cuenta: ||*$" + formatearCOP(nuevoSaldo || 0) + " COP*||\n\n" +
                     "⏳ *Impacto en Horas de Trabajo:*\n" +
                     "• Equivale a *" + horasTrabajo + " horas* de tu trabajo (~*" + diasCupo + " días* de cupo diario).";

  if (infoAlerta.alerta) {
    confirmacion += "\n\n" + infoAlerta.alertaTexto;
  }

  var urlMapa = getUrlWebAppConParametros("view=mapa");
  var inlineKb = [
    [
      { text: "↩️ Deshacer Gasto", callback_data: "cb:deshacer:" + idTimestamp },
      { text: "🗺️ Ver en Mapa", web_app: { url: urlMapa } }
    ],
    [
      { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
      { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
    ]
  ];

  if (infoAlerta.alerta && infoAlerta.botones && infoAlerta.botones.length > 0) {
    for (var b = 0; b < infoAlerta.botones.length; b++) {
      inlineKb.push(infoAlerta.botones[b]);
    }
  }

  sendTelegram(chatId, confirmacion, inlineKb);
  checkBudgetAlert(monto, concepto);

  // Solicitar ubicación si el gasto no tenía ubicación previa
  if (!ubiGasto.lat) {
    solicitarUbicacionPostGasto(chatId);
  }
}

// ==========================================
// ALERTAS DE PRESUPUESTO MENSUAL
// ==========================================
function checkBudgetAlert(nuevoGasto, comercio) {
  var resumen = obtenerResumenMesActual();
  var conf = obtenerConfiguracionActual();
  var presupuesto = conf.presupuestoVariable;
  var porcentaje = (resumen.totalVariable / presupuesto) * 100;
  var restante = presupuesto - resumen.totalVariable;

  var inlineKbAlert = [
    [
      { text: "🐜 Radar Hormiga", callback_data: "cb:radar" },
      { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
    ]
  ];

  if (resumen.totalVariable >= presupuesto) {
    sendTelegram(CONFIG.TELEGRAM_CHAT_ID,
      "🚨 *¡LÍMITE DE PRESUPUESTO VARIABLE ALCANZADO!* 🚨\n\n" +
      "Último gasto: *$" + formatearCOP(nuevoGasto) + "* en *" + comercio + "*.\n" +
      "Total gastado en el mes: *$" + formatearCOP(resumen.totalVariable) + "* de *$" + formatearCOP(presupuesto) + "* (" + porcentaje.toFixed(1) + "%).\n\n" +
      "⚠️ _Has superado el tope de gastos variables sugerido._",
      inlineKbAlert
    );
  } else if (porcentaje >= 80) {
    sendTelegram(CONFIG.TELEGRAM_CHAT_ID,
      "⚠️ *ALERTA PREVENTIVA (80% DEL PRESUPUESTO)*\n\n" +
      "Último gasto: *$" + formatearCOP(nuevoGasto) + "* en *" + comercio + "*.\n" +
      "Acumulado del mes: *$" + formatearCOP(resumen.totalVariable) + "* (" + porcentaje.toFixed(1) + "%).\n" +
      "💰 *Saldo variable restante:* *$" + formatearCOP(restante) + "* para lo que queda del mes.",
      inlineKbAlert
    );
  }
}

// ==========================================
// LECTURA DINÁMICA DE CONFIGURACIÓN Y METAS DESDE SHEETS
// ==========================================
function obtenerConfiguracionActual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var salario = CONFIG.DEFAULT_SALARIO;
  var presupuestoVar = CONFIG.DEFAULT_PRESUPUESTO_VARIABLE;
  var saldoCuenta = CONFIG.DEFAULT_SALDO_CUENTA;
  var saldoBolsilloAhorro = CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO || 1561218;
  var saldoBolsilloObligaciones = CONFIG.DEFAULT_SALDO_BOLSILLO_OBLIGACIONES || 836624;
  var saldoTotalBanco = CONFIG.DEFAULT_SALDO_TOTAL_BANCO || (saldoCuenta + saldoBolsilloAhorro + saldoBolsilloObligaciones);
  var deudaTarjetaNu = CONFIG.DEFAULT_DEUDA_TARJETA || 0;
  var diaPagoTarjetaNu = CONFIG.DEFAULT_DIA_PAGO_TARJETA || 11;

  var tieneDeudaFila = false;
  var tieneDiaPagoFila = false;
  var tieneBolsilloAhorroFila = false;
  var tieneBolsilloObligacionesFila = false;
  var tieneSaldoTotalFila = false;

  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (shConfig && shConfig.getLastRow() > 1) {
    var datos = shConfig.getDataRange().getValues();
    for (var i = 1; i < datos.length; i++) {
      var param = datos[i][0];
      var val = parseFloat(datos[i][1]);
      if (param === "Salario Mensual Neto" && !isNaN(val)) salario = val;
      if (param === "Presupuesto Gastos Variables" && !isNaN(val)) {
        if (val > 700000) {
          val = CONFIG.DEFAULT_PRESUPUESTO_VARIABLE;
          shConfig.getRange(i + 1, 2).setValue(val);
        }
        presupuestoVar = val;
      }
      if (param === "Saldo en Cuenta Bancaria" && !isNaN(val)) saldoCuenta = val;
      if (param === "Saldo Bolsillo Ahorro" && !isNaN(val)) {
        tieneBolsilloAhorroFila = true;
        saldoBolsilloAhorro = val;
      }
      if (param === "Saldo Bolsillo Obligaciones" && !isNaN(val)) {
        tieneBolsilloObligacionesFila = true;
        saldoBolsilloObligaciones = val;
      }
      if (param === "Saldo Total Banco" && !isNaN(val)) {
        tieneSaldoTotalFila = true;
        saldoTotalBanco = val;
      }
      if (param === "Deuda Tarjeta de Crédito Nu") {
        tieneDeudaFila = true;
        if (!isNaN(val)) deudaTarjetaNu = val;
      }
      if (param === "Día de Pago Tarjeta Nu") {
        tieneDiaPagoFila = true;
        if (!isNaN(val)) diaPagoTarjetaNu = parseInt(val);
      }
    }
  }

  // Recalcular saldo total consolidado
  saldoTotalBanco = saldoCuenta + saldoBolsilloAhorro + saldoBolsilloObligaciones;

  // Auto-inicializar filas en la hoja si no existen aún
  if (shConfig && !tieneDeudaFila) {
    shConfig.appendRow(["Deuda Tarjeta de Crédito Nu", 0, "Valor a pagar en la próxima factura de Nu"]);
  }
  if (shConfig && !tieneDiaPagoFila) {
    shConfig.appendRow(["Día de Pago Tarjeta Nu", 11, "Día fijo de pago de la tarjeta Nu"]);
  }
  if (shConfig && !tieneBolsilloAhorroFila) {
    shConfig.appendRow(["Saldo Bolsillo Ahorro", saldoBolsilloAhorro, "Dinero actualmente en Bolsillo Ahorro Davivienda"]);
  }
  if (shConfig && !tieneBolsilloObligacionesFila) {
    shConfig.appendRow(["Saldo Bolsillo Obligaciones", saldoBolsilloObligaciones, "Dinero actualmente en Bolsillo Obligaciones Davivienda"]);
  }
  if (shConfig && !tieneSaldoTotalFila) {
    shConfig.appendRow(["Saldo Total Banco", saldoTotalBanco, "Total consolidado en cuenta Davivienda (Disponible + Bolsillos)"]);
  }

  // Cálculo de próxima fecha límite de pago (los 11 de cada mes)
  var hoy = new Date();
  var anioActual = hoy.getFullYear();
  var mesActual = hoy.getMonth();
  var diaHoy = hoy.getDate();

  var proximaFechaPago;
  if (diaHoy <= diaPagoTarjetaNu) {
    proximaFechaPago = new Date(anioActual, mesActual, diaPagoTarjetaNu);
  } else {
    proximaFechaPago = new Date(anioActual, mesActual + 1, diaPagoTarjetaNu);
  }

  var unDiaMs = 1000 * 60 * 60 * 24;
  // Auto-saneamiento si se detecta la transacción errónea de arriendo de 600.000
  verificarYSanearArriendoSiEsNecesario(ss);

  // Recargar saldo y salario tras posible saneamiento
  if (shConfig && shConfig.getLastRow() > 1) {
    var datosPost = shConfig.getDataRange().getValues();
    for (var p = 1; p < datosPost.length; p++) {
      if (datosPost[p][0] === "Saldo en Cuenta Bancaria") saldoCuenta = parseFloat(datosPost[p][1]) || saldoCuenta;
      if (datosPost[p][0] === "Salario Mensual Neto") salario = parseFloat(datosPost[p][1]) || salario;
    }
  }

  var diasParaPagoTarjeta = Math.max(Math.ceil((proximaFechaPago.getTime() - hoy.getTime()) / unDiaMs), 0);
  var liquidezNetaReal = saldoCuenta - deudaTarjetaNu;

  var gastosFijosTotal = 0;
  var listaFijos = [];
  var shFijos = ss.getSheetByName(CONFIG.HOJA_GASTOS_FIJOS);
  if (shFijos && shFijos.getLastRow() > 1) {
    var rowsFijos = shFijos.getDataRange().getValues();
    for (var j = 1; j < rowsFijos.length; j++) {
      var concepto = rowsFijos[j][0] ? rowsFijos[j][0].toString() : "";
      var montoFijo = parseFloat(rowsFijos[j][1]) || 0;
      if (!concepto || montoFijo <= 0) continue;

      var diaPago = 30;
      var medio = "Transferencia";
      var tipo = "Fijo";

      if (rowsFijos[j].length >= 5 && !isNaN(parseInt(rowsFijos[j][2]))) {
        diaPago = parseInt(rowsFijos[j][2]);
        medio = rowsFijos[j][3] || "Transferencia";
        tipo = rowsFijos[j][4] || "Fijo";
      } else {
        if (concepto.toLowerCase().indexOf("arriendo") !== -1) diaPago = 30;
        else if (concepto.toLowerCase().indexOf("google") !== -1) diaPago = 5;
        else if (concepto.toLowerCase().indexOf("claude") !== -1) diaPago = 6;
        else if (concepto.toLowerCase().indexOf("claro") !== -1) diaPago = 14;
        else if (concepto.toLowerCase().indexOf("gasolina") !== -1) diaPago = 15;
        else diaPago = 11;
        medio = rowsFijos[j][2] || "Tarjeta Nu";
        tipo = rowsFijos[j][3] || "Fijo";
      }

      var esGastoAnual = (tipo.toLowerCase().indexOf("anual") !== -1 || concepto.toLowerCase().indexOf("soat") !== -1);
      if (esGastoAnual) {
        if (tipo.toLowerCase().indexOf("anual") === -1 && rowsFijos[j].length >= 5) {
          shFijos.getRange(j + 1, 5).setValue("Anual (No Mensual)");
        }
        listaFijos.push({
          concepto: concepto,
          monto: montoFijo,
          diaPago: diaPago,
          medio: medio,
          tipo: "Anual (No Mensual)"
        });
        continue;
      }

      gastosFijosTotal += montoFijo;
      listaFijos.push({
        concepto: concepto,
        monto: montoFijo,
        diaPago: diaPago,
        medio: medio,
        tipo: tipo
      });
    }
  }

  // ==========================================
  // FLUJO QUINCENAL Y CALENDARIO DE NÓMINA
  // ==========================================
  var ultimoDiaMes = new Date(anioActual, mesActual + 1, 0).getDate();
  var quincenaActual = diaHoy <= 15 ? 1 : 2;
  var nombreQuincena = quincenaActual === 1 ? "1ª Quincena (1 al 15)" : "2ª Quincena (16 al " + ultimoDiaMes + ")";

  var proximoPagoFecha;
  var montoProximoPago;
  var diasParaProximoPago;
  var diaProximoPago;

  if (diaHoy < 15) {
    proximoPagoFecha = new Date(anioActual, mesActual, 15);
    montoProximoPago = CONFIG.QUINCENA_15_NETO; // $1.472.000
    diasParaProximoPago = 15 - diaHoy;
    diaProximoPago = 15;
  } else if (diaHoy === 15) {
    proximoPagoFecha = new Date(anioActual, mesActual, ultimoDiaMes);
    montoProximoPago = CONFIG.QUINCENA_30_NETO; // $1.721.095 con Aux. Transporte
    diasParaProximoPago = ultimoDiaMes - 15;
    diaProximoPago = ultimoDiaMes;
  } else {
    proximoPagoFecha = new Date(anioActual, mesActual, ultimoDiaMes);
    montoProximoPago = CONFIG.QUINCENA_30_NETO;
    diasParaProximoPago = Math.max(ultimoDiaMes - diaHoy, 0);
    diaProximoPago = ultimoDiaMes;
  }

  // Compromisos fijos pendientes de la quincena actual (desembolsos bancarios directos vs cargos en tarjeta)
  var compromisosQuincena = [];
  var totalCompromisosQuincena = 0;
  var cargosTarjetaNuQuincena = 0;

  for (var f = 0; f < listaFijos.length; f++) {
    var fijo = listaFijos[f];
    var diaFijo = fijo.diaPago;
    var esMedioTarjeta = (fijo.medio && fijo.medio.toLowerCase().indexOf("tarjeta") !== -1);
    var venceEnEstaQuincena = false;

    if (quincenaActual === 1) {
      if (diaFijo >= diaHoy && diaFijo <= 15) {
        venceEnEstaQuincena = true;
      }
    } else {
      if (diaFijo >= diaHoy && diaFijo <= ultimoDiaMes) {
        venceEnEstaQuincena = true;
      }
    }

    if (venceEnEstaQuincena) {
      compromisosQuincena.push(fijo);
      if (esMedioTarjeta) {
        cargosTarjetaNuQuincena += fijo.monto;
      } else {
        // Desembolso bancario directo (PSE, Débito automático, Transferencia o Efectivo)
        totalCompromisosQuincena += fijo.monto;
      }
    }
  }

  // Pago de Tarjeta Nu: Vence los 11.
  // Si el usuario ingresó una deuda real de la tarjeta (>0), usamos ese monto exacto de factura.
  // Si está en 0, usamos la suma de los cargos fijos programados a la tarjeta Nu en la quincena.
  var montoFacturaNu = deudaTarjetaNu > 0 ? deudaTarjetaNu : cargosTarjetaNuQuincena;
  var deudaNuEnPeriodo = (diasParaPagoTarjeta <= diasParaProximoPago) ? montoFacturaNu : 0;
  // En Davivienda, las obligaciones fijas (Arriendo $600k, Nu, Claro, Gasolina) están blindadas
  // dentro del Bolsillo de Obligaciones ($836.624 / $863.610 COP).
  // Por lo tanto, el saldo en cuenta bancaria es 100% DISPONIBLE para ocio y gastos diarios.
  var saldoComprometido = 0;
  var saldoProyectadoLibre = saldoCuenta;
  var cupoDiarioSugeridoQuincena = Math.max(Math.round(saldoProyectadoLibre / (diasParaProximoPago || 1)), 0);

  var presupuestoQuincena = Math.round(presupuestoVar / 2);
  var cupoDiarioModelo20 = 21300;

  var totalBancoCalculado = (saldoTotalBanco > 0) ? saldoTotalBanco : (saldoCuenta + saldoBolsilloAhorro + saldoBolsilloObligaciones);
  var pctAhorroReal = totalBancoCalculado > 0 ? ((saldoBolsilloAhorro / totalBancoCalculado) * 100).toFixed(1) : "0.0";
  var pctObligacionesReal = totalBancoCalculado > 0 ? ((saldoBolsilloObligaciones / totalBancoCalculado) * 100).toFixed(1) : "0.0";
  var pctDisponibleReal = totalBancoCalculado > 0 ? ((saldoCuenta / totalBancoCalculado) * 100).toFixed(1) : "0.0";

  var modeloBolsillos = {
    porcentajeAhorroMeta: 53.0,
    porcentajeAhorroReal: pctAhorroReal,
    montoAhorroMes: 1690866,
    ahorroQ1: 0,
    ahorroQ2: 1690866,
    porcentajeFijosMeta: 27.0,
    porcentajeFijosReal: pctObligacionesReal,
    montoFijosMes: 863610,
    fondeoFijosDia15: 863610,
    porcentajeOcioMeta: 20.0,
    porcentajeOcioReal: pctDisponibleReal,
    montoOcioMes: 638619,
    disponibleQ1: 608390,
    disponibleQ2: 30229,
    saldoActualAhorro: saldoBolsilloAhorro,
    saldoActualObligaciones: saldoBolsilloObligaciones,
    saldoActualDisponible: saldoCuenta,
    saldoTotalBanco: saldoTotalBanco,
    cupoDiarioSeguro: 21300
  };

  var flujoQuincenal = {
    empresa: CONFIG.EMPRESA,
    quincenaActual: quincenaActual,
    nombreQuincena: nombreQuincena,
    diaHoy: diaHoy,
    diaProximoPago: diaProximoPago,
    fechaProximaNominaTexto: Utilities.formatDate(proximoPagoFecha, CONFIG.ZONA_HORARIA, "dd/MM/yyyy"),
    diasParaProximaNomina: diasParaProximoPago,
    montoProximaNomina: montoProximoPago,
    compromisosQuincena: compromisosQuincena,
    totalCompromisosQuincena: totalCompromisosQuincena,
    saldoReal: saldoCuenta,
    saldoBolsilloAhorro: saldoBolsilloAhorro,
    saldoBolsilloObligaciones: saldoBolsilloObligaciones,
    saldoTotalBanco: saldoTotalBanco,
    saldoComprometido: saldoComprometido,
    saldoProyectadoLibre: saldoProyectadoLibre,
    cupoDiarioSugeridoQuincena: cupoDiarioSugeridoQuincena,
    cupoDiarioModelo20: cupoDiarioModelo20,
    presupuestoQuincena: presupuestoQuincena,
    modeloBolsillos: modeloBolsillos
  };

  var metas = [];
  var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  if (shMetas && shMetas.getLastRow() > 1) {
    var rowsMetas = shMetas.getDataRange().getValues();
    for (var k = 1; k < rowsMetas.length; k++) {
      metas.push({
        nombre: rowsMetas[k][0],
        objetivo: parseFloat(rowsMetas[k][1]) || 0,
        actual: parseFloat(rowsMetas[k][2]) || 0,
        plazo: rowsMetas[k][3] || 6,
        estado: rowsMetas[k][4] || "Activa"
      });
    }
  }

  var excedenteLibre = salario - gastosFijosTotal;
  var metaAhorroMensual = excedenteLibre - presupuestoVar;

  var subBolsillosVirtuales = {
    emergenciaPorcentaje: 70,
    emergenciaMonto: Math.round(saldoBolsilloAhorro * 0.70),
    emergenciaMensual: Math.round(metaAhorroMensual * 0.70),
    cdtPorcentaje: 20,
    cdtMonto: Math.round(saldoBolsilloAhorro * 0.20),
    cdtMensual: Math.round(metaAhorroMensual * 0.20),
    criptoPorcentaje: 10,
    criptoMonto: Math.round(saldoBolsilloAhorro * 0.10),
    criptoMensual: Math.round(metaAhorroMensual * 0.10)
  };

  return {
    salario: salario,
    saldoCuenta: saldoCuenta,
    saldoBolsilloAhorro: saldoBolsilloAhorro,
    saldoBolsilloObligaciones: saldoBolsilloObligaciones,
    saldoTotalBanco: saldoTotalBanco,
    pctAhorroReal: pctAhorroReal,
    pctObligacionesReal: pctObligacionesReal,
    pctDisponibleReal: pctDisponibleReal,
    deudaTarjetaNu: deudaTarjetaNu,
    diaPagoTarjetaNu: diaPagoTarjetaNu,
    proximaFechaPagoTarjeta: Utilities.formatDate(proximaFechaPago, CONFIG.ZONA_HORARIA, "dd/MM/yyyy"),
    diasParaPagoTarjeta: diasParaPagoTarjeta,
    liquidezNetaReal: liquidezNetaReal,
    gastosFijosTotal: gastosFijosTotal,
    listaFijos: listaFijos,
    presupuestoVariable: presupuestoVar,
    excedenteLibre: excedenteLibre,
    metaAhorroMensual: metaAhorroMensual,
    metas: metas,
    flujoQuincenal: flujoQuincenal,
    modeloBolsillos: modeloBolsillos,
    subBolsillosVirtuales: subBolsillosVirtuales
  };
}

// ==========================================
// MODIFICACIÓN DINÁMICA DE PARÁMETROS EN SHEETS
// ==========================================
function actualizarParametroConfig(parametroNombre, nuevoValor) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig) return;

  var datos = shConfig.getDataRange().getValues();
  var encontrado = false;

  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] === parametroNombre) {
      shConfig.getRange(i + 1, 2).setValue(nuevoValor);
      encontrado = true;
      break;
    }
  }

  if (!encontrado) {
    shConfig.appendRow([parametroNombre, nuevoValor, "Actualizado por Bot / Asesor"]);
  }

  recalcularFilaMetaAhorro();
}

function recalcularFilaMetaAhorro() {
  var conf = obtenerConfiguracionActual();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig) return;

  var datos = shConfig.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] === "Gastos Fijos Totales") {
      shConfig.getRange(i + 1, 2).setValue(conf.gastosFijosTotal);
    }
    if (datos[i][0] === "Meta de Ahorro Mensual") {
      shConfig.getRange(i + 1, 2).setValue(conf.metaAhorroMensual);
    }
  }
}

function crearMetaAhorro(nombre, objetivo, plazo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  if (!shMetas) {
    inicializarHojas();
    shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  }
  shMetas.appendRow([nombre, objetivo, 0, plazo || 6, "Activa", new Date()]);
}

function abonarAMeta(nombreBusqueda, abono) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  if (!shMetas) return "⚠️ No se encontró la hoja de Metas.";

  var rows = shMetas.getDataRange().getValues();
  var encontrada = false;
  var msg = "";

  for (var i = 1; i < rows.length; i++) {
    var nombreActual = rows[i][0].toString().toLowerCase();
    if (nombreActual.indexOf(nombreBusqueda.toLowerCase()) !== -1) {
      var actual = parseFloat(rows[i][2]) || 0;
      var nuevoTotal = actual + abono;
      shMetas.getRange(i + 1, 3).setValue(nuevoTotal);

      // También descuenta del saldo bancario disponible
      descontarSaldoCuenta(abono);

      var obj = parseFloat(rows[i][1]) || 0;
      var pct = obj > 0 ? ((nuevoTotal / obj) * 100).toFixed(1) : 100;

      msg = "🎉 *¡Abono registrado a tu meta!*\n\n" +
            "🎯 Meta: *" + rows[i][0] + "*\n" +
            "💵 Abono realizado: *$" + formatearCOP(abono) + " COP*\n" +
            "📊 Acumulado actual: *$" + formatearCOP(nuevoTotal) + "* de *$" + formatearCOP(obj) + "* (" + pct + "%)\n" +
            "💳 _Se descontó automáticamente de tu saldo en cuenta._";
      encontrada = true;
      break;
    }
  }

  return encontrada ? msg : "⚠️ No encontré ninguna meta llamada '" + nombreBusqueda + "'. Usa `/metas` para ver tus metas activas.";
}

function agregarOActualizarGastoFijo(nombre, monto, diaPago, medio, tipo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shFijos = ss.getSheetByName(CONFIG.HOJA_GASTOS_FIJOS);
  if (!shFijos) return;

  var datos = shFijos.getDataRange().getValues();
  var encontrado = false;

  for (var i = 1; i < datos.length; i++) {
    if (datos[i][0] && datos[i][0].toString().toLowerCase() === nombre.toLowerCase()) {
      shFijos.getRange(i + 1, 2).setValue(monto);
      if (diaPago) shFijos.getRange(i + 1, 3).setValue(diaPago);
      if (medio) shFijos.getRange(i + 1, 4).setValue(medio);
      encontrado = true;
      break;
    }
  }

  if (!encontrado) {
    shFijos.appendRow([nombre, monto, diaPago || 30, medio || "Transferencia", tipo || "Fijo"]);
  }

  recalcularFilaMetaAhorro();
}

function agregarGastoFijo(concepto, monto, medio) {
  agregarOActualizarGastoFijo(concepto, monto, 30, medio, "Fijo");
}

function verificarYSanearArriendoSiEsNecesario(ss) {
  try {
    var shTrans = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
    var huboBorrado = false;
    if (shTrans && shTrans.getLastRow() > 1) {
      var rowsT = shTrans.getDataRange().getValues();
      var headers = rowsT[0] || [];
      var tieneColTipo = headers.length > 1 && headers[1].toString().trim().toLowerCase() === "tipo";

      for (var t = rowsT.length - 1; t >= 1; t--) {
        var cNom = tieneColTipo ? (rowsT[t][2] || "").toString().toLowerCase() : (rowsT[t][1] || "").toString().toLowerCase();
        var cMonto = tieneColTipo ? (parseFloat(rowsT[t][3]) || 0) : (parseFloat(rowsT[t][2]) || 0);
        var cOrig = tieneColTipo ? (rowsT[t][6] || "").toString() : (rowsT[t][5] || "").toString();
        if (cNom.indexOf("arriendo") !== -1 && cMonto === 600000 && cOrig.indexOf("IA Multimodal") !== -1) {
          shTrans.deleteRow(t + 1);
          huboBorrado = true;
          Logger.log("Transacción errónea de arriendo eliminada.");
        }
      }
    }

    var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
    if (shConfig && shConfig.getLastRow() > 1) {
      var confRows = shConfig.getDataRange().getValues();
      for (var c = 1; c < confRows.length; c++) {
        if (param === "Salario Mensual Neto" && val < 3190000) {
          shConfig.getRange(c + 1, 2).setValue(3193095);
        }
        if (param === "Presupuesto Gastos Variables" && val > 700000) {
          shConfig.getRange(c + 1, 2).setValue(CONFIG.DEFAULT_PRESUPUESTO_VARIABLE);
          Logger.log("Presupuesto variable migrado a 20%: $638.619 COP.");
        }
      }
    }

    var shFijos = ss.getSheetByName(CONFIG.HOJA_GASTOS_FIJOS);
    if (shFijos) {
      var tieneColumnaDia = false;
      if (shFijos.getLastRow() >= 1) {
        var header = shFijos.getRange(1, 1, 1, Math.max(shFijos.getLastColumn(), 1)).getValues()[0];
        for (var h = 0; h < header.length; h++) {
          var hTxt = (header[h] || "").toString().toLowerCase();
          if (hTxt.indexOf("da") !== -1 || hTxt.indexOf("dia") !== -1 || hTxt.indexOf("d\u00eda") !== -1) {
            tieneColumnaDia = true;
            break;
          }
        }
      }

      if (shFijos.getLastRow() > 1 && tieneColumnaDia) {
        var fijosRows = shFijos.getDataRange().getValues();
        for (var f = 1; f < fijosRows.length; f++) {
          var nomF = (fijosRows[f][0] || "").toString().toLowerCase();
          if (nomF.indexOf("google") !== -1) shFijos.getRange(f + 1, 3).setValue(5);
          if (nomF.indexOf("claude") !== -1) {
            shFijos.getRange(f + 1, 3).setValue(6);
            var valC = parseFloat(fijosRows[f][1]) || 0;
            if (valC === 80000 || valC <= 0) shFijos.getRange(f + 1, 2).setValue(63110);
          }
          if (nomF.indexOf("gimnasio") !== -1) shFijos.getRange(f + 1, 3).setValue(11);
          if (nomF.indexOf("claro") !== -1) shFijos.getRange(f + 1, 3).setValue(14);
          if (nomF.indexOf("gasolina") !== -1) shFijos.getRange(f + 1, 3).setValue(15);
          if (nomF.indexOf("arriendo") !== -1) shFijos.getRange(f + 1, 3).setValue(30);
        }
      } else {
        var fijosCompletos = [
          ["Google One", 3900, 5, "Tarjeta Nu (Cobro Fijo)", "Fijo Almacenamiento"],
          ["Claude Code", 63110, 6, "Tarjeta Nu (Cobro Fijo)", "Fijo Trabajo/IA (TRM variable)"],
          ["Gimnasio", 92600, 11, "Tarjeta Nu (Cobro Fijo)", "Fijo Bienestar"],
          ["Plan Celular Claro", 44000, 14, "Débito / PSE", "Fijo Comunicación (Promedio)"],
          ["Gasolina Moto", 60000, 15, "Efectivo / Transferencia", "Fijo Transporte (Quincenal)"],
          ["Arriendo", 600000, 30, "Transferencia Bancaria", "Fijo Obligatorio"]
        ];
        shFijos.clear();
        shFijos.appendRow(["Concepto", "Monto COP", "Día de Pago", "Medio de Pago", "Tipo"]);
        shFijos.getRange("A1:E1").setFontWeight("bold").setBackground("#34A853").setFontColor("#FFFFFF");
        shFijos.setFrozenRows(1);
        for (var k = 0; k < fijosCompletos.length; k++) {
          shFijos.appendRow(fijosCompletos[k]);
        }
        shFijos.getRange("B2:B7").setNumberFormat("$#,##0");
      }
    }
  } catch (err) {
    Logger.log("Error en saneamiento de arriendo: " + err.toString());
  }
}

// ==========================================
// RESUMEN Y CONSULTA DE GASTOS DEL MES ACTUAL
// ==========================================
function obtenerResumenMesActual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!sheet) return { transacciones: [], totalVariable: 0, totalIngresos: 0, totalTransferencias: 0, porCategoria: {}, mesNombre: "", diasRestantes: 0 };

  var rows = sheet.getDataRange().getValues();
  var hoy = new Date();
  var mesActual = hoy.getMonth();
  var anioActual = hoy.getFullYear();

  var meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var mesNombre = meses[mesActual];

  var transaccionesMes = [];
  var totalVariable = 0;
  var totalIngresos = 0;
  var totalTransferencias = 0;
  var porCategoria = {};

  var headers = rows.length > 0 ? rows[0] : [];
  var tieneColTipo = headers.length > 1 && headers[1].toString().trim().toLowerCase() === "tipo";

  for (var i = 1; i < rows.length; i++) {
    var fila = rows[i];
    var fechaStr = fila[0];
    var fecha = new Date(fechaStr);

    if (!isNaN(fecha.getTime())) {
      if (fecha.getMonth() === mesActual && fecha.getFullYear() === anioActual) {
        var tipoStr = "";
        var comercio = "";
        var valor = 0;
        var tarjeta = "";
        var cat = "";

        if (tieneColTipo) {
          tipoStr = (fila[1] || "").toString().toLowerCase();
          comercio = (fila[2] || "Sin comercio").toString();
          valor = parseFloat(fila[3]) || 0;
          tarjeta = (fila[4] || "Apple Pay").toString();
          cat = (fila[5] || "Sin categoría").toString();
        } else {
          comercio = (fila[1] || "Sin comercio").toString();
          valor = parseFloat(fila[2]) || 0;
          tarjeta = (fila[3] || "Apple Pay").toString();
          cat = (fila[4] || "Sin categoría").toString();

          var comLower = comercio.toLowerCase();
          if (comLower.indexOf("nómina") !== -1 || comLower.indexOf("nomina") !== -1 || comLower.indexOf("salario") !== -1 || comLower.indexOf("ingreso") !== -1) {
            tipoStr = "ingreso";
          } else if (comLower.indexOf("arriendo") !== -1 || comLower.indexOf("pago tarjeta") !== -1 || comLower.indexOf("bolsillo") !== -1) {
            tipoStr = "transferencia";
          } else {
            tipoStr = "gasto";
          }
        }

        var esIngreso = tipoStr.indexOf("ingreso") !== -1;
        var esTransferencia = tipoStr.indexOf("transferencia") !== -1 || tipoStr.indexOf("traslado") !== -1 || tipoStr.indexOf("interno") !== -1;
        var esGasto = (tipoStr.indexOf("gasto") !== -1) || (!tieneColTipo && !esIngreso && !esTransferencia);

        if (esGasto) {
          totalVariable += valor;
          porCategoria[cat] = (porCategoria[cat] || 0) + valor;
        } else if (esIngreso) {
          totalIngresos += valor;
        } else if (esTransferencia) {
          totalTransferencias += valor;
        }

        transaccionesMes.push({
          fecha: Utilities.formatDate(fecha, CONFIG.ZONA_HORARIA, "dd/MM/yyyy HH:mm"),
          tipo: esIngreso ? "🟢 Ingreso" : (esTransferencia ? "🔄 Traslado Interno" : "🔴 Gasto"),
          comercio: comercio,
          importe: valor,
          tarjeta: tarjeta,
          categoria: cat
        });
      }
    }
  }

  return {
    transacciones: transaccionesMes,
    totalVariable: totalVariable,
    totalIngresos: totalIngresos,
    totalTransferencias: totalTransferencias,
    porCategoria: porCategoria,
    mesNombre: mesNombre,
    diasRestantes: new Date(anioActual, mesActual + 1, 0).getDate() - hoy.getDate()
  };
}

// ==========================================
// GENERADORES DE MENSAJES RÁPIDOS
// ==========================================
function generarMensajeReporte(resumen, conf) {
  var presupuesto = conf.presupuestoVariable;
  var porcentaje = ((resumen.totalVariable / presupuesto) * 100).toFixed(1);
  var restante = presupuesto - resumen.totalVariable;

  var pctVisual = Math.min(Math.round(parseFloat(porcentaje)), 100);
  var barraVisual = generarBarraProgreso(pctVisual);

  var msg = "📊 *RESUMEN DE GASTOS VARIABLES - " + resumen.mesNombre.toUpperCase() + "*\n\n";

  if (resumen.totalIngresos > 0) {
    msg += "🟢 *Ingresos Extra en el Mes:* +$" + formatearCOP(resumen.totalIngresos) + " COP\n\n";
  }

  msg += "🔴 *Total Gastado en Variables:* *$" + formatearCOP(resumen.totalVariable) + " COP*\n" +
         "🎯 *Presupuesto (20% Ocio):* *$" + formatearCOP(presupuesto) + " COP*\n" +
         "📊 *Consumo:* " + barraVisual + " *" + porcentaje + "%*\n" +
         "💵 *Margen Disponible:* *" + (restante >= 0 ? "$" + formatearCOP(restante) + " COP 🟢" : "-$" + formatearCOP(Math.abs(restante)) + " COP en sobregiro 🔴") + "*\n\n" +
         "> 📅 *Días restantes del mes:* " + resumen.diasRestantes + " días\n" +
         "> ⏱️ *Ritmo de gasto seguro:* ~$" + formatearCOP(Math.max(Math.round(restante / (resumen.diasRestantes || 1)), 0)) + " COP/día para no exceder tu tope.\n\n" +
         "📋 *Desglose de Gastos por Categoría:*\n";

  var categorias = Object.keys(resumen.porCategoria);
  if (categorias.length === 0) {
    msg += "_No hay gastos variables registrados este mes._\n";
  } else {
    msg += "```\n";
    categorias.forEach(function(cat) {
      var cNom = (cat.length > 15 ? cat.substring(0, 14) + "…" : cat);
      while (cNom.length < 16) cNom += " ";
      var cMonto = "$" + formatearCOP(resumen.porCategoria[cat]);
      while (cMonto.length < 11) cMonto = " " + cMonto;
      msg += cNom + " " + cMonto + "\n";
    });
    msg += "```\n";
  }

  var inlineKb = [
    [
      { text: "📊 Gráfico de Gastos", callback_data: "cb:grafico_gastos" },
      { text: "🐜 Ver Radar Hormiga", callback_data: "cb:radar" }
    ],
    [
      { text: "📋 Ver Gastos Fijos", callback_data: "cb:fijos" },
      { text: "🏆 Cierre de Mes", callback_data: "cb:cierre_mes" }
    ],
    [
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" },
      { text: "⚖️ Calculadora Cuotas", callback_data: "cb:cuotas" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

function generarMensajeMetas(conf) {
  var msg = "🎯 *MIS METAS DE AHORRO Y PATRIMONIO*\n\n" +
            "🚀 *Capacidad Mensual de Ahorro (53% nómina):* *$" + formatearCOP(conf.metaAhorroMensual) + " COP/mes*\n\n" +
            "📌 *Progreso de Metas Registradas:*\n";

  if (!conf.metas || conf.metas.length === 0) {
    msg += "_No tienes metas registradas aún. ¡Crea una con `/nueva_meta [nombre] [monto]` o pídeselo al Asesor!_\n\n" +
           "> 💡 *Ejemplo:* `/nueva_meta Fondo Emergencia 5000000`";
  } else {
    conf.metas.forEach(function(m) {
      var pct = m.objetivo > 0 ? ((m.actual / m.objetivo) * 100).toFixed(0) : 0;
      var barra = generarBarraProgreso(pct);
      msg += "• *" + m.nombre + "*:\n" +
             "  " + barra + " *" + pct + "%*\n" +
             "  Acumulado: *$" + formatearCOP(m.actual) + "* de *$" + formatearCOP(m.objetivo) + "* COP\n\n";
    });
    msg += "> 💡 *Para abonar a una meta usa:* `/abono [nombre] [monto]` (ej: `/abono Fondo 200000`)";
  }

  var inlineKb = [
    [
      { text: "➕ Crear Nueva Meta", callback_data: "cb:metas_nueva" },
      { text: "💵 Abonar a Meta", callback_data: "cb:metas_abono" }
    ],
    [
      { text: "🏆 Scorecard Cierre de Mes", callback_data: "cb:cierre_mes" },
      { text: "📈 Ver Inversiones", callback_data: "cb:invertir" }
    ],
    [
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

function generarBarraProgreso(porcentaje, totalBloques) {
  totalBloques = totalBloques || 8;
  var pct = Math.max(0, Math.min(100, parseFloat(porcentaje) || 0));
  var llenos = Math.min(Math.round((pct / 100) * totalBloques), totalBloques);
  var vacios = totalBloques - llenos;
  return "▰".repeat(llenos) + "▱".repeat(vacios);
}

// ==========================================
// GENERADORES DE MENSAJES REUTILIZABLES
// ==========================================
function generarMensajeBolsillos(conf) {
  var hoy = new Date();
  var ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  var diaHoy = hoy.getDate();
  var diasCiclo = diaHoy <= 15 ? (15 - diaHoy || 1) : (ultimoDiaMes - diaHoy + 15);
  var cupoDiario = Math.max(Math.round(conf.saldoCuenta / diasCiclo), 0);

  var pctAh = conf.pctAhorroReal || ((conf.saldoBolsilloAhorro / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
  var pctOb = conf.pctObligacionesReal || ((conf.saldoBolsilloObligaciones / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
  var pctDi = conf.pctDisponibleReal || ((conf.saldoCuenta / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);

  var msg = "🏦 *ESTADO DE CUENTA Y BOLSILLOS DAVIVIENDA*\n" +
            "💵 *Ingreso Neto Mensual:* $" + formatearCOP(conf.salario) + " COP (Empresa S.A.S.)\n\n" +
            "💰 *SALDOS REALES Y DISTRIBUCIÓN EN VIVO:*\n" +
            "💎 *Bolsillo Ahorro Puro:* ||*$" + formatearCOP(conf.saldoBolsilloAhorro) + " COP*|| *(" + pctAh + "% actual | 53% meta)*\n" +
            "🛡️ *Bolsillo Obligaciones Fijas:* ||*$" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP*|| *(" + pctOb + "% actual | 27% meta)*\n" +
            "🛒 *Saldo Disponible en Cuenta:* ||*$" + formatearCOP(conf.saldoCuenta) + " COP*|| *(" + pctDi + "% actual | 20% meta)*\n" +
            "─────────────────────────────\n" +
            "💳 *SALDO TOTAL EN DAVIVIENDA:* ||*$" + formatearCOP(conf.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
            "> 🎯 *Cupo Diario Seguro:* ~$" + formatearCOP(cupoDiario) + " COP/día (para " + diasCiclo + " días del ciclo)\n\n" +
            "⚙️ *REGLAS DE DÉBITO AUTOMÁTICO (1 débito/mes por bolsillo):*\n" +
            "• *Día 15 (1ª Quincena - $1.472.000 COP):*\n" +
            "   🛡️ Débito a *Obligaciones:* *$863.610 COP* (27% nómina)\n" +
            "   🛒 Disponible restante: *~$608.390 COP*\n" +
            "• *Día 30 (2ª Quincena - $1.721.095 COP con auxilio):*\n" +
            "   💎 Débito a *Ahorro:* *$1.690.866 COP* (53% nómina)\n" +
            "   🏠 Arriendo ($600.000 COP): Debitado de Obligaciones\n" +
            "   🛒 Remanente a Disponible: *+$30.229 COP*\n\n" +
            "> 💡 *Distribución sugerida si decides invertir:* 70% Emergencia líquida, 20% CDT, 10% Cripto DCA.";

  var inlineKb = [
    [
      { text: "📊 Gráfico de Bolsillos", callback_data: "cb:grafico_distribucion" },
      { text: "📱 Abrir Dashboard Web", web_app: { url: CONFIG.WEB_APP_URL } }
    ],
    [
      { text: "🔄 Trasladar a Bolsillo", callback_data: "cb:traslado_ayuda" },
      { text: "🔄 Retirar a Disponible", callback_data: "cb:retirar_ayuda" }
    ],
    [
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" },
      { text: "📈 Opciones Inversión", callback_data: "cb:invertir" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

function generarMensajeSaldo(conf) {
  var saldoActual = conf.saldoCuenta;
  var deudaNu = conf.deudaTarjetaNu || 0;
  var flujoS = conf.flujoQuincenal;
  var cupoDiarioS = flujoS.cupoDiarioSugeridoQuincena || 21190;

  var pctAh = conf.pctAhorroReal || ((conf.saldoBolsilloAhorro / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
  var pctOb = conf.pctObligacionesReal || ((conf.saldoBolsilloObligaciones / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
  var pctDi = conf.pctDisponibleReal || ((saldoActual / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);

  var msg = "💳 *ESTADO FINANCIERO Y LIQUIDEZ DAVIVIENDA*\n\n" +
            "🛒 *Saldo Disponible (Ocio):* ||*$" + formatearCOP(saldoActual) + " COP*|| *(" + pctDi + "% actual)*\n" +
            "💎 *Bolsillo Ahorro Puro:* ||*$" + formatearCOP(conf.saldoBolsilloAhorro) + " COP*|| *(" + pctAh + "% actual | Meta 53%)*\n" +
            "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP*|| *(" + pctOb + "% actual | Meta 27%)*\n" +
            "─────────────────────────────\n" +
            "💰 *SALDO TOTAL DAVIVIENDA:* ||*$" + formatearCOP(conf.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
            "> 🟣 *Factura Tarjeta Nu:* ||*$" + formatearCOP(deudaNu) + " COP*|| (los 11, cubierta en Obligaciones)\n" +
            "> 🏢 *Próxima Nómina Quincenal:* " + flujoS.fechaProximaNominaTexto + " (en *" + flujoS.diasParaProximaNomina + " días*)\n" +
            "> 🎯 *Cupo Diario Seguro:* *~$" + formatearCOP(cupoDiarioS) + " COP/día*";

  var inlineKb = [
    [
      { text: "📊 Gráfico de Bolsillos", callback_data: "cb:grafico_distribucion" },
      { text: "📱 Abrir Dashboard Web", web_app: { url: CONFIG.WEB_APP_URL } }
    ],
    [
      { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
      { text: "🔄 Trasladar Dinero", callback_data: "cb:traslado_ayuda" }
    ],
    [
      { text: "🏢 Calendario Nómina", callback_data: "cb:quincena" },
      { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

function generarMensajeQuincena(conf) {
  var flujoQ = conf.flujoQuincenal;
  var msgQ = "🏢 *CALENDARIO DE NÓMINA Y CASHFLOW (NÓMINA EMPRESA)*\n\n" +
             "📅 *Periodo Actual:* " + flujoQ.nombreQuincena + "\n" +
             "⏰ *Próxima Nómina:* " + flujoQ.fechaProximaNominaTexto + " (en *" + flujoQ.diasParaProximaNomina + " días*)\n" +
             "💵 *Monto Esperado:* *$" + formatearCOP(flujoQ.montoProximaNomina) + " COP*" + (flujoQ.esQuincena2 ? " (incluye auxilio transporte $249.095)" : "") + "\n\n" +
             "🔒 *Compromisos fijos antes de cobrar:* $" + formatearCOP(flujoQ.totalCompromisosQuincena) + " COP\n";

  if (flujoQ.compromisosQuincena && flujoQ.compromisosQuincena.length > 0) {
    msgQ += "```\n";
    flujoQ.compromisosQuincena.forEach(function(c) {
      var cC = (c.concepto.length > 14 ? c.concepto.substring(0, 13) + "…" : c.concepto);
      while (cC.length < 15) cC += " ";
      var cM = "$" + formatearCOP(c.monto);
      while (cM.length < 10) cM = " " + cM;
      msgQ += cC + " " + cM + "  (d." + c.diaPago + ")\n";
    });
    msgQ += "```\n";
  } else {
    msgQ += "   _No hay compromisos fijos pendientes en esta quincena._\n";
  }

  msgQ += "\n> 🎯 *Tope Diario Seguro (20% Ocio):* $" + formatearCOP(flujoQ.cupoDiarioModelo20 || 21300) + " COP/día\n" +
          "> Margen real sugerido: *$" + formatearCOP(flujoQ.cupoDiarioSugeridoQuincena) + " COP/día* hasta el día " + flujoQ.diaProximoPago + ".\n\n";

  var diaActual = flujoQ.diaHoy;
  if (diaActual >= 14 && diaActual <= 16) {
    msgQ += "📢 *¿Ya te consignaron la 1ª quincena?*\n" +
            "👉 Usa el botón de abajo para acreditar los *$1.472.000 COP* y repartir en bolsillos.\n";
  } else if (diaActual >= 29) {
    msgQ += "📢 *¿Ya te consignaron la 2ª quincena?*\n" +
            "👉 Usa el botón de abajo para acreditar los *$1.721.095 COP* y repartir en bolsillos.\n";
  }

  var inlineKbQ = [
    [
      { text: "🎉 Cobrar Quincena", callback_data: "cb:cobro_quincena" },
      { text: "📋 Ver Gastos Fijos", callback_data: "cb:fijos" }
    ],
    [
      { text: "🐜 Radar Hormiga", callback_data: "cb:radar" },
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
    ]
  ];

  return { texto: msgQ, inlineKb: inlineKbQ };
}

function generarMensajeCobroQuincena(resCobro) {
  var totC = resCobro.saldoTotalBanco > 0 ? resCobro.saldoTotalBanco : (resCobro.saldoDisponible + resCobro.saldoBolsilloAhorro + resCobro.saldoBolsilloObligaciones);
  var pctAhC = totC > 0 ? ((resCobro.saldoBolsilloAhorro / totC) * 100).toFixed(1) : "0.0";
  var pctObC = totC > 0 ? ((resCobro.saldoBolsilloObligaciones / totC) * 100).toFixed(1) : "0.0";
  var pctDiC = totC > 0 ? ((resCobro.saldoDisponible / totC) * 100).toFixed(1) : "0.0";

  var msgCobro = "🎉 *¡NÓMINA QUINCENAL ACREDITADA CON ÉXITO!*\n\n" +
                 "🏢 *Empresa:* " + CONFIG.EMPRESA + "\n" +
                 "📅 *Periodo:* " + resCobro.nombreQ + "\n" +
                 "💵 *Monto Ingresado:* *+$" + formatearCOP(resCobro.monto) + " COP*\n" +
                 "💰 *Saldo Total en Cuenta Davivienda:* ||*$" + formatearCOP(resCobro.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                 "🏦 *MOVIMIENTO EN BOLSILLOS DAVIVIENDA:*\n";

  if (resCobro.esQuincena1) {
    msgCobro += "🛡️ *Bolsillo Obligaciones Fijas:* Débito automático de *$863.610 COP* (27% nómina)\n" +
                "   Saldo acumulado en bolsillo: ||*$" + formatearCOP(resCobro.saldoBolsilloObligaciones) + " COP*|| *(" + pctObC + "% actual)*\n" +
                "   _(Cubre Arriendo $600k del 30, Factura Nu los 11, Claro $44k y Gasolina)_\n\n" +
                "💎 *Bolsillo Ahorro Puro:* *$0 COP hoy* (se traslada el 30)\n" +
                "   Saldo en bolsillo: ||*$" + formatearCOP(resCobro.saldoBolsilloAhorro) + " COP*|| *(" + pctAhC + "% actual)*\n\n" +
                "🛒 *Saldo Disponible en Cuenta:* ||*$" + formatearCOP(resCobro.saldoDisponible) + " COP*|| *(" + pctDiC + "% actual)*\n" +
                "   _(Acreditados +$" + formatearCOP(resCobro.incrementoDisponible) + " COP de nómina + remanentes)_\n\n" +
                "> 🎯 *Cupo Diario Seguro:* *$" + formatearCOP(resCobro.cupoDiarioQ) + " COP/día*.\n\n";
  } else {
    msgCobro += "💎 *Bolsillo Ahorro Puro:* Débito automático de *$1.690.866 COP* (53% nómina)\n" +
                "   Saldo acumulado en bolsillo: ||*$" + formatearCOP(resCobro.saldoBolsilloAhorro) + " COP*|| *(" + pctAhC + "% actual)*\n" +
                "   _(Meta mensual de ahorro del 53% cumplida en Davivienda)_\n\n" +
                "🏠 *Pago de Arriendo ($600.000 COP):* Debitado desde Bolsillo Obligaciones (¡disponible intacto!)\n" +
                "   Saldo restante en bolsillo Obligaciones: ||*$" + formatearCOP(resCobro.saldoBolsilloObligaciones) + " COP*|| *(" + pctObC + "% actual)*\n\n" +
                "🛒 *Saldo Disponible en Cuenta:* ||*$" + formatearCOP(resCobro.saldoDisponible) + " COP*|| *(" + pctDiC + "% actual)*\n" +
                "   _(Suma remanente de nómina: +$" + formatearCOP(resCobro.incrementoDisponible) + " COP)_\n\n" +
                "> 🎯 *Cupo Diario Seguro:* *$" + formatearCOP(resCobro.cupoDiarioQ) + " COP/día* hasta el 15.\n\n";
  }

  msgCobro += "💎 _¡Tus bolsillos Davivienda protegen tu patrimonio automáticamente!_";
  return msgCobro;
}

function generarMensajeGastosFijos(conf) {
  var msgF = "📋 *CALENDARIO DE GASTOS FIJOS MENSUALES*\n\n" +
             "📊 *Total Fijos Comprometidos:* *$" + formatearCOP(conf.gastosFijosTotal) + " COP* (~" + ((conf.gastosFijosTotal / conf.salario) * 100).toFixed(1) + "% de nómina)\n\n" +
             "```\n" +
             "Concepto       Monto COP   Día\n" +
             "──────────────────────────────\n";

  conf.listaFijos.forEach(function(f) {
    var cNom = (f.concepto.length > 13 ? f.concepto.substring(0, 12) + "…" : f.concepto);
    while (cNom.length < 14) cNom += " ";
    var cMonto = "$" + formatearCOP(f.monto);
    while (cMonto.length < 11) cMonto = " " + cMonto;
    var cDia = "d." + (f.diaPago < 10 ? "0" + f.diaPago : f.diaPago);
    msgF += cNom + " " + cMonto + "  " + cDia + "\n";
  });

  msgF += "──────────────────────────────\n" +
          "TOTAL FIJOS   $" + formatearCOP(conf.gastosFijosTotal) + "  (27%)\n" +
          "```\n\n" +
          "> 🛡️ *Bolsillo Obligaciones:* Se fondea automáticamente el día 15 con tu 1ª quincena.\n" +
          "> El arriendo ($600k) se paga el 30 desde este bolsillo y la Tarjeta Nu se paga el 11.";

  var inlineKbF = [
    [
      { text: "🟣 Tarjeta Nu (los 11)", callback_data: "cb:deuda" },
      { text: "🏢 Calendario Quincena", callback_data: "cb:quincena" }
    ],
    [
      { text: "🏦 Bolsillo Obligaciones", callback_data: "cb:bolsillos" },
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
    ]
  ];

  return { texto: msgF, inlineKb: inlineKbF };
}

function generarMensajeDeuda(conf) {
  var deudaNu = conf.deudaTarjetaNu || 0;
  var estadoNu = deudaNu <= 0 ? "✅ Al día (Sin saldo)" : "🕒 Pendiente de pago (en " + conf.diasParaPagoTarjeta + " días)";

  var msg = "🟣 *CENTRO DE CONTROL - TARJETA NU*\n\n" +
            "🔴 *Factura a Pagar:* ||*$" + formatearCOP(deudaNu) + " COP*||\n" +
            "📅 *Vencimiento:* *" + conf.proximaFechaPagoTarjeta + "* (los 11 de cada mes)\n" +
            "📊 *Estado:* " + estadoNu + "\n\n" +
            "```\n" +
            "Suscripción     Monto COP   Día\n" +
            "──────────────────────────────\n" +
            "SmartFit         $92.600    d.11\n" +
            "Claude Code     ~$63.110    d.06\n" +
            "Google One        $3.900    d.05\n" +
            "```\n\n" +
            "> 🛡️ *Regla de Oro:* Siempre a 1 cuota = $0 COP de interés bancario.\n" +
            "> El dinero ya está reservado dentro de tu Bolsillo de Obligaciones.";

  var inlineKb = [
    [
      { text: "✅ Registrar Pago Factura", callback_data: "cb:pagar_tarjeta" },
      { text: "✏️ Actualizar Deuda", callback_data: "cb:set_deuda_ayuda" }
    ],
    [
      { text: "⚖️ Simular Cuotas", callback_data: "cb:cuotas" },
      { text: "📋 Ver Gastos Fijos", callback_data: "cb:fijos" }
    ],
    [
      { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

// ==========================================
// RADAR DE GASTOS HORMIGA Y DESVIACIÓN DEL CUPO DIARIO 🐜
// ==========================================
function analizarGastosHormigaYDesviacion(conf) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  var hoy = new Date();
  var diasVentana = 5;
  var limiteMs = hoy.getTime() - (diasVentana * 24 * 60 * 60 * 1000);

  var totalHormiga = 0;
  var conteoHormiga = 0;
  var itemsHormiga = [];
  var gastosPorDia = {};

  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var headers = rows[0] || [];
    var tieneColTipo = headers.length > 1 && headers[1].toString().trim().toLowerCase() === "tipo";

    for (var i = 1; i < rows.length; i++) {
      var fila = rows[i];
      var fechaVal = fila[0];
      var fecha = new Date(fechaVal);
      if (isNaN(fecha.getTime())) continue;

      if (fecha.getTime() >= limiteMs) {
        var tipoFila = tieneColTipo ? (fila[1] || "").toString().toLowerCase() : "";
        var comercio = tieneColTipo ? (fila[2] || "").toString().trim() : (fila[1] || "").toString().trim();
        var monto = tieneColTipo ? (parseFloat(fila[3]) || 0) : (parseFloat(fila[2]) || 0);
        var comercioLower = comercio.toLowerCase();

        // Solo consideramos Gastos reales (descartar ingresos o transferencias)
        var esGasto = tieneColTipo ? (tipoFila.indexOf("gasto") !== -1 || tipoFila === "") : 
                      (comercioLower.indexOf("arriendo") === -1 && comercioLower.indexOf("nómina") === -1 && comercioLower.indexOf("nomina") === -1 && comercioLower.indexOf("pago tarjeta") === -1);

        // Filtrar micro-gastos (<= $50.000 COP) y omitir pagos fijos o transferencias
        if (esGasto && monto > 0 && monto <= 50000 &&
            comercioLower.indexOf("arriendo") === -1 &&
            comercioLower.indexOf("nómina") === -1 &&
            comercioLower.indexOf("nomina") === -1 &&
            comercioLower.indexOf("pago tarjeta") === -1) {
          totalHormiga += monto;
          conteoHormiga++;
          itemsHormiga.push({ comercio: comercio, monto: monto, fecha: fecha });

          var diaKey = Utilities.formatDate(fecha, CONFIG.ZONA_HORARIA, "yyyy-MM-dd");
          gastosPorDia[diaKey] = (gastosPorDia[diaKey] || 0) + monto;
        }
      }
    }
  }

  // Ordenar los 3 gastos hormiga más representativos
  itemsHormiga.sort(function(a, b) { return b.monto - a.monto; });
  var topHormigas = itemsHormiga.slice(0, 3);

  // Días faltantes para próxima nómina
  var flujo = (conf && conf.flujoQuincenal) ? conf.flujoQuincenal : {};
  var diasParaNomina = flujo.diasParaProximaNomina || 1;
  if (diasParaNomina <= 0) diasParaNomina = 1;

  var saldoDisponible = (conf && conf.saldoCuenta) ? conf.saldoCuenta : 0;
  var nuevoCupoDiarioSeguro = Math.max(Math.floor(saldoDisponible / diasParaNomina), 0);
  var cupoTeoricoBase = 21190;
  var desviacionDiaria = nuevoCupoDiarioSeguro - cupoTeoricoBase;
  var promedioHormigaDiario = Math.round(totalHormiga / diasVentana);

  var estadoRadar = "🟢 RITMO ÓPTIMO";
  var mensajeAlerta = "";
  if (nuevoCupoDiarioSeguro < 12000) {
    estadoRadar = "🔴 CRÍTICO";
    mensajeAlerta = "⚠️ *Alerta:* Tu cupo cayó a menos de $12.000 COP/día. Frena compras hormiga para asegurar tu quincena.";
  } else if (nuevoCupoDiarioSeguro < 18000) {
    estadoRadar = "🟡 PRECAUCIÓN";
    mensajeAlerta = "⚠️ *Atención:* Micro-gastos recientes redujeron tu cupo diario. Modera compras discrecionales.";
  } else {
    estadoRadar = "🟢 SALUDABLE";
    mensajeAlerta = "✨ _Tu disponible está bajo control y cuentas con margen holgado para gastos diarios._";
  }

  return {
    diasVentana: diasVentana,
    totalHormiga: totalHormiga,
    conteoHormiga: conteoHormiga,
    promedioHormigaDiario: promedioHormigaDiario,
    topHormigas: topHormigas,
    diasParaNomina: diasParaNomina,
    fechaProximaNomina: flujo.fechaProximaNominaTexto || "próxima quincena",
    saldoDisponible: saldoDisponible,
    cupoTeoricoBase: cupoTeoricoBase,
    nuevoCupoDiarioSeguro: nuevoCupoDiarioSeguro,
    desviacionDiaria: desviacionDiaria,
    estadoRadar: estadoRadar,
    mensajeAlerta: mensajeAlerta
  };
}

function generarTextoRadarHormiga(conf) {
  var radar = analizarGastosHormigaYDesviacion(conf);

  var texto = "🐜 *RADAR DE GASTOS HORMIGA Y CUPO DIARIO (" + radar.estadoRadar + ")*\n" +
              "• Micro-gastos (últimos " + radar.diasVentana + " días): *$" + formatearCOP(radar.totalHormiga) + " COP* (" + radar.conteoHormiga + " compras)\n" +
              "• Promedio hormiga: *~$" + formatearCOP(radar.promedioHormigaDiario) + " COP/día*\n";

  if (radar.topHormigas.length > 0) {
    texto += "• Principales micro-fugas recientes:\n";
    radar.topHormigas.forEach(function(h) {
      texto += "   - " + h.comercio + ": *$" + formatearCOP(h.monto) + " COP*\n";
    });
  }

  texto += "🎯 *Cupo diario recalibrado:* ||*$" + formatearCOP(radar.nuevoCupoDiarioSeguro) + " COP/día*|| (para los " + radar.diasParaNomina + " días hasta tu nómina del " + radar.fechaProximaNomina + ")\n" +
           (radar.desviacionDiaria < 0 ? "📉 Desviación vs cupo base: *-$" + formatearCOP(Math.abs(radar.desviacionDiaria)) + " COP/día*\n" : "📈 Margen favorable: *+$" + formatearCOP(radar.desviacionDiaria) + " COP/día*\n") +
           radar.mensajeAlerta;

  return { texto: texto, radar: radar };
}

// ==========================================
// FUNCIÓN DESHACER GASTO / REVERSIÓN DE TRANSACCIÓN ↩️
// ==========================================
function deshacerTransaccion(idTimestamp) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { ok: false, error: "No hay transacciones registradas para deshacer." };
  }

  var rows = sheet.getDataRange().getValues();
  var targetRow = -1;
  var headers = rows[0] || [];
  var tieneColTipo = headers.length > 1 && headers[1].toString().trim().toLowerCase() === "tipo";
  var idColIdx = tieneColTipo ? 7 : 6;

  if (idTimestamp) {
    var idStr = idTimestamp.toString();
    for (var i = rows.length - 1; i >= 1; i--) {
      var rowId = (rows[i][idColIdx] || "").toString();
      if (rowId === idStr) {
        targetRow = i + 1;
        break;
      }
    }
    if (targetRow === -1) {
      return { ok: false, error: "Este gasto ya fue deshecho o no se encontró en el historial." };
    }
  } else {
    for (var j = rows.length - 1; j >= 1; j--) {
      var tipoFila = tieneColTipo ? (rows[j][1] || "").toString().toLowerCase() : "";
      if (tipoFila.indexOf("ingreso") === -1 && tipoFila.indexOf("transferencia") === -1) {
        targetRow = j + 1;
        break;
      }
    }
  }

  if (targetRow <= 1) {
    return { ok: false, error: "No se encontró ninguna transacción válida para revertir." };
  }

  var rowData = sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var concepto = tieneColTipo ? (rowData[2] || "Sin concepto") : (rowData[1] || "Sin concepto");
  var monto = tieneColTipo ? (parseFloat(rowData[3]) || 0) : (parseFloat(rowData[2]) || 0);

  if (monto <= 0) {
    return { ok: false, error: "La transacción encontrada no tiene un monto monetario a revertir." };
  }

  // Eliminar la fila de Transacciones
  sheet.deleteRow(targetRow);

  // Reintegrar el dinero al saldo en cuenta
  var nuevoSaldo = agregarIngresoCuenta(monto, "Reintegro: " + concepto);
  var confActual = obtenerConfiguracionActual();

  return {
    ok: true,
    monto: monto,
    concepto: concepto,
    nuevoSaldo: nuevoSaldo,
    nuevoSaldoTotal: confActual.saldoTotalBanco
  };
}

// ==========================================
// MÓDULO DE SUB-BOLSILLOS VIRTUALES Y MICRO-INVERSIÓN (CDT + BINANCE CRIPTO) 📈
// ==========================================

/**
 * Calcula la distribución de sub-bolsillos virtuales dentro del Bolsillo de Ahorro Davivienda (53%)
 */
function obtenerSubBolsillosVirtuales(conf) {
  var totalAhorro = conf.saldoBolsilloAhorro || 1561218;
  var fondeoMensual = conf.metaAhorroMensual || CONFIG.DEFAULT_BOLSILLO_AHORRO;
  return {
    totalAhorro: totalAhorro,
    fondeoMensual: fondeoMensual,
    emergencia: {
      pct: 70,
      saldo: Math.round(totalAhorro * 0.70),
      fondeoMensual: Math.round(fondeoMensual * 0.70),
      nombre: "Colchón de Emergencia / Supervivencia",
      descripcion: "Blindado para salud, moto o empleo. Máxima liquidez en Davivienda."
    },
    cdt: {
      pct: 20,
      saldo: Math.round(totalAhorro * 0.20),
      fondeoMensual: Math.round(fondeoMensual * 0.20),
      nombre: "Micro-CDT / Renta Fija Protegida",
      descripcion: "Capital para CDTs a 90 o 180 días (Davivienda o Tyba desde $50k) batiendo la inflación."
    },
    cripto: {
      pct: 10,
      saldo: Math.round(totalAhorro * 0.10),
      fondeoMensual: Math.round(fondeoMensual * 0.10),
      nombre: "Micro-Cripto DCA Binance",
      descripcion: "Acumulación periódica en Binance (Bitcoin o USDT) en tickets de $20k a $50k COP."
    }
  };
}

/**
 * Consulta precios reales de Binance y TRM de Colombia con CacheService (30 min)
 */
function obtenerDatosCriptoBinance() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("crypto_binance_cop_data_v1");
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch(eC) {}
  }

  var btcUsd = 75600;
  var cambio24h = -4.1;
  var trm = 3100;
  var highPrice = 78000;
  var lowPrice = 74000;

  // 1. Ticker Binance 24h para BTCUSDT
  try {
    var resBinance = UrlFetchApp.fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", {
      muteHttpExceptions: true
    });
    if (resBinance.getResponseCode() === 200) {
      var dataB = JSON.parse(resBinance.getContentText());
      if (dataB && dataB.lastPrice) {
        btcUsd = parseFloat(dataB.lastPrice) || btcUsd;
        cambio24h = parseFloat(dataB.priceChangePercent) || cambio24h;
        if (dataB.highPrice) highPrice = parseFloat(dataB.highPrice) || highPrice;
        if (dataB.lowPrice) lowPrice = parseFloat(dataB.lowPrice) || lowPrice;
      }
    }
  } catch(eB) {
    Logger.log("Error consultando Binance: " + eB.toString());
  }

  // 2. TRM Oficial de Colombia (Datos Abiertos) o Fallback
  try {
    var resTrm = UrlFetchApp.fetch("https://www.datos.gov.co/resource/32sa-8pi3.json?$limit=1&$order=vigenciadesde%20DESC", {
      muteHttpExceptions: true
    });
    if (resTrm.getResponseCode() === 200) {
      var dataT = JSON.parse(resTrm.getContentText());
      if (dataT && dataT.length > 0 && dataT[0].valor) {
        trm = parseFloat(dataT[0].valor) || trm;
      }
    }
  } catch(eT) {
    try {
      var resEr = UrlFetchApp.fetch("https://open.er-api.com/v6/latest/USD", { muteHttpExceptions: true });
      if (resEr.getResponseCode() === 200) {
        var dataEr = JSON.parse(resEr.getContentText());
        if (dataEr && dataEr.rates && dataEr.rates.COP) {
          trm = parseFloat(dataEr.rates.COP) || trm;
        }
      }
    } catch(eEr) {
      Logger.log("Error consultando TRM fallback: " + eEr.toString());
    }
  }

  var btcCop = btcUsd * trm;
  var usdtCop = Math.round(trm * 1.005); // USDT P2P suele cotizar TRM + ~0.5% en Colombia
  var rango24hPct = highPrice > lowPrice ? Math.round(((btcUsd - lowPrice) / (highPrice - lowPrice)) * 100) : 50;

  var resultado = {
    btcUsd: btcUsd,
    cambio24h: cambio24h,
    trm: trm,
    btcCop: btcCop,
    usdtCop: usdtCop,
    highPrice: highPrice,
    lowPrice: lowPrice,
    rango24hPct: rango24hPct,
    timestamp: new Date().toISOString(),
    microCompras: {
      c20k: {
        sats: Math.round((20000 / btcCop) * 100000000),
        btc: (20000 / btcCop).toFixed(8),
        usdt: (20000 / usdtCop).toFixed(2)
      },
      c50k: {
        sats: Math.round((50000 / btcCop) * 100000000),
        btc: (50000 / btcCop).toFixed(8),
        usdt: (50000 / usdtCop).toFixed(2)
      },
      c100k: {
        sats: Math.round((100000 / btcCop) * 100000000),
        btc: (100000 / btcCop).toFixed(8),
        usdt: (100000 / usdtCop).toFixed(2)
      }
    }
  };

  try {
    cache.put("crypto_binance_cop_data_v1", JSON.stringify(resultado), 1800); // 30 min
  } catch(eP) {}

  return resultado;
}

/**
 * Fórmula exacta de rendimiento de CDT en Colombia deduciendo 4% retención en la fuente
 */
function calcularRendimientoCDT(monto, plazoDias, tasaEA) {
  monto = parseFloat(monto) || 0;
  plazoDias = parseInt(plazoDias) || 90;
  tasaEA = parseFloat(tasaEA) || 10.5;

  var factor = Math.pow(1 + (tasaEA / 100), plazoDias / 365);
  var rendimientoBruto = monto * (factor - 1);
  var retencionFuente = rendimientoBruto * 0.04; // 4% retención en la fuente Colombia
  var rendimientoNeto = Math.round(rendimientoBruto - retencionFuente);
  var montoFinalNeto = monto + rendimientoNeto;

  return {
    monto: monto,
    plazoDias: plazoDias,
    tasaEA: tasaEA,
    rendimientoBruto: Math.round(rendimientoBruto),
    retencionFuente: Math.round(retencionFuente),
    rendimientoNeto: rendimientoNeto,
    montoFinalNeto: montoFinalNeto
  };
}

/**
 * Inicializa la hoja Inversiones si no existe
 */
function inicializarHojaInversiones(ss) {
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.HOJA_INVERSIONES);
  }
  var headers = ["Fecha_Apertura", "Tipo", "Entidad_Plataforma", "Monto_COP", "Tasa_EA_o_Precio", "Plazo_Dias", "Fecha_Vencimiento", "Rendimiento_Estimado_COP", "Estado", "Senal_Radar", "ID_Timestamp"];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#0F9D58").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.getRange("D2:D").setNumberFormat("$#,##0");
    sheet.getRange("H2:H").setNumberFormat("$#,##0");
  } else if (sheet.getLastRow() === 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#0F9D58").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.getRange("D2:D").setNumberFormat("$#,##0");
    sheet.getRange("H2:H").setNumberFormat("$#,##0");
  }
  return sheet;
}

/**
 * Registra una inversión en Google Sheets Inversiones
 */
function registrarInversionEnHoja(tipo, entidad, montoCOP, tasaOPrecio, plazoDias, rendimientoEstimado) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  if (!sheet) {
    sheet = inicializarHojaInversiones(ss);
  }

  var hoy = new Date();
  var fechaAperturaStr = Utilities.formatDate(hoy, CONFIG.ZONA_HORARIA, "yyyy-MM-dd");
  var fechaVencimientoStr = "N/A";
  var rendimientoNum = 0;

  tipo = (tipo || "CDT").toUpperCase();
  plazoDias = parseInt(plazoDias) || 0;
  montoCOP = parseFloat(montoCOP) || 0;

  if (tipo === "CDT" && plazoDias > 0) {
    var fechaVenc = new Date(hoy.getTime() + (plazoDias * 24 * 60 * 60 * 1000));
    fechaVencimientoStr = Utilities.formatDate(fechaVenc, CONFIG.ZONA_HORARIA, "yyyy-MM-dd");
    var tasaNum = parseFloat(tasaOPrecio) || 10.5;
    var calc = calcularRendimientoCDT(montoCOP, plazoDias, tasaNum);
    rendimientoNum = calc.rendimientoNeto;
  } else {
    rendimientoNum = rendimientoEstimado || "N/A";
  }

  var idTs = hoy.getTime();
  var senalInicial = tipo === "CDT" ? "🔒 Activo (Fijo)" : "🟢 Acumulado (DCA)";

  sheet.appendRow([
    fechaAperturaStr,
    tipo,
    entidad || (tipo === "CDT" ? "Davivienda" : "Binance"),
    montoCOP,
    tasaOPrecio || (tipo === "CDT" ? "10.5% E.A." : "Spot"),
    plazoDias > 0 ? plazoDias : "N/A",
    fechaVencimientoStr,
    rendimientoNum,
    "Activo",
    senalInicial,
    idTs
  ]);

  return {
    ok: true,
    tipo: tipo,
    entidad: entidad,
    monto: montoCOP,
    tasaOPrecio: tasaOPrecio,
    plazoDias: plazoDias,
    vencimiento: fechaVencimientoStr,
    rendimientoEstimado: rendimientoNum,
    idTs: idTs
  };
}

/**
 * Limpia todas las filas de inversiones (dejando la fila 1 de encabezados)
 */
function limpiarTodasLasInversiones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    return true;
  }
  return false;
}

/**
 * Elimina una inversión específica por ID de timestamp, índice o monto, o todas si es 'all'
 */
function borrarInversionEnHoja(criterio) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { ok: false, mensaje: "No hay inversiones registradas en tu hoja de Google Sheets." };
  }

  var crit = (criterio || "all").toString().trim().toLowerCase();
  if (crit === "all" || crit === "todas" || crit === "todos" || crit === "*") {
    var filas = sheet.getLastRow() - 1;
    sheet.deleteRows(2, filas);
    return { ok: true, borrados: filas, mensaje: "Se eliminaron todas las inversiones (" + filas + " registro" + (filas > 1 ? "s" : "") + ")." };
  }

  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    var r = rows[i];
    var idTs = (r[10] || r[9] || "").toString();
    var tipo = (r[1] || "").toString();
    var entidad = (r[2] || "").toString();
    var monto = parseFloat(r[3]) || 0;
    var idxStr = i.toString();

    if (idTs === crit || idxStr === crit || crit.indexOf(monto.toString()) !== -1 || (crit.indexOf("100") !== -1 && monto === 100000)) {
      sheet.deleteRow(i + 1);
      return { ok: true, borrados: 1, mensaje: "Inversión (" + tipo + " en " + entidad + " por $" + formatearCOP(monto) + " COP) eliminada correctamente." };
    }
  }

  return { ok: false, mensaje: "No se encontró ninguna inversión con el identificador '" + criterio + "'." };
}

/**
 * Consulta todas las inversiones registradas y activas
 */
function obtenerInversionesRegistradas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  var activas = [];
  var totalMontoCDT = 0;
  var totalMontoCripto = 0;

  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getDataRange().getValues();
    var hoy = new Date();
    var hoyTs = hoy.getTime();

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var fechaAp = r[0] ? (r[0] instanceof Date ? Utilities.formatDate(r[0], CONFIG.ZONA_HORARIA, "yyyy-MM-dd") : r[0].toString()) : "";
      var tipo = (r[1] || "").toString();
      var entidad = (r[2] || "").toString();
      var monto = parseFloat(r[3]) || 0;
      var tasaOPrecio = (r[4] || "").toString();
      var plazo = r[5];
      var fechaVenc = r[6] ? (r[6] instanceof Date ? Utilities.formatDate(r[6], CONFIG.ZONA_HORARIA, "yyyy-MM-dd") : r[6].toString()) : "N/A";
      var rendEstimado = parseFloat(r[7]) || (r[7] ? r[7].toString() : "0");
      var estado = (r[8] || "Activo").toString();
      var senalRadar = (r[9] || "Activo").toString();
      var idTs = r[10] || r[9];

      if (estado.toLowerCase() === "activo") {
        var diasParaVencer = null;
        if (fechaVenc && fechaVenc !== "N/A") {
          try {
            var fVencDate = new Date(fechaVenc);
            if (!isNaN(fVencDate.getTime())) {
              diasParaVencer = Math.ceil((fVencDate.getTime() - hoyTs) / (1000 * 60 * 60 * 24));
            }
          } catch(eD) {}
        }

        if (tipo.toUpperCase() === "CDT") {
          totalMontoCDT += monto;
        } else {
          totalMontoCripto += monto;
        }

        activas.push({
          fechaApertura: fechaAp,
          tipo: tipo,
          entidad: entidad,
          monto: monto,
          tasaOPrecio: tasaOPrecio,
          plazoDias: plazo,
          fechaVencimiento: fechaVenc,
          diasParaVencer: diasParaVencer,
          rendimientoEstimado: rendEstimado,
          estado: estado,
          senalRadar: senalRadar,
          idTs: idTs
        });
      }
    }
  }

  return {
    activas: activas,
    totalMontoCDT: totalMontoCDT,
    totalMontoCripto: totalMontoCripto,
    totalMontoGeneral: totalMontoCDT + totalMontoCripto
  };
}

/**
 * Generador de mensaje para el Hub de Inversiones
 */
function generarMensajeHubInversiones(conf) {
  var invData = obtenerInversionesRegistradas();
  var sub = obtenerSubBolsillosVirtuales(conf);
  var crypto = obtenerDatosCriptoBinance();

  var signoVar = crypto.cambio24h >= 0 ? "🟢 +" : "🔴 ";
  var msg = "📈 *CENTRO DE INVERSIONES & PATRIMONIO*\n" +
            "🛡️ _Renta fija regulada y acumulación patrimonial sin especulación._\n\n";

  // SECCIÓN 1: CAPITAL INVERTIDO REAL
  if (!invData.activas || invData.activas.length === 0) {
    msg += "📊 *CAPITAL REALMENTE INVERTIDO:* *$0 COP*\n" +
           "✨ _Actualmente no tienes ningún CDT abierto ni compras cripto registradas en Google Sheets._\n\n";
  } else {
    msg += "📊 *CAPITAL REALMENTE INVERTIDO:* ||*$" + formatearCOP(invData.totalMontoGeneral) + " COP*||\n" +
           "• 🏦 CDTs Vigentes: *$" + formatearCOP(invData.totalMontoCDT) + " COP*\n" +
           "• ⚡ Cripto Binance: *$" + formatearCOP(invData.totalMontoCripto) + " COP*\n\n";
  }

  // SECCIÓN 2: CAPACIDAD Y DISTRIBUCIÓN SUGERIDA (SI DECIDE INVERTIR)
  msg += "💡 *CAPACIDAD DE INVERSIÓN (SUGERIDA SOBRE TU AHORRO):*\n" +
         "En tu Bolsillo Ahorro Davivienda tienes ||*$" + formatearCOP(sub.totalAhorro) + " COP*||. Si decides invertir parte de ese capital, el modelo 70/20/10 te sugiere:\n" +
         "1. 🛡️ *Emergencia (70%):* ||*$" + formatearCOP(sub.emergencia.saldo) + " COP*|| _(Intocable, 100% líquido en Davivienda)_\n" +
         "2. 🏦 *Cupo sugerido para CDT (20%):* hasta *$" + formatearCOP(sub.cdt.saldo) + " COP* _(Renta fija a 90 o 180 días)_\n" +
         "3. ⚡ *Cupo sugerido para Cripto (10%):* hasta *$" + formatearCOP(sub.cripto.saldo) + " COP* _(DCA Bitcoin en Binance)_\n" +
         "_(Nota: Tú decides cuándo y cuánto invertir; el bot jamás mueve dinero automáticamente)._\n\n" +
         "─────────────────────────────\n" +
         "⚡ *RADAR DE MERCADO EN VIVO:*\n" +
         "• 💵 *Dólar TRM Oficial:* *$" + formatearCOP(crypto.trm) + " COP*\n" +
         "• 🪙 *Bitcoin (Binance):* ||*$" + formatearCOP(crypto.btcUsd) + " USD*|| (~||*$" + formatearCOP(crypto.btcCop) + " COP*||)\n" +
         "• 📈 *Variación 24h:* *" + signoVar + crypto.cambio24h.toFixed(2) + "%*\n" +
         "• 🏦 *CDT Davivienda Móvil:* ~*10.50% E.A.* (directo en app Davivienda desde $100k)\n\n" +
         "👇 *Elige una opción para explorar o simular:*";

  var portafolioTxt = (invData.totalMontoGeneral > 0) ? "📁 Mi Portafolio ($" + formatearCOP(invData.totalMontoGeneral) + ")" : "📁 Mi Portafolio ($0)";

  var inlineKb = [
    [
      { text: portafolioTxt, callback_data: "cb:inv_portafolio" },
      { text: "➕ Registrar Inversión", callback_data: "cb:inv_como_registrar" }
    ],
    [
      { text: "🏦 Opciones CDT (10.5% - 11.3%)", callback_data: "cb:inv_cdt" },
      { text: "⚡ Opciones Binance (DCA)", callback_data: "cb:inv_cripto" }
    ],
    [
      { text: "🧮 Simular Ganancias CDT", callback_data: "cb:inv_simular" },
      { text: "🧭 Señales ¿Cuándo Invertir?", callback_data: "cb:inv_timing" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Generador de mensaje comparativo de CDTs en Colombia
 */
function generarMensajeCDTsColombia(conf) {
  var invData = obtenerInversionesRegistradas();
  var sub = obtenerSubBolsillosVirtuales(conf);
  var sim100k_90 = calcularRendimientoCDT(100000, 90, 10.5);
  var sim50k_90 = calcularRendimientoCDT(50000, 90, 11.0);

  var msg = "🏦 *COMPARADOR DE CDTs DIGITALES EN COLOMBIA*\n" +
            "🛡️ _Renta fija 100% regulada por la Superfinanciera y respaldada por Fogafín hasta por $50.000.000 COP._\n\n" +
            "📊 *Estado Actual en CDTs:* *" + (invData.totalMontoCDT > 0 ? "$" + formatearCOP(invData.totalMontoCDT) + " COP invertidos" : "$0 COP invertidos (0 activos)") + "*\n" +
            "💰 *Cupo sugerido si deseas abrir un CDT:* hasta ||*$" + formatearCOP(sub.cdt.saldo) + " COP*|| (20% de tu Bolsillo Ahorro)\n\n" +
            "⭐ *1. DAVIVIENDA CDT DIGITAL / MÓVIL (Recomendado para ti):*\n" +
            "• *Tasa estimada:* ~*10.50% E.A.*\n" +
            "• *Plazos:* 90, 180 o 360 días\n" +
            "• *Monto mínimo:* Desde *$100.000 COP*\n" +
            "• *Ventaja Clave:* Como tu nómina llega a Davivienda, no pagas comisiones por transferir ni 4x1000. Se abre directo en la App Davivienda -> Menú Invertir -> CDT Móvil en 2 minutos.\n" +
            "• *Ejemplo 90 días ($100k):* Recibes *$" + formatearCOP(sim100k_90.montoFinalNeto) + " COP* (+*$" + formatearCOP(sim100k_90.rendimientoNeto) + " COP* netos tras 4% retención).\n\n" +
            "🌿 *2. TYBA (MIBANCO CDT DIGITAL):*\n" +
            "• *Tasa estimada:* ~*11.00% E.A.*\n" +
            "• *Monto mínimo:* Desde *$50.000 COP* (el más accesible de Colombia)\n" +
            "• *Ejemplo 90 días ($50k):* Recibes *$" + formatearCOP(sim50k_90.montoFinalNeto) + " COP* (+*$" + formatearCOP(sim50k_90.rendimientoNeto) + " COP* netos).\n\n" +
            "🏛️ *3. PIBANK / MEJORCDT:*\n" +
            "• *Tasa estimada:* ~*11.30% E.A.*\n" +
            "• *Plazos recomendados:* 180 a 360 días\n" +
            "• *Monto mínimo:* Desde *$100.000 COP*\n\n" +
            "⚖️ *Nota Tributaria:* Todas las rentabilidades descuentan el 4% de retención en la fuente sobre los intereses generados.\n\n" +
            "💡 _Toca los botones abajo para simular con otros montos:_";

  var inlineKb = [
    [
      { text: "🧮 Simular $50k", callback_data: "cb:inv_sim_50k" },
      { text: "🧮 Simular $100k", callback_data: "cb:inv_sim_100k" },
      { text: "🧮 Simular $200k", callback_data: "cb:inv_sim_200k" }
    ],
    [
      { text: "⚡ Opciones Binance Cripto", callback_data: "cb:inv_cripto" },
      { text: "🧭 Señales de Timing", callback_data: "cb:inv_timing" }
    ],
    [
      { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Generador de mensaje de Radar Cripto Binance
 */
function generarMensajeCriptoBinance(conf) {
  var invData = obtenerInversionesRegistradas();
  var sub = obtenerSubBolsillosVirtuales(conf);
  var crypto = obtenerDatosCriptoBinance();

  var signoVar = crypto.cambio24h >= 0 ? "🟢 +" : "🔴 ";
  var msg = "⚡ *RADAR CRIPTO BINANCE EN VIVO (MICRO-DCA)*\n" +
            "🚀 _Estrategia de acumulación periódica en Binance sin arriesgar tu estabilidad._\n\n" +
            "📊 *Estado Actual en Cripto:* *" + (invData.totalMontoCripto > 0 ? "$" + formatearCOP(invData.totalMontoCripto) + " COP invertidos" : "$0 COP invertidos (0 posiciones)") + "*\n" +
            "💰 *Cupo sugerido si decides comprar:* hasta ||*$" + formatearCOP(sub.cripto.saldo) + " COP*|| (10% de tu Bolsillo Ahorro)\n\n" +
            "📊 *COTIZACIONES REALES EN BINANCE:*\n" +
            "• 🪙 *Bitcoin (BTC):* ||*$" + formatearCOP(crypto.btcUsd) + " USD*|| (~||*$" + formatearCOP(crypto.btcCop) + " COP*||)\n" +
            "• 📈 *Variación 24h:* *" + signoVar + crypto.cambio24h.toFixed(2) + "%*\n" +
            "• 💵 *Dólar TRM Oficial:* *$" + formatearCOP(crypto.trm) + " COP*\n" +
            "• 🪙 *USDT P2P Estimado:* *$" + formatearCOP(crypto.usdtCop) + " COP*\n\n" +
            "🎯 *MICRO-COMPRAS SUGERIDAS (BINANCE DCA):*\n" +
            "• Con *$20.000 COP:* compras ~*" + crypto.microCompras.c20k.sats.toLocaleString("es-CO") + " Satoshis* o *" + crypto.microCompras.c20k.usdt + " USDT*\n" +
            "• Con *$50.000 COP:* compras ~*" + crypto.microCompras.c50k.sats.toLocaleString("es-CO") + " Satoshis* o *" + crypto.microCompras.c50k.usdt + " USDT*\n" +
            "• Con *$100.000 COP:* compras ~*" + crypto.microCompras.c100k.sats.toLocaleString("es-CO") + " Satoshis* o *" + crypto.microCompras.c100k.usdt + " USDT*\n\n" +
            "🧠 *ESTRATEGIA RECOMENDADA EN BINANCE RECOMENDADA:*\n" +
            "1. *Nunca arriesgar el arriendo ni el disponible diario:* Usa únicamente una pequeña fracción de tu 10% de ahorro ($20k a $40k por quincena).\n" +
            "2. *Binance P2P:* Puedes comprar USDT pagando con Davivienda o Nequi a 0% comisiones bancarias.\n" +
            "3. *Binance Auto-Invest (DCA):* Programa compras automáticas recurrentes de Bitcoin para promediar el precio a largo plazo.\n\n" +
            "🛡️ _Recuerda: El bot nunca ejecuta compras ni mueve tu dinero. Cuando hagas una compra en Binance, regístrala con `/registrar_inversion cripto [monto] btc Binance`._";

  var inlineKb = [
    [
      { text: "🏦 Ver Opciones CDT", callback_data: "cb:inv_cdt" },
      { text: "🧭 ¿Cuándo Comprar BTC?", callback_data: "cb:inv_timing" }
    ],
    [
      { text: "📁 Mi Portafolio", callback_data: "cb:inv_portafolio" },
      { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Generador de simulador de rendimientos de CDT
 */
function generarMensajeSimuladorInversiones(monto) {
  monto = monto || 100000;

  var sD90 = calcularRendimientoCDT(monto, 90, 10.5);
  var sD180 = calcularRendimientoCDT(monto, 180, 10.5);
  var sT90 = calcularRendimientoCDT(monto, 90, 11.0);
  var sT180 = calcularRendimientoCDT(monto, 180, 11.0);
  var sP360 = calcularRendimientoCDT(monto, 360, 11.3);

  var msg = "🧮 *SIMULADOR FINANCIERO DE CDTs EN COLOMBIA*\n" +
            "💵 *Capital a Invertir:* *$" + formatearCOP(monto) + " COP*\n" +
            "🛡️ _Rendimientos netos reales (descontando el 4% de retención en la fuente):_\n\n" +
            "🏦 *1. Davivienda CDT Móvil (10.50% E.A. - Tu mismo banco):*\n" +
            "• *A 90 días:* Recibes *$" + formatearCOP(sD90.montoFinalNeto) + " COP* (+*$" + formatearCOP(sD90.rendimientoNeto) + " COP* netos)\n" +
            "• *A 180 días:* Recibes *$" + formatearCOP(sD180.montoFinalNeto) + " COP* (+*$" + formatearCOP(sD180.rendimientoNeto) + " COP* netos)\n\n" +
            "🌿 *2. Tyba / Mibanco (11.00% E.A.):*\n" +
            "• *A 90 días:* Recibes *$" + formatearCOP(sT90.montoFinalNeto) + " COP* (+*$" + formatearCOP(sT90.rendimientoNeto) + " COP* netos)\n" +
            "• *A 180 días:* Recibes *$" + formatearCOP(sT180.montoFinalNeto) + " COP* (+*$" + formatearCOP(sT180.rendimientoNeto) + " COP* netos)\n\n" +
            "🏛️ *3. Pibank / MejorCDT (11.30% E.A.):*\n" +
            "• *A 360 días (1 año):* Recibes *$" + formatearCOP(sP360.montoFinalNeto) + " COP* (+*$" + formatearCOP(sP360.rendimientoNeto) + " COP* netos)\n\n" +
            "💡 *Recomendación del Asesor:* Para evitar costos de transferencia y 4x1000, la opción más práctica para ti es abrir el *CDT Móvil en Davivienda* directo desde su app a 90 o 180 días.\n\n" +
            "👇 *Selecciona otro monto para simular:*";

  var inlineKb = [
    [
      { text: "Simular $50k", callback_data: "cb:inv_sim_50k" },
      { text: "Simular $100k", callback_data: "cb:inv_sim_100k" },
      { text: "Simular $200k", callback_data: "cb:inv_sim_200k" },
      { text: "Simular $300k", callback_data: "cb:inv_sim_300k" }
    ],
    [
      { text: "🏦 Opciones CDTs", callback_data: "cb:inv_cdt" },
      { text: "⚡ Opciones Cripto", callback_data: "cb:inv_cripto" }
    ],
    [
      { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Generador de mensaje de Sub-Bolsillos Virtuales
 */
function generarMensajeSubBolsillos(conf) {
  var sub = obtenerSubBolsillosVirtuales(conf);
  var invData = obtenerInversionesRegistradas();

  var pctAhSub = conf.pctAhorroReal || ((conf.saldoBolsilloAhorro / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
  var msg = "💎 *DISTRIBUCIÓN ESTRATÉGICA DE AHORRO (70 / 20 / 10)*\n" +
            "🛡️ _Guía sugerida para no mezclar tu fondo de emergencias con inversiones._\n\n" +
            "💰 *Total en Bolsillo Ahorro Davivienda:* ||*$" + formatearCOP(sub.totalAhorro) + " COP*|| *(" + pctAhSub + "% actual del total)*\n" +
            "📊 *Inversiones activas ejecutadas hoy:* *$" + formatearCOP(invData.totalMontoGeneral) + " COP*\n\n" +
            "1. 🛡️ *COLCHÓN DE EMERGENCIA (70%):*\n" +
            "• Saldo sugerido: ||*$" + formatearCOP(sub.emergencia.saldo) + " COP*||\n" +
            "• *Regla:* Intocable. Se mantiene 100% líquido en Davivienda para cubrir cualquier eventualidad de salud, moto o empleo sin endeudarte con tarjeta.\n\n" +
            "2. 🏦 *MARGEN SUGERIDO PARA CDT (20%):*\n" +
            "• Cupo máximo sugerido: ||*$" + formatearCOP(sub.cdt.saldo) + " COP*|| (Actualmente invertido: *$" + formatearCOP(invData.totalMontoCDT) + " COP*)\n" +
            "• *Regla:* Capital para CDTs a 90 o 180 días (Davivienda o Tyba desde $50k) para blindar tus ahorros de la inflación.\n\n" +
            "3. ⚡ *MARGEN SUGERIDO PARA CRIPTO (10%):*\n" +
            "• Cupo máximo sugerido: ||*$" + formatearCOP(sub.cripto.saldo) + " COP*|| (Actualmente invertido: *$" + formatearCOP(invData.totalMontoCripto) + " COP*)\n" +
            "• *Regla:* Fracción para acumular Bitcoin o USDT vía Binance P2P / Auto-Invest en tickets de $20k a $40k COP sin estrés.\n\n" +
            "💡 _Esta división es una guía estratégica 100% sugerida. El dinero sigue unificado en tu Bolsillo Ahorro Davivienda y tú tienes el control total._";

  var inlineKb = [
    [
      { text: "🏦 Ver CDTs", callback_data: "cb:inv_cdt" },
      { text: "⚡ Cripto Binance", callback_data: "cb:inv_cripto" }
    ],
    [
      { text: "📁 Mi Portafolio", callback_data: "cb:inv_portafolio" },
      { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Generador de mensaje del Portafolio de Inversiones Registradas
 */
function generarMensajePortafolio() {
  var invData = obtenerInversionesRegistradas();
  var msg = "📁 *PORTAFOLIO DE INVERSIONES REGISTRADAS*\n\n";

  if (!invData.activas || invData.activas.length === 0) {
    msg += "📊 *Capital Activo Invertido:* *$0 COP*\n" +
           "• 🏦 CDTs Vigentes: *$0 COP* (0 activos)\n" +
           "• ⚡ Cripto Binance: *$0 COP* (0 posiciones)\n\n" +
           "✨ _Actualmente no tienes ninguna inversión registrada en tu hoja de Inversiones._\n\n" +
           "💡 *¿Cómo registrar una inversión cuando la hagas manualmente?*\n" +
           "• Para un CDT: `/registrar_inversion cdt 100000 10.5 90 Davivienda`\n" +
           "• Para Cripto: `/registrar_inversion cripto 50000 btc Binance`\n" +
           "• O simplemente dímelo por audio o chat:\n" +
           "  _\"Abrí un CDT en Davivienda de 100k a 90 días al 10.5%\"_\n\n" +
           "El bot guardará el registro en tu Google Sheet `Inversiones` y te enviará alertas automáticas a las 8 AM cuando esté cerca de vencer.";
  } else {
    msg += "📊 *Total Invertido en CDTs:* *$" + formatearCOP(invData.totalMontoCDT) + " COP*\n" +
           "⚡ *Total Invertido en Cripto:* *$" + formatearCOP(invData.totalMontoCripto) + " COP*\n" +
           "💰 *Total Portafolio Activo:* *$" + formatearCOP(invData.totalMontoGeneral) + " COP*\n\n" +
           "📋 *Detalle de Inversiones Activas:*\n";

    invData.activas.forEach(function(item, idx) {
      if (item.tipo && item.tipo.toUpperCase() === "CDT") {
        msg += "🏦 *" + (idx + 1) + ". CDT en " + item.entidad + "*\n" +
               "   💵 Monto: *$" + formatearCOP(item.monto) + " COP* | Tasa: *" + item.tasaOPrecio + "*\n" +
               "   📅 Vencimiento: *" + item.fechaVencimiento + "* (en *" + item.diasParaVencer + " días*)\n" +
               "   📈 Ganancia estimada: *+$" + formatearCOP(item.rendimientoEstimado) + " COP*\n\n";
      } else {
        msg += "⚡ *" + (idx + 1) + ". Cripto en " + item.entidad + "*\n" +
               "   💵 Monto: *$" + formatearCOP(item.monto) + " COP*\n" +
               "   📊 Detalle: *" + item.rendimientoEstimado + "*\n" +
               "   📅 Fecha: *" + item.fechaApertura + "*\n\n";
      }
    });
  }

  var inlineKb = [
    [
      { text: "🧭 Cuándo Comprar/Vender", callback_data: "cb:inv_timing" },
      { text: "➕ Registrar Inversión", callback_data: "cb:inv_como_registrar" }
    ],
    [
      { text: "🏦 Ver CDTs", callback_data: "cb:inv_cdt" },
      { text: "⚡ Binance Cripto", callback_data: "cb:inv_cripto" }
    ]
  ];

  if (invData.activas && invData.activas.length > 0) {
    inlineKb.push([
      { text: "🗑️ Borrar Inversiones Registradas", callback_data: "cb:inv_borrar_todas" }
    ]);
  }

  inlineKb.push([
    { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
  ]);

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Análisis cuantitativo de Timing para Compra y Venta (Binance BTC + CDTs Colombia)
 */
function analizarTimingMercadoInversiones(conf) {
  var crypto = obtenerDatosCriptoBinance();
  var invData = obtenerInversionesRegistradas();
  var sub = obtenerSubBolsillosVirtuales(conf);

  // 1. Diagnóstico de Mercado Cripto General
  var estadoCompraCripto = "";
  var consejoCompraCripto = "";
  var emojiCompraCripto = "";

  var estadoVentaCripto = "";
  var consejoVentaCripto = "";
  var emojiVentaCripto = "";

  if (crypto.cambio24h <= -3.0 || crypto.rango24hPct <= 25) {
    emojiCompraCripto = "🟢";
    estadoCompraCripto = "OPORTUNIDAD MICRO-DCA (Retroceso Diario)";
    consejoCompraCripto = "Bitcoin ha retrocedido *" + crypto.cambio24h.toFixed(2) + "%* en 24h y cotiza cerca al soporte del día ($" + formatearCOP(crypto.lowPrice) + " USD). Es una ventana favorable para realizar una micro-compra escalonada de *$20.000 a $50.000 COP* (cupo disponible: ||$" + formatearCOP(sub.cripto.saldo) + " COP||). No compres todo de golpe; divide en 2 o 3 compras parciales.";

    emojiVentaCripto = "🔴";
    estadoVentaCripto = "NO VENDER EN CORRECCIÓN (HOLD)";
    consejoVentaCripto = "Vender durante una caída intradía cristaliza pérdidas innecesarias. Si tienes posiciones abiertas, mantén la calma (HOLD) y espera el rebote a resistencias.";
  } else if (crypto.cambio24h >= 4.0 || crypto.rango24hPct >= 80) {
    emojiCompraCripto = "🔴";
    estadoCompraCripto = "RESISTENCIA / SOBREEXTENDIDO (EVITAR FOMO)";
    consejoCompraCripto = "Bitcoin cotiza en la parte alta de su rango diario ($" + formatearCOP(crypto.highPrice) + " USD, +" + crypto.cambio24h.toFixed(2) + "%). Comprar en máximos diarios eleva el riesgo de corrección inmediata. Espera un pullback hacia la media.";

    emojiVentaCripto = "🟢";
    estadoVentaCripto = "ZONA FAVORABLE DE TOMA DE GANANCIAS";
    consejoVentaCripto = "Si tienes compras anteriores en beneficio sustancial (+15% a +20%), este es un excelente momento para vender un 20% a 30% de tu posición y asegurar ganancias en tu cuenta o pasarlas a tu fondo de emergencia.";
  } else {
    emojiCompraCripto = "🟡";
    estadoCompraCripto = "MERCADO EN CONSOLIDACIÓN / NEUTRAL";
    consejoCompraCripto = "El precio cotiza en zona media ($" + formatearCOP(crypto.btcUsd) + " USD, " + (crypto.cambio24h >= 0 ? "+" : "") + crypto.cambio24h.toFixed(2) + "%). No hay desequilibrio extremo. Si no es tu fecha programada de nómina, mantén la paciencia.";

    emojiVentaCripto = "🟡";
    estadoVentaCripto = "MANTENER POSICIONES (HOLD)";
    consejoVentaCripto = "Sin catalizadores de ruptura extrema. Mantén tus posiciones activas acumulando valor.";
  }

  // 2. Diagnóstico de Renta Fija y CDTs en Colombia
  var estadoCDT = "🟢 VENTANA HISTÓRICA PARA FIJAR TASA AHORA";
  var consejoCDT = "El Banco de la República (BanRep) mantiene una senda de recorte de tasas de interés. Como la inflación colombiana se ha moderado, los bancos gradualmente bajarán las tasas de los CDTs hacia el 8%-9% E.A.\n" +
                   "👉 *Momento de entrada:* Fijar una tasa del *10.50% E.A.* en Davivienda Móvil (o ~11.0% en Tyba) a *180 o 360 días AHORA* asegura un rendimiento real blindado antes de los próximos recortes bancarios.\n" +
                   "👉 *Momento de salida:* Los CDTs no se pueden cancelar antes del vencimiento. Al vencer, dispones de 48 horas de período de gracia para decidir si capitalizas con interés compuesto o trasladas las ganancias netas.";

  // 3. Diagnóstico de Inversiones Activas del Usuario
  var evaluacionesActivas = [];
  if (invData.activas && invData.activas.length > 0) {
    invData.activas.forEach(function(item) {
      var recomendacion = "";
      var tipo = (item.tipo || "").toUpperCase();

      if (tipo === "CDT") {
        if (item.diasParaVencer !== null) {
          if (item.diasParaVencer <= 0) {
            recomendacion = "🔔 *Vence Hoy:* Acércate a la app Davivienda. Elige reinvertir al 10.5% E.A. para capitalizar intereses o retirar al disponible.";
          } else if (item.diasParaVencer <= 3) {
            recomendacion = "⏰ *Vence en " + item.diasParaVencer + " días:* Prepara tu decisión de renovación o retiro de los $" + formatearCOP(item.rendimientoEstimado) + " COP netos.";
          } else {
            recomendacion = "🔒 *Activo y Generando Rendimiento:* Faltan " + item.diasParaVencer + " días. Deja madurar el título sin tocarlo.";
          }
        }
      } else {
        // Cripto
        if (crypto.cambio24h <= -3.0) {
          recomendacion = "🛒 *Promediar a la baja (DCA):* Si tu posición está en negativo o neutra, el retroceso actual del mercado te permite comprar más barato y reducir tu precio medio.";
        } else if (crypto.cambio24h >= 4.0) {
          recomendacion = "💰 *Evaluar Toma Parcial:* Mercado alcista. Si tu compra tiene beneficio, puedes retirar el capital inicial y dejar correr las ganancias (riesgo cero).";
        } else {
          recomendacion = "🟡 *Hold:* Mantener posición en Binance. Esperar consolidación o siguiente nivel objetivo.";
        }
      }

      evaluacionesActivas.push({
        item: item,
        recomendacion: recomendacion
      });
    });
  }

  return {
    crypto: crypto,
    sub: sub,
    invData: invData,
    estadoCompraCripto: estadoCompraCripto,
    consejoCompraCripto: consejoCompraCripto,
    emojiCompraCripto: emojiCompraCripto,
    estadoVentaCripto: estadoVentaCripto,
    consejoVentaCripto: consejoVentaCripto,
    emojiVentaCripto: emojiVentaCripto,
    estadoCDT: estadoCDT,
    consejoCDT: consejoCDT,
    evaluacionesActivas: evaluacionesActivas
  };
}

/**
 * Generador de mensaje explicativo del Radar de Timing Compra/Venta
 */
function generarMensajeTimingMercado(conf) {
  var timing = analizarTimingMercadoInversiones(conf);
  var c = timing.crypto;

  var msg = "🧭 *RADAR DE SEÑALES: ¿CUÁNDO COMPRAR O VENDER?* 📊\n" +
            "🛡️ _Análisis de mercado en vivo de Binance (BTC/COP), TRM y Renta Fija Colombia._\n\n" +
            "─────────────────────────────\n" +
            "⚡ *1. MERCADO CRIPTO (BINANCE - BITCOIN / USDT)*\n" +
            "• 🪙 *Precio Actual:* ||*$" + formatearCOP(c.btcUsd) + " USD*|| (~||*$" + formatearCOP(c.btcCop) + " COP*||)\n" +
            "• 📊 *Rango 24h:* Mín ||$" + formatearCOP(c.lowPrice) + "|| | Máx ||$" + formatearCOP(c.highPrice) + "||\n" +
            "• 📈 *Variación 24h:* *" + (c.cambio24h >= 0 ? "🟢 +" : "🔴 ") + c.cambio24h.toFixed(2) + "%* (Ubicación en rango: *" + c.rango24hPct + "%*)\n\n" +
            "🎯 *¿MOMENTO DE COMPRAR CRIPTO?*\n" +
            timing.emojiCompraCripto + " *" + timing.estadoCompraCripto + "*\n" +
            timing.consejoCompraCripto + "\n\n" +
            "🎯 *¿MOMENTO DE VENDER CRIPTO?*\n" +
            timing.emojiVentaCripto + " *" + timing.estadoVentaCripto + "*\n" +
            timing.consejoVentaCripto + "\n\n" +
            "─────────────────────────────\n" +
            "🏦 *2. RENTA FIJA Y CDTs (DAVIVIENDA / COLOMBIA)*\n" +
            "• 🏛️ *Tasa Davivienda Móvil:* ~*10.50% E.A.* (Neto: ~*10.08%* tras retención 4%)\n" +
            "• 🇨🇴 *Tendencia BanRep:* Ciclo bajista de política monetaria hacia el 8%-9%.\n\n" +
            "🎯 *DIAGNÓSTICO Y MOMENTO PARA CDTs:*\n" +
            "*" + timing.estadoCDT + "*\n" +
            timing.consejoCDT + "\n\n" +
            "─────────────────────────────\n" +
            "📁 *3. DIAGNÓSTICO DE TUS INVERSIONES REGISTRADAS:*\n";

  if (timing.evaluacionesActivas.length === 0) {
    msg += "✨ _Actualmente no tienes CDTs ni compras registradas en tu hoja de Google Sheets._\n" +
           "💡 _Cuando hagas una compra manual en Binance o abras un CDT en Davivienda, regístrala con `/registrar_inversion` y el bot te avisará automáticamente el momento exacto para reinvertir o tomar beneficios._";
  } else {
    timing.evaluacionesActivas.forEach(function(ev, idx) {
      var it = ev.item;
      msg += (idx + 1) + ". *" + it.tipo + " en " + it.entidad + "* ($" + formatearCOP(it.monto) + " COP)\n" +
             "   👉 " + ev.recomendacion + "\n\n";
    });
  }

  var inlineKb = [
    [
      { text: "⚡ Binance Cripto", callback_data: "cb:inv_cripto" },
      { text: "🏦 Comparador CDTs", callback_data: "cb:inv_cdt" }
    ],
    [
      { text: "🧮 Simular Ganancias", callback_data: "cb:inv_simular" },
      { text: "📁 Mi Portafolio", callback_data: "cb:inv_portafolio" }
    ],
    [
      { text: "💎 Ver Sub-Bolsillos", callback_data: "cb:inv_subbolsillos" },
      { text: "🔄 Refrescar Radar", callback_data: "cb:inv_timing" }
    ]
  ];

  return { texto: msg, inlineKb: inlineKb };
}

/**
 * Actualiza la columna Senal_Radar en la hoja Inversiones en Google Sheets
 */
function actualizarSenalesEnHojaInversiones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.HOJA_INVERSIONES);
  if (!sheet || sheet.getLastRow() <= 1) return;

  var conf = obtenerConfiguracionActual();
  var timing = analizarTimingMercadoInversiones(conf);
  var rows = sheet.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    var tipo = (rows[i][1] || "").toString().toUpperCase();
    var estado = (rows[i][8] || "Activo").toString();
    if (estado.toLowerCase() === "activo") {
      var senal = "🟡 Hold";
      if (tipo === "CDT") {
        var fechaVenc = rows[i][6];
        var diasVenc = 999;
        if (fechaVenc && fechaVenc !== "N/A") {
          try {
            var fV = new Date(fechaVenc);
            if (!isNaN(fV.getTime())) {
              diasVenc = Math.ceil((fV.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            }
          } catch(eF) {}
        }
        if (diasVenc <= 0) {
          senal = "🔔 Vence Hoy (Renovar/Retirar)";
        } else if (diasVenc <= 3) {
          senal = "⏰ Vence en " + diasVenc + "d (Preparar decisión)";
        } else {
          senal = "🔒 Activo (" + diasVenc + "d restantes)";
        }
      } else {
        if (timing.crypto.cambio24h <= -3.0) {
          senal = "🟢 Zona Compra DCA (" + timing.crypto.cambio24h.toFixed(1) + "%)";
        } else if (timing.crypto.cambio24h >= 4.0) {
          senal = "🔴 Tomar Ganancia (" + (timing.crypto.cambio24h >= 0 ? "+" : "") + timing.crypto.cambio24h.toFixed(1) + "%)";
        } else {
          senal = "🟡 Hold (" + (timing.crypto.cambio24h >= 0 ? "+" : "") + timing.crypto.cambio24h.toFixed(1) + "%)";
        }
      }
      sheet.getRange(i + 1, 10).setValue(senal);
    }
  }
}

/**
 * Manejador del comando /registrar_inversion
 */
function handleRegistrarInversionComando(chatId, text, conf) {
  var partesRI = text.split(" ");
  if (partesRI.length >= 3) {
    var tipoRI = (partesRI[1] || "").toLowerCase();
    var montoRI = parseFloat(partesRI[2].replace(/[^0-9.]/g, ''));
    if (montoRI > 0) {
      if (tipoRI.indexOf("cdt") !== -1) {
        var tasaRI = partesRI[3] ? parseFloat(partesRI[3].replace(/[^0-9.]/g, '')) : 10.5;
        var plazoRI = partesRI[4] ? parseInt(partesRI[4].replace(/[^0-9]/g, '')) : 90;
        var entidadRI = partesRI.slice(5).join(" ") || "Davivienda CDT Digital";

        var calcCDT = calcularRendimientoCDT(montoRI, plazoRI, tasaRI);
        var resReg = registrarInversionEnHoja("CDT", entidadRI, montoRI, tasaRI + "% E.A.", plazoRI, calcCDT.rendimientoNeto);

        var msgConfCDT = "🎉 *¡CDT REGISTRADO EN TU PORTAFOLIO!*\n\n" +
                         "🏦 *Entidad:* " + entidadRI + "\n" +
                         "💵 *Capital Invertido:* *$" + formatearCOP(montoRI) + " COP*\n" +
                         "📊 *Tasa:* *" + tasaRI + "% E.A.* | *Plazo:* *" + plazoRI + " días*\n" +
                         "📅 *Fecha Vencimiento:* *" + resReg.vencimiento + "*\n" +
                         "📈 *Ganancia neta esperada:* ||*+$" + formatearCOP(calcCDT.rendimientoNeto) + " COP*||\n" +
                         "💰 *Total neto a recibir:* ||*$" + formatearCOP(calcCDT.montoFinalNeto) + " COP*||\n\n" +
                         "🔔 _Te avisaré a las 8:00 AM cuando falten 3 días y el día exacto de vencimiento para que decidas si reinvertir o transferir a tu cuenta._";
        sendTelegram(chatId, msgConfCDT, [
          [{ text: "📁 Ver Mi Portafolio", callback_data: "cb:inv_portafolio" }],
          [{ text: "📈 Menú Inversiones", callback_data: "cb:invertir" }]
        ]);
        return;
      } else if (tipoRI.indexOf("cripto") !== -1 || tipoRI.indexOf("binance") !== -1 || tipoRI.indexOf("btc") !== -1 || tipoRI.indexOf("usdt") !== -1) {
        var monedaRI = (partesRI[3] || "BTC").toUpperCase();
        var entidadC = partesRI.slice(4).join(" ") || "Binance P2P";
        var cData = obtenerDatosCriptoBinance();
        var descCant = "";
        if (monedaRI.indexOf("USDT") !== -1) {
          var usdtCant = (montoRI / cData.usdtCop).toFixed(2);
          descCant = usdtCant + " USDT (@ $" + formatearCOP(cData.usdtCop) + " COP)";
        } else {
          var satsCant = Math.round((montoRI / cData.btcCop) * 100000000);
          descCant = satsCant.toLocaleString("es-CO") + " Satoshis (~" + (montoRI / cData.btcCop).toFixed(8) + " BTC)";
        }

        registrarInversionEnHoja("Cripto", entidadC, montoRI, monedaRI + " / Binance", 0, descCant);

        var msgConfCripto = "⚡ *¡COMPRA CRIPTO REGISTRADA CON ÉXITO!*\n\n" +
                            "🏢 *Plataforma:* " + entidadC + "\n" +
                            "💵 *Monto invertido:* *$" + formatearCOP(montoRI) + " COP*\n" +
                            "🪙 *Activo adquirido:* *" + descCant + "*\n" +
                            "📊 *Precio referencia BTC:* $" + formatearCOP(cData.btcUsd) + " USD (~$" + formatearCOP(cData.btcCop) + " COP)\n\n" +
                            "🛡️ _¡Excelente micro-DCA! Recuerda mantener tus fondos seguros en tu billetera o cuenta verificada de Binance._";
        sendTelegram(chatId, msgConfCripto, [
          [{ text: "📁 Ver Mi Portafolio", callback_data: "cb:inv_portafolio" }],
          [{ text: "📈 Menú Inversiones", callback_data: "cb:invertir" }]
        ]);
        return;
      }
    }
  }

  var msgAyudaRI = "⚠️ *Formato de registro de inversiones:*\n\n" +
                   "🏦 *Para registrar un CDT:*\n" +
                   "`/registrar_inversion cdt [monto] [tasa_EA] [plazo_dias] [entidad]`\n" +
                   "_Ejemplo:_ `/registrar_inversion cdt 100000 10.5 90 Davivienda`\n\n" +
                   "⚡ *Para registrar compra Cripto (Binance):*\n" +
                   "`/registrar_inversion cripto [monto] [BTC|USDT] [entidad]`\n" +
                   "_Ejemplo:_ `/registrar_inversion cripto 50000 btc Binance`\n\n" +
                   "💡 _O si prefieres, simplemente cuéntamelo por nota de voz o mensaje libre a Gemini._";
  sendTelegram(chatId, msgAyudaRI);
}

/**
 * Manejador del comando /borrar_inversion o /borrar_inversiones
 */
function handleBorrarInversionComando(chatId, text, conf) {
  var partes = text.trim().split(" ");
  var param = partes.length > 1 ? partes.slice(1).join(" ") : "all";
  var resB = borrarInversionEnHoja(param);
  if (resB.ok) {
    sendTelegram(chatId, "🗑️ *¡Inversión Eliminada con Éxito!*\n\n" + resB.mensaje + "\n\nTu portafolio ha quedado actualizado.", [
      [{ text: "📁 Ver Portafolio", callback_data: "cb:inv_portafolio" }],
      [{ text: "📈 Menú Inversiones", callback_data: "cb:invertir" }]
    ]);
  } else {
    sendTelegram(chatId, "⚠️ *Aviso al eliminar inversión:*\n\n" + resB.mensaje, [
      [{ text: "📁 Ver Portafolio", callback_data: "cb:inv_portafolio" }]
    ]);
  }
}

// ==========================================
// DISPATCHER DE BOTONES INTERACTIVOS (CALLBACK QUERIES) ⚡
// ==========================================
function handleTelegramCallbackQuery(cb) {
  var callbackId = cb.id;
  var chatId = (cb.message && cb.message.chat) ? cb.message.chat.id.toString() : CONFIG.TELEGRAM_CHAT_ID;
  var messageId = (cb.message && cb.message.message_id) ? cb.message.message_id : null;
  var data = cb.data || "";

  // Seguridad: Validar Chat ID
  if (CONFIG.TELEGRAM_CHAT_ID && CONFIG.TELEGRAM_CHAT_ID !== "TU_CHAT_ID" && chatId !== CONFIG.TELEGRAM_CHAT_ID.toString()) {
    answerCallbackQuery(callbackId, "⛔ Acceso no autorizado.", true);
    return;
  }

  // 1. Responder de inmediato al callback de Telegram para desbloquear la UI
  answerCallbackQuery(callbackId);

  // Helper para responder editando el mensaje in-place (o enviar nuevo si falla o no hay messageId)
  function responder(texto, inlineKb) {
    if (messageId) {
      editarMensajeTelegram(chatId, messageId, texto, inlineKb);
    } else {
      sendTelegram(chatId, texto, inlineKb);
    }
  }

  // 2. Gráficos Visuales Infográficos (QuickChart)
  if (data === "cb:grafico_distribucion") {
    var confGD = obtenerConfiguracionActual();
    var urlGD = generarUrlGraficoDistribucion(confGD);
    var pctAhGD = confGD.pctAhorroReal || ((confGD.saldoBolsilloAhorro / (confGD.saldoTotalBanco || 1)) * 100).toFixed(1);
    var pctObGD = confGD.pctObligacionesReal || ((confGD.saldoBolsilloObligaciones / (confGD.saldoTotalBanco || 1)) * 100).toFixed(1);
    var pctDiGD = confGD.pctDisponibleReal || ((confGD.saldoCuenta / (confGD.saldoTotalBanco || 1)) * 100).toFixed(1);

    var captionGD = "📊 *DISTRIBUCIÓN PATRIMONIAL DAVIVIENDA EN VIVO*\n\n" +
                    "💎 *Ahorro Puro (53% meta):* ||*$" + formatearCOP(confGD.saldoBolsilloAhorro) + " COP*|| *(" + pctAhGD + "% actual)*\n" +
                    "🛡️ *Obligaciones Fijas (27% meta):* ||*$" + formatearCOP(confGD.saldoBolsilloObligaciones) + " COP*|| *(" + pctObGD + "% actual)*\n" +
                    "🛒 *Saldo Disponible (20% meta):* ||*$" + formatearCOP(confGD.saldoCuenta) + " COP*|| *(" + pctDiGD + "% actual)*\n" +
                    "─────────────────────────────\n" +
                    "💰 *Saldo Total Consolidado:* ||*$" + formatearCOP(confGD.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                    "> 💡 _Gráfico generado dinámicamente con tus saldos reales en Davivienda._";

    var kbGD = [
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ],
      [
        { text: "📊 Gráfico de Gastos", callback_data: "cb:grafico_gastos" },
        { text: "📱 Abrir Dashboard Web", web_app: { url: CONFIG.WEB_APP_URL } }
      ]
    ];
    editarOEnviarFotoTelegram(chatId, messageId, urlGD, captionGD, kbGD);
    return;
  }

  if (data === "cb:grafico_gastos") {
    var confGG = obtenerConfiguracionActual();
    var resMesGG = obtenerResumenMesActual();
    var urlGG = generarUrlGraficoPresupuesto(resMesGG, confGG);

    var captionGG = "📊 *DESGLOSE DE GASTOS VARIABLES (" + (resMesGG.mesNombre || "MES").toUpperCase() + ")*\n\n" +
                    "🔴 *Total Gastado en Variables:* *$" + formatearCOP(resMesGG.totalVariable) + " COP*\n" +
                    "🎯 *Presupuesto (20% Ocio):* *$" + formatearCOP(confGG.presupuestoVariable) + " COP*\n" +
                    "💵 *Margen Restante:* *" + ((confGG.presupuestoVariable - resMesGG.totalVariable) >= 0 ? "$" + formatearCOP(confGG.presupuestoVariable - resMesGG.totalVariable) + " COP 🟢" : "-$" + formatearCOP(Math.abs(confGG.presupuestoVariable - resMesGG.totalVariable)) + " COP 🔴") + "*\n\n" +
                    "> 💡 _Distribución visual de los gastos variables del mes actual._";

    var kbGG = [
      [
        { text: "📊 Resumen Completo", callback_data: "cb:reporte" },
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ],
      [
        { text: "📊 Gráfico de Bolsillos", callback_data: "cb:grafico_distribucion" },
        { text: "📱 Abrir Dashboard Web", web_app: { url: CONFIG.WEB_APP_URL } }
      ]
    ];
    editarOEnviarFotoTelegram(chatId, messageId, urlGG, captionGG, kbGG);
    return;
  }

  // 3. Despachar según acción con edición in-place
  if (data === "cb:bolsillos") {
    var confB = obtenerConfiguracionActual();
    var objB = generarMensajeBolsillos(confB);
    responder(objB.texto, objB.inlineKb);
    return;
  }

  if (data === "cb:saldo") {
    var confS = obtenerConfiguracionActual();
    var objS = generarMensajeSaldo(confS);
    responder(objS.texto, objS.inlineKb);
    return;
  }

  if (data === "cb:quincena") {
    var confQ = obtenerConfiguracionActual();
    var objQ = generarMensajeQuincena(confQ);
    responder(objQ.texto, objQ.inlineKb);
    return;
  }

  if (data === "cb:cobro_quincena") {
    var resCobro = cobrarQuincenaNomina(null);
    var msgCobro = generarMensajeCobroQuincena(resCobro);
    var inlineKbC = [
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
      ],
      [
        { text: "📈 Explorar Inversiones", callback_data: "cb:invertir" },
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ];
    responder(msgCobro, inlineKbC);
    return;
  }

  if (data === "cb:briefing") {
    ejecutarRecordatoriosDiarios(true, chatId, messageId);
    return;
  }

  if (data === "cb:radar") {
    var confR = obtenerConfiguracionActual();
    var rInfo = generarTextoRadarHormiga(confR);
    var msgR = "🐜 *RADAR FINANCIERO Y CONTROL DE FUGAS*\n\n" + rInfo.texto;
    var inlineKbR = [
      [
        { text: "📊 Resumen Mes", callback_data: "cb:reporte" },
        { text: "⚖️ Calculadora Cuotas", callback_data: "cb:cuotas" }
      ],
      [
        { text: "☀️ Briefing Matutino", callback_data: "cb:briefing" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ];
    responder(msgR, inlineKbR);
    return;
  }

  if (data === "cb:deuda") {
    var confD = obtenerConfiguracionActual();
    var objD = generarMensajeDeuda(confD);
    responder(objD.texto, objD.inlineKb);
    return;
  }

  if (data === "cb:fijos") {
    var confF = obtenerConfiguracionActual();
    var objF = generarMensajeGastosFijos(confF);
    responder(objF.texto, objF.inlineKb);
    return;
  }

  if (data === "cb:reporte" || data === "cb:resumen") {
    var confRep = obtenerConfiguracionActual();
    var resMes = obtenerResumenMesActual();
    var objRep = generarMensajeReporte(resMes, confRep);
    responder(objRep.texto, objRep.inlineKb);
    return;
  }

  if (data === "cb:metas") {
    var confMet = obtenerConfiguracionActual();
    var objMet = generarMensajeMetas(confMet);
    responder(objMet.texto, objMet.inlineKb);
    return;
  }

  if (data === "cb:metas_nueva") {
    var msgNuevaMeta = "🎯 *CREAR UNA NUEVA META DE AHORRO*\n\n" +
                       "Para crear una meta escribe el comando:\n\n" +
                       "`/nueva_meta [nombre] [monto_objetivo]`\n\n" +
                       "📌 *Ejemplos:*\n" +
                       "• `/nueva_meta Fondo de Emergencia 5000000`\n" +
                       "• `/nueva_meta Viaje Fin de Año 2000000`\n" +
                       "• `/nueva_meta Moto 6000000`\n\n" +
                       "💡 _O simplemente dímelo en el chat: 'Crea una meta para mi fondo de emergencia por 5 millones'._";
    var kbNuevaMeta = [
      [
        { text: "🎯 Ver Mis Metas", callback_data: "cb:metas" },
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }
      ]
    ];
    responder(msgNuevaMeta, kbNuevaMeta);
    return;
  }

  if (data === "cb:metas_abono") {
    var msgAbonoMeta = "💵 *ABONAR A UNA META DE AHORRO*\n\n" +
                       "Para registrar un abono a tu meta escribe:\n\n" +
                       "`/abono [nombre_meta] [monto]`\n\n" +
                       "📌 *Ejemplos:*\n" +
                       "• `/abono Fondo 200000`\n" +
                       "• `/abono Viaje 150000`\n\n" +
                       "💡 _O dímelo en el chat: 'Abona 100k a mi meta de fondo'._";
    var kbAbonoMeta = [
      [
        { text: "🎯 Ver Mis Metas", callback_data: "cb:metas" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ];
    responder(msgAbonoMeta, kbAbonoMeta);
    return;
  }

  if (data === "cb:set_deuda_ayuda") {
    var confDA = obtenerConfiguracionActual();
    var msgDA = "🟣 *ACTUALIZAR FACTURA TARJETA NU*\n\n" +
                "Deuda registrada actualmente: ||*$" + formatearCOP(confDA.deudaTarjetaNu || 0) + " COP*||\n" +
                "Fecha límite de pago: *" + confDA.proximaFechaPagoTarjeta + "* (los 11 de cada mes)\n\n" +
                "Para actualizar el valor de tu factura de Nu escribe:\n\n" +
                "`/set_deuda [monto]`\n\n" +
                "📌 *Ejemplo:* `/set_deuda 159610`\n\n" +
                "💡 _Recuerda: Si pagas la totalidad de la tarjeta, usa `/pagar_tarjeta` para descontarlo automáticamente del banco._";
    var kbDA = [
      [
        { text: "✅ Registrar Pago Factura", callback_data: "cb:pagar_tarjeta" },
        { text: "🟣 Volver a Tarjeta Nu", callback_data: "cb:deuda" }
      ]
    ];
    responder(msgDA, kbDA);
    return;
  }

  if (data === "cb:traslado_ayuda") {
    var confTA = obtenerConfiguracionActual();
    var msgTA = "🔄 *TRASLADAR DINERO A UN BOLSILLO DAVIVIENDA*\n\n" +
                "Mueve dinero de tu Saldo Disponible hacia uno de tus bolsillos internos:\n\n" +
                "📌 *Comandos:*\n" +
                "• *Hacia Ahorro:* `/traslado ahorro [monto]`\n" +
                "  _Ejemplo: `/traslado ahorro 100000`_\n\n" +
                "• *Hacia Obligaciones:* `/traslado obligaciones [monto]`\n" +
                "  _Ejemplo: `/traslado obligaciones 50000`_\n\n" +
                "🛒 *Saldo Disponible actual:* ||*$" + formatearCOP(confTA.saldoCuenta) + " COP*||\n" +
                "✨ _Tu saldo total consolidado no varía._";
    var kbTA = [
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ];
    responder(msgTA, kbTA);
    return;
  }

  if (data === "cb:retirar_ayuda") {
    var confRA = obtenerConfiguracionActual();
    var msgRA = "🔄 *RETIRAR DINERO DE UN BOLSILLO A DISPONIBLE*\n\n" +
                "Devuelve dinero de un bolsillo a tu Saldo Disponible para gastar:\n\n" +
                "📌 *Comandos:*\n" +
                "• *Desde Ahorro:* `/retirar_bolsillo ahorro [monto]`\n" +
                "  _Ejemplo: `/retirar_bolsillo ahorro 50000`_\n\n" +
                "• *Desde Obligaciones:* `/retirar_bolsillo obligaciones [monto]`\n" +
                "  _Ejemplo: `/retirar_bolsillo obligaciones 600000` (al pagar arriendo el 30)_\n\n" +
                "🚨 *Retiro rápido de emergencia:*";
    var kbRA = [
      [
        { text: "🚨 Sacar $50k de Ahorro", callback_data: "cb:retirar_rapido:ahorro:50000" },
        { text: "🚨 Sacar $100k de Ahorro", callback_data: "cb:retirar_rapido:ahorro:100000" }
      ],
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
      ]
    ];
    responder(msgRA, kbRA);
    return;
  }

  if (data === "cb:pagar_tarjeta") {
    var resP = pagarTarjetaCredito(null);
    if (resP.error) {
      responder("⚠️ " + resP.error);
    } else {
      var msgP = "🟣 *¡PAGO DE TARJETA NU REGISTRADO CON ÉXITO!*\n\n" +
                 "💵 *Monto pagado:* *$" + formatearCOP(resP.montoPagado) + " COP*\n" +
                 "💳 *Deuda restante de Tarjeta Nu:* ||*$" + formatearCOP(resP.nuevaDeuda) + " COP*||\n" +
                 "💰 *Saldo restante en banco:* ||*$" + formatearCOP(resP.nuevoSaldo) + " COP*||\n\n" +
                 "🛡️ _¡Excelente! Tu factura de Nu está saldada y tu historial protegido._";
      var inlineKbP = [
        [
          { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
          { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
        ]
      ];
      responder(msgP, inlineKbP);
    }
    return;
  }

  if (data.startsWith("cb:deshacer")) {
    var partesDes = data.split(":");
    var idTs = partesDes[2] || null;
    var resDes = deshacerTransaccion(idTs);
    if (!resDes.ok) {
      responder("⚠️ *No se pudo deshacer:* " + resDes.error);
    } else {
      var msgDes = "↩️ *GASTO DESHECHO CON ÉXITO*\n\n" +
                   "Se eliminó el registro de:\n" +
                   "💵 *$" + formatearCOP(resDes.monto) + " COP* en *" + resDes.concepto + "*\n\n" +
                   "💰 *Saldo disponible restaurado:* ||*$" + formatearCOP(resDes.nuevoSaldo) + " COP*||\n" +
                   "💳 *Saldo total Davivienda:* ||*$" + formatearCOP(resDes.nuevoSaldoTotal) + " COP*||";
      var inlineKbDes = [
        [
          { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
          { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }
        ],
        [
          { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
        ]
      ];
      responder(msgDes, inlineKbDes);
    }
    return;
  }

  // Callbacks del Módulo de Inversión 📈
  if (data === "cb:invertir") {
    var confInv = obtenerConfiguracionActual();
    var hub = generarMensajeHubInversiones(confInv);
    responder(hub.texto, hub.inlineKb);
    return;
  }

  if (data === "cb:inv_cdt") {
    var confCDT = obtenerConfiguracionActual();
    var msgCDT = generarMensajeCDTsColombia(confCDT);
    responder(msgCDT.texto, msgCDT.inlineKb);
    return;
  }

  if (data === "cb:inv_cripto") {
    var confCrip = obtenerConfiguracionActual();
    var msgCrip = generarMensajeCriptoBinance(confCrip);
    responder(msgCrip.texto, msgCrip.inlineKb);
    return;
  }

  if (data === "cb:inv_simular" || data === "cb:inv_sim_100k") {
    var msgSim100 = generarMensajeSimuladorInversiones(100000);
    responder(msgSim100.texto, msgSim100.inlineKb);
    return;
  }

  if (data === "cb:inv_sim_50k") {
    var msgSim50 = generarMensajeSimuladorInversiones(50000);
    responder(msgSim50.texto, msgSim50.inlineKb);
    return;
  }

  if (data === "cb:inv_sim_200k") {
    var msgSim200 = generarMensajeSimuladorInversiones(200000);
    responder(msgSim200.texto, msgSim200.inlineKb);
    return;
  }

  if (data === "cb:inv_sim_300k") {
    var msgSim300 = generarMensajeSimuladorInversiones(300000);
    responder(msgSim300.texto, msgSim300.inlineKb);
    return;
  }

  if (data === "cb:inv_subbolsillos") {
    var confSub = obtenerConfiguracionActual();
    var msgSub = generarMensajeSubBolsillos(confSub);
    responder(msgSub.texto, msgSub.inlineKb);
    return;
  }

  if (data === "cb:inv_portafolio") {
    var msgPort = generarMensajePortafolio();
    responder(msgPort.texto, msgPort.inlineKb);
    return;
  }

  if (data === "cb:inv_timing") {
    var confTim = obtenerConfiguracionActual();
    var msgTim = generarMensajeTimingMercado(confTim);
    responder(msgTim.texto, msgTim.inlineKb);
    return;
  }

  if (data === "cb:inv_borrar_todas") {
    limpiarTodasLasInversiones();
    responder("🗑️ *¡Portafolio de Inversiones Limpiado con Éxito!*\n\nSe han eliminado todas las inversiones registradas de tu hoja de Google Sheets `Inversiones`.\n\n✨ Tu saldo y tus bolsillos de Davivienda no fueron modificados.", [
      [{ text: "📁 Ver Portafolio", callback_data: "cb:inv_portafolio" }],
      [{ text: "📈 Menú Inversiones", callback_data: "cb:invertir" }]
    ]);
    return;
  }

  if (data === "cb:inv_como_registrar") {
    var msgComo = "📝 *CÓMO REGISTRAR UNA INVERSIÓN*\n\n" +
                  "Puedes registrar tus inversiones de 2 formas sencillas:\n\n" +
                  "1️⃣ *Mediante comandos directos:*\n" +
                  "• *Para un CDT:*\n" +
                  "  `/registrar_inversion cdt 100000 10.5 90 Davivienda`\n" +
                  "  _(Monto: $100k, Tasa: 10.5% E.A., Plazo: 90 días, Entidad: Davivienda)_\n\n" +
                  "• *Para Cripto:*\n" +
                  "  `/registrar_inversion cripto 50000 btc Binance`\n" +
                  "  _(Monto: $50k, Criptoactivo: BTC, Plataforma: Binance)_\n\n" +
                  "2️⃣ *Hablando naturalmente (o enviando un audio):*\n" +
                  "  _\"Abrí un CDT en Davivienda de 100k a 90 días\"_\n" +
                  "  _\"Compré 30 mil en Bitcoin por Binance\"_\n\n" +
                  "✨ Tus inversiones quedarán guardadas en la pestaña `Inversiones` de tu hoja de cálculo y el bot te avisará cuando un CDT esté por vencer.";
    var kbComo = [
      [
        { text: "📁 Ver Portafolio", callback_data: "cb:inv_portafolio" },
        { text: "🏦 Ver CDTs", callback_data: "cb:inv_cdt" }
      ],
      [
        { text: "⚡ Binance Cripto", callback_data: "cb:inv_cripto" },
        { text: "🔙 Menú Inversiones", callback_data: "cb:invertir" }
      ]
    ];
    responder(msgComo, kbComo);
    return;
  }

  // Callbacks de Calculadora Anti-Cuotas ⚖️
  if (data === "cb:cuotas") {
    var menuCuotasCb = "⚖️ *CALCULADORA ANTI-CUOTAS Y COSTO FINANCIERO*\n\n" +
                       "Simula antes de diferir una compra con tarjeta de crédito para descubrir exactamente cuánto dinero le regalarías al banco en intereses y cuántas horas de trabajo te costaría:\n\n" +
                       "📌 *Uso del comando:*\n" +
                       "`/cuotas [monto] [cuotas]`\n" +
                       "`/cuotas [monto] [cuotas] [tasa_EA_opcional]`\n\n" +
                       "📌 *Ejemplos prácticos:*\n" +
                       "• `/cuotas 1200000 6` (Simula $1.2M a 6 cuotas con tasa Nu ~25.85% E.A.)\n" +
                       "• `/cuotas 3000000 12` (Simula $3.0M a 12 cuotas)\n" +
                       "• `/cuotas 600000 3 23` (Simula $600k a 3 cuotas con tasa 23% E.A.)\n\n" +
                       "🛡️ _Regla de oro: ¡Con tu Tarjeta Nu siempre compras a 1 cuota (0% interés)!_";

    responder(menuCuotasCb, [
      [
        { text: "Simular $600k a 3 ctas", callback_data: "cb:cuotas_sim:600000:3" },
        { text: "Simular $1.2M a 6 ctas", callback_data: "cb:cuotas_sim:1200000:6" }
      ],
      [
        { text: "Simular $3.0M a 12 ctas", callback_data: "cb:cuotas_sim:3000000:12" },
        { text: "Simular $5.0M a 24 ctas", callback_data: "cb:cuotas_sim:5000000:24" }
      ],
      [
        { text: "🟣 Estado Tarjeta Nu", callback_data: "cb:deuda" },
        { text: "💳 Mi Saldo", callback_data: "cb:saldo" }
      ]
    ]);
    return;
  }

  if (data.startsWith("cb:cuotas_sim:")) {
    var partesCS = data.split(":");
    var montoCS = parseFloat(partesCS[2] || "1200000");
    var cuotasCS = parseInt(partesCS[3] || "6");
    var simCS = calcularSimulacionCuotas(montoCS, cuotasCS);
    responder(simCS.mensaje, [
      [
        { text: "🟣 Factura Tarjeta Nu", callback_data: "cb:deuda" },
        { text: "⚖️ Otra Simulación", callback_data: "cb:cuotas" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ]);
    return;
  }

  // Callbacks de Scorecard / Cierre de Mes 🏆
  if (data === "cb:cierre_mes") {
    var confCM = obtenerConfiguracionActual();
    var reporteScoreCb = generarReporteCierreMes(confCM);
    responder(reporteScoreCb, [
      [
        { text: "📊 Resumen Mes", callback_data: "cb:reporte" },
        { text: "📈 Inversiones", callback_data: "cb:invertir" }
      ],
      [
        { text: "🎯 Ver Metas", callback_data: "cb:metas" },
        { text: "💳 Ver Mi Saldo", callback_data: "cb:saldo" }
      ]
    ]);
    return;
  }

  // Callback de Retiro Rápido de Emergencia 🚨
  if (data.startsWith("cb:retirar_rapido:")) {
    var partesRR = data.split(":");
    var bolsilloRR = partesRR[2] || "ahorro";
    var montoRR = parseFloat(partesRR[3] || "50000");
    var resRR = trasladarDeBolsillo(bolsilloRR, montoRR);
    var msgRetiro = "🚨 *RETIRO DE EMERGENCIA REALIZADO CON ÉXITO*\n\n" +
                    "Se transfirieron ||*$" + formatearCOP(montoRR) + " COP*|| desde tu Bolsillo *" + resRR.bolsilloNom + "* a tu Saldo Disponible.\n\n" +
                    "🛒 *Nuevo Saldo Disponible:* ||*$" + formatearCOP(resRR.nuevoDisponible) + " COP*|| *(" + resRR.pctDisponible + "% actual)*\n" +
                    "🏦 *Saldo restante en " + resRR.bolsilloNom + ":* ||*$" + formatearCOP(resRR.nuevoBolsillo) + " COP*||\n" +
                    "─────────────────────────────\n" +
                    "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(resRR.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                    "✨ _Tu saldo total no varió ($" + formatearCOP(resRR.saldoTotalBanco) + " COP). Recuerda reponer este dinero con tu próxima quincena de nómina._";
    responder(msgRetiro, [
      [
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ]);
    return;
  }
}

// ==========================================
// INSTRUCCIÓN DE SISTEMA Y CONTEXTO PATRIMONIAL PARA GEMINI
// ==========================================
function construirSystemInstructionFinanciero(resumen, conf) {
  var flujo = conf.flujoQuincenal;
  var colchonSeguridadSugerido = 300000;
  var excedenteInvertibleInmediato = Math.max(flujo.saldoProyectadoLibre - colchonSeguridadSugerido, 0);
  var radar = analizarGastosHormigaYDesviacion(conf);

  return "Eres el Asesor Financiero Personal, CFO privado y Guardián Patrimonial del usuario en Colombia.\n" +
    "Tu misión suprema es proteger su capital, evitar que gaste dinero por impulso, garantizar que pague sus compromisos a tiempo y blindar su ahorro del 53% en su Bolsillo de Ahorro Davivienda.\n\n" +
    "=== REGLA ESTRICTA SOBRE NU ===\n" +
    "El usuario NO usa cajas de ahorro de Nu ni cuentas remuneradas de Nu. Únicamente tiene la TARJETA DE CRÉDITO Nu, la cual usa exclusivamente como pasarela a 1 cuota (0% interés) para pagar sus pocas suscripciones fijas (SmartFit $92.600, Claude ~$63.110, Google One $3.900) y generar historial crediticio. NUNCA le recomiendes meter plata a Cajitas Nu ni a rendimientos de Nu.\n\n" +
    "=== RADIOGRAFÍA LABORAL Y NÓMINA (NÓMINA EMPRESA) ===\n" +
    "- Empresa: Empresa S.A.S. | Modelo de Nómina Quincenal\n" +
    "- Sueldo básico mensual: $3.200.000 COP\n" +
    "- Quincena 1 (Día 15 de cada mes): $1.472.000 COP neto (Básico $1.600.000 - Salud $64.000 - Pensión $64.000)\n" +
    "- Quincena 2 (Día 30/31 de cada mes): $1.721.095 COP neto (Básico $1.600.000 + Auxilio Transporte $249.095 - Salud $64.000 - Pensión $64.000)\n" +
    "- Ingreso mensual neto total: $3.193.095 COP (~$3.200.000 COP)\n\n" +
    "=== MODELO ESTRUCTURAL DE BOLSILLOS DAVIVIENDA (53% / 27% / 20%) ===\n" +
    "En Davivienda solo se permite 1 débito automático mensual por bolsillo. El flujo funciona así:\n" +
    "1. 💎 AHORRO E INVERSIÓN PURO (53.0% = $1.690.866 COP/mes):\n" +
    "   - Día 15: Se transfieren $0 COP a ahorro.\n" +
    "   - Día 30: Débito automático mensual de $1.690.866 COP hacia el Bolsillo Ahorro Davivienda.\n" +
    "   - Saldo actual en este bolsillo: $" + formatearCOP(conf.saldoBolsilloAhorro) + " COP. Blindado e intocable.\n" +
    "2. 🛡️ OBLIGACIONES FIJAS (27.0% = $863.610 COP/mes):\n" +
    "   - Día 15: Débito automático mensual de $863.610 COP hacia el Bolsillo Obligaciones.\n" +
    "   - Cubre todos los pagos obligatorios del mes: Arriendo ($600.000 el 30), Factura Tarjeta Nu (~$160.000 los 11), Claro ($44.000 los 14), Gasolina ($60.000).\n" +
    "   - Saldo actual en este bolsillo: $" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP.\n" +
    "   - REGLA CRÍTICA: El arriendo del 30 ($600.000) se paga retirando dinero de ESTE bolsillo de Obligaciones, NUNCA del disponible.\n" +
    "3. 🛒 DISPONIBLE EN CUENTA / GASTOS DIARIOS Y OCIO (20.0% = $638.619 COP/mes):\n" +
    "   - Día 15: Queda en disponible el remanente de nómina: ~$608.390 COP (+ remanentes previos).\n" +
    "   - Día 30: Se suma el remanente de nómina: +$30.229 COP.\n" +
    "   - Saldo actual disponible en cuenta: $" + formatearCOP(conf.saldoCuenta) + " COP.\n" +
    "   - Saldo total consolidado en Davivienda (Disponible + Bolsillos): $" + formatearCOP(conf.saldoTotalBanco) + " COP.\n" +
    "   - Cupo diario base del modelo: ~$21.190 - $21.300 COP/día.\n" +
    "=== REGLA DE PRESENTACIÓN DE PORCENTAJES (DISTRIBUCIÓN EN TIEMPO REAL) ===\n" +
    "El usuario estableció una distinción fundamental que DEBES respetar al hablar de porcentajes:\n" +
    "1. REGLA BASE DE ASIGNACIÓN MENSUAL DE NÓMINA: 53% Ahorro ($1.690.866 COP/mes) | 27% Obligaciones ($863.610 COP/mes) | 20% Disponible ($638.619 COP/mes).\n" +
    "2. PORCENTAJES EN TIEMPO REAL DE LOS SALDOS ACTUALES EN DAVIVIENDA: Al reportar los saldos que tiene en este momento, SIEMPRE muestra los porcentajes reales calculados sobre su Saldo Total ($" + formatearCOP(conf.saldoTotalBanco) + " COP):\n" +
    "   - Saldo Disponible: $" + formatearCOP(conf.saldoCuenta) + " COP (" + conf.pctDisponibleReal + "% actual del total)\n" +
    "   - Bolsillo Ahorro: $" + formatearCOP(conf.saldoBolsilloAhorro) + " COP (" + conf.pctAhorroReal + "% actual del total)\n" +
    "   - Bolsillo Obligaciones: $" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP (" + conf.pctObligacionesReal + "% actual del total)\n" +
    "NUNCA digas que su saldo disponible actual es el 20% si en este momento representa el " + conf.pctDisponibleReal + "%, ni que su ahorro es el 53% si en este momento representa el " + conf.pctAhorroReal + "%. Muestra siempre el porcentaje real actual y, si viene al caso, aclara que la meta de fondeo mensual de nómina es 53% / 27% / 20%.\n\n" +
    "=== ESTADO ACTUAL DE LIQUIDEZ Y CALENDARIO (" + flujo.nombreQuincena + ") ===\n" +
    "- Próxima nómina quincenal: " + flujo.fechaProximaNominaTexto + " (en " + flujo.diasParaProximaNomina + " días: $" + formatearCOP(flujo.montoProximaNomina) + " COP)\n" +
    "- SALDO DISPONIBLE EN CUENTA HOY: $" + formatearCOP(flujo.saldoReal) + " COP (" + conf.pctDisponibleReal + "% actual del total)\n" +
    "- SALDO BOLSILLO AHORRO: $" + formatearCOP(conf.saldoBolsilloAhorro) + " COP (" + conf.pctAhorroReal + "% actual del total)\n" +
    "- SALDO BOLSILLO OBLIGACIONES: $" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP (" + conf.pctObligacionesReal + "% actual del total)\n" +
    "- SALDO TOTAL DAVIVIENDA: $" + formatearCOP(conf.saldoTotalBanco) + " COP (100%)\n" +
    "- Cupo diario seguro disponible hoy: $" + formatearCOP(radar.nuevoCupoDiarioSeguro) + " COP/día\n" +
    "- Deuda actual Tarjeta Nu: $" + formatearCOP(conf.deudaTarjetaNu) + " COP (Pago los 11 de cada mes, cubierta por Bolsillo Obligaciones)\n\n" +
    "=== CRONOGRAMA EXACTO DE GASTOS FIJOS ($" + formatearCOP(conf.gastosFijosTotal) + " COP - ~27% del sueldo) ===\n" +
    "- Día 05: Google One ($3.900 COP | Factura en Tarjeta Nu)\n" +
    "- Día 06: Claude Code (~$63.110 COP | Factura en Tarjeta Nu)\n" +
    "- Día 11: Pago Factura Tarjeta Nu (Gimnasio $92.600 + Claude ~$63.110 + Google One $3.900)\n" +
    "- Día 14: Plan Celular Claro (~$44.000 COP | Débito / PSE)\n" +
    "- Día 15: Gasolina Quincena 1 ($30.000 COP) | Cobro Nómina Quincenal Quincena 1 ($1.472.000 COP neto) | Fondeo Bolsillo Obligaciones ($863.610 COP)\n" +
    "- Día 30: Gasolina Quincena 2 ($30.000 COP) + Arriendo ($600.000 COP pagado desde Bolsillo Obligaciones) | Cobro Nómina Quincenal Quincena 2 ($1.721.095 COP neto con auxilio) | Fondeo Bolsillo Ahorro ($1.690.866 COP)\n\n" +
    "=== PSICOLOGÍA FINANCIERA: CONVERSOR A HORAS DE TRABAJO ===\n" +
    "- El usuario cuenta con un modelo de nómina quincenal con ingreso neto mensual de referencia.\n" +
    "- Valor hora de trabajo neta: $19.957 COP / hora (calculado sobre 160 horas laborales al mes = 20 días x 8 hrs).\n" +
    "- Valor día laboral (8 hrs): $159.655 COP.\n" +
    "- Cupo diario seguro para ocio y gastos variables: $" + formatearCOP(radar.nuevoCupoDiarioSeguro) + " COP/día.\n\n" +
    "REGLA ESTRICTA DE PERSUASIÓN Y FRICCIÓN PSICOLÓGICA:\n" +
    "Cada vez que el usuario te consulte si puede comprar algo discrecional, salir a comer, comprarse ropa/tecnología, o evalúe un gasto no esencial (ej: '¿me puedo comprar unos tenis de 200k?', 'quiero ir a cenar por 50k', '¿me alcanza para X?'):\n" +
    "DEBES traducir el costo monetario a esfuerzo laboral y tiempo de vida real:\n" +
    "1. ⏳ Horas de Trabajo: Divide el monto entre $19.957 COP. Ejemplo: '$200.000 COP equivalen a 10,0 horas de tu trabajo  (más de una jornada laboral completa de 8 horas)'.\n" +
    "2. 📅 Días de Cupo Diario Consumidos: Divide el monto entre su cupo diario de ocio (" + formatearCOP(radar.nuevoCupoDiarioSeguro) + " COP/día). Ejemplo: 'Consume X días completos de tu presupuesto diario de ocio'.\n" +
    "3. 🎯 Veredicto Contundente: Dile con total claridad y honestidad si vale la pena trabajar tantas horas  a cambio de ese producto o si es mejor proteger su disponible para llegar tranquilo a la nómina.\n\n" +
    "=== MÓDULO SIMULADOR DE DECISIONES DE GASTO Y GESTIÓN DE RIESGO ===\n" +
    "Cuando el usuario te pregunte si puede gastar en algo no contemplado:\n" +
    "1. Evalúa el impacto contra el Disponible de Ocio (Cupo de ~$" + formatearCOP(radar.nuevoCupoDiarioSeguro) + " COP/día) y el saldo libre.\n" +
    "2. Clasifica el Nivel de Riesgo:\n" +
    "   • 🟢 RIESGO BAJO: Gasto menor a $21.000 COP. Aprobado sin afectar bolsillos.\n" +
    "   • 🟡 RIESGO MEDIO: Gasto entre $21.000 y $60.000 COP. Consume varios días de ocio.\n" +
    "   • 🔴 RIESGO ALTO / CRÍTICO: Gasto mayor a $60.000 COP o que afecte los bolsillos de ahorro u obligaciones. Rechaza contundentemente.\n\n" +
    "=== MÓDULO DE INVERSIONES Y SUB-BOLSILLOS VIRTUALES (53% AHORRO) ===\n" +
    "Dentro del Bolsillo de Ahorro Davivienda (Saldo actual: ||$" + formatearCOP(conf.saldoBolsilloAhorro) + " COP||), existen 3 SUB-BOLSILLOS VIRTUALES:\n" +
    "1. 🛡️ 70% Fondo de Emergencia: ||$" + formatearCOP(Math.round(conf.saldoBolsilloAhorro * 0.70)) + " COP|| (Intocable, 100% líquido en Davivienda).\n" +
    "2. 🏦 20% Micro-CDT / Renta Fija: ||$" + formatearCOP(Math.round(conf.saldoBolsilloAhorro * 0.20)) + " COP|| (Para CDTs digitales a 90 o 180 días en Davivienda o Tyba desde $50k).\n" +
    "3. ⚡ 10% Micro-Cripto DCA Binance: ||$" + formatearCOP(Math.round(conf.saldoBolsilloAhorro * 0.10)) + " COP|| (Para compras periódicas de Bitcoin o USDT en Binance de $20k a $50k COP).\n\n" +
    "REGLA SUPREMA SOBRE INVERSIONES:\n" +
    "- NUNCA inviertas ni transfieras dinero automáticamente. El bot es únicamente un radar, asesor y simulador.\n" +
    "- El usuario tiene el control manual absoluto de cuándo, cuánto y dónde invertir.\n" +
    "- Simulaciones de CDT: Rendimiento Neto = Monto * ((1 + Tasa_EA/100)^(Días/365) - 1) * 0.96 (descontando 4% de retención en la fuente en Colombia).\n" +
    "- Si el usuario te confirma que abrió un CDT o compró cripto en Binance: usa [ACCION: REGISTRAR_INVERSION <Tipo> | <Entidad> | <Monto> | <Tasa_o_Precio> | <Plazo_Dias> | <Rendimiento_Estimado>].\n" +
    "- Si el usuario te pide borrar, cancelar o limpiar una inversión (o las registradas de prueba): usa [ACCION: BORRAR_INVERSION <criterio o 'all'>].\n\n" +
    "=== RADAR DE SEÑALES: CUÁNDO COMPRAR O VENDER ===\n" +
    "- COMPRA CRIPTO (BINANCE): Si el mercado retrocede (>3% en 24h) o cotiza cerca del soporte intradía, es zona óptima de micro-DCA ($20k-$50k COP). NUNCA comprar en picos alcistas diarios (+4% en 24h por riesgo de FOMO).\n" +
    "- VENTA CRIPTO: Si una posición supera el +15% o +20% de ganancia, aconseja tomar beneficios parciales (vender 20-30%) y asegurar en el fondo de emergencia. Nunca vendas en caídas de pánico (HOLD).\n" +
    "- CDTs DAVIVIENDA: BanRep está en ciclo de recorte de tasas hacia 8-9%. Por tanto, el mejor momento para fijar tasa fija al 10.5% E.A. a 180 o 360 días es AHORA antes de que bajen más. Al vencer el plazo, esperar las 48h de gracia para reinvertir con interés compuesto o retirar.\n\n" +
    "=== CALCULADORA ANTI-CUOTAS Y COSTO FINANCIERO ===\n" +
    "Si el usuario pregunta si debe diferir una compra con tarjeta de crédito (ej: '¿compro esto a 3/6/12 cuotas?', '¿cómo me sale diferir X?'):\n" +
    "- DISUÁDELO FIRMEMENTE: Recuerda que con Nu se compra a 1 sola cuota (0% interés).\n" +
    "- Si insiste o pregunta costos, recuérdale que puede usar el comando `/cuotas [monto] [cuotas]` o explícale que pagar intereses bancarios del ~25.85% E.A. equivale a regalarle dinero al banco y perder horas de su trabajo .\n\n" +
    "=== ALERTA DE DISPONIBLE CRÍTICO (<$40.000 COP) ===\n" +
    "Si un gasto deja su disponible por debajo de $40.000 COP o el disponible diario para los días que faltan para la nómina es inferior a $8.500 COP/día, el sistema activa una alerta preventiva de riesgo. Recomiéndale frenar gastos discrecionales o, solo si es estrictamente necesario, retirar $50.000 COP de emergencia desde el Bolsillo Ahorro usando `/retirar_bolsillo ahorro 50000`.\n\n" +
    "=== DISTINCIÓN SUPREMA ENTRE GASTO, INGRESO Y TRASLADO INTERNO ===\n" +
    "1. 🔴 GASTO / COMPRA (Salida de dinero a un comercio, tercero o factura):\n" +
    "   - Usa [ACCION: REGISTRAR_GASTO <monto> | <comercio> | <categoria> | <medio>]\n" +
    "   - Descuenta del Disponible y descuenta del Saldo Total Davivienda.\n" +
    "2. 🟢 INGRESO EXTERNO (Entrada de dinero nuevo desde afuera: sueldo, venta, consignación recibida):\n" +
    "   - Si es nómina quincenal: usa [ACCION: COBRAR_QUINCENA]\n" +
    "   - Si es otro ingreso recibido: usa [ACCION: AGREGAR_INGRESO <monto> | <concepto>]\n" +
    "   - Suma al Disponible y suma al Saldo Total Davivienda.\n" +
    "3. 🔄 TRASLADO INTERNO ENTRE BOLSILLOS (¡ATENCIÓN CRÍTICA!):\n" +
    "   - Si el usuario dice: 'pasé 500k al bolsillo de ahorro', 'metí 500k al ahorro', 'trasladé X al bolsillo', 'guardé X en obligaciones', 'pasa X al bolsillo':\n" +
    "     ¡NUNCA USES SET_BOLSILLO! ¡NUNCA LO TRATES COMO GASTO NI COMO INGRESO!\n" +
    "     USA OBLIGATORIAMENTE: [ACCION: TRASLADAR_A_BOLSILLO <ahorro|obligaciones> | <monto>]\n" +
    "     Efecto: Descuenta del disponible y suma al bolsillo. El Saldo Total Davivienda NO CAMBIA (sigue siendo la misma plata).\n" +
    "   - Si el usuario dice: 'saqué 200k del bolsillo', 'retiré 200k del ahorro', 'pasa del bolsillo a la cuenta':\n" +
    "     USA OBLIGATORIAMENTE: [ACCION: TRASLADAR_DE_BOLSILLO <ahorro|obligaciones> | <monto>]\n" +
    "     Efecto: Descuenta del bolsillo y suma al disponible. El Saldo Total Davivienda NO CAMBIA.\n" +
    "4. ⚙️ CALIBRACIÓN FIJA DE SALDOS:\n" +
    "   - [ACCION: SET_SALDO_TOTAL <monto>] -> Calibra saldo total consolidado Davivienda.\n" +
    "   - [ACCION: SET_SALDO_DISPONIBLE <monto>] -> Calibra disponible libre para gastos.\n" +
    "   - [ACCION: SET_BOLSILLO <tipo> | <monto>] -> Solo para calibrar saldo acumulado total del bolsillo (no para traslados).\n" +
    "• PRIVACIDAD / MODO ESPÍA: Cada vez que menciones cualquier saldo bancario, disponible, bolsillo o deuda, escríbelos SIEMPRE entre dobles barras verticales como spoiler: ||$X.XXX.XXX COP||.\n" +
    "• Párrafos muy breves (máximo 2 a 3 líneas). Cifras concretas.\n\n" +
    "=== ETIQUETAS DE ACCIÓN DISPONIBLES ===\n" +
    "- [ACCION: TRASLADAR_A_BOLSILLO <ahorro|obligaciones> | <monto>]\n" +
    "- [ACCION: TRASLADAR_DE_BOLSILLO <ahorro|obligaciones> | <monto>]\n" +
    "- [ACCION: COBRAR_QUINCENA <monto_opcional>]\n" +
    "- [ACCION: SET_BOLSILLO <tipo> | <monto>]\n" +
    "- [ACCION: SET_SALDO_TOTAL <monto>]\n" +
    "- [ACCION: SET_SALDO_DISPONIBLE <monto>]\n" +
    "- [ACCION: SET_SALDO <monto>]\n" +
    "- [ACCION: AGREGAR_GASTO_FIJO <concepto> | <monto> | <dia_pago> | <medio>]\n" +
    "- [ACCION: REGISTRAR_GASTO <monto> | <concepto> | <categoria> | <medio>]\n" +
    "- [ACCION: AGREGAR_INGRESO <monto> | <concepto>]\n" +
    "- [ACCION: SET_DEUDA_TARJETA <monto>]\n" +
    "- [ACCION: PAGAR_TARJETA <monto>]\n" +
    "- [ACCION: REGISTRAR_INVERSION <Tipo> | <Entidad> | <Monto> | <Tasa_o_Precio> | <Plazo_Dias> | <Rendimiento_Estimado>]\n" +
    "- [ACCION: BORRAR_INVERSION <criterio o 'all'>]";
}

function construirPromptFinanciero(peticionUsuario, resumen, conf) {
  var sys = construirSystemInstructionFinanciero(resumen, conf);
  return sys + "\n\n=== MENSAJE DEL USUARIO ===\n\"" + peticionUsuario + "\"";
}

// ==========================================
// EJECUTOR DE ACCIONES DETECTADAS POR GEMINI
// ==========================================
function procesarAccionesGemini(respuesta) {
  var textoFinal = respuesta;
  var accionRegex = /\[ACCION:\s*([A-Z_]+)\s*(.*?)\]/i;
  var match = respuesta.match(accionRegex);

  if (match) {
    var comando = match[1].toUpperCase();
    var params = match[2].trim();
    var avisoAccion = "";

    var ultimoGastoTimestamp = null;
    var botonesAlertaCritica = null;

    try {
      if (comando === "COBRAR_QUINCENA") {
        var numCobro = parseFloat(params.replace(/[^0-9.]/g, ''));
        var resC = cobrarQuincenaNomina(numCobro > 0 ? numCobro : null);
        var totC = resC.saldoTotalBanco > 0 ? resC.saldoTotalBanco : (resC.saldoDisponible + resC.saldoBolsilloAhorro + resC.saldoBolsilloObligaciones);
        var pctAhC = totC > 0 ? ((resC.saldoBolsilloAhorro / totC) * 100).toFixed(1) : "0.0";
        var pctObC = totC > 0 ? ((resC.saldoBolsilloObligaciones / totC) * 100).toFixed(1) : "0.0";
        var pctDiC = totC > 0 ? ((resC.saldoDisponible / totC) * 100).toFixed(1) : "0.0";

        avisoAccion = "\n\n🎉 *¡Nómina de nómina acreditada con éxito!*\n" +
                      "🏢 " + CONFIG.EMPRESA + " (" + resC.nombreQ + ")\n" +
                      "💵 Ingreso acreditado: *+$" + formatearCOP(resC.monto) + " COP*\n" +
                      "💰 Saldo total en cuenta Davivienda: ||*$" + formatearCOP(resC.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                      "🏦 *Reparto en Bolsillos Davivienda:*\n";
        if (resC.esQuincena1) {
          avisoAccion += "🛡️ Bolsillo Obligaciones: Débito automático de *$863.610 COP* (Saldo: ||*$" + formatearCOP(resC.saldoBolsilloObligaciones) + " COP*|| - " + pctObC + "% actual)\n" +
                         "💎 Bolsillo Ahorro Puro: *$0 COP hoy* (Saldo: ||*$" + formatearCOP(resC.saldoBolsilloAhorro) + " COP*|| - " + pctAhC + "% actual)\n" +
                         "🛒 Disponible en Cuenta: ||*$" + formatearCOP(resC.saldoDisponible) + " COP*|| (" + pctDiC + "% actual | *$" + formatearCOP(resC.cupoDiarioQ) + " COP/día*).";
        } else {
          avisoAccion += "💎 Bolsillo Ahorro Puro: Débito automático de *$1.690.866 COP* (Saldo: ||*$" + formatearCOP(resC.saldoBolsilloAhorro) + " COP*|| - " + pctAhC + "% actual)\n" +
                         "🏠 Arriendo ($600.000 COP): Debitado de Bolsillo Obligaciones (Saldo restante: ||*$" + formatearCOP(resC.saldoBolsilloObligaciones) + " COP*|| - " + pctObC + "% actual)\n" +
                         "🛒 Disponible en Cuenta: ||*$" + formatearCOP(resC.saldoDisponible) + " COP*|| (" + pctDiC + "% actual | *$" + formatearCOP(resC.cupoDiarioQ) + " COP/día* hasta el 15).";
        }
      } else if (comando === "TRASLADAR_A_BOLSILLO" || comando === "MOVER_A_BOLSILLO" || comando === "PASAR_A_BOLSILLO") {
        var partesTr = params.split("|");
        var tipoTr = partesTr[0].trim().toLowerCase();
        var montoTr = parseFloat(partesTr[1] ? partesTr[1].replace(/[^0-9.]/g, '') : "0");
        if (!isNaN(montoTr) && montoTr > 0) {
          var resTr = trasladarABolsillo(tipoTr, montoTr);
          avisoAccion = "\n\n🔄 *Traslado Interno a Bolsillo " + resTr.bolsilloNom + " registrado:*\n" +
                        "💵 Monto trasladado: ||*$" + formatearCOP(montoTr) + " COP*||\n" +
                        "🛒 *Nuevo Saldo Disponible:* ||*$" + formatearCOP(resTr.nuevoDisponible) + " COP*|| *(" + resTr.pctDisponible + "% actual)*\n" +
                        "💎 *Nuevo Saldo Bolsillo " + resTr.bolsilloNom + ":* ||*$" + formatearCOP(resTr.nuevoBolsillo) + " COP*|| *(" + (resTr.bolsilloNom === "Ahorro" ? resTr.pctAhorro : resTr.pctObligaciones) + "% actual)*\n" +
                        "─────────────────────────────\n" +
                        "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(resTr.saldoTotalBanco) + " COP*|| *(100%)* (¡Tu plata total sigue intacta!).";
        }
      } else if (comando === "TRASLADAR_DE_BOLSILLO" || comando === "RETIRAR_DE_BOLSILLO" || comando === "SACAR_DE_BOLSILLO") {
        var partesRet = params.split("|");
        var tipoRet = partesRet[0].trim().toLowerCase();
        var montoRet = parseFloat(partesRet[1] ? partesRet[1].replace(/[^0-9.]/g, '') : "0");
        if (!isNaN(montoRet) && montoRet > 0) {
          var resRet = trasladarDeBolsillo(tipoRet, montoRet);
          avisoAccion = "\n\n🔄 *Retiro de Bolsillo " + resRet.bolsilloNom + " a Disponible registrado:*\n" +
                        "💵 Monto devuelto a disponible: ||*$" + formatearCOP(montoRet) + " COP*||\n" +
                        "🛒 *Nuevo Saldo Disponible:* ||*$" + formatearCOP(resRet.nuevoDisponible) + " COP*|| *(" + resRet.pctDisponible + "% actual)*\n" +
                        "💎 *Restante en Bolsillo " + resRet.bolsilloNom + ":* ||*$" + formatearCOP(resRet.nuevoBolsillo) + " COP*|| *(" + (resRet.bolsilloNom === "Ahorro" ? resRet.pctAhorro : resRet.pctObligaciones) + "% actual)*\n" +
                        "─────────────────────────────\n" +
                        "💰 *Saldo Total Davivienda:* ||*$" + formatearCOP(resRet.saldoTotalBanco) + " COP*|| *(100%)* (¡Tu plata total sigue intacta!).";
        }
      } else if (comando === "SET_BOLSILLO") {
        var partesBol = params.split("|");
        var tipoBol = partesBol[0].trim().toLowerCase();
        var montoBol = parseFloat(partesBol[1] ? partesBol[1].replace(/[^0-9.]/g, '') : "0");
        if (!isNaN(montoBol) && montoBol >= 0) {
          actualizarSaldoBolsillo(tipoBol, montoBol);
          var confB = obtenerConfiguracionActual();
          var pNombre = (tipoBol.indexOf("ahorro") !== -1) ? "Bolsillo Ahorro" : "Bolsillo Obligaciones";
          var pctB = (tipoBol.indexOf("ahorro") !== -1) ? confB.pctAhorroReal : confB.pctObligacionesReal;
          avisoAccion = "\n\n🏦 *" + pNombre + " sincronizado:* ||*$" + formatearCOP(montoBol) + " COP*|| *(" + pctB + "% actual)*. Saldo total Davivienda: ||*$" + formatearCOP(confB.saldoTotalBanco) + " COP*|| *(100%)*.";
        }
      } else if (comando === "SET_DEUDA_TARJETA") {
        var numDeuda = parseFloat(params.replace(/[^0-9.]/g, ''));
        if (!isNaN(numDeuda) && numDeuda >= 0) {
          actualizarDeudaTarjeta(numDeuda);
          var confA = obtenerConfiguracionActual();
          avisoAccion = "\n\n🟣 *Deuda de Tarjeta Nu actualizada:* ||*$" + formatearCOP(numDeuda) + " COP*|| a pagar el *" + confA.proximaFechaPagoTarjeta + "* (los 11 de cada mes). Liquidez neta real: ||*$" + formatearCOP(confA.liquidezNetaReal) + " COP*||.";
        }
      } else if (comando === "PAGAR_TARJETA") {
        var numPago = parseFloat(params.replace(/[^0-9.]/g, ''));
        var resP = pagarTarjetaCredito(numPago > 0 ? numPago : null);
        if (!resP.error) {
          avisoAccion = "\n\n🎉 *Pago de Tarjeta Nu anotado:* Pagados *$" + formatearCOP(resP.montoPagado) + " COP*. Deuda restante: ||*$" + formatearCOP(resP.nuevaDeuda) + " COP*||. Saldo disponible: ||*$" + formatearCOP(resP.nuevoSaldo) + " COP*||.";
        }
      } else if (comando === "SET_SALDO_TOTAL") {
        var numSaldoT = parseFloat(params.replace(/[^0-9.]/g, ''));
        if (!isNaN(numSaldoT) && numSaldoT >= 0) {
          actualizarSaldoTotalBanco(numSaldoT);
          var confST = obtenerConfiguracionActual();
          avisoAccion = "\n\n💰 *Saldo Total Davivienda calibrado:* ||*$" + formatearCOP(confST.saldoTotalBanco) + " COP*||\n" +
                        "🛒 *Saldo Disponible Calculado:* ||*$" + formatearCOP(confST.saldoCuenta) + " COP*||\n" +
                        "💎 *Bolsillo Ahorros:* ||*$" + formatearCOP(confST.saldoBolsilloAhorro) + " COP*||\n" +
                        "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(confST.saldoBolsilloObligaciones) + " COP*||.";
        }
      } else if (comando === "SET_SALDO_DISPONIBLE" || comando === "SET_SALDO") {
        var numSaldo = parseFloat(params.replace(/[^0-9.]/g, ''));
        if (!isNaN(numSaldo) && numSaldo >= 0) {
          var confPrevAcc = obtenerConfiguracionActual();
          var sumaBols = (confPrevAcc.saldoBolsilloAhorro || 0) + (confPrevAcc.saldoBolsilloObligaciones || 0);
          if (comando === "SET_SALDO" && numSaldo > sumaBols) {
            actualizarSaldoTotalBanco(numSaldo);
            var confST = obtenerConfiguracionActual();
            avisoAccion = "\n\n💰 *Saldo Total Davivienda calibrado:* ||*$" + formatearCOP(confST.saldoTotalBanco) + " COP*|| (Disponible deducido: ||*$" + formatearCOP(confST.saldoCuenta) + " COP*||).";
          } else {
            actualizarSaldoCuenta(numSaldo);
            var confS = obtenerConfiguracionActual();
            avisoAccion = "\n\n💳 *Saldo disponible en cuenta sincronizado:* ||*$" + formatearCOP(numSaldo) + " COP*||. Saldo total Davivienda: ||*$" + formatearCOP(confS.saldoTotalBanco) + " COP*||.";
          }
        }
      } else if (comando === "AGREGAR_INGRESO") {
        var partesIng = params.split("|");
        var mIng = parseFloat(partesIng[0] ? partesIng[0].replace(/[^0-9.]/g, '') : "0");
        var cIng = partesIng[1] ? partesIng[1].trim() : "Ingreso";
        if (mIng > 0) {
          var nSaldo = agregarIngresoCuenta(mIng, cIng, "Transferencia / Consignación");
          avisoAccion = "\n\n🎉 *Ingreso añadido a tu cuenta:* +*$" + formatearCOP(mIng) + " COP* (" + cIng + "). Saldo actual: ||*$" + formatearCOP(nSaldo) + " COP*||.";
        }
      } else if (comando === "SET_PRESUPUESTO") {
        var num = parseFloat(params.replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) {
          actualizarParametroConfig("Presupuesto Gastos Variables", num);
          avisoAccion = "\n\n⚙️ *Actualización aplicada:* Se ajustó el presupuesto variable a *$" + formatearCOP(num) + " COP*.";
        }
      } else if (comando === "SET_SALARIO") {
        var numSal = parseFloat(params.replace(/[^0-9.]/g, ''));
        if (!isNaN(numSal) && numSal > 0) {
          actualizarParametroConfig("Salario Mensual Neto", numSal);
          avisoAccion = "\n\n⚙️ *Actualización aplicada:* Se actualizó tu salario a *$" + formatearCOP(numSal) + " COP*.";
        }
      } else if (comando === "CREAR_META") {
        var partesMeta = params.split("|");
        var nomMeta = partesMeta[0].trim();
        var objMeta = parseFloat(partesMeta[1] ? partesMeta[1].replace(/[^0-9.]/g, '') : "0");
        var plazoMeta = parseInt(partesMeta[2] || "6");
        if (nomMeta && objMeta > 0) {
          crearMetaAhorro(nomMeta, objMeta, plazoMeta);
          avisoAccion = "\n\n🎯 *Meta registrada en Google Sheets:* *" + nomMeta + "* con objetivo de *$" + formatearCOP(objMeta) + " COP*.";
        }
      } else if (comando === "ABONAR_META") {
        var partesAbono = params.split("|");
        var nomAb = partesAbono[0].trim();
        var montAb = parseFloat(partesAbono[1] ? partesAbono[1].replace(/[^0-9.]/g, '') : "0");
        if (nomAb && montAb > 0) {
          avisoAccion = "\n\n" + abonarAMeta(nomAb, montAb);
        }
      } else if (comando === "REGISTRAR_INVERSION") {
        var partesInv = params.split("|");
        var tipoInv = partesInv[0] ? partesInv[0].trim() : "CDT";
        var entInv = partesInv[1] ? partesInv[1].trim() : "Davivienda";
        var montInv = parseFloat(partesInv[2] ? partesInv[2].replace(/[^0-9.]/g, '') : "0");
        var tasaInv = partesInv[3] ? partesInv[3].trim() : "10.5% E.A.";
        var plazoInv = parseInt(partesInv[4] ? partesInv[4].replace(/[^0-9]/g, '') : "90") || 0;
        var rendInv = partesInv[5] ? partesInv[5].trim() : "0";
        if (montInv > 0) {
          var resRegInv = registrarInversionEnHoja(tipoInv, entInv, montInv, tasaInv, plazoInv, rendInv);
          avisoAccion = "\n\n📈 *¡Inversión Registrada en Google Sheets!*\n" +
                        "📋 *" + tipoInv + "* en *" + entInv + "* por *$" + formatearCOP(montInv) + " COP*\n" +
                        "📊 *Rendimiento / Tasa:* " + tasaInv + " | *Plazo:* " + (plazoInv > 0 ? plazoInv + " días" : "Spot") + "\n" +
                        (resRegInv.vencimiento && resRegInv.vencimiento !== "N/A" ? "📅 *Fecha Vencimiento:* " + resRegInv.vencimiento + "\n" : "") +
                        "🛡️ _Guardado en tu portafolio para monitoreo de rendimientos y alertas matutinas de vencimiento._";
        }
      } else if (comando === "BORRAR_INVERSION") {
        var paramB = params ? params.trim() : "all";
        var resB = borrarInversionEnHoja(paramB);
        avisoAccion = "\n\n🗑️ *" + (resB.ok ? "Inversión eliminada:" : "Aviso:") + "* " + resB.mensaje;
      } else if (comando === "AGREGAR_GASTO_FIJO") {
        var partesGF = params.split("|");
        var nomGF = partesGF[0].trim();
        var montGF = parseFloat(partesGF[1] ? partesGF[1].replace(/[^0-9.]/g, '') : "0");
        var diaGF = parseInt(partesGF[2] ? partesGF[2].replace(/[^0-9]/g, '') : "30") || 30;
        var medGF = partesGF[3] ? partesGF[3].trim() : "Transferencia Bancaria";
        if (nomGF && montGF > 0) {
          agregarOActualizarGastoFijo(nomGF, montGF, diaGF, medGF, "Fijo Obligatorio");
          avisoAccion = "\n\n🏢 *Gasto Fijo Programado Guardado:*\n" +
                        "📋 *" + nomGF + "* por *$" + formatearCOP(montGF) + " COP* a pagar los *" + diaGF + " de cada mes* (" + medGF + ").\n" +
                        "💡 _No se descuenta hoy porque vence el día " + diaGF + " con tu quincena correspondiente._";
        }
      } else if (comando === "REGISTRAR_GASTO") {
        var partesGasto = params.split("|");
        var montG = sanitizarImporteCOP(partesGasto[0]);
        var comG = partesGasto[1] ? partesGasto[1].trim() : "Comercio";
        var catG = partesGasto[2] ? partesGasto[2].trim() : "General";
        var metG = partesGasto[3] ? partesGasto[3].trim() : "Nequi/Davivienda";

        if (montG > 0) {
          // Salvaguarda: Si Gemini intenta registrar el Arriendo como gasto ejecutado del día
          if (comG.toLowerCase().indexOf("arriendo") !== -1 && montG >= 400000) {
            agregarOActualizarGastoFijo("Arriendo", montG, 30, metG, "Fijo Obligatorio");
            avisoAccion = "\n\n🏢 *Gasto Fijo Programado:* *Arriendo* configurado por *$" + formatearCOP(montG) + " COP* para pagarse los *30 de cada mes*.\n" +
                          "💡 _No se descontó de tu saldo hoy porque vence a fin de mes con tu 2ª quincena de nómina._";
          } else {
            var ss = SpreadsheetApp.getActiveSpreadsheet();
            var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
            if (sheet) {
              asegurarColumnasUbicacion(sheet);
            }
            var fechaActual = new Date();
            var fechaTexto = Utilities.formatDate(fechaActual, CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss");
            var idTimestamp = new Date().getTime();

            var cache = CacheService.getScriptCache();
            var pendingLocStr = cache.get("pending_location_" + CONFIG.TELEGRAM_CHAT_ID);
            var ubiGasto = { lat: null, lng: null, ubicacion: "" };
            if (pendingLocStr) {
              try {
                ubiGasto = JSON.parse(pendingLocStr);
                cache.remove("pending_location_" + CONFIG.TELEGRAM_CHAT_ID);
              } catch(eLoc) {}
            }

            sheet.appendRow([
              fechaTexto,
              "🔴 Gasto",
              comG,
              montG,
              metG,
              catG,
              "IA Multimodal (Foto/Audio/Texto)",
              idTimestamp,
              ubiGasto.lat !== null ? ubiGasto.lat : "",
              ubiGasto.lng !== null ? ubiGasto.lng : "",
              ubiGasto.ubicacion || ""
            ]);

            cache.put("ultimo_gasto_id", idTimestamp.toString(), 600);

            var sald = descontarSaldoCuenta(montG);
            var horasTrabajo = (montG / 19957).toFixed(1);
            var diasCupo = (montG / 21190).toFixed(1);
            ultimoGastoTimestamp = idTimestamp;

            var confPostG = obtenerConfiguracionActual();
            var infoAlertaG = evaluarAlertaDisponibleCritico(sald, confPostG);

            avisoAccion = "\n\n✅ *Gasto anotado en Google Sheets:*\n" +
                          "💵 *$" + formatearCOP(montG) + " COP* en *" + comG + "* (" + catG + ")\n" +
                          "📱 Medio: *" + metG + "*\n" +
                          (ubiGasto.ubicacion ? "📍 Ubicación: *" + ubiGasto.ubicacion + "*\n" : "") +
                          "💰 Saldo restante en banco: ||*$" + formatearCOP(sald || 0) + " COP*||\n\n" +
                          "⏳ *Impacto en Horas de Trabajo:*\n" +
                          "• Equivale a *" + horasTrabajo + " horas* de tu trabajo (~*" + diasCupo + " días* de cupo diario).";

            if (infoAlertaG.alerta) {
              avisoAccion += "\n\n" + infoAlertaG.alertaTexto;
              botonesAlertaCritica = infoAlertaG.botones;
            }

            checkBudgetAlert(montG, comG);
          }
        }
      }
    } catch (err) {
      Logger.log("Error ejecutando acción de Gemini: " + err.toString());
    }

    textoFinal = respuesta.replace(accionRegex, "").trim() + avisoAccion;

    if (ultimoGastoTimestamp) {
      var urlMapa = getUrlWebAppConParametros("view=mapa");
      var kbPostGasto = [
        [
          { text: "↩️ Deshacer Gasto", callback_data: "cb:deshacer:" + ultimoGastoTimestamp },
          { text: "🗺️ Ver en Mapa", web_app: { url: urlMapa } }
        ],
        [
          { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
          { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
        ]
      ];

      if (botonesAlertaCritica && botonesAlertaCritica.length > 0) {
        for (var bac = 0; bac < botonesAlertaCritica.length; bac++) {
          kbPostGasto.push(botonesAlertaCritica[bac]);
        }
      }

      kbPostGasto.push([
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]);

      return {
        texto: textoFinal,
        inlineKeyboard: kbPostGasto
      };
    }
  }

  return {
    texto: textoFinal,
    inlineKeyboard: [
      [
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" },
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" },
        { text: "☀️ Briefing", callback_data: "cb:briefing" }
      ]
    ]
  };
}

// ==========================================
// CLIENTE GEMINI CONVERSACIONAL Y MULTIMODAL CON MEMORIA
// ==========================================
function llamarGeminiConversacional(systemInstructionText, prompt, mimeType, base64Data, historial) {
  var apiKey = CONFIG.GEMINI_API_KEY;
  // Cascada de modelos: gemini-3.5-flash (máxima inteligencia y criterio),
  // gemini-3.1-flash-lite (ultra veloz), gemini-2.5-flash y gemini-3-flash-preview
  var modelos = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3-flash-preview"];

  var contents = [];

  // 1. Agregar historial previo sanitizado
  if (historial && Array.isArray(historial) && historial.length > 0) {
    for (var h = 0; h < historial.length; h++) {
      var turno = historial[h];
      if (turno && turno.text && turno.text.trim()) {
        contents.push({
          role: turno.role === "model" ? "model" : "user",
          parts: [{ text: turno.text }]
        });
      }
    }
  }

  // 2. Agregar turno actual del usuario
  var currentParts = [{ text: prompt }];
  if (mimeType && base64Data) {
    currentParts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    });
  }

  contents.push({
    role: "user",
    parts: currentParts
  });

  var payload = {
    contents: contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 2048,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };

  if (systemInstructionText && systemInstructionText.trim()) {
    payload.systemInstruction = {
      parts: [{ text: systemInstructionText }]
    };
  }

  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var ultimoError = "";

  for (var i = 0; i < modelos.length; i++) {
    var modelo = modelos[i];
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelo + ":generateContent?key=" + apiKey;

    try {
      var res = UrlFetchApp.fetch(url, options);
      var statusCode = res.getResponseCode();

      if (statusCode === 200) {
        var json = JSON.parse(res.getContentText());
        if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
          var partes = json.candidates[0].content.parts;
          var textoAcumulado = "";
          for (var p = 0; p < partes.length; p++) {
            if (partes[p].text) {
              textoAcumulado += partes[p].text;
            }
          }
          if (textoAcumulado.trim().length > 0) {
            Logger.log("Respuesta generada con éxito por modelo: " + modelo + " (" + contents.length + " turnos de contexto)");
            return textoAcumulado;
          }
        }
      }

      ultimoError = res.getContentText();
      Logger.log("Modelo " + modelo + " (" + statusCode + "): " + ultimoError + ". Intentando siguiente en cascada...");

    } catch (err) {
      ultimoError = err.toString();
      Logger.log("Fallo en conexión con " + modelo + ": " + ultimoError + ". Intentando siguiente en cascada...");
    }
  }

  return "⚠️ Estimado usuario, los servidores de IA tuvieron una saturación momentánea. Por favor repite tu pregunta en un instante.";
}

function llamarGeminiMultimodal(prompt, mimeType, base64Data) {
  return llamarGeminiConversacional("", prompt, mimeType, base64Data, []);
}

function llamarGemini(prompt) {
  return llamarGeminiConversacional("", prompt, null, null, []);
}

// ==========================================
// GESTIÓN DE MEMORIA CONVERSACIONAL (CACHE)
// ==========================================
function obtenerHistorialChat(chatId) {
  try {
    var raw = CacheService.getScriptCache().get("tg_hist_" + chatId);
    if (raw) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {
    Logger.log("Error leyendo historial de chat: " + e.toString());
  }
  return [];
}

function guardarHistorialChat(chatId, historial) {
  try {
    if (!historial || !Array.isArray(historial)) return;
    // Conservar los últimos 8 turnos (4 idas y vueltas)
    var recortado = historial.slice(-8);
    // Limitar longitud por turno a 1000 caracteres para preservar espacio de cache
    var saneado = recortado.map(function(item) {
      return {
        role: item.role === "model" ? "model" : "user",
        text: (item.text || "").substring(0, 1000)
      };
    });
    // TTL de 4 horas (14400 segundos)
    CacheService.getScriptCache().put("tg_hist_" + chatId, JSON.stringify(saneado), 14400);
  } catch (e) {
    Logger.log("Error guardando historial de chat: " + e.toString());
  }
}

function limpiarHistorialChat(chatId) {
  try {
    CacheService.getScriptCache().remove("tg_hist_" + chatId);
    Logger.log("Historial de chat borrado para chatId: " + chatId);
  } catch (e) {
    Logger.log("Error limpiando historial de chat: " + e.toString());
  }
}

// ==========================================
// ACCIONES DE ESTADO EN TELEGRAM (Typing...)
// ==========================================
function enviarAccionChat(chatId, accion) {
  try {
    var token = CONFIG.TELEGRAM_TOKEN;
    if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;
    var url = "https://api.telegram.org/bot" + token + "/sendChatAction";
    UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        action: accion || "typing"
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Error enviando acción de chat: " + e.toString());
  }
}

// ==========================================
// CLIENTE TELEGRAM CON PARSEO HTML ROBUSTO
// ==========================================
function sendTelegram(chatId, text, inlineKeyboard) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || token === "TU_TELEGRAM_BOT_TOKEN") {
    Logger.log("TELEGRAM_TOKEN no configurado.");
    return;
  }

  if (!text) return;

  var textoFinal = text;
  var kbFinal = inlineKeyboard;
  if (typeof text === "object" && text.texto) {
    textoFinal = text.texto;
    if (!kbFinal && (text.inlineKb || text.inlineKeyboard)) {
      kbFinal = text.inlineKb || text.inlineKeyboard;
    }
  }

  // Si el mensaje supera 3500 caracteres, dividir en bloques antes de convertir
  if (textoFinal.length > 3500) {
    var bloques = textoFinal.match(/[\s\S]{1,3500}/g) || [textoFinal];
    for (var i = 0; i < bloques.length; i++) {
      var htmlBloque = formatearParaTelegramHtml(bloques[i]);
      var kb = (i === bloques.length - 1) ? kbFinal : null;
      enviarMensajeTelegramDirecto(chatId, htmlBloque, token, kb);
    }
  } else {
    var htmlTexto = formatearParaTelegramHtml(textoFinal);
    enviarMensajeTelegramDirecto(chatId, htmlTexto, token, kbFinal);
  }
}

function enviarMensajeTelegramDirecto(chatId, textoHtml, token, inlineKeyboard) {
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";

  var payload = {
    chat_id: chatId,
    text: textoHtml,
    parse_mode: "HTML"
  };

  if (inlineKeyboard) {
    if (typeof inlineKeyboard === 'string') {
      payload.reply_markup = inlineKeyboard;
    } else if (inlineKeyboard.keyboard || inlineKeyboard.inline_keyboard || inlineKeyboard.remove_keyboard) {
      payload.reply_markup = JSON.stringify(inlineKeyboard);
    } else {
      payload.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
    }
  }

  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(url, options);
  var statusCode = res.getResponseCode();

  if (statusCode !== 200) {
    Logger.log("Fallo envío HTML Telegram (" + statusCode + "): " + res.getContentText() + ". Reintentando en texto plano limpio...");
    // Fallback 1: remover etiquetas HTML y enviar en texto plano
    payload.text = textoHtml.replace(/<[^>]+>/g, "");
    delete payload.parse_mode;
    options.payload = JSON.stringify(payload);
    var resRetry = UrlFetchApp.fetch(url, options);
    // Fallback 2: si aún falla (por ejemplo por botones o URLs de webapp inválidas), reintentar sin botones
    if (resRetry.getResponseCode() !== 200 && payload.reply_markup) {
      delete payload.reply_markup;
      options.payload = JSON.stringify(payload);
      UrlFetchApp.fetch(url, options);
    }
  }
}

function eliminarMensajeTelegram(chatId, messageId) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || token === "TU_TELEGRAM_BOT_TOKEN" || !messageId) return false;

  var url = "https://api.telegram.org/bot" + token + "/deleteMessage";
  var payload = {
    chat_id: chatId,
    message_id: messageId
  };
  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var res = UrlFetchApp.fetch(url, options);
    var resObj = JSON.parse(res.getContentText());
    return resObj.ok === true;
  } catch(e) {
    Logger.log("Error en eliminarMensajeTelegram: " + e.toString());
    return false;
  }
}

function editarMensajeTelegram(chatId, messageId, text, inlineKeyboard) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;
  if (!text || !messageId) return;

  var textoFinal = text;
  var kbFinal = inlineKeyboard;
  if (typeof text === "object" && text.texto) {
    textoFinal = text.texto;
    if (!kbFinal && (text.inlineKb || text.inlineKeyboard)) {
      kbFinal = text.inlineKb || text.inlineKeyboard;
    }
  }

  var htmlTexto = formatearParaTelegramHtml(textoFinal);
  var url = "https://api.telegram.org/bot" + token + "/editMessageText";
  var payload = {
    chat_id: chatId,
    message_id: messageId,
    text: htmlTexto,
    parse_mode: "HTML"
  };

  if (kbFinal) {
    if (typeof kbFinal === 'string') {
      payload.reply_markup = kbFinal;
    } else if (kbFinal.keyboard || kbFinal.inline_keyboard || kbFinal.remove_keyboard) {
      payload.reply_markup = JSON.stringify(kbFinal);
    } else {
      payload.reply_markup = JSON.stringify({ inline_keyboard: kbFinal });
    }
  }

  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var res = UrlFetchApp.fetch(url, options);
    var resObj = JSON.parse(res.getContentText());
    if (!resObj.ok) {
      if (resObj.description && resObj.description.indexOf("message is not modified") !== -1) {
        return;
      }
      Logger.log("Aviso editMessageText: " + resObj.description + ". Reemplazando mensaje...");
      // Si falló (ej: porque el mensaje previo era una foto y Telegram no permite editMessageText sobre fotos),
      // eliminamos el mensaje previo para que no quede duplicado en el chat y enviamos el texto actualizado
      eliminarMensajeTelegram(chatId, messageId);
      sendTelegram(chatId, textoFinal, kbFinal);
    }
  } catch(e) {
    Logger.log("Error en editarMensajeTelegram: " + e.toString());
    eliminarMensajeTelegram(chatId, messageId);
    sendTelegram(chatId, textoFinal, kbFinal);
  }
}

function editarOEnviarFotoTelegram(chatId, messageId, photoUrl, caption, inlineKeyboard) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;

  var captionHtml = formatearParaTelegramHtml(caption || "");
  var replyMarkupObj = null;
  if (inlineKeyboard) {
    if (typeof inlineKeyboard === 'string') {
      try {
        replyMarkupObj = JSON.parse(inlineKeyboard);
      } catch(e) {
        replyMarkupObj = inlineKeyboard;
      }
    } else if (inlineKeyboard.keyboard || inlineKeyboard.inline_keyboard || inlineKeyboard.remove_keyboard) {
      replyMarkupObj = inlineKeyboard;
    } else {
      replyMarkupObj = { inline_keyboard: inlineKeyboard };
    }
  }

  // 1. Si hay messageId, intentar editar el media in-place con editMessageMedia
  // (funciona si el mensaje actual ya es una foto/gráfico)
  if (messageId) {
    var urlMedia = "https://api.telegram.org/bot" + token + "/editMessageMedia";
    var payloadMedia = {
      chat_id: chatId,
      message_id: messageId,
      media: {
        type: "photo",
        media: photoUrl,
        caption: captionHtml,
        parse_mode: "HTML"
      }
    };
    if (replyMarkupObj) {
      payloadMedia.reply_markup = (typeof replyMarkupObj === 'string') ? replyMarkupObj : JSON.stringify(replyMarkupObj);
    }

    var optionsMedia = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payloadMedia),
      muteHttpExceptions: true
    };

    try {
      var res = UrlFetchApp.fetch(urlMedia, optionsMedia);
      var resObj = JSON.parse(res.getContentText());
      if (resObj.ok) {
        return; // ¡Editado exitosamente in-place!
      }
      Logger.log("Aviso editMessageMedia: " + resObj.description + ". Eliminando mensaje previo y enviando foto...");
      // Si falló (ej: porque el mensaje previo era un mensaje de texto), eliminamos el texto previo para no duplicar en el chat
      eliminarMensajeTelegram(chatId, messageId);
    } catch(e) {
      Logger.log("Error en editMessageMedia: " + e.toString());
      eliminarMensajeTelegram(chatId, messageId);
    }
  }

  // 2. Enviar la foto (habiendo eliminado el mensaje anterior para que no queden duplicados)
  enviarFotoTelegram(chatId, photoUrl, caption, inlineKeyboard);
}

function enviarFotoTelegram(chatId, photoUrl, caption, inlineKeyboard) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || token === "TU_TELEGRAM_BOT_TOKEN") return;

  var url = "https://api.telegram.org/bot" + token + "/sendPhoto";
  var payload = {
    chat_id: chatId,
    photo: photoUrl,
    caption: formatearParaTelegramHtml(caption || ""),
    parse_mode: "HTML"
  };

  if (inlineKeyboard) {
    if (typeof inlineKeyboard === 'string') {
      payload.reply_markup = inlineKeyboard;
    } else if (inlineKeyboard.keyboard || inlineKeyboard.inline_keyboard || inlineKeyboard.remove_keyboard) {
      payload.reply_markup = JSON.stringify(inlineKeyboard);
    } else {
      payload.reply_markup = JSON.stringify({ inline_keyboard: inlineKeyboard });
    }
  }

  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var res = UrlFetchApp.fetch(url, options);
    var resObj = JSON.parse(res.getContentText());
    if (!resObj.ok) {
      Logger.log("Aviso sendPhoto: " + resObj.description);
      sendTelegram(chatId, caption, inlineKeyboard);
    }
  } catch(e) {
    Logger.log("Error en enviarFotoTelegram: " + e.toString());
    sendTelegram(chatId, caption, inlineKeyboard);
  }
}

function generarUrlGraficoDistribucion(conf) {
  var chartConfig = {
    type: 'doughnut',
    data: {
      labels: ['Ahorro Puro (53%)', 'Obligaciones (27%)', 'Disponible (20%)'],
      datasets: [{
        data: [conf.saldoBolsilloAhorro, conf.saldoBolsilloObligaciones, conf.saldoCuenta],
        backgroundColor: ['#8B5CF6', '#38BDF8', '#22C55E'],
        borderColor: '#0F172A',
        borderWidth: 3
      }]
    },
    options: {
      title: {
        display: true,
        text: 'DISTRIBUCIÓN PATRIMONIAL DAVIVIENDA',
        fontColor: '#FFFFFF',
        fontSize: 16,
        fontStyle: 'bold'
      },
      legend: {
        position: 'bottom',
        labels: {
          fontColor: '#E2E8F0',
          fontSize: 13,
          boxWidth: 14,
          padding: 14
        }
      }
    }
  };
  return "https://quickchart.io/chart?bkg=%230f172a&w=600&h=420&devicePixelRatio=2&c=" + encodeURIComponent(JSON.stringify(chartConfig));
}

function generarUrlGraficoPresupuesto(resumen, conf) {
  var cats = Object.keys(resumen.porCategoria || {});
  var labels = [];
  var dataVals = [];
  if (cats.length === 0) {
    labels = ['Sin gastos aún'];
    dataVals = [0];
  } else {
    cats.forEach(function(c) {
      labels.push(c);
      dataVals.push(resumen.porCategoria[c]);
    });
  }

  var chartConfig = {
    type: 'horizontalBar',
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: '#F43F5E',
        borderRadius: 6
      }]
    },
    options: {
      title: {
        display: true,
        text: 'GASTOS VARIABLES (' + (resumen.mesNombre || 'MES').toUpperCase() + ')',
        fontColor: '#FFFFFF',
        fontSize: 16,
        fontStyle: 'bold'
      },
      legend: { display: false },
      scales: {
        xAxes: [{
          ticks: { fontColor: '#94A3B8', beginAtZero: true },
          gridLines: { color: 'rgba(255,255,255,0.08)' }
        }],
        yAxes: [{
          ticks: { fontColor: '#FFFFFF', fontSize: 12 },
          gridLines: { display: false }
        }]
      }
    }
  };
  return "https://quickchart.io/chart?bkg=%230f172a&w=600&h=400&devicePixelRatio=2&c=" + encodeURIComponent(JSON.stringify(chartConfig));
}

function answerCallbackQuery(callbackQueryId, text, showAlert) {
  var token = CONFIG.TELEGRAM_TOKEN;
  if (!token || !callbackQueryId) return;
  var url = "https://api.telegram.org/bot" + token + "/answerCallbackQuery";
  var payload = {
    callback_query_id: callbackQueryId
  };
  if (text) {
    payload.text = text;
  }
  if (showAlert) {
    payload.show_alert = true;
  }

  try {
    UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log("Error answerCallbackQuery: " + err.toString());
  }
}

// ==========================================
// CONVERTIDOR DE MARKDOWN A TELEGRAM HTML
// Resuelve el fallo nativo de Markdown v1 en Telegram (**texto**, viñetas y caracteres especiales)
// ==========================================
function formatearParaTelegramHtml(text) {
  if (!text) return "";

  // 1. Proteger bloques de código ``` ... ```
  var codeBlocks = [];
  text = text.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, function(match, code) {
    codeBlocks.push(code);
    return "@@@CODE_BLOCK_" + (codeBlocks.length - 1) + "@@@";
  });

  // 2. Proteger código en línea ` ... `
  var inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, function(match, code) {
    inlineCodes.push(code);
    return "@@@INLINE_CODE_" + (inlineCodes.length - 1) + "@@@";
  });

  // 3. Escapar caracteres reservados de HTML (&, <, >)
  text = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Encabezados Markdown (# Título -> <b>Título</b>)
  text = text.replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>");

  // 4a. Citas Nativas Telegram (Markdown > Cita -> <blockquote>Cita</blockquote>)
  text = text.replace(/^(?:&gt;)[ \t]?(.*(?:\n(?:&gt;)[ \t]?.*)*)/gm, function(match) {
    var cleanLines = match.split("\n").map(function(line) {
      return line.replace(/^(?:&gt;)[ \t]?/, "");
    }).join("\n");
    return "<blockquote>" + cleanLines + "</blockquote>";
  });

  // 5. Viñetas de lista Markdown (* item o - item -> • item)
  text = text.replace(/^\s*[\*\-]\s+/gm, "• ");

  // 6. Negritas dobles (**texto** o __texto__)
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // 7. Negritas simples (*texto*) cuando no son viñetas
  text = text.replace(/(^|[\s\(\[\{.,!?:;¡¿])\*([^\*\n]+?)\*(?=[\s\)\]\}.,!?:;]|$)/g, "$1<b>$2</b>");

  // 8. Cursivas simples (_texto_)
  text = text.replace(/(^|[\s\(\[\{.,!?:;¡¿])_([^_\n]+?)_(?=[\s\)\]\}.,!?:;]|$)/g, "$1<i>$2</i>");

  // 9. Spoilers de Telegram (||texto oculto|| -> <tg-spoiler>texto oculto</tg-spoiler>)
  text = text.replace(/\|\|(.+?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

  // 10. Enlaces [texto](url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 10. Restaurar códigos en línea con sanitizado HTML
  text = text.replace(/@@@INLINE_CODE_(\d+)@@@/g, function(match, i) {
    var safe = (inlineCodes[i] || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return "<code>" + safe + "</code>";
  });

  // 11. Restaurar bloques de código con sanitizado HTML
  text = text.replace(/@@@CODE_BLOCK_(\d+)@@@/g, function(match, i) {
    var safe = (codeBlocks[i] || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return "<pre><code>" + safe + "</code></pre>";
  });

  return text;
}

/**
 * Migra y normaliza la hoja Transacciones para incluir la columna Tipo (Ingreso / Gasto / Transferencia)
 */
function migrarHojaTransaccionesATipo(ss) {
  var sheet = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!sheet || sheet.getLastRow() === 0) return;

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0];
  var col2 = (headers[1] || "").toString().trim().toLowerCase();

  // Si la columna 2 NO es "Tipo", insertamos la columna
  if (col2 !== "tipo") {
    sheet.insertColumnBefore(2);
    sheet.getRange(1, 2).setValue("Tipo");
    sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#1A73E8").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);

    var numRows = sheet.getLastRow();
    if (numRows > 1) {
      var range = sheet.getRange(2, 1, numRows - 1, sheet.getLastColumn());
      var values = range.getValues();

      for (var r = 0; r < values.length; r++) {
        var row = values[r];
        var comercio = (row[2] || "").toString().toLowerCase();
        var cat = (row[5] || "").toString().toLowerCase();

        var tipo = "🔴 Gasto";
        if (comercio.indexOf("nómina") !== -1 || comercio.indexOf("nomina") !== -1 ||
            comercio.indexOf("salario") !== -1 || cat.indexOf("nómina") !== -1 ||
            cat.indexOf("nomina") !== -1 || cat.indexOf("salario") !== -1 ||
            comercio.indexOf("ingreso") !== -1 || cat.indexOf("ingreso") !== -1) {
          tipo = "🟢 Ingreso";
        } else if (comercio.indexOf("arriendo") !== -1 || comercio.indexOf("pago tarjeta") !== -1 ||
                   comercio.indexOf("bolsillo") !== -1 || cat.indexOf("tarjeta de crédito") !== -1 ||
                   cat.indexOf("transferencia") !== -1) {
          tipo = "🔄 Transferencia";
        }

        sheet.getRange(r + 2, 2).setValue(tipo);
      }
    }
    sheet.getRange("D2:D").setNumberFormat("$#,##0");
    Logger.log("✅ Hoja Transacciones migrada exitosamente con columna Tipo.");
  } else {
    sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#1A73E8").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.getRange("D2:D").setNumberFormat("$#,##0");

    var numR = sheet.getLastRow();
    if (numR > 1) {
      var vals = sheet.getRange(2, 1, numR - 1, sheet.getLastColumn()).getValues();
      for (var k = 0; k < vals.length; k++) {
        var rVal = vals[k];
        var currTipo = (rVal[1] || "").toString().trim();
        if (!currTipo) {
          var com = (rVal[2] || "").toString().toLowerCase();
          var ctg = (rVal[5] || "").toString().toLowerCase();
          var tCalc = "🔴 Gasto";
          if (com.indexOf("nómina") !== -1 || com.indexOf("nomina") !== -1 || com.indexOf("salario") !== -1 || ctg.indexOf("nómina") !== -1 || ctg.indexOf("nomina") !== -1 || ctg.indexOf("ingreso") !== -1) {
            tCalc = "🟢 Ingreso";
          } else if (com.indexOf("arriendo") !== -1 || com.indexOf("pago tarjeta") !== -1 || com.indexOf("bolsillo") !== -1) {
            tCalc = "🔄 Transferencia";
          }
          sheet.getRange(k + 2, 2).setValue(tCalc);
        }
      }
    }
  }

  // Asegurar columnas de Latitud, Longitud y Ubicación
  asegurarColumnasUbicacion(sheet);
}

// ==========================================
// INICIALIZACIÓN Y CONFIGURACIÓN DE SHEETS
// ==========================================
function inicializarHojas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Hoja Transacciones
  var shTransacciones = ss.getSheetByName(CONFIG.HOJA_TRANSACCIONES);
  if (!shTransacciones) {
    shTransacciones = ss.insertSheet(CONFIG.HOJA_TRANSACCIONES);
  }
  if (shTransacciones.getLastRow() === 0) {
    shTransacciones.appendRow(["Fecha", "Tipo", "Comercio", "Importe", "Tarjeta", "Categoría", "Origen", "ID_Timestamp", "Latitud", "Longitud", "Ubicación"]);
    shTransacciones.getRange("A1:K1").setFontWeight("bold").setBackground("#1A73E8").setFontColor("#FFFFFF");
    shTransacciones.setFrozenRows(1);
    shTransacciones.getRange("D2:D").setNumberFormat("$#,##0");
  } else {
    migrarHojaTransaccionesATipo(ss);
    asegurarColumnasUbicacion(shTransacciones);
  }

  // 2. Hoja Gastos Fijos
  var shFijos = ss.getSheetByName(CONFIG.HOJA_GASTOS_FIJOS);
  if (!shFijos) {
    shFijos = ss.insertSheet(CONFIG.HOJA_GASTOS_FIJOS);
  }
  if (shFijos.getLastRow() === 0) {
    shFijos.appendRow(["Concepto", "Monto COP", "Día de Pago", "Medio de Pago", "Tipo"]);
    shFijos.appendRow(["Google One", 3900, 5, "Tarjeta Nu (Cobro Fijo)", "Fijo Almacenamiento"]);
    shFijos.appendRow(["Claude Code", 63110, 6, "Tarjeta Nu (Cobro Fijo)", "Fijo Trabajo/IA (TRM variable)"]);
    shFijos.appendRow(["Gimnasio", 92600, 11, "Tarjeta Nu (Cobro Fijo)", "Fijo Bienestar"]);
    shFijos.appendRow(["Plan Celular Claro", 44000, 14, "Débito / PSE", "Fijo Comunicación"]);
    shFijos.appendRow(["Gasolina Moto", 60000, 15, "Efectivo / Transferencia", "Fijo Transporte (Quincenal)"]);
    shFijos.appendRow(["Arriendo", 600000, 30, "Transferencia Bancaria", "Fijo Obligatorio"]);
    shFijos.getRange("A1:E1").setFontWeight("bold").setBackground("#34A853").setFontColor("#FFFFFF");
    shFijos.setFrozenRows(1);
    shFijos.getRange("B2:B7").setNumberFormat("$#,##0");
  }

  // 3. Hoja Metas
  var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  if (!shMetas) {
    shMetas = ss.insertSheet(CONFIG.HOJA_METAS);
  }
  if (shMetas.getLastRow() === 0) {
    shMetas.appendRow(["Nombre de la Meta", "Monto Objetivo COP", "Ahorro Acumulado", "Plazo (Meses)", "Estado", "Fecha Creación"]);
    shMetas.appendRow(["Fondo de Emergencia (Supervivencia)", 863610, 0, 1, "Activa", new Date()]);
    shMetas.appendRow(["Bolsillo Ahorro e Inversión Davivienda", 10000000, 1561546, 12, "Activa", new Date()]);
    shMetas.getRange("A1:F1").setFontWeight("bold").setBackground("#673AB7").setFontColor("#FFFFFF");
    shMetas.setFrozenRows(1);
    shMetas.getRange("B2:C3").setNumberFormat("$#,##0");
  }

  // 4. Hoja Configuración
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (!shConfig) {
    shConfig = ss.insertSheet(CONFIG.HOJA_CONFIGURACION);
  }
  if (shConfig.getLastRow() === 0) {
    shConfig.appendRow(["Parámetro", "Valor", "Descripción"]);
    shConfig.appendRow(["Salario Mensual Neto", CONFIG.DEFAULT_SALARIO, "Ingreso mensual neto consolidado (Nómina)"]);
    shConfig.appendRow(["Saldo en Cuenta Bancaria", CONFIG.DEFAULT_SALDO_CUENTA, "Dinero en disponible real para gastos y ocio (Davivienda)"]);
    shConfig.appendRow(["Saldo Bolsillo Ahorro", CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO, "Dinero actualmente en Bolsillo Ahorro Davivienda"]);
    shConfig.appendRow(["Saldo Bolsillo Obligaciones", CONFIG.DEFAULT_SALDO_BOLSILLO_OBLIGACIONES, "Dinero actualmente en Bolsillo Obligaciones Davivienda"]);
    shConfig.appendRow(["Saldo Total Banco", CONFIG.DEFAULT_SALDO_TOTAL_BANCO, "Total consolidado en cuenta Davivienda (Disponible + Bolsillos)"]);
    shConfig.appendRow(["Gastos Fijos Totales", CONFIG.DEFAULT_BOLSILLO_OBLIGACIONES, "Suma de compromisos fijos mensuales (27%)"]);
    shConfig.appendRow(["Presupuesto Gastos Variables", CONFIG.DEFAULT_PRESUPUESTO_VARIABLE, "Límite mensual gastos diarios y ocio (20%)"]);
    shConfig.appendRow(["Meta de Ahorro Mensual", CONFIG.DEFAULT_BOLSILLO_AHORRO, "Ahorro proyectado mensual blindado (53%)"]);
    shConfig.appendRow(["Deuda Tarjeta de Crédito Nu", 159909, "Factura a pagar en la tarjeta Nu (suscripciones)"]);
    shConfig.appendRow(["Día de Pago Tarjeta Nu", CONFIG.DEFAULT_DIA_PAGO_TARJETA, "Día fijo de pago de la tarjeta Nu (11 de cada mes)"]);
    shConfig.appendRow(["Bolsillo Obligaciones Fijas (27%)", CONFIG.DEFAULT_BOLSILLO_OBLIGACIONES, "Fondeado el 15 para Arriendo, Nu, Claro y Gasolina"]);
    shConfig.appendRow(["Bolsillo Ahorro e Inversión (53%)", CONFIG.DEFAULT_BOLSILLO_AHORRO, "Blindado en Davivienda (Débito mensual el día 30)"]);
    shConfig.appendRow(["Disponible en Cuenta (20%)", CONFIG.DEFAULT_PRESUPUESTO_VARIABLE, "Gastos diarios y ocio (~$608k Q1 / +$30k Q2)"]);
    shConfig.getRange("A1:C1").setFontWeight("bold").setBackground("#F9AB00").setFontColor("#000000");
    shConfig.setFrozenRows(1);
    shConfig.getRange("B2:B14").setNumberFormat("$#,##0");
  }

  // 5. Hoja Inversiones
  inicializarHojaInversiones(ss);

  // Ejecutar sincronización de parámetros si las hojas ya existían
  sincronizarHojasYParametros();
  Logger.log("✅ Hojas, Metas e Inversiones inicializadas y sincronizadas con éxito.");
}

// ==========================================
// SINCRONIZACIÓN REAL CON GOOGLE SHEETS (CERO HARDCODEO)
// ==========================================
function sincronizarHojasYParametros(forceResetSaldos) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Sincronizar Parámetros en Hoja Configuración
  var shConfig = ss.getSheetByName(CONFIG.HOJA_CONFIGURACION);
  if (shConfig && shConfig.getLastRow() > 0) {
    var params = [
      ["Salario Mensual Neto", CONFIG.DEFAULT_SALARIO, "Ingreso mensual neto consolidado (Nómina)"],
      ["Saldo en Cuenta Bancaria", CONFIG.DEFAULT_SALDO_CUENTA, "Dinero disponible real para gastos y ocio (Davivienda)"],
      ["Saldo Bolsillo Ahorro", CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO, "Dinero actualmente en Bolsillo Ahorro Davivienda"],
      ["Saldo Bolsillo Obligaciones", CONFIG.DEFAULT_SALDO_BOLSILLO_OBLIGACIONES, "Dinero actualmente en Bolsillo Obligaciones Davivienda"],
      ["Saldo Total Banco", CONFIG.DEFAULT_SALDO_TOTAL_BANCO, "Total consolidado en cuenta Davivienda (Disponible + Bolsillos)"],
      ["Gastos Fijos Totales", CONFIG.DEFAULT_BOLSILLO_OBLIGACIONES, "Suma de compromisos fijos mensuales (27%)"],
      ["Presupuesto Gastos Variables", CONFIG.DEFAULT_PRESUPUESTO_VARIABLE, "Límite mensual gastos diarios y ocio (20%)"],
      ["Meta de Ahorro Mensual", CONFIG.DEFAULT_BOLSILLO_AHORRO, "Ahorro proyectado mensual blindado (53%)"],
      ["Día de Pago Tarjeta Nu", 11, "Día fijo de pago de la tarjeta Nu (11 de cada mes)"],
      ["Bolsillo Obligaciones Fijas (27%)", CONFIG.DEFAULT_BOLSILLO_OBLIGACIONES, "Fondeado el 15 para Arriendo, Nu, Claro y Gasolina"],
      ["Bolsillo Ahorro e Inversión (53%)", CONFIG.DEFAULT_BOLSILLO_AHORRO, "Blindado en Davivienda (Débito mensual el día 30)"],
      ["Disponible en Cuenta (20%)", CONFIG.DEFAULT_PRESUPUESTO_VARIABLE, "Gastos diarios y ocio (~$608k Q1 / +$30k Q2)"],
      ["Sub-Bolsillo Emergencia (70%)", Math.round(CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO * 0.70), "Fondo de emergencia intocable y líquido en Davivienda (70% del ahorro)"],
      ["Sub-Bolsillo Micro-CDT (20%)", Math.round(CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO * 0.20), "Renta fija a 90/180 días Davivienda o Tyba (20% del ahorro)"],
      ["Sub-Bolsillo Micro-Cripto (10%)", Math.round(CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO * 0.10), "Micro-DCA Bitcoin/USDT en Binance (10% del ahorro)"],
      ["Radar Timing Cripto Binance", "Activo", "Monitoreo 24h Binance + detector de dips y tomas de ganancia"],
      ["Radar Timing CDT Davivienda", "Activo", "Alerta de tasas BanRep y vencimientos para reinversión"],
      ["Última Evaluación Radar", Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, "yyyy-MM-dd HH:mm:ss"), "Timestamp de última evaluación de mercado"]
    ];

    var datosConf = shConfig.getDataRange().getValues();
    var mapa = {};
    for (var i = 1; i < datosConf.length; i++) {
      mapa[datosConf[i][0]] = i + 1;
    }

    params.forEach(function(p) {
      var nom = p[0];
      var val = p[1];
      var desc = p[2];
      var esSaldoDinamico = (nom === "Saldo en Cuenta Bancaria" || nom === "Saldo Bolsillo Ahorro" || nom === "Saldo Bolsillo Obligaciones" || nom === "Saldo Total Banco");
      if (mapa[nom]) {
        if (!esSaldoDinamico || forceResetSaldos) {
          shConfig.getRange(mapa[nom], 2).setValue(val);
        }
      } else {
        shConfig.appendRow([nom, val, desc]);
      }
    });

    // Siempre recalcular Saldo Total Banco en la hoja: Disponible + Bolsillos
    recalcularSaldoTotalBanco();
    shConfig.getRange("B2:B17").setNumberFormat("$#,##0");
  }

  // 2. Sincronizar Hoja Metas (Bolsillo Ahorro Davivienda con $1.561.218 acumulado)
  var shMetas = ss.getSheetByName(CONFIG.HOJA_METAS);
  if (shMetas && shMetas.getLastRow() > 0) {
    var rowsM = shMetas.getDataRange().getValues();
    var tieneBolsillo = false;
    for (var m = 1; m < rowsM.length; m++) {
      var nomM = (rowsM[m][0] || "").toString();
      if (nomM.toLowerCase().indexOf("cajita") !== -1 || (nomM.toLowerCase().indexOf("nu") !== -1 && nomM.toLowerCase().indexOf("rend") !== -1)) {
        shMetas.getRange(m + 1, 1).setValue("Bolsillo Ahorro e Inversión Davivienda");
        shMetas.getRange(m + 1, 3).setValue(CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO);
        tieneBolsillo = true;
      } else if (nomM.toLowerCase().indexOf("bolsillo") !== -1 && nomM.toLowerCase().indexOf("ahorro") !== -1) {
        shMetas.getRange(m + 1, 3).setValue(CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO);
        tieneBolsillo = true;
      }
    }
    if (!tieneBolsillo) {
      shMetas.appendRow(["Bolsillo Ahorro e Inversión Davivienda", 10000000, CONFIG.DEFAULT_SALDO_BOLSILLO_AHORRO, 12, "Activa", new Date()]);
    }
  }

  // 3. Sincronizar Hoja Inversiones y Señales del Radar
  inicializarHojaInversiones(ss);
  actualizarSenalesEnHojaInversiones();

  // 4. Migrar y Normalizar Hoja Transacciones (Columna Tipo: Ingreso / Gasto / Transferencia)
  migrarHojaTransaccionesATipo(ss);
}

// ==========================================
// SISTEMA DE ALERTAS Y RECORDATORIOS PROACTIVOS (8:00 AM)
// ==========================================
function ejecutarRecordatoriosDiarios(forzarEnvio, chatIdOpt, messageIdOpt) {
  var hoy = new Date();
  var diaHoy = hoy.getDate();
  var mesActual = hoy.getMonth();
  var anioActual = hoy.getFullYear();
  var ultimoDiaMes = new Date(anioActual, mesActual + 1, 0).getDate();

  var conf = obtenerConfiguracionActual();
  var chatId = chatIdOpt || CONFIG.TELEGRAM_CHAT_ID;
  var avisos = [];

  // 1. Revisar cada Gasto Fijo programado
  conf.listaFijos.forEach(function(fijo) {
    if (fijo.tipo && fijo.tipo.toLowerCase().indexOf("anual") !== -1) return;

    var diaPago = fijo.diaPago;
    if (diaPago >= 30 && diaHoy >= 28 && diaHoy === ultimoDiaMes) {
      diaPago = ultimoDiaMes;
    }

    var diasFaltantes = diaPago - diaHoy;
    if (diaHoy > 25 && diaPago <= 5) {
      diasFaltantes = (ultimoDiaMes - diaHoy) + diaPago;
    }

    if (diasFaltantes === 3) {
      avisos.push("⏳ *En 3 días (día " + diaPago + "):* Vence *" + fijo.concepto + "* por *$" + formatearCOP(fijo.monto) + " COP* (" + fijo.medio + ").\n   _Protegido en tu Bolsillo de Obligaciones._");
    } else if (diasFaltantes === 1) {
      avisos.push("⚠️ *¡Mañana (día " + diaPago + ")!* Vence *" + fijo.concepto + "* por *$" + formatearCOP(fijo.monto) + " COP* (" + fijo.medio + ").");
    } else if (diasFaltantes === 0) {
      avisos.push("🚨 *¡HOY (día " + diaPago + ")!* Se paga *" + fijo.concepto + "* por *$" + formatearCOP(fijo.monto) + " COP*.\n   _Sale del Bolsillo de Obligaciones sin tocar tu disponible._");
    }
  });

  // 2. Factura Tarjeta Nu (los 11 de cada mes)
  if (conf.deudaTarjetaNu > 0) {
    var diasNu = conf.diasParaPagoTarjeta;
    if (diasNu === 3) {
      avisos.push("🟣 *Factura Tarjeta Nu:* En 3 días (el 11) vence tu factura por ||*$" + formatearCOP(conf.deudaTarjetaNu) + " COP*||. Ya está cubierta en tu Bolsillo de Obligaciones.");
    } else if (diasNu === 1) {
      avisos.push("🟣 *Factura Tarjeta Nu:* ¡Mañana 11 vence tu factura de ||*$" + formatearCOP(conf.deudaTarjetaNu) + " COP*||! Puedes pagarla y registrar con `/pagar_tarjeta`.");
    } else if (diasNu === 0) {
      avisos.push("🟣 *Factura Tarjeta Nu:* ¡Hoy 11 es el pago de tu factura de ||*$" + formatearCOP(conf.deudaTarjetaNu) + " COP*||! Regístralo con `/pagar_tarjeta`.");
    }
  }

  // 3. Nóminas Quincenales (Día 15 y Día 30/Fin de mes)
  if (diaHoy === 14) {
    avisos.push("🏢 *Nómina Quincenal:* ¡Mañana 15 es pago de tu 1ª Quincena (*$1.472.000 COP*)!");
  } else if (diaHoy === 15) {
    avisos.push("🎉 *¡Hoy 15 es pago de Nómina Quincenal!* En cuanto te consignen, usa `/cobro_quincena` para registrar el ingreso y fondear tus bolsillos.");
  } else if (diaHoy === ultimoDiaMes - 1) {
    avisos.push("🏢 *Nómina Quincenal:* ¡Mañana es fin de mes y cobras tu 2ª Quincena (*$1.721.095 COP* con auxilio de transporte)!");
  } else if (diaHoy === ultimoDiaMes) {
    avisos.push("🎉 *¡Hoy es cobro de Nómina Quincenal de fin de mes!* Usa `/cobro_quincena` para registrar el ingreso, completar tu ahorro del 53% ($1.690.866 COP) y debitar el arriendo ($600.000 COP) desde Obligaciones.");
  }

  // 3.5 Revisar Vencimientos de CDTs en Hoja Inversiones
  try {
    var invRegistradas = obtenerInversionesRegistradas();
    if (invRegistradas && invRegistradas.activas && invRegistradas.activas.length > 0) {
      invRegistradas.activas.forEach(function(inv) {
        if (inv.tipo && inv.tipo.toUpperCase() === "CDT" && inv.diasParaVencer !== null && inv.diasParaVencer !== undefined) {
          if (inv.diasParaVencer === 3) {
            avisos.push("🏦 *Vencimiento de CDT en 3 días:* Tu CDT en *" + inv.entidad + "* por *$" + formatearCOP(inv.monto) + " COP* vence el " + inv.fechaVencimiento + ".\n   _Ganancia neta estimada: +$" + formatearCOP(inv.rendimientoEstimado) + " COP._");
          } else if (inv.diasParaVencer === 1) {
            avisos.push("⚠️ *¡Mañana vence tu CDT!* En *" + inv.entidad + "* por *$" + formatearCOP(inv.monto) + " COP*. Revisa en la app si reinviertes o transfieres a tu cuenta.");
          } else if (inv.diasParaVencer === 0) {
            avisos.push("🚨 *¡HOY vence tu CDT en " + inv.entidad + "!* Capital e intereses por ||*$" + formatearCOP(inv.monto + (parseFloat(inv.rendimientoEstimado) || 0)) + " COP*|| se acreditarán a tu cuenta.");
          }
        }
      });
    }
  } catch(eInv) {
    Logger.log("Error revisando vencimientos CDT: " + eInv.toString());
  }

  // 4. Enviar si hay avisos o si se forzó el envío
  if (avisos.length > 0 || forzarEnvio) {
    var diasCiclo = diaHoy <= 15 ? (15 - diaHoy || 1) : (ultimoDiaMes - diaHoy + 15);
    var cupoDiario = Math.max(Math.round(conf.saldoCuenta / diasCiclo), 0);
    var cuerpoAvisos = avisos.length > 0 ? avisos.join("\n\n") : "✨ _No tienes pagos inmediatos en los próximos 3 días._";

    var radarInfo = generarTextoRadarHormiga(conf);

    var pctAhBr = conf.pctAhorroReal || ((conf.saldoBolsilloAhorro / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
    var pctObBr = conf.pctObligacionesReal || ((conf.saldoBolsilloObligaciones / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);
    var pctDiBr = conf.pctDisponibleReal || ((conf.saldoCuenta / (conf.saldoTotalBanco || 1)) * 100).toFixed(1);

    var mensajeBriefing = "☀️ *BRIEFING FINANCIERO MATUTINO*\n" +
                          "📅 " + Utilities.formatDate(hoy, CONFIG.ZONA_HORARIA, "EEEE, dd 'de' MMMM 'de' yyyy") + "\n\n" +
                          "🔔 *Compromisos y Vencimientos Próximos:*\n" +
                          cuerpoAvisos + "\n\n" +
                          "─────────────────────────────\n" +
                          "💰 *Tus Saldos Davivienda Hoy:*\n" +
                          "🛒 *Disponible en Cuenta:* ||*$" + formatearCOP(conf.saldoCuenta) + " COP*|| *(" + pctDiBr + "% actual)*\n" +
                          "🛡️ *Bolsillo Obligaciones:* ||*$" + formatearCOP(conf.saldoBolsilloObligaciones) + " COP*|| *(" + pctObBr + "% actual)*\n" +
                          "💎 *Bolsillo Ahorro Puro:* ||*$" + formatearCOP(conf.saldoBolsilloAhorro) + " COP*|| *(" + pctAhBr + "% actual)*\n" +
                          "💳 *Saldo Total Davivienda:* ||*$" + formatearCOP(conf.saldoTotalBanco) + " COP*|| *(100%)*\n\n" +
                          "─────────────────────────────\n" +
                          radarInfo.texto + "\n\n" +
                          "💡 _Tus gastos fijos salen del Bolsillo de Obligaciones sin comprometer tu disponible de ocio._";

    var inlineKbBriefing = [
      [
        { text: "🏦 Ver Bolsillos", callback_data: "cb:bolsillos" },
        { text: "💳 Ver Saldo", callback_data: "cb:saldo" }
      ],
      [
        { text: "📈 Radar de Inversión", callback_data: "cb:invertir" },
        { text: "🏢 Nómina y Quincena", callback_data: "cb:quincena" }
      ],
      [
        { text: "🐜 Radar Hormiga", callback_data: "cb:radar" }
      ]
    ];
    if (diaHoy === 15 || diaHoy === ultimoDiaMes) {
      inlineKbBriefing.unshift([
        { text: "🎉 Registrar Cobro de Nómina", callback_data: "cb:cobro_quincena" }
      ]);
    }
    if (conf.deudaTarjetaNu > 0 && conf.diasParaPagoTarjeta <= 3) {
      inlineKbBriefing.push([
        { text: "🟣 Pagar Tarjeta Nu (" + formatearCOP(conf.deudaTarjetaNu) + ")", callback_data: "cb:pagar_tarjeta" }
      ]);
    }

    if (messageIdOpt) {
      editarMensajeTelegram(chatId, messageIdOpt, mensajeBriefing, inlineKbBriefing);
    } else {
      sendTelegram(chatId, mensajeBriefing, inlineKbBriefing);
    }
    return mensajeBriefing;
  }
  return null;
}

function configurarTriggersAutomaticos() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      var funcName = triggers[i].getHandlerFunction();
      if (funcName === "ejecutarRecordatoriosDiarios" || funcName === "revisarCorreosBancariosAuto") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    // 1. Trigger diario matutino a las 8:00 AM (Hora Colombia)
    ScriptApp.newTrigger("ejecutarRecordatoriosDiarios")
      .timeBased()
      .atHour(8)
      .everyDays(1)
      .inTimezone(CONFIG.ZONA_HORARIA)
      .create();

    // 2. Registrar comandos en menú de Telegram
    configurarComandosTelegram();

    return { ok: true, mensaje: "Triggers automáticos (Briefing 8 AM) y comandos de Telegram configurados con éxito." };
  } catch (err) {
    Logger.log("Error configurando triggers: " + err.toString());
    return { ok: false, error: err.toString() };
  }
}

// ==========================================
// MÓDULO 1: TECLADO PERSISTENTE Y COMANDOS TELEGRAM
// ==========================================
function obtenerTecladoPrincipalTelegram() {
  return {
    keyboard: [
      [
        { text: "📱 Abrir Dashboard Web", web_app: { url: getUrlWebAppConParametros("view=webapp") } },
        { text: "🗺️ Mapa de Calor", web_app: { url: getUrlWebAppConParametros("view=mapa") } }
      ],
      [{ text: "💳 Mi Saldo" }, { text: "🏦 Bolsillos" }],
      [{ text: "📊 Resumen Mes" }, { text: "🏢 Quincena" }],
      [{ text: "⚖️ Calculadora Cuotas" }, { text: "🐜 Radar Hormiga" }],
      [{ text: "📈 Inversiones" }, { text: "🏆 Cierre de Mes" }],
      [{ text: "☀️ Briefing" }, { text: "🟣 Tarjeta Nu" }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

function configurarComandosTelegram() {
  var token = CONFIG.TELEGRAM_TOKEN;
  var url = "https://api.telegram.org/bot" + token + "/setMyCommands";
  var comandos = [
    { command: "saldo", description: "💳 Ver saldo disponible y bolsillos en tiempo real" },
    { command: "bolsillos", description: "🏦 Estado en tiempo real y reglas Davivienda" },
    { command: "resumen", description: "📊 Resumen mensual de gastos vs presupuesto" },
    { command: "mapa", description: "🗺️ Ver mapa de calor y epicentros de consumo GPS" },
    { command: "quincena", description: "🏢 Calendario de nómina quincenal y compromisos" },
    { command: "traslado", description: "🔄 Trasladar disponible a bolsillo ahorro u obligaciones" },
    { command: "retirar_bolsillo", description: "🔄 Retirar dinero de bolsillo a disponible" },
    { command: "cuotas", description: "⚖️ Simular costo real e intereses de compras a cuotas" },
    { command: "inversiones", description: "📈 Centro de micro-inversiones (CDT y Binance)" },
    { command: "radar", description: "🐜 Radar de gastos hormiga y fugas" },
    { command: "cierre_mes", description: "🏆 Auditoría patrimonial y scorecard de fin de mes" },
    { command: "deuda", description: "🟣 Estado de factura y Tarjeta Nu (los 11)" },
    { command: "menu", description: "🎛️ Activar teclado de botones interactivos" }
  ];
  var payload = { commands: comandos };
  var options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    var res = UrlFetchApp.fetch(url, options);
    Logger.log("Comandos Telegram configurados: " + res.getContentText());
    return JSON.parse(res.getContentText());
  } catch(e) {
    Logger.log("Error configurando comandos en Telegram: " + e.toString());
    return { ok: false, error: e.toString() };
  }
}

// ==========================================
// MÓDULO 2: ALERTA DE DISPONIBLE CRÍTICO (MODO SUPERVIVENCIA)
// ==========================================
function evaluarAlertaDisponibleCritico(nuevoDisponible, conf) {
  conf = conf || obtenerConfiguracionActual();
  var flujo = conf.flujoQuincenal || {};
  var diasParaNomina = flujo.diasParaProximaNomina || 1;
  var cupoDiarioRestante = Math.max(0, Math.round(nuevoDisponible / diasParaNomina));

  // Umbral crítico: menos de $40.000 COP en total O menos de $8.500 COP por día
  if (nuevoDisponible < 40000 || (diasParaNomina > 1 && cupoDiarioRestante < 8500)) {
    var esExtremo = (nuevoDisponible < 20000 || cupoDiarioRestante < 4000);
    var emoji = esExtremo ? "🚨" : "⚠️";
    var titulo = esExtremo ? "*¡ALERTA MÁXIMA DE DISPONIBLE CRÍTICO!*" : "*¡ALERTA PREVENTIVA DE LIQUIDEZ!*";

    var texto = "\n\n" + emoji + " " + titulo + "\n" +
      "Tu saldo disponible en cuenta bajó a ||*$" + formatearCOP(nuevoDisponible) + " COP*||.\n" +
      "📅 Faltan *" + diasParaNomina + " días* para cobrar tu nómina quincenal (" + (flujo.fechaProximaNominaTexto || "fin de quincena") + ").\n" +
      "🛒 Margen de supervivencia diario: *~$" + formatearCOP(cupoDiarioRestante) + " COP/día*.\n\n" +
      "💡 _Consejo CFO: Frena cualquier gasto discrecional u ocio hasta el cobro. Si necesitas liquidez urgente para alimentación o transporte, retira dinero de tus bolsillos:_";

    var inlineKb = [
      [
        { text: "🔄 Retirar $50k de Ahorro", callback_data: "cb:retirar_rapido:ahorro:50000" },
        { text: "🔄 Retirar $50k Obligaciones", callback_data: "cb:retirar_rapido:obligaciones:50000" }
      ]
    ];

    return { alertaActiva: true, texto: texto, inlineKeyboard: inlineKb };
  }

  return { alertaActiva: false, texto: "", inlineKeyboard: null };
}

// ==========================================
// MÓDULO 3: CALCULADORA ANTI-CUOTAS Y FRICCIÓN DE TARJETAS
// ==========================================
function calcularSimulacionCuotas(monto, numeroCuotas, tasaEA) {
  tasaEA = tasaEA || 0.26; // 26% E.A. promedio tarjetas de crédito en Colombia
  numeroCuotas = parseInt(numeroCuotas) || 1;
  monto = parseFloat(monto) || 0;

  if (numeroCuotas <= 1) {
    return {
      monto: monto,
      cuotas: 1,
      tasaEA: tasaEA,
      cuotaMensual: monto,
      totalPagado: monto,
      interesesTotales: 0,
      horasTrabajoPerdidas: 0,
      mensaje: "💳 *PAGO A 1 CUOTA (REGLA DE ORO):*\n" +
               "💵 Monto: *$" + formatearCOP(monto) + " COP*\n" +
               "✨ *Intereses cobrados:* *$0 COP (0.0% interés)*\n" +
               "🛡️ _¡Excelente decisión! Pagando la Tarjeta Nu a 1 cuota construyes un historial crediticio intachable sin pagarle un solo peso en intereses al banco._"
    };
  }

  // Tasa mensual equivalente: i = (1 + EA)^(1/12) - 1
  var tasaMensual = Math.pow(1 + tasaEA, 1 / 12) - 1;
  // Cuota fija con fórmula francesa: C = P * [ i / (1 - (1+i)^-n) ]
  var cuotaMensual = Math.round(monto * (tasaMensual / (1 - Math.pow(1 + tasaMensual, -numeroCuotas))));
  var totalPagado = cuotaMensual * numeroCuotas;
  var interesesTotales = totalPagado - monto;
  var sobrecostoPorcentaje = ((interesesTotales / monto) * 100).toFixed(1);
  var horasTrabajoPerdidas = (interesesTotales / 19957).toFixed(1);
  var diasTrabajoPerdidos = (interesesTotales / 159655).toFixed(1);

  var ahorroPorQuincena = Math.round(monto / 2);

  var msg = "⚖️ *SIMULADOR ANTI-CUOTAS Y FRICCIÓN DE TARJETA*\n\n" +
            "🏷️ *Valor de la compra:* *$" + formatearCOP(monto) + " COP*\n" +
            "💳 *Plazo solicitado:* *" + numeroCuotas + " cuotas mensuales*\n" +
            "📈 *Tasa de interés bancaria:* ~*" + (tasaEA * 100).toFixed(1) + "% E.A.* (~" + (tasaMensual * 100).toFixed(2) + "% mes vencido)\n\n" +
            "📊 *RADIOGRAFÍA DEL CRÉDITO:*\n" +
            "• Cuota mensual a pagar: *$" + formatearCOP(cuotaMensual) + " COP/mes*\n" +
            "• Total que terminarás pagando: ||*$" + formatearCOP(totalPagado) + " COP*||\n" +
            "💸 *DINERO REGALADO EN INTERESES:* ||*$" + formatearCOP(interesesTotales) + " COP*|| (*+" + sobrecostoPorcentaje + "%* de sobrecosto)\n\n" +
            "⏳ *IMPACTO EN HORAS DE TRABAJO:*\n" +
            "• Trabajarías *" + horasTrabajoPerdidas + " horas* (~*" + diasTrabajoPerdidos + " jornadas de 8h*) ÚNICAMENTE para pagarle intereses al banco.\n\n" +
            "💡 *LA ALTERNATIVA INTELIGENTE DEL CFO:*\n" +
            "Si en lugar de endeudarte separas *$" + formatearCOP(ahorroPorQuincena) + " COP* en las próximas *2 quincenas* en tu Bolsillo Ahorro:\n" +
            "👉 Te compras el producto de contado a 1 cuota en Nu, pagas *$0 COP de interés* y conservas tus ||*$" + formatearCOP(interesesTotales) + " COP*|| en tu bolsillo.";

  return {
    monto: monto,
    cuotas: numeroCuotas,
    cuotaMensual: cuotaMensual,
    totalPagado: totalPagado,
    interesesTotales: interesesTotales,
    horasTrabajoPerdidas: horasTrabajoPerdidas,
    mensaje: msg
  };
}


// ==========================================
// MÓDULO 5: SCORECARD Y AUDITORÍA DE CIERRE DE MES
// ==========================================
function generarReporteCierreMes(conf) {
  conf = conf || obtenerConfiguracionActual();
  var resumen = obtenerResumenMesActual();
  var radar = analizarGastosHormigaYDesviacion(conf);

  var hoy = new Date();
  var meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var nombreMes = meses[hoy.getMonth()] + " de " + hoy.getFullYear();

  var ahorroAportado = conf.saldoBolsilloAhorro;
  var metaAhorro = conf.metaAhorroMensual || 1690866;
  var pctAhorroCumplido = metaAhorro > 0 ? ((ahorroAportado / metaAhorro) * 100).toFixed(1) : "100";

  var presupuestoVar = conf.presupuestoVariable || 638619;
  var gastoVariableReal = resumen.totalVariable || 0;
  var excedenteOcio = presupuestoVar - gastoVariableReal;
  var pctPresupuestoUsado = presupuestoVar > 0 ? ((gastoVariableReal / presupuestoVar) * 100).toFixed(1) : "0";

  // Score y Calificación
  var score = 100;
  var medalla = "🌟";
  var calificacion = "A+ (Financieramente Impecable)";

  if (gastoVariableReal > presupuestoVar) {
    score -= 25;
    medalla = "🟡";
    calificacion = "B (Exceso de Gasto en Ocio)";
  }
  if (ahorroAportado < metaAhorro * 0.8) {
    score -= 30;
    medalla = "🔴";
    calificacion = "C (Meta de Ahorro No Cumplida)";
  }
  if (score >= 90) {
    medalla = "🏆";
    calificacion = "A+ (Maestría Financiera)";
  } else if (score >= 75) {
    medalla = "🟢";
    calificacion = "A (Muy Buen Manejo)";
  }

  var conteoHormigas = radar.conteoHormiga || 0;
  var horasTrabajoHormiga = ((radar.totalHormiga || 0) / 19957).toFixed(1);

  var barraAhorro = generarBarraProgreso(Math.min(parseFloat(pctAhorroCumplido), 100));
  var barraOcio = generarBarraProgreso(Math.min(parseFloat(pctPresupuestoUsado), 100));

  var msg = "🏆 *SCORECARD Y AUDITORÍA PATRIMONIAL DE FIN DE MES*\n" +
            "📅 *Mes auditado:* " + nombreMes + "\n" +
            "👤 *Titular:* Usuario | Empresa: Empresa S.A.S.\n" +
            "🎖️ *Calificación:* " + medalla + " *" + calificacion + "* (" + score + "/100 pts)\n\n" +
            "─────────────────────────────\n" +
            "💎 *1. CUMPLIMIENTO DEL AHORRO (META: 53%):*\n" +
            barraAhorro + " *" + pctAhorroCumplido + "%*\n" +
            "• Acumulado: ||*$" + formatearCOP(ahorroAportado) + " COP*|| de *$" + formatearCOP(metaAhorro) + "*\n\n" +
            "🛡️ *2. OBLIGACIONES Y COMPROMISOS (META: 27%):*\n" +
            "• Compromisos fijos cubiertos: *$" + formatearCOP(conf.gastosFijosTotal) + " COP*\n" +
            "• Arriendo del 30 ($600.000): Cubierto por Obligaciones\n" +
            "• Tarjeta Nu: Pagada a 1 cuota (0% interés)\n\n" +
            "🛒 *3. GASTOS VARIABLES Y OCIO (PRESUPUESTO: 20%):*\n" +
            barraOcio + " *" + pctPresupuestoUsado + "%*\n" +
            "• Ejecutado: *$" + formatearCOP(gastoVariableReal) + " COP* de *$" + formatearCOP(presupuestoVar) + "*\n" +
            "• Balance: *" + (excedenteOcio >= 0 ? "+$" + formatearCOP(excedenteOcio) + " COP a favor 🟢" : "-$" + formatearCOP(Math.abs(excedenteOcio)) + " COP en sobregiro 🔴") + "*\n\n" +
            "🐜 *4. RADAR HORMIGA Y TIEMPO DE VIDA:*\n" +
            "• Fugas detectadas: *$" + formatearCOP(radar.totalHormiga) + " COP* (" + conteoHormigas + " compras, ~" + horasTrabajoHormiga + "h de trabajo)\n\n" +
            "─────────────────────────────\n" +
            "💰 *PATRIMONIO TOTAL DAVIVIENDA:* ||*$" + formatearCOP(conf.saldoTotalBanco) + " COP*||\n" +
            "✨ _Ahorro " + conf.pctAhorroReal + "% • Obligaciones " + conf.pctObligacionesReal + "% • Disponible " + conf.pctDisponibleReal + "%_\n\n" +
            "> 🎯 *VEREDICTO DEL CFO:* " +
            (score >= 85 ? "¡Mes extraordinario! Protegiste tu capital, mantuviste tus bolsillos intactos y el 53% de ahorro está blindando tu libertad financiera." : "Mes superado. Cuidar más las compras hormiga el próximo mes para que tu disponible libre crezca.");

  return msg;
}

// ==========================================
// REGISTRO DE WEBHOOK TELEGRAM
function registrarWebhookTelegram() {
  var webAppUrl = (CONFIG.WEB_APP_URL && CONFIG.WEB_APP_URL.indexOf("TU_DEPLOYMENT_ID") === -1)
    ? CONFIG.WEB_APP_URL.split("?")[0] 
    : "https://script.google.com/macros/s/AKfycbxjz1Y8xXd5vv6D3PuNxw16LI3UQByPnb_m3pCoDw9FTacTz7QVTmHmtUXQCaWT8qQ1LA/exec";
  var token = CONFIG.TELEGRAM_TOKEN;
  var url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + encodeURIComponent(webAppUrl);
  var res = UrlFetchApp.fetch(url);
  Logger.log("Resultado de registro de Webhook Telegram: " + res.getContentText());
  configurarComandosTelegram();
}

// ==========================================
// UTILIDADES
// ==========================================
function formatearCOP(monto) {
  if (isNaN(monto)) return "0";
  return Math.round(monto).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
