// ============================================================
// Adaptador PlannerCork · VOCUS — GET /api/store/planeamento_vocus_v6 -> {data:[...], etag, meta}
// ATENÇÃO: /api/ops?tipo=vocus está DESACTUALIZADO (último _ts Jul/2026, sem Vocus 3, sem as OPs em curso).
// O que a app mostra (quadro e Monitor) vem do blob "planeamento_vocus_v6" — é esse que lemos.
// Plano = FILA por máquina (weekKey = semana em que foi colocada + sortIdx); não há dia planeado.
// dlim = data limite (cliente); dlog = data prevista de entrega à logística.
// realStart/realEnd = 'YYYY-MM-DDTHH:mm' (hora local). qc = quantidade cliente; qds = quantidade DS; qreal = real.
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

const MAQUINAS_DEFEITO = ['Vocus 1', 'Vocus 2', 'Vocus 3'];

function filaIdx(wk, sortIdx) {
  const m = /(\d{4})-W(\d{1,2})/.exec(wk || '');
  const base = m ? ((+m[1]) * 100 + (+m[2])) : 999999;
  return base * 1000 + (U.num(sortIdx) || 0);
}

async function carregar(fonte, http) {
  const r = await http(fonte.url + '/api/store/planeamento_vocus_v6');
  const ops = Array.isArray(r.data) ? r.data : (Array.isArray(r.ops) ? r.ops : []);
  const maquinas = [...MAQUINAS_DEFEITO];
  const out = [];
  for (const o of ops) {
    const wk = o.weekKey || null;
    if (o.maquina && !maquinas.includes(o.maquina)) maquinas.push(o.maquina);
    const reproc = U.num(o.reprocessoC5);
    out.push({
      fonte: fonte.id, unidade: fonte.unidade,
      id: `${fonte.id}-${o.id}`,
      op: U.limpa(o.op), ref: U.limpa(o.operacao), pedido: U.limpa(o.po),
      cliente: U.limpa(o.cliente), produto: U.limpa(o.desc), calibre: '',
      qtd: U.num(o.qc) || U.num(o.qds),
      maquina: U.limpa(o.maquina) || null, fase: U.limpa(o.operacao) || null,
      fila: filaIdx(wk, o.sortIdx),
      estado: E.normalizar(o.estado), estado_origem: U.limpa(o.estado), estado_derivado: false,
      data_plano: null, data_fim_plano: null,
      semana_plano: wk, plano_granularidade: 'fila',
      hora_plano_ini: null, hora_plano_fim: null,
      data_limite: U.paraData(o.dlim), data_log: U.paraData(o.dlog),
      real_inicio: U.isoParaLocal(o.realStart), real_fim: U.isoParaLocal(o.realEnd),
      atraso_prod_min: 0, motivo_paragem: '',
      urgente: false, manutencao: false,
      obs: U.limpa([o.obs, reproc ? `reprocesso C5 ${U.num(reproc)} un.` : '', o.qreal ? `real ${o.qreal} un.` : ''].filter(Boolean).join(' · ')),
      atualizado: o._ts || null,
      link: fonte.url,
    });
  }
  return { ordens: out, maquinas, ts: (r.meta && r.meta.updatedAt) || null, granularidade: 'fila' };
}

module.exports = { carregar };
