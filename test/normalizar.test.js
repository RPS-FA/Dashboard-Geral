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

// --- OP por abrir: número de OP = 8 dígitos (1xxxxxxx) isolados no campo OP ---
const comOP = { '12063090': '12063090', '12063090- LT02356473': '12063090', '14400249 -2': '14400249', 'OP12063090': '12063090', '12063068 - REDES': '12063068', '13106313 LT02383143': '13106313' };
for (const [raw, esp] of Object.entries(comOP)) assert.strictEqual(U.numOP(raw), esp, `numOP ${raw}`);
const semOP = ['', '134XXXX', 'AG OP - 150XXX', '1800XXXX', '144xxxx -1', 'AG OP (1) - 1500XXXX - PAV 1200', 'LT02328411', 'CLIENTE', '4400042021-20', '02356473', '123456789', 'CICLO LIMPEZA', 'AG OP - N-QV2-NAT-49X240-0101-SDE-SDS-TA-SC ABRIR OP SC COM 40K'];
for (const raw of semOP) assert.strictEqual(U.numOP(raw), null, `numOP sem OP: ${raw}`);
d = I.enriquecer({ ...base, op: 'AG OP - 150XXX', data_plano: '2026-10-28' }, hoje, semana, lim7, agora);
assert.ok(d.sem_op && d.sem_op_nivel === 'serio' && d.dias_plano === 2, 'sem OP a 2 dias = sério');
d = I.enriquecer({ ...base, op: '1800XXXX', plano_granularidade: 'fila', semana_plano: '2026-W43' }, hoje, semana, lim7, agora);
assert.ok(d.sem_op && d.sem_op_nivel === 'critico' && d.dias_plano === -7, 'fila VOCUS da semana passada sem OP = crítico (segunda-feira da semana)');
d = I.enriquecer({ ...base, op: '134XXXX', estado: 'pre', data_plano: '2027-01-05' }, hoje, semana, lim7, agora);
assert.ok(d.sem_op && d.sem_op_nivel === 'aviso' && d.dias_corridos === 71 && d.dias_plano === U.diasUteisAte(hoje, '2027-01-05'), 'kanban a 71 dias corridos sem OP = aviso (dias_plano em dias úteis)');
d = I.enriquecer({ ...base, op: 'CICLO LIMPEZA', manutencao: true, data_plano: hoje }, hoje, semana, lim7, agora);
assert.ok(!d.sem_op, 'manutenção nunca é OP por abrir');
d = I.enriquecer({ ...base, op: 'LT02328411', estado: 'fechada', data_plano: '2026-05-28', real_fim: '2026-05-28' }, hoje, semana, lim7, agora);
assert.ok(!d.sem_op, 'fechada sem OP não é OP por abrir');
d = I.enriquecer({ ...base, op: '12063090- LT02356473', estado: 'em_processo', data_plano: hoje }, hoje, semana, lim7, agora);
assert.ok(!d.sem_op && d.op_num === '12063090', 'com OP');
{ const k = I.vazio(); for (const o of [{ ...base, op: 'AG OP', data_plano: '2026-10-20' }, { ...base, op: '150XXX', data_plano: '2026-10-30' }, { ...base, op: '150XXX', data_plano: '2026-12-01' }, { ...base, op: '15007315', data_plano: '2026-10-30' }]) I.somar(k, I.enriquecer(o, hoje, semana, lim7, agora));
  assert.ok(k.sem_op === 3 && k.sem_op_passado === 1 && k.sem_op_7d === 1, `KPI sem_op ${JSON.stringify([k.sem_op, k.sem_op_passado, k.sem_op_7d])}`); }
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

// --- plano VOCUS (porte do PlannerCork) ---
process.env.TZ = 'Europe/Lisbon';
{
  const P = require('../src/adaptadores/vocus_plano');
  const S = { startTime: '06:00', rate: 1000, setupMinutes: 30, oee: { v1: 0.5 }, stops: { 'Vocus 1': [{ date: '2026-10-27', days: 1, label: 'Paragem' }] }, shiftPeriods: [] };
  const ops = [
    { id: 1, maquina: 'Vocus 1', weekKey: '2026-W44', sortIdx: 0, qc: 5000 },            // 5000/(1000×0.5) = 10 h → seg 06:00–16:00
    { id: 2, maquina: 'Vocus 1', weekKey: '2026-W44', sortIdx: 1, qc: 4000, reprocessoC5: 500, tempoParagem: 60 }, // (4500/500 + 1) = 10 h → 16:30; 7h30 até à meia-noite, salta a paragem de terça (00:00–24:00), termina 4.ª 02:30
    { id: 3, maquina: 'Vocus 1', weekKey: '2026-W44', sortIdx: 2, qc: 1000, startMode: 'manual', startManual: '2026-10-30T08:00' }, // forçado
    { id: 4, maquina: 'Vocus 1', weekKey: '2026-W45', sortIdx: 0, qc: 500 },             // semana seguinte continua a cadeia (não volta à segunda 06:00)
    { id: 9, maquina: 'KANBAN', weekKey: null, qc: 100 },
  ];
  const pl = P.calcularPlano(ops, S);
  const f = d => `${P.dataLocal(d)} ${P.horaLocal(d)}`;
  assert.strictEqual(f(pl.get(1).start), '2026-10-26 06:00', 'arranque segunda 06:00');
  assert.strictEqual(f(pl.get(1).end), '2026-10-26 16:00', '10 h de duração');
  assert.strictEqual(f(pl.get(2).start), '2026-10-26 16:30', 'setup 30 min');
  assert.strictEqual(f(pl.get(2).end), '2026-10-28 02:30', '7h30 até meia-noite + salta terça inteira + 2h30 na quarta');
  assert.strictEqual(f(pl.get(3).start), '2026-10-30 08:00', 'início manual força o cursor');
  assert.strictEqual(f(pl.get(3).end), '2026-10-30 10:00', '2 h');
  assert.strictEqual(f(pl.get(4).start), '2026-10-30 10:30', 'semana seguinte encadeia (cursor contínuo)');
  assert.ok(!pl.has(9), 'KANBAN não tem plano');
  const seg = P.segundaDe('2026-W44'); assert.strictEqual(P.dataLocal(seg), '2026-10-26');
  console.log('OK — plano VOCUS');
}

