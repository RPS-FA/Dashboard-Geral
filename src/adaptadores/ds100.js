// ============================================================
// Adaptador PlannerCork · DS100 (análise sensorial) — GET /api/store/planeamento_ds100_v3 -> {data:[...], etag, meta}
// Lemos o blob (é o que a app renderiza). /api/ops/ds100 existe e é actualizado ao mesmo tempo, mas mantém
// estado "KANBAN" em 63 ordens que no blob já estão "Aberto" com máquina e semana atribuídas.
// Plano por semana ISO (weekKey) + ordem (sortIdx); maquina = DS100 | CSP2 (análise feita no CSP2) | KANBAN.
// Ignora slots "VAZIO".
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

const MAQUINAS_DEFEITO = ['DS100', 'CSP2'];

async function carregar(fonte, http) {
  const r = await http(fonte.url + '/api/store/planeamento_ds100_v3');
  const ops = Array.isArray(r.data) ? r.data : (Array.isArray(r.ops) ? r.ops : []);
  const maquinas = [...MAQUINAS_DEFEITO];
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of ops) {
    try {
      const opc = U.limpa(o.op || o.op_code);
      if (o.isVazio || o.is_vazio || opc.toUpperCase() === 'VAZIO' || U.limpa(o.alias).toUpperCase() === 'VAZIO') continue;
      const wk = o.weekKey || o.week_key || null;
      const maq = U.limpa(o.maquina);
      const kanban = maq.toUpperCase() === 'KANBAN' || !maq;
      let estado = E.normalizar(o.estado);
      if (kanban) estado = 'pre';
      else if (estado === 'pre' && wk) estado = 'aberto'; // "KANBAN" legado com máquina+semana atribuídas
      if (!kanban && !maquinas.includes(maq)) maquinas.push(maq);
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: opc, ref: U.limpa(o.analise), pedido: U.limpa(o.pedido),
        cliente: U.limpa(o.alias), produto: U.limpa(o.produto), calibre: '',
        qtd: U.num(o.qtEntrada ?? o.qt_entrada) || U.num(o.qtEncomenda ?? o.qt_encomenda),
        maquina: kanban ? null : maq, fase: U.limpa(o.linha) ? `pos. ${U.limpa(o.linha)}` : null,
        fila: U.num(o.sortIdx ?? o.sort_idx),
        estado, estado_origem: U.limpa(o.estado) + (kanban ? '' : ''), estado_derivado: false,
        data_plano: wk ? U.segundaDaSemana(wk) : null,
        data_fim_plano: wk ? U.domingoDaSemana(wk) : null,
        semana_plano: wk, plano_granularidade: 'semana',
        hora_plano_ini: null, hora_plano_fim: null,
        data_limite: U.paraData(o.dlim), data_log: U.paraData(o.dlog),
        real_inicio: null, real_fim: null,
        atraso_prod_min: 0, motivo_paragem: '',
        urgente: false, manutencao: false,
        obs: U.limpa([o.obs, o.destino, o.frascos ? `${o.frascos} frascos` : '', o.provadores ? `${o.provadores} provadores` : ''].filter(Boolean).join(' · ')),
        atualizado: o.updated_at || null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: (r.meta && r.meta.updatedAt) || null, granularidade: 'semana' };
}

module.exports = { carregar };
