// Testes rápidos (node test/normalizar.test.js) — sem dependências.
'use strict';
const assert = require('assert');
const U = require('../src/util');
const E = require('../src/estados');
const I = require('../src/indicadores');

// --- estados (ciclo: pre → aberto → liberada → entregue_log → em_processo → terminada → espera_job → fechada) ---
const casos = {
  'Aberto': 'aberto', 'Liberado': 'liberada', 'Liberada': 'liberada',
  'Entrega LOG': 'entregue_log', 'Entregue Logística': 'entregue_log', 'entregue_logistica': 'entregue_log',
  'Em Processo': 'em_processo', 'em_processo': 'em_processo',
  'Terminado': 'terminada', 'Terminada': 'terminada', 'Terminado em Linha': 'terminada', 'terminado_linha': 'terminada',
  'Espera JOB': 'espera_job', 'espera_job': 'espera_job',
  'Concluído Planeamento': 'fechada', 'Concluída Planeamento': 'fechada', 'concluido_planeamento': 'fechada',
  'KANBAN': 'pre', 'Buffer': 'pre', '': 'desconhecido', 'xpto': 'desconhecido',
};
for (const [raw, esperado] of Object.entries(casos)) assert.strictEqual(E.normalizar(raw), esperado, `estado ${raw}`);
assert.ok(E.terminal('fechada') && E.terminal('terminada') && E.terminal('espera_job'));
assert.ok(!E.terminal('entregue_log') && !E.terminal('em_processo') && !E.terminal('liberada'), 'entregue_log é pré-produção');

// --- datas ---
assert.strictEqual(U.semanaISO('2026-10-26'), '2026-W44');
assert.strictEqual(U.semanaISO('2026-01-01'), '2026-W01');
assert.strictEqual(U.segundaDaSemana('2026-W43'), '2026-10-19');
assert.strictEqual(U.domingoDaSemana('2026-W43'), '2026-10-25');
assert.strictEqual(U.paraData('2026-06-02T00:00:00.000Z'), '2026-06-02');
assert.strictEqual(U.paraData('2026-06-01 07:06'), '2026-06-01');
assert.strictEqual(U.paraData('2026-10-26T03:17'), '2026-10-26');
assert.strictEqual(U.paraData('25/10/2026'), '2026-10-25');
assert.strictEqual(U.paraData('6/11/2026'), '2026-11-06', 'D/M/YYYY nunca é M/D/YYYY');
assert.strictEqual(U.isoParaLocal('2026-06-01 07:06'), '2026-06-01 07:06');
assert.strictEqual(U.isoParaLocal('2026-10-26T03:17'), '2026-10-26 03:17');
assert.strictEqual(U.dataHora('2026-09-18', '12:10'), '2026-09-18 12:10');
assert.strictEqual(U.difDias('2026-10-20', '2026-10-26'), 6);
assert.strictEqual(U.paraMinutos('1:30'), 90);
assert.strictEqual(U.paraMinutos(360), 360);
assert.strictEqual(U.paraMinutos(''), 0);
assert.strictEqual(U.minutosDesde('2026-10-26 08:10', new Date('2026-10-26T13:58:00Z')), 348); // Lisboa = UTC+0 (hora de inverno)
assert.strictEqual(U.minutosDesde('2026-07-01 08:00', new Date('2026-07-01T08:00:00Z')), 60);   // Lisboa = UTC+1 (verão)

