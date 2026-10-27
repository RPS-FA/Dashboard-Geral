// ============================================================
// Adaptador WIM — GET /api/state -> {ops, settings, ts}
// Cada ordem tem até 3 fases: W (Wash/Lavação), I (Innocork), M (Make-up),
// cada uma com estado, semana ISO (p_wk) + índice do dia (p_dia, 0 = segunda), ordem na máquina (p_sort),
// máquina (p_maq), horas reais (p_hIniR/p_hFimR ou p_real:[{i,f}]) e atraso (p_atraso).
// Emite UMA linha por ordem, na fase actual (fase "em processo" se houver; senão a primeira não terminal).
// Máquinas: settings.sections.{W,I,M}.maqs
// ============================================================
'use strict';
const U = require('../util');
const E = require('../estados');

const FASES = [
  { p: 'w', flag: 'temW', sec: 'W', label: 'Wash' },
  { p: 'i', flag: 'temI', sec: 'I', label: 'Innocork' },
  { p: 'm', flag: 'temM', sec: 'M', label: 'Make-up' },
];

function dataFase(o, p) {
  const wk = o[p + '_wk'];
  if (!wk) return null;
  const seg = U.segundaDaSemana(wk);
  return seg ? U.addDias(seg, Math.max(0, Math.min(6, parseInt(o[p + '_dia'], 10) || 0))) : null;
}
function reais(o, p) {
  const arr = Array.isArray(o[p + '_real']) ? o[p + '_real'] : [];
  const dIni = o[p + '_dIniR'] || dataFase(o, p);
  const dFim = o[p + '_dFimR'] || dIni;
  const hIni = o[p + '_hIniR'] || (arr.length ? arr[0].i : '');
  const hFim = o[p + '_hFimR'] || (arr.length ? arr[arr.length - 1].f : '');
  return { ini: hIni ? U.dataHora(dIni, hIni) : null, fim: hFim ? U.dataHora(dFim, hFim) : null };
}

async function carregar(fonte, http) {
  const st = await http(fonte.url + '/api/state');
  const ops = Array.isArray(st.ops) ? st.ops : [];
  const sections = (st.settings && st.settings.sections) || {};
  // Make-up: a app não atribui máquina (m_maq sempre vazio) — a secção é tratada como uma única "máquina".
  const usaMaqM = ops.some(o => U.limpa(o.m_maq));
  const maquinas = [];
  for (const f of FASES) {
    const lista = (f.sec === 'M' && !usaMaqM) ? ['Make-up'] : ((sections[f.sec] || {}).maqs || []);
    for (const m of lista) if (!maquinas.includes(m)) maquinas.push(m);
  }
  const maqI = ((sections.I || {}).maqs || [])[0] || 'INNOCORK';
  const out = [];
  for (const o of ops) {
    const fases = FASES.filter(f => o[f.flag]);
    if (!fases.length) continue;
    const estados = fases.map(f => ({ ...f, estado: E.normalizar(o[f.p + '_estado']), raw: o[f.p + '_estado'] || '' }));
    let actual = estados.find(f => !E.terminal(f.estado)) || estados[estados.length - 1];
    const emProc = estados.find(f => f.estado === 'em_processo');
    if (emProc) actual = emProc;
    const p = actual.p;
    const r = reais(o, p);
    const atraso = FASES.reduce((s, f) => s + U.paraMinutos(o[f.p + '_atraso']), 0);
    const manut = !!(o.manut || o.cleanTpl) || /limpeza|manuten/i.test(String(o.op || o.nome || ''));
    let maquina = U.limpa(o[p + '_maq']) || null;
    if (!maquina && p === 'i') maquina = maqI;                 // Innocork só tem uma máquina
    if (!maquina && p === 'm' && !usaMaqM) maquina = 'Make-up'; // Make-up sem máquinas atribuídas
    const dataPlano = dataFase(o, p) || (p === 'm' ? U.paraData(o.m_data) : null) || U.paraData(o.diaPlano);
    out.push({
      fonte: fonte.id, unidade: fonte.unidade,
      id: `${fonte.id}-${o.id}`,
      op: U.limpa(o.op || o.ordem || o.nome),
      ref: U.limpa(o.lote), pedido: U.limpa(o.pedido),
      cliente: U.limpa(o.cliente), produto: U.limpa(o.produtoEntrada), calibre: U.limpa(o.calibre),
      qtd: U.num(o.qtd),
      maquina,
      fase: `${actual.label}` + (fases.length > 1 ? ` (${estados.map(f => f.p.toUpperCase() + ':' + E.LABEL[f.estado]).join(' · ')})` : ''),
      fila: U.num(o[p + '_sort']),
      estado: actual.estado, estado_origem: actual.raw, estado_derivado: false,
      // Dia planeado = dia da fase actual (semana ISO + índice do dia); Make-up usa m_data; diaPlano só como recurso.
      data_plano: dataPlano,
      data_fim_plano: null,
      semana_plano: o[p + '_wk'] || null, plano_granularidade: 'dia',
      hora_plano_ini: U.limpa(o[p + '_hIni']) || null, hora_plano_fim: null,
      data_limite: null, data_log: null,
      real_inicio: r.ini, real_fim: r.fim,
      atraso_prod_min: atraso, motivo_paragem: '',
      urgente: !!(o.urgente || o.urgEnc), manutencao: manut,
      obs: U.limpa([o.obs, o.obsProd, o[p + '_obs'], o.destino ? `→ ${o.destino}` : ''].filter(Boolean).join(' · ')),
      atualizado: o._ts || null,
      link: fonte.url,
    });
    // Fases seguintes já planeadas (ex.: W em processo na Maq 1 e I planeada para hoje no INNOCORK):
    // linhas "fase_futura" só para a fila do painel de máquinas — não contam nos KPIs nem na tabela.
    const idx = estados.indexOf(actual);
    for (const f of estados.slice(idx + 1)) {
      if (E.terminal(f.estado) || manut) continue;
      const dp = dataFase(o, f.p) || (f.p === 'm' ? U.paraData(o.m_data) : null);
      if (!dp) continue;
      let maq = U.limpa(o[f.p + '_maq']) || null;
      if (!maq && f.p === 'i') maq = maqI;
      if (!maq && f.p === 'm' && !usaMaqM) maq = 'Make-up';
      if (!maq) continue;
      out.push({
        fonte: fonte.id, unidade: fonte.unidade, id: `${fonte.id}-${o.id}-${f.p}`, fase_futura: true,
        op: U.limpa(o.op || o.ordem || o.nome), ref: U.limpa(o.lote), pedido: U.limpa(o.pedido),
        cliente: U.limpa(o.cliente), produto: U.limpa(o.produtoEntrada), calibre: U.limpa(o.calibre), qtd: U.num(o.qtd),
        maquina: maq, fase: `${f.label} (após ${actual.label})`, fila: U.num(o[f.p + '_sort']),
        estado: f.estado, estado_origem: f.raw, estado_derivado: false,
        data_plano: dp, data_fim_plano: null, semana_plano: o[f.p + '_wk'] || null, plano_granularidade: 'dia',
        hora_plano_ini: U.limpa(o[f.p + '_hIni']) || null, hora_plano_fim: null,
        data_limite: null, data_log: null, real_inicio: null, real_fim: null,
        atraso_prod_min: 0, motivo_paragem: '', urgente: !!(o.urgente || o.urgEnc), manutencao: false,
        obs: '', atualizado: o._ts || null, link: fonte.url,
      });
    }
  }
  return { ordens: out, maquinas, ts: st.ts || null, granularidade: 'dia' };
}

module.exports = { carregar };
