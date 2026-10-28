// ============================================================
// Dashboard Geral — Cork Supply CSP1
// Agrega as apps de planeamento (WIM, VOCUS, DS100, PureCork, Densidades, DSL, DSL Talis)
// e serve um dashboard de leitura: em curso, estado das ordens, atrasos.
//   GET /                 — dashboard (public/index.html)
//   GET /api/resumo       — indicadores + ordens enriquecidas (JSON)
//   GET /api/resumo?so=kpi — só indicadores (sem a lista de ordens)
//   GET /api/procurar?q=… — pesquisa global (todas as unidades, activas e fechadas)
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