// --- plano DS100 (porte do separador DS100 do PlannerCork) ---
{
  const D = require('../src/adaptadores/ds100_plano');
  const S = { ds100DailyTarget: 1000, ds100CapsByWeek: { '2026-W44': [0, 1000, 1000, 1000, 1000, 0] } };
  const ops = [
    { id: 1, maquina: 'DS100', weekKey: '2026-W44', sortIdx: 0, analise: 'DS100_2', qtEntrada: 1000 },  // 500 frascos → 3.ª 27/10 (2.ª tem cap 0)
    { id: 2, maquina: 'DS100', weekKey: '2026-W44', sortIdx: 1, analise: 'DS100_1', qtEntrada: 3200 },  // 3200 → 500 na 3.ª, 1000 4.ª/5.ª/6.ª = 3500 > 3200 → acaba 6.ª
    { id: 3, maquina: 'DS100', weekKey: '2026-W44', sortIdx: 2, analise: 'DS100_4', qtEntrada: 4000 },  // 1000 → 300 na 6.ª, resto 700 transborda para W45 (2.ª 02/11)
    { id: 4, maquina: 'CSP2', weekKey: '2026-W45', sortIdx: 0, analise: 'DS100_1', qtEntrada: 500 },    // depois do carry na W45
    { id: 9, maquina: 'KANBAN', weekKey: '2026-W44', sortIdx: 0, analise: 'DS100_1', qtEntrada: 999 },  // KANBAN não entra
  ];
  const pl = D.calcularPlano(ops, S);
  const f = x => D.dataLocal(x);
  assert.strictEqual(D.frascos(ops[0]), 500); assert.strictEqual(D.frascos(ops[2]), 1000);
  assert.strictEqual(f(pl.get(1).inicio), '2026-10-27', 'DS100: 2.ª com capacidade 0 → começa 3.ª');
  assert.strictEqual(f(pl.get(2).inicio), '2026-10-27'); assert.strictEqual(f(pl.get(2).fim), '2026-10-30');
  assert.strictEqual(f(pl.get(3).inicio), '2026-10-30', 'começa na 6.ª com o que sobra');
  assert.strictEqual(f(pl.get(3).fim), '2026-11-02', 'transborda para a 2.ª da semana seguinte');
  assert.strictEqual(pl.get(3).colocados, 1000);
  assert.strictEqual(f(pl.get(4).inicio), '2026-11-02', 'semana seguinte: depois do carry');
  assert.ok(!pl.has(9), 'KANBAN fora');
  console.log('OK — plano DS100');
}

// --- dias úteis (D+n) ---
{
  assert.strictEqual(U.pascoa(2026), '2026-04-05'); assert.strictEqual(U.pascoa(2027), '2027-03-28');
  const F = U.feriados(2026, {});
  for (const f of ['2026-01-01', '2026-01-20', '2026-04-03', '2026-04-05', '2026-04-25', '2026-05-01', '2026-06-04', '2026-06-10', '2026-08-15', '2026-10-05', '2026-11-01', '2026-12-01', '2026-12-08', '2026-12-25']) assert.ok(F.has(f), 'feriado ' + f);
  assert.strictEqual(F.size, 14);
  assert.ok(!U.feriados(2026, { FERIADO_MUNICIPAL: '' }).has('2026-01-20'), 'municipal desligável');
  assert.ok(U.feriados(2026, { FERIADOS_EXTRA: '02-17,2026-12-24' }).has('2026-02-17'), 'extra MM-DD');
  const e = {};
  assert.strictEqual(U.diasUteisAte('2026-10-29', '2026-10-29', e), 0, 'hoje');
  assert.strictEqual(U.diasUteisAte('2026-10-29', '2026-10-30', e), 1, '5.ª → 6.ª = D+1');
  assert.strictEqual(U.diasUteisAte('2026-10-29', '2026-11-02', e), 2, '5.ª → 2.ª = D+2 (fim-de-semana não conta)');
  assert.strictEqual(U.diasUteisAte('2026-10-30', '2026-10-31', e), 0, '6.ª → sábado = D (último dia útil antes)');
  assert.strictEqual(U.diasUteisAte('2026-10-30', '2026-11-02', e), 1, '6.ª → 2.ª = D+1');
  assert.strictEqual(U.diasUteisAte('2026-11-30', '2026-12-02', e), 1, '1/12 feriado não conta');
  assert.strictEqual(U.diasUteisAte('2026-10-29', '2026-10-27', e), -2, 'atrasada: dias corridos negativos');
  console.log('OK — dias úteis');
}
