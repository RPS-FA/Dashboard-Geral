// ============================================================
// Adaptador PlannerCork · VOCUS — GET /api/store/planeamento_vocus_v6 -> {data:[...], etag, meta}
// ATENÇÃO: /api/ops?tipo=vocus está DESACTUALIZADO (último _ts Jul/2026, sem Vocus 3, sem as OPs em curso).
// O que a app mostra (quadro e Monitor) vem do blob "planeamento_vocus_v6" — é esse que lemos.
// Plano = início/fim PROGRAMADOS pelo PlannerCork: cadeia contínua por máquina (weekKey + sortIdx, rate × OEE,
// paragens, turnos reduzidos, setup, início manual) — porte fiel em vocus_plano.js, validado contra a app (329/329 iguais, 28/10/2026).
// Settings da app: /api/store/planeamento_vocus_settings_v1. Sem settings (falha) usa os defaults da app.
// dlim = data limite (cliente); dlog = data prevista de entrega à logística.
// realStart/realEnd = 'YYYY-MM-DDTHH:mm' (hora local). qc = quantidade cliente; qds = quantidade DS; qreal = real.
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');
const P = require('./vocus_plano');

const MAQUINAS_DEFEITO = ['Vocus 1', 'Vocus 2', 'Vocus 3'];

function filaIdx(wk, sortIdx) {
  const m = /(\d{4})-W(\d{1,2})/.exec(wk || '');
  const base = m ? ((+m[1]) * 100 + (+m[2])) : 999999;
  return base * 1000 + (U.num(sortIdx) || 0);
}

async function carregar(fonte, http) {
  const r = await http(fonte.url + '/api/store/planeamento_vocus_v6');
  const ops = Array.isArray(r.data) ? r.data : (Array.isArray(r.ops) ? r.ops : []);
  let settings = null, settingsErro = null;
  try { const s = await http(fonte.url + '/api/store/planeamento_vocus_settings_v1'); settings = (s && s.data && typeof s.data === 'object') ? s.data : null; }
  catch (e) { settingsErro = e.message; }
  const plano = P.calcularPlano(ops, settings); // id -> {start, end} (Date locais, TZ=Europe/Lisbon)
  const maquinas = [...MAQUINAS_DEFEITO];
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of ops) {
    try {
      const wk = o.weekKey || null;
      const kanban = String(o.maquina || '').toUpperCase() === 'KANBAN';
      if (o.maquina && !kanban && !maquinas.includes(o.maquina)) maquinas.push(o.maquina);
      const reproc = U.num(o.reprocessoC5);
      const pl = plano.get(o.id) || null;
      let estado = E.normalizar(o.estado);
      if (kanban && !E.terminal(estado)) estado = 'pre';
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: U.limpa(o.op), ref: U.limpa(o.operacao), pedido: U.limpa(o.po),
        cliente: U.limpa(o.cliente), produto: U.limpa(o.desc), calibre: '',
        qtd: U.num(o.qc) || U.num(o.qds),
        maquina: kanban ? null : (U.limpa(o.maquina) || null), fase: U.limpa(o.operacao) || null,
        fila: filaIdx(wk, o.sortIdx),
        estado, estado_origem: U.limpa(o.estado) + (kanban ? ' (KANBAN)' : ''), estado_derivado: false,
        data_plano: pl ? P.dataLocal(pl.start) : null, data_fim_plano: pl ? P.dataLocal(pl.end) : null,
        semana_plano: wk, plano_granularidade: pl ? 'dia' : 'fila', plano_fila: true,
        hora_plano_ini: pl ? P.horaLocal(pl.start) : null, hora_plano_fim: pl ? P.horaLocal(pl.end) : null,
        plano_manual: !!(pl && pl.manual),
        data_limite: U.paraData(o.dlim), data_log: U.paraData(o.dlog),
        real_inicio: U.isoParaLocal(o.realStart), real_fim: U.isoParaLocal(o.realEnd),
        atraso_prod_min: 0, motivo_paragem: '',
        urgente: false, manutencao: false,
        obs: U.limpa([o.obs, reproc ? `reprocesso C5 ${U.num(reproc)} un.` : '', o.qreal ? `real ${o.qreal} un.` : '', pl && pl.manual ? 'início manual' : '', settingsErro ? 'plano com settings por defeito (settings da app indisponíveis)' : ''].filter(Boolean).join(' · ')),
        atualizado: o._ts || null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: (r.meta && r.meta.updatedAt) || null, granularidade: 'dia',
    bruto: { ops, settings } }; // bruto: entrada do motor (settings null = defaults da app)
}

module.exports = { carregar };
