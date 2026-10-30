// ============================================================
// Adaptador PlannerCork · DS100 (análise sensorial) — GET /api/store/planeamento_ds100_v3 -> {data:[...], etag, meta}
// Lemos o blob (é o que a app renderiza). /api/ops/ds100 existe e é actualizado ao mesmo tempo, mas mantém
// estado "KANBAN" em 63 ordens que no blob já estão "Aberto" com máquina e semana atribuídas.
// Plano = 1.º dia com frascos nas colunas 2.ªF…SAB do separador DS100 do PlannerCork (mesmo planeamento do CRU):
// porte fiel da alocação diária da app em ds100_plano.js (frascos = qtEntrada / rolhas por frasco; capacidade diária por
// semana de settings.ds100CapsByWeek / ds100DailyTarget; enche pela ordem sortIdx; transborda para a semana seguinte).
// Validado contra a app: 423/423 ordens com 1.º e último dia iguais (29/10/2026). Settings: /api/store/planeamento_vocus_settings_v1.
// maquina = DS100 | CSP2 (análise feita no CSP2) | KANBAN. Slots "VAZIO" entram no cálculo (ocupam capacidade) mas não no ecrã.
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');
const P = require('./ds100_plano');

const MAQUINAS_DEFEITO = ['DS100', 'CSP2'];

async function carregar(fonte, http) {
  const r = await http(fonte.url + '/api/store/planeamento_ds100_v3');
  const ops = Array.isArray(r.data) ? r.data : (Array.isArray(r.ops) ? r.ops : []);
  let settings = null, settingsErro = null;
  try { const st = await http(fonte.url + '/api/store/planeamento_vocus_settings_v1'); settings = (st && st.data && typeof st.data === 'object') ? st.data : null; }
  catch (e) { settingsErro = e.message; }
  const plano = P.calcularPlano(ops, settings); // id -> {inicio, fim, frascos, colocados, porDia}
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
      const pl = kanban ? null : (plano.get(o.id) || null);
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: opc, ref: U.limpa(o.analise), pedido: U.limpa(o.pedido),
        cliente: U.limpa(o.alias), produto: U.limpa(o.produto), calibre: '',
        qtd: U.num(o.qtEntrada ?? o.qt_entrada) || U.num(o.qtEncomenda ?? o.qt_encomenda),
        maquina: kanban ? null : maq, fase: U.limpa(o.linha) ? `pos. ${U.limpa(o.linha)}` : null,
        fila: U.num(o.sortIdx ?? o.sort_idx),
        estado, estado_origem: U.limpa(o.estado) + (kanban ? '' : ''), estado_derivado: false,
        // com alocação: 1.º/último dia com frascos (como o separador DS100); sem (KANBAN): semana, como antes
        data_plano: pl && pl.inicio ? P.dataLocal(pl.inicio) : (wk ? U.segundaDaSemana(wk) : null),
        data_fim_plano: pl && pl.fim ? P.dataLocal(pl.fim) : (wk ? U.domingoDaSemana(wk) : null),
        semana_plano: wk, plano_granularidade: pl && pl.inicio ? 'dia' : 'semana', plano_ds100: !!pl,
        hora_plano_ini: null, hora_plano_fim: null,
        data_limite: U.paraData(o.dlim), data_log: U.paraData(o.dlog),
        real_inicio: null, real_fim: null,
        atraso_prod_min: 0, motivo_paragem: '',
        urgente: false, manutencao: false,
        obs: U.limpa([o.obs, o.destino, pl ? `${pl.frascos} frascos` : (o.frascos ? `${o.frascos} frascos` : ''), pl && pl.colocados < pl.frascos ? `${pl.frascos - pl.colocados} frascos sem capacidade no horizonte` : '', o.provadores ? `${o.provadores} provadores` : '', settingsErro ? 'plano com capacidade por defeito (settings da app indisponíveis)' : ''].filter(Boolean).join(' · ')),
        atualizado: o.updated_at || null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: (r.meta && r.meta.updatedAt) || null, granularidade: 'dia',
    bruto: { ops, settings } }; // bruto: entrada do motor (settings null = capacidade por defeito)
}

module.exports = { carregar };