// --- indicadores ---
const hoje = '2026-10-26', semana = '2026-W44', lim7 = '2026-10-19', agora = new Date('2026-10-26T14:00:00Z');
const base = { estado: 'aberto', manutencao: false, qtd: 100, urgente: false, data_plano: null, data_fim_plano: null, semana_plano: null, data_limite: null, real_inicio: null, real_fim: null, atraso_prod_min: 0, maquina: 'M1', fila: 0, plano_granularidade: 'dia' };
let d = I.enriquecer({ ...base, data_plano: '2026-10-20' }, hoje, semana, lim7, agora);
assert.ok(d.atraso_plano && d.atraso_plano_dias === 6 && !d.hoje && !d.semana, 'atraso plano 6 dias');
d = I.enriquecer({ ...base, estado: 'fechada', data_plano: '2026-10-20', real_fim: '2026-10-21 10:00' }, hoje, semana, lim7, agora);
assert.ok(!d.atraso_plano && d.fechada_7d && !d.ativa, 'fechada não conta atraso');
d = I.enriquecer({ ...base, estado: 'espera_job', data_plano: '2026-10-20', real_fim: '2026-10-26 10:00' }, hoje, semana, lim7, agora);
assert.ok(!d.atraso_plano && d.feita_hoje && !d.ativa, 'espera JOB = terminada');
d = I.enriquecer({ ...base, estado: 'entregue_log', data_plano: '2026-10-20' }, hoje, semana, lim7, agora);
assert.ok(d.atraso_plano && d.ativa && !d.em_curso, 'na linha (entregue log.) ainda é activa');
d = I.enriquecer({ ...base, estado: 'em_processo', data_limite: '2026-10-24', data_plano: hoje, real_inicio: '2026-10-26 08:00' }, hoje, semana, lim7, agora);
assert.ok(d.em_curso && d.atraso_prazo && d.atraso_prazo_dias === 2 && d.hoje && d.semana && d.decorrido_min === 360, 'prazo + hoje + decorrido');
d = I.enriquecer({ ...base, estado: 'em_processo', real_inicio: '2026-10-21' }, hoje, semana, lim7, agora);
assert.strictEqual(d.decorrido_min, null, 'data sem hora não dá decorrido');
d = I.enriquecer({ ...base, plano_granularidade: 'semana', data_plano: '2026-10-26', data_fim_plano: '2026-11-01', semana_plano: '2026-W44' }, hoje, semana, lim7, agora);
assert.ok(!d.hoje && d.semana && !d.atraso_plano, 'semana: sem hoje, sem atraso');
d = I.enriquecer({ ...base, plano_granularidade: 'semana', data_plano: '2026-10-19', data_fim_plano: '2026-10-25', semana_plano: '2026-W43' }, hoje, semana, lim7, agora);
assert.ok(d.atraso_plano && d.atraso_plano_dias === 1, 'semana anterior: atraso 1 dia');
d = I.enriquecer({ ...base, plano_granularidade: 'fila', semana_plano: '2026-W03', data_limite: '2026-08-03' }, hoje, semana, lim7, agora);
assert.ok(!d.atraso_plano && d.atraso_prazo && !d.hoje, 'fila: só prazo conta');
d = I.enriquecer({ ...base, estado: 'em_processo', manutencao: true, data_plano: '2026-10-01' }, hoje, semana, lim7, agora);
assert.ok(d.em_curso && !d.atraso_plano && !d.ativa, 'manutenção fora dos KPIs');
d = I.enriquecer({ ...base, fase_futura: true, estado: 'aberto', data_plano: hoje, maquina: 'INNOCORK' }, hoje, semana, lim7, agora);
assert.ok(!d.ativa && d.na_fila && d.hoje, 'fase futura: só na fila');

