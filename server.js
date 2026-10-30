// ============================================================
// Dashboard Geral — Cork Supply CSP1
// Agrega as apps de planeamento (WIM, VOCUS, DS100, PureCork, Densidades, DSL, DSL Talis)
// e serve um dashboard de leitura: em curso, estado das ordens, atrasos.
//   GET /                 — dashboard (public/index.html)
//   GET /api/resumo       — indicadores + ordens enriquecidas (JSON)
//   GET /api/resumo?so=kpi — só indicadores (sem a lista de ordens)
//   GET /api/procurar?q=… — pesquisa global (todas as unidades, activas e fechadas)
//   GET  /api/encomendas   — encomendas (Encomendas.xlsx carregado) cruzadas com as ordens dos planeamentos
//   POST /api/encomendas   — carrega as linhas do Encomendas.xlsx (JSON, lido no browser); UPLOAD_TOKEN opcional
//   GET  /api/sim/maquinas — máquinas/linhas simuláveis por unidade
//   GET  /api/sim/procurar?q=… — ordens simuláveis (6 unidades com motor portado; PureCork fora)
//   POST /api/sim          — simula um cenário {alteracoes:[…]} com os motores portados (nunca escreve nas apps)
//   POST /api/refresh     — força nova leitura das fontes
//   GET /health
// Só faz GET às apps de origem. Não tem base de dados.
// ============================================================
'use strict';
process.env.TZ = 'Europe/Lisbon'; // o plano VOCUS usa Date local (porte do PlannerCork); o Railway corre em UTC
const express = require('express');
const compression = require('compression');
const path = require('path');
const agregador = require('./src/agregador');
const encomendas = require('./src/encomendas');
const simulador = require('./src/simulador');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  else if (req.path === '/' || req.path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
});

app.get('/api/resumo', (req, res) => {
  try {
    const r = agregador.resumo();
    if (req.query.so === 'kpi') delete r.ordens;
    res.json(r);
  } catch (e) { console.error('[api] resumo', e); res.status(500).json({ ok: false, error: e.message }); }
});
// Pesquisa global: GET /api/procurar?q=LT02386299  -> ordens de TODAS as unidades (activas e fechadas) que contêm todas as palavras
app.get('/api/procurar', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ q, n: 0, resultados: [] });
    const U = require('./src/util');
    const r = agregador.resumo();
    const resultados = r.ordens.filter(o => U.corresponde(U.textoPesquisa(o), q)).slice(0, 200);
    res.json({ q, hoje: r.hoje, n: resultados.length, resultados });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// Barras dos motores (Gantt). Se um motor falhar, o rastreio continua com as datas das apps.
function barrasSeguras() {
  try { return simulador.barrasPorOrdem(agregador.brutos()); }
  catch (e) { console.error('[simulador] barras', e); return null; }
}
// Simulador de cenários — corre os motores portados sobre CÓPIAS dos dados lidos. Nunca escreve nas apps.
app.get('/api/sim/maquinas', (_req, res) => {
  try { res.json({ fontes: simulador.maquinas(agregador.brutos()) }); }
  catch (e) { console.error('[api] sim/maquinas', e); res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/sim/procurar', (req, res) => {
  try {
    const r = agregador.resumo();
    const q = String(req.query.q || '').trim();
    res.json({ q, resultados: simulador.procurar(q, { brutos: agregador.brutos(), ordens: r.ordens }, { id: req.query.id ? String(req.query.id) : null, fonte: req.query.fonte ? String(req.query.fonte) : null }) });
  } catch (e) { console.error('[api] sim/procurar', e); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/sim', express.json({ limit: '200kb' }), (req, res) => {
  try {
    const r = agregador.resumo();
    const enc = encomendas.cruzar(r.ordens, r.hoje, { barras: barrasSeguras() });
    const t0 = Date.now();
    const out = simulador.simular((req.body || {}).alteracoes, { brutos: agregador.brutos(), ordens: r.ordens, encomendas: enc, hoje: r.hoje });
    out.ms = Date.now() - t0;
    res.json({ ok: true, hoje: r.hoje, ...out });
  } catch (e) { console.error('[api] sim', e); res.status(500).json({ ok: false, error: e.message }); }
});
// Encomendas (rastreio por Pedido_Item)
app.get('/api/encomendas', (_req, res) => {
  try {
    const r = agregador.resumo();
    const x = encomendas.cruzar(r.ordens, r.hoje, { barras: barrasSeguras() });
    if (!x) return res.json({ carregado: false, mensagem: 'Ainda não foi carregado nenhum Encomendas.xlsx', upload_protegido: !!process.env.UPLOAD_TOKEN });
    res.json({ carregado: true, upload_protegido: !!process.env.UPLOAD_TOKEN, ...x });
  } catch (e) { console.error('[api] encomendas', e); res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/encomendas', express.json({ limit: '15mb' }), (req, res) => {
  try {
    const tok = process.env.UPLOAD_TOKEN;
    if (tok && req.get('x-upload-token') !== tok) return res.status(401).json({ ok: false, error: 'código de carregamento inválido' });
    const dados = encomendas.validar(req.body);
    const st = encomendas.guardar(dados, req.get('x-upload-por') || '');
    console.log(`[encomendas] carregado ${st.ficheiro}: ${st.linhas.length} Pedido_Item (persistido: ${st.persistido})`);
    res.json({ ok: true, n: st.linhas.length, carregado_em: st.carregado_em, persistido: st.persistido, erro_persistencia: st.erro_persistencia || null });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/refresh', async (_req, res) => {
  try { await agregador.actualizar(); res.json({ ok: true, ultima_agregacao: agregador.resumo().ultima_agregacao }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/health', (_req, res) => {
  const r = agregador.resumo();
  res.json({ status: 'ok', service: 'dashboard-geral', fontes_ok: r.fontes_ok, fontes_total: r.fontes_total, ultima_agregacao: r.ultima_agregacao, ts: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'] }));
app.get('*', (req, res, next) => { if (req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });

agregador.iniciar();
app.listen(PORT, () => console.log(`[dashboard-geral] A servir na porta ${PORT} · refresh ${agregador.REFRESH_SEC}s · ${agregador.FONTES.length} fontes`));
