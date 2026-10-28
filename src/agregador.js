// ============================================================
// Agregador — lê as fontes em paralelo a cada REFRESH_SEC segundos,
// guarda a última leitura boa de cada fonte e calcula os indicadores.
// Só faz GET às apps; nunca escreve.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { FONTES } = require('./fontes');
const E = require('./estados');
const U = require('./util');
const I = require('./indicadores');

const ADAPTADORES = {
  wim: require('./adaptadores/wim'),
  vocus: require('./adaptadores/vocus'),
  ds100: require('./adaptadores/ds100'),
  purecork: require('./adaptadores/purecork'),
  densidades: require('./adaptadores/densidades'),
  dsl: require('./adaptadores/dsl'),
  talis: require('./adaptadores/talis'),
};

const REFRESH_SEC = Math.max(20, parseInt(process.env.REFRESH_SEC || '60', 10) || 60);
const TIMEOUT_MS = Math.max(3000, parseInt(process.env.TIMEOUT_MS || '12000', 10) || 12000);
const FIXTURES_DIR = process.env.FIXTURES_DIR || ''; // modo de teste: lê JSON locais em vez das apps
const LIMIARES = I.limiares(process.env);           // ALERTA_PROCESSO_H, ALERTA_PROCESSO_H_FILA, ALERTA_FIM_REGISTADO_H, ALERTA_PLANO_DIAS, ALERTA_JOB_DIAS

// Estado em memória por fonte
const cache = {}; // id -> { ordens:[], ok, erro, ultima_ok, ultima_tentativa, ms, n, ts_fonte }
let ultimaAgregacao = null;
let aCorrer = false;

async function httpJson(url) {
  if (FIXTURES_DIR) {
    const nome = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_') + '.json';
    const f = path.join(FIXTURES_DIR, nome);
    if (!fs.existsSync(f)) throw new Error('fixture em falta: ' + nome);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'dashboard-ops/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    // Mensagem útil nos logs do Railway: causa de rede (ENOTFOUND, ECONNREFUSED, …) ou timeout
    if (e && e.name === 'AbortError') throw new Error(`timeout ${Math.round(TIMEOUT_MS / 1000)} s`);
    const causa = e && e.cause ? (e.cause.code || e.cause.message) : '';
    throw new Error(causa ? `${e.message} (${causa})` : (e && e.message) || String(e));
  } finally { clearTimeout(t); }
}

async function lerFonte(fonte) {
  const t0 = Date.now();
  const c = cache[fonte.id] || (cache[fonte.id] = { ordens: [], ok: false, erro: null, ultima_ok: null, ultima_tentativa: null, ms: 0, n: 0, ts_fonte: null });
  c.ultima_tentativa = new Date().toISOString();
  try {
    const r = await ADAPTADORES[fonte.adaptador].carregar(fonte, httpJson);
    c.ordens = r.ordens; c.maquinas = r.maquinas || []; c.granularidade = r.granularidade || 'dia';
    c.ok = true; c.erro = null; c.ultima_ok = c.ultima_tentativa; c.n = r.ordens.length; c.ts_fonte = r.ts || null;
    c.registos_erro = Array.isArray(r.erros_registos) ? r.erros_registos.slice(0, 20) : [];
    if (c.registos_erro.length) console.warn(`[agregador] ${fonte.id}: ${c.registos_erro.length} registo(s) ignorado(s) por dados inesperados — ${c.registos_erro.slice(0, 3).join(' | ')}`);
  } catch (e) {
    c.ok = false; c.erro = (e && e.message) || String(e);
    console.warn(`[agregador] ${fonte.id}: ${c.erro}`);
  }
  c.ms = Date.now() - t0;
  return c;
}

async function actualizar() {
  if (aCorrer) return;
  aCorrer = true;
  try {
    await Promise.all(FONTES.map(lerFonte));
    ultimaAgregacao = new Date().toISOString();
  } finally { aCorrer = false; }
}

// ------------------------------------------------------------
// Resumo (indicadores em src/indicadores.js)
// ------------------------------------------------------------
function resumo() {
  const agora = new Date();
  const hoje = U.hoje();
  const semana = U.semanaISO(hoje);
  const limite7 = U.addDias(hoje, -7);
  const total = I.vazio();
  const unidades = [];
  const ordens = [];
  let maqTotal = 0, maqEmProcesso = 0;
  for (const f of FONTES) {
    const c = cache[f.id] || { ordens: [], maquinas: [], granularidade: 'dia', ok: false, erro: 'ainda não lido', ultima_ok: null, ultima_tentativa: null, ms: 0, n: 0 };
    const r = I.calcular(c.ordens, hoje, semana, limite7, { agora, maquinas: c.maquinas, granularidade: c.granularidade });
    for (const d of r.ordens) { I.somar(total, d); if (!d.fase_futura) ordens.push(d); }
    maqTotal += r.maquinas.length; maqEmProcesso += r.maquinas.filter(m => m.estado === 'em_processo').length;
    unidades.push({
      id: f.id, unidade: f.unidade, nome: f.nome, url: f.url,
      fonte: { ok: c.ok, erro: c.erro, ultima_ok: c.ultima_ok, ultima_tentativa: c.ultima_tentativa, ms: c.ms, n: c.n, ts_fonte: c.ts_fonte, idade_min: c.ultima_ok ? Math.round((Date.now() - new Date(c.ultima_ok)) / 60000) : null, registos_ignorados: (c.registos_erro || []).length, registos_erro: c.registos_erro || [] },
      kpi: r.kpi,
      em_curso: r.em_curso.slice(0, 12),
      maquinas: r.maquinas,
      estado_derivado: f.id === 'purecork',
      granularidade: c.granularidade || 'dia',
    });
  }
  const fontesOk = unidades.filter(u => u.fonte.ok).length;
  const alertas = I.alertas(ordens, unidades, hoje, agora, LIMIARES);
  for (const u of unidades) u.alertas_n = alertas.grupos.reduce((s, g) => s + g.itens.filter(a => a.unidade === u.unidade).length, 0);
  // OPs por abrir: ordens activas sem número de OP (8 dígitos), as de plano mais próximo primeiro (sem data no fim)
  const opsPorAbrir = ordens.filter(o => o.sem_op).sort((a, b) => ((a.dias_plano ?? 1e9) - (b.dias_plano ?? 1e9)) || a.unidade.localeCompare(b.unidade) || ((a.fila ?? 1e9) - (b.fila ?? 1e9)));
  return {
    gerado: agora.toISOString(), hoje, semana, refresh_seg: REFRESH_SEC, ultima_agregacao: ultimaAgregacao,
    fontes_ok: fontesOk, fontes_total: unidades.length,
    maquinas_total: maqTotal, maquinas_em_processo: maqEmProcesso,
    total, unidades, alertas, ops_por_abrir: opsPorAbrir,
    estados: E.LABEL,
    ordens: ordens.sort((a, b) => (b.atraso_prazo_dias - a.atraso_prazo_dias) || (b.atraso_plano_dias - a.atraso_plano_dias) || Number(b.em_curso) - Number(a.em_curso) || String(a.data_plano || '9999').localeCompare(String(b.data_plano || '9999'))),
  };
}

function iniciar() {
  actualizar().catch(e => console.error('[agregador] falha inicial:', e.message));
  setInterval(() => actualizar().catch(e => console.error('[agregador]', e.message)), REFRESH_SEC * 1000);
}

module.exports = { iniciar, actualizar, resumo, REFRESH_SEC, FONTES };
