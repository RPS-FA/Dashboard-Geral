// ============================================================
// Adaptador Densidades — GET /api/state -> {ops, settings, ts}
// _calcInicioP_date/_calcInicioP, _calcFimP_date/_calcFimP = janela planeada calculada pela app (usamos primeiro);
// dataPlano = dia planeado introduzido (formato DD/MM/YYYY) como recurso;
// dataInicioR/hInicioR, dataFimR/hFimR e realPorDia = reais; tempoAtraso = paragem registada;
// maquina = 'Maq 1 - Linha 9' | 'Maq 3 - Linha 10' | 'BUFFER' / 'KANBAN' (ainda não planeada -> estado "Em espera", sem máquina).
// Máquinas: settings.turnosPorMaquina / settings.capacidades.
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

async function carregar(fonte, http) {
  const st = await http(fonte.url + '/api/state');
  const ops = Array.isArray(st.ops) ? st.ops : [];
  const s = st.settings || {};
  const maquinas = Object.keys(s.turnosPorMaquina || s.capacidades || {}).filter(m => !/buffer|kanban/i.test(m));
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of ops) {
    try {
      let estado = E.normalizar(o.estado);
      const buffer = /buffer|kanban/i.test(String(o.maquina || ''));
      if (buffer && !E.terminal(estado) && estado !== 'em_processo') estado = 'pre';
      // Reais: só contam registos COM hora. A app pré-cria entradas em realPorDia (e dataInicioR/dataFimR)
      // com o dia do plano e horas vazias — datas sem hora não são execução real.
      const rpd = (o.realPorDia && typeof o.realPorDia === 'object') ? Object.entries(o.realPorDia).sort((a, b) => a[0].localeCompare(b[0])).map(e => ({ dia: e[0], ...e[1] })) : [];
      const comIni = rpd.filter(x => x.hIniR), comFim = rpd.filter(x => x.hFimR);
      const rIni = o.hInicioR ? U.dataHora(o.dataInicioR || (comIni[0] && (comIni[0].dataIniR || comIni[0].dia)), o.hInicioR)
        : (comIni.length ? U.dataHora(comIni[0].dataIniR || comIni[0].dia, comIni[0].hIniR) : null);
      const rFim = o.hFimR ? U.dataHora(o.dataFimR || (comFim.length && (comFim[comFim.length - 1].dataFimR || comFim[comFim.length - 1].dia)), o.hFimR)
        : (comFim.length ? U.dataHora(comFim[comFim.length - 1].dataFimR || comFim[comFim.length - 1].dia, comFim[comFim.length - 1].hFimR) : null);
      const atraso = U.paraMinutos(o.tempoAtraso) + rpd.reduce((a, x) => a + U.paraMinutos(x.tempoAtraso), 0);
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: U.limpa(o.op), ref: U.limpa(o.loteAde), pedido: U.limpa(o.poPedido),
        cliente: U.limpa(o.fileCliente), produto: U.limpa(o.produto), calibre: U.limpa(o.calibre),
        qtd: U.num(o.qtdEntrada),
        maquina: buffer ? null : (U.limpa(o.maquina) || null), fase: null,
        fila: U.num(o.sortIdx),
        estado, estado_origem: U.limpa(o.estado) + (buffer ? ` (${U.limpa(o.maquina)})` : ''), estado_derivado: false,
        data_plano: U.paraData(o._calcInicioP_date) || U.paraData(o.dataPlano),
        data_fim_plano: U.paraData(o._calcFimP_date) || U.paraData(o.dataPlano),
        semana_plano: o.weekKey || null, plano_granularidade: 'dia',
        hora_plano_ini: U.limpa(o._calcInicioP) || null, hora_plano_fim: U.limpa(o._calcFimP) || null,
        data_limite: null, data_log: null,
        real_inicio: rIni, real_fim: rFim,
        atraso_prod_min: atraso, motivo_paragem: '',
        urgente: false, manutencao: false,
        obs: U.limpa([o.obsPi, o.obs, o.massas ? `massas ${o.massas}` : '', o.destino ? `→ ${o.destino}` : ''].filter(Boolean).join(' · ')),
        atualizado: o._ts || null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: st.ts || null, granularidade: 'dia',
    bruto: { ops, settings: st.settings || {} } }; // bruto: entrada do motor (simulador/Gantt)
}

module.exports = { carregar };