const r = I.calcular([
  { ...base, estado: 'em_processo', data_plano: hoje, real_inicio: '2026-10-26 08:00', op: 'A' },
  { ...base, estado: 'liberada', data_plano: '2026-10-23', urgente: true, op: 'B' },
  { ...base, estado: 'fechada', op: 'C' },
  { ...base, estado: 'em_processo', manutencao: true, op: 'LIMPEZA', real_inicio: '2026-10-26 09:00' },
  { ...base, estado: 'aberto', data_plano: hoje, fila: 2, op: 'E' },
  { ...base, estado: 'entregue_log', data_plano: hoje, fila: 1, op: 'D', maquina: 'M2' },
], hoje, semana, lim7, { agora, maquinas: ['M1', 'M2', 'M3'], granularidade: 'dia' });
assert.deepStrictEqual([r.kpi.ativas, r.kpi.em_curso, r.kpi.atraso_plano, r.kpi.hoje, r.kpi.urgentes, r.em_curso.length], [4, 1, 1, 3, 1, 2]);
assert.strictEqual(r.maquinas.length, 3);
const m1 = r.maquinas[0];
assert.strictEqual(m1.estado, 'em_processo');
assert.strictEqual(m1.atuais[0].op, 'A', 'ordem real antes da manutenção');
assert.deepStrictEqual(m1.proximas.map(o => o.op), ['B', 'E'], 'fila: atrasada primeiro (dia mais antigo), depois hoje');
assert.strictEqual(r.maquinas[1].estado, 'planeada');
assert.strictEqual(r.maquinas[2].estado, 'sem_plano');

console.log('OK — todos os testes passaram');

// --- alertas ---
{
  const hoje2 = '2026-10-27', agora2 = new Date('2026-10-27T12:00:00Z'), sem2 = '2026-10-44', lim72 = '2026-10-20';
  const b = { manutencao: false, qtd: 1, urgente: false, data_plano: null, data_fim_plano: null, semana_plano: null, data_limite: null, real_inicio: null, real_fim: null, atraso_prod_min: 0, maquina: 'M', fila: 0, plano_granularidade: 'dia', unidade: 'U', op: 'X', id: 'x' };
  const lista = [
    { ...b, id: 'a', op: 'A', estado: 'em_processo', real_inicio: '2026-10-22 08:45', real_fim: '2026-10-22 10:05' },           // fim registado sem fechar
    { ...b, id: 'b', op: 'B', estado: 'em_processo', real_inicio: '2026-10-25 08:00' },                                          // > 24 h
    { ...b, id: 'c', op: 'C', estado: 'em_processo', real_inicio: '2026-10-21 08:00', plano_granularidade: 'fila' },             // fila: 148 h > 96 h
    { ...b, id: 'd', op: 'D', estado: 'em_processo', real_inicio: '2026-10-27 08:00', data_fim_plano: '2026-10-27', hora_plano_fim: '10:00' }, // fim plano passou
    { ...b, id: 'e', op: 'E', estado: 'aberto', data_plano: '2026-10-01' },                                                      // plano antigo
    { ...b, id: 'f', op: 'F', estado: 'espera_job', real_fim: '2026-10-10 12:00' },                                              // JOB antigo
    { ...b, id: 'g', op: 'G', estado: 'liberada', data_plano: '2026-10-27', maquina: null },                                     // sem máquina
    { ...b, id: 'h', op: 'H', estado: 'em_processo', real_inicio: '2026-10-27 09:00' },                                          // normal
  ].map(o => I.enriquecer(o, hoje2, sem2, lim72, agora2));
  const A = I.alertas(lista, [{ unidade: 'U', id: 'u', fonte: { ok: false, erro: 'timeout', ultima_ok: null } }], hoje2, agora2, I.LIMIARES);
  const tipos = Object.fromEntries(A.grupos.map(g => [g.tipo, g.itens.map(a => a.op)]));
  assert.deepStrictEqual(tipos.fonte_falha.length, 1);
  assert.deepStrictEqual(tipos.fim_registado, ['A']);
  assert.deepStrictEqual(tipos.processo_longo, ['C', 'B']);
  assert.deepStrictEqual(tipos.fim_plano, ['D']);
  assert.deepStrictEqual(tipos.plano_antigo, ['E']);
  assert.deepStrictEqual(tipos.job_antigo, ['F']);
  assert.deepStrictEqual(tipos.sem_maquina, ['G']);
  assert.strictEqual(lista[3].atraso_fim_min, 120, 'fim plano 10:00, agora 12:00 (Lisboa=UTC) -> 120 min');
  assert.strictEqual(A.total, 8);
  console.log('OK — alertas');
}
