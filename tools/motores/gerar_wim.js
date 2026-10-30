const fs = require('fs');
const [,, rawF, sha, outF] = process.argv;
const raw = fs.readFileSync(rawF, 'utf8');
const ind = s => s.split('\n').map(l => l ? '  ' + l : l).join('\n');
fs.writeFileSync(outF, `// ============================================================
// Motor WIM — cópia FIEL dos agendadores da app planeamento-wim
// (public/index.html, sha256 ${sha}…, extraído 2026-10-29).
//  • Wash (W): scheduleMaq — por máquina, batch a batch, linha de tempo contínua; REDES anexadas ao batch host.
//  • Innocork (I): scheduleInno — fluxo contínuo; 1.º batch de ordens com Wash só arranca no fim da Lavação + 2 h.
//  • Make-up (M): a sequência vive dentro de renderMQPlan() (UI). planoMQ() abaixo é a transcrição LITERAL
//    das linhas de cálculo dessa função (dia = effMqDay; por máquina: ordenar por mqSeqOf, O = início turno 1,
//    P = O + ciclo, seguinte = P + intervalo) — sem o HTML. Não há transbordo de dia no Make-up (igual à app).
//    Lotes sem máquina de Make-up atribuída (a situação actual: 0 de 64 em 29/10) só têm DIA -> so_dia: true.
// Não editar à mão. DATA/SETTINGS injectados; DATA é copiado (a app preenche m_bseq em memória).
// ============================================================
'use strict';

function criar(opsIn, settingsIn) {
${ind(raw)}

  DATA = JSON.parse(JSON.stringify(Array.isArray(opsIn) ? opsIn : []));
  SETTINGS = settingsIn || {};

  // --- transcrição de renderMQPlan(): só o cálculo de O/P, para todos os dias com lotes ---
  function planoMQ() {
    const allLots=DATA.filter(o=>o.temM&&released(o)&&!o.manut);
    const gap=+secCfg('M').interBatchMin||0;const t1=hm2min((turnoWindow('M',1)||{}).ini)||360;
    const dias=[...new Set(allLots.map(o=>{const dd=effMqDay(o);return dd?dateKey(dd):null;}).filter(Boolean))].sort();
    const linhas=[];
    for(const dk of dias){
      const dayLots=allLots.filter(o=>{const dd=effMqDay(o);return dd&&dateKey(dd)===dk;});
      const baseIdx=new Map();dayLots.slice().sort((a,b)=>((a.ordem||'')<(b.ordem||'')?-1:1)).forEach((o,i)=>baseIdx.set(o.id,i));
      dayLots.forEach(o=>{const n=mqBatchesFull(o).length;o.m_bseq=o.m_bseq||{};for(let bi=0;bi<n;bi++)if(o.m_bseq[bi]==null)o.m_bseq[bi]=(baseIdx.get(o.id)||0)*100+bi;});
      const byMaq={};dayLots.forEach(o=>{const full=mqBatchesFull(o);const nb=mqPerBatch(o).length;full.forEach((b,bi)=>{const k=batchMaq(o,bi)||'';if(!k)return;(byMaq[k]=byMaq[k]||[]).push({o,bi,cyc:b.cyc,nb,isRecup:b.isRecup,srcBi:b.srcBi,qtd:b.qtd,recIdx:b.recIdx});});});
      Object.values(byMaq).forEach(list=>{list.sort((a,b)=>mqSeqOf(a.o,a.bi)-mqSeqOf(b.o,b.bi));let cur=t1;list.forEach(r=>{r.O=cur;r.P=cur+r.cyc;cur=r.P+gap;});});
      for(const maq of Object.keys(byMaq))for(const r of byMaq[maq])linhas.push({dk,maq,o:r.o,bi:r.bi,O:r.O,P:r.P,isRecup:r.isRecup});
    }
    return linhas;
  }
  const lotesMQ=()=>DATA.filter(o=>o.temM&&released(o)&&!o.manut);
  return { PREF, maqsOf, scheduleMaq, scheduleInno, planoMQ, lotesMQ, nBatches, dateKey, effMqDay };
}

// hora de parede: dia (meia-noite local) + minutos (podem passar 1440)
function parede(d, min) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min); }

// Plano completo por fase: Map "id|W" / "id|I" / "id|M" -> { id, fase, maquina, inicio, fim, segs:[{inicio,fim,qtd,lote,tipo}] }
function calcularPlano(ops, settings) {
  const m = criar(ops, settings);
  const out = new Map();
  const add = (id, fase, maq, ini, fim, extra) => {
    const k = id + '|' + fase; let r = out.get(k);
    if (!r) { r = { id, fase, maquina: maq, inicio: ini, fim, segs: [] }; out.set(k, r); }
    r.segs.push({ inicio: ini, fim, ...extra });
    if (ini < r.inicio) r.inicio = ini;
    if (fim > r.fim) r.fim = fim;
  };
  // W primeiro (popula o fim da Lavação usado pelo INNO e pelo Make-up)
  for (const maq of m.maqsOf('W')) {
    const segs = Object.values(m.scheduleMaq(maq)).flat().sort((a, b) => a.date - b.date || a.startMin - b.startMin);
    for (const s of segs) {
      const ini = parede(s.date, s.startMin), fim = parede(s.date, s.endMin);
      add(s.op.id, 'W', maq, ini, fim, { qtd: s.qtdSeg, lote: s.batchIdx, tipo: s.op.manut ? 'manut' : 'batch' });
      for (const r of (s.redesOps || [])) add(r.id, 'W', maq, ini, fim, { qtd: 0, lote: s.batchIdx, tipo: 'redes', host: s.op.id });
    }
  }
  for (const maq of m.maqsOf('I')) {
    const segs = m.scheduleInno(maq).slice().sort((a, b) => a.date - b.date || a.startMin - b.startMin);
    for (const s of segs) {
      const nb = s.kind === 'b' ? (s.nb || 1) : 1;
      add(s.o.id, 'I', maq, parede(s.date, s.startMin), parede(s.date, s.endMin),
        { qtd: s.kind === 'b' ? (+s.o.qtd || 0) / nb : 0, lote: s.bi, tipo: { b: 'batch', m: 'manut', r: 'redes', p: 'proto' }[s.kind] || s.kind });
    }
  }
  for (const r of m.planoMQ()) {
    const d = new Date(r.dk + 'T00:00:00');
    add(r.o.id, 'M', r.maq, parede(d, r.O), parede(d, r.P), { qtd: null, lote: r.bi + 1, tipo: r.isRecup ? 'recup' : 'batch' });
  }
  // Lotes de Make-up sem máquina atribuída: a app só define o DIA (effMqDay) -> barra de dia inteiro, sem horas.
  for (const o of m.lotesMQ()) {
    if (out.has(o.id + '|M')) continue;
    const d = m.effMqDay(o); if (!d) continue;
    const r = { id: o.id, fase: 'M', maquina: null, inicio: parede(d, 0), fim: parede(d, 1440), so_dia: true, segs: [] };
    r.segs.push({ inicio: r.inicio, fim: r.fim, qtd: +o.qtd || 0, lote: null, tipo: 'dia' });
    out.set(o.id + '|M', r);
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { criar, calcularPlano, parede };
`);
