// ============================================================
// Adaptador PureCork — GET /api/data -> {ops, settings}
// A app NÃO tem estado de execução nem horas reais. Só existem dois "check" por lote:
//   contagens  = CONTADO  (lote contado)
//   lote_final = LOTE FINAL (lote final criado — fim do processo)
// Estado derivado (marcado como tal no dashboard):
//   lote_final -> fechada (fim real = dia planeado, só data) | senão -> aberto ("PLANEADO", com "· CONTADO" se contado)
// Não há "em processo" no PureCork: CONTADO não significa em execução (há lotes CONTADO desde Maio sem LOTE FINAL).
// dayKey = dia planeado; qc em milheiros (x1000 -> unidades). Máquinas: settings.maquinas (ativa).
// ============================================================
'use strict';
const U = require('../util');

async function carregar(fonte, http) {
  const r = await http(fonte.url + '/api/data');
  const ops = Array.isArray(r.ops) ? r.ops : [];
  const maquinas = ((r.settings && r.settings.maquinas) || []).filter(m => m && m.ativa !== false).map(m => U.limpa(m.nome)).filter(Boolean);
  const out = [];
  const registosErro = []; // registos com dados inesperados: ignora-se o registo, não a fonte
  for (const o of ops) {
    try {
      const lf = !!o.lote_final, ct = !!o.contagens;
      const estado = lf ? 'fechada' : 'aberto';
      const origem = lf ? 'LOTE FINAL' : (ct ? 'PLANEADO · CONTADO' : 'PLANEADO');
      const dia = U.paraData(o.dayKey);
      out.push({
        fonte: fonte.id, unidade: fonte.unidade,
        id: `${fonte.id}-${o.id}`,
        op: U.limpa(o.op), ref: U.limpa(o.lote), pedido: '', // op vazia = OP por abrir (o lote fica em ref; o ecrã mostra op || ref)
        cliente: U.limpa(o.cliente), produto: U.limpa(o.material_descricao || o.material_codigo), calibre: U.limpa(o.calibre),
        qtd: Math.round(U.num(o.qc) * 1000),
        maquina: U.limpa(o.maquina) || null, fase: null,
        fila: U.num(o.id),
        estado, estado_origem: origem, estado_derivado: true,
        data_plano: dia, data_fim_plano: dia,
        semana_plano: dia ? U.semanaISO(dia) : null, plano_granularidade: 'dia',
        hora_plano_ini: null, hora_plano_fim: null,
        data_limite: null, data_log: null,
        real_inicio: null, real_fim: lf ? dia : null, // só data: "lote final" marcado no dia planeado
        atraso_prod_min: 0, motivo_paragem: '',
        urgente: !!U.limpa(o.prioridade_tag), manutencao: false,
        obs: U.limpa([o.observacoes || o.obs, o.prioridade_tag, o.carros_ids ? `carros ${o.carros_ids}` : ''].filter(Boolean).join(' · ')),
        atualizado: null,
        link: fonte.url,
      });
  
    } catch (e) { registosErro.push(`${(o && (o.id ?? o.op)) || "?"}: ${e.message}`); }
  }
  return { ordens: out, maquinas, erros_registos: registosErro, ts: null, granularidade: 'dia' };
}

module.exports = { carregar };
