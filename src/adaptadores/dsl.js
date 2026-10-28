// ============================================================
// Adaptador DSL (dupla escolha) — GET /api/state -> {ops, settings, ts}
// diaPlano = dia planeado; linha = 1..8 | EM | EEB; unidade = sub-unidade (dsl | eedsl | em);
// dataInicioR/hInicioR, dataFimR/hFimR = reais; tempoAtraso / temposPerdidosAvaria = paragens;
// qtd em milheiros (x1000 -> unidades); dsl = referência da ordem DSL; op = OP SAP (pode faltar).
// "Espera JOB" = terminada, à espera do JOB SAP (41 de 63 têm início e fim reais).
// Linhas: settings.calibresPorLinha (1..8) + EM.
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

function nomeLinha(l) { return l ? (/^\d+$/.test(l) ? `Linha ${l}` : l) : null; }

async function carregar(fonte, http) {
  const st = await http(fonte.url + '/api/state');
  const ops = Array.isArray(st.ops) ? st.ops : [];
  const s = st.settings || {};
  const maquinas = Object.keys(s.calibresPorLinha || s.capacidades || {}).sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99) || a.localeCompare(b)).map(nomeLinha);
  if (!maquinas.includes('EM')) maquinas.push('EM');
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of ops) {
    try {
      let estado = E.normalizar(o.estado);
      if (o.buffer && !E.terminal(estado) && estado !== 'em_processo') estado = 'pre';
      const atraso = U.paraMinutos(o.tempoAtraso) + U.paraMinutos(o.temposPerdidosAvaria);
      const linha = U.limpa(o.linha);
      const diaPlano = U.paraData(o.diaPlano);
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: U.limpa(o.op) || U.limpa(o.dsl), ref: U.limpa(o.lote), pedido: U.limpa(o.po),
        cliente: U.limpa(o.cliente), produto: U.limpa(o.produtoEntrada), calibre: U.limpa(o.calibre),
        qtd: Math.round(U.num(o.qtd) * 1000),
        maquina: o.buffer ? null : nomeLinha(linha),
        fase: [U.limpa(o.dslTipo), o.turno ? `T${o.turno}` : ''].filter(Boolean).join(' · ') || null,
        fila: U.num(o.sortIdx),
        estado, estado_origem: U.limpa(o.estado) + (o.buffer ? ' (Buffer)' : ''), estado_derivado: false,
        data_plano: diaPlano, data_fim_plano: diaPlano,
        semana_plano: o.weekKey || null, plano_granularidade: 'dia',
        hora_plano_ini: U.limpa(o.hInicioP) || null, hora_plano_fim: null,
        data_limite: null, data_log: null,
        real_inicio: o.hInicioR ? U.dataHora(o.dataInicioR || o.diaPlano, o.hInicioR) : null,
        real_fim: o.hFimR ? U.dataHora(o.dataFimR || o.dataInicioR || o.diaPlano, o.hFimR) : null,
        atraso_prod_min: atraso, motivo_paragem: U.limpa(o.motivoParagem),
        urgente: !!o.urgente, manutencao: false,
        obs: U.limpa([o.obs, o.obsProd, o.faltas ? `faltas: ${o.faltas}` : '', o.proximoPasso ? `→ ${o.proximoPasso}` : ''].filter(Boolean).join(' · ')),
        atualizado: null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: st.ts || null, granularidade: 'dia' };
}

module.exports = { carregar };
