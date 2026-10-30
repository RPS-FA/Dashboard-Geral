// ============================================================
// Motor DSL Talis — cópia FIEL do motor da app planeamento-dsl-talis
//   server/scheduler.js  sha256 fee6597a53d74371…  (integral; só se retiraram os "export")
//   server/index.js      sha256 55b3c3efbdb5e62f…  (inicioManualDe + a parte "linhas" de calcular())
//   server/config.js     sha256 245f2f8082f1b225…  (LINHAS, turnoEmMinutos)
// Extraído 2026-10-29. Não editar à mão.
// Convenção da app: datas em UTC usado como hora de parede (08:00Z = 08:00 na fábrica).
// A app devolve o próprio plano em /api/estado (plano.linhas) -> o agregador compara
// sempre motor vs app e expõe as diferenças (auto-validação contínua).
// ============================================================
'use strict';

// Motor de escalonamento.
//
// Substitui a fórmula fechada LET do Excel (folha SET, S6) por um percurso
// dia a dia. O resultado é idêntico quando o turno é constante — validado
// contra 13 valores calculados pelo Excel, ver scripts/validar-motor.mjs —
// mas permite o que a fórmula não permitia:
//   - dias fechados (feriados, férias, paragens gerais)
//   - máquinas fechadas num dia (manutenção de uma linha só)
//   - turnos diferentes num dia, para todas as linhas ou só para uma
//
// Regras herdadas do Excel:
//   - Turno base 08:00–17:00, almoço 12:00–13:00 => 480 min úteis/dia
//   - Início >= fim de turno arranca no dia seguinte à hora de abertura
//   - Início dentro do almoço arranca no fim do almoço
//   - Setup fixo entre OPs (Base dados (2)!P4 = 15 min)
//   - Data LoG = 1 dia útil antes da data de início (coluna B)
//
// Desvio deliberado: o Excel usa WORKDAY.INTL(dCand;0;...) para empurrar o
// arranque para dia útil, mas devolve a própria data quando days=0 — uma OP
// que arrancasse num feriado ficava agendada no feriado. Aqui é empurrada.

const DEFAULT_TURNO = { inicio: 8 * 60, fim: 17 * 60, almocoIni: 12 * 60, almocoFim: 13 * 60 };
const DIA_MS = 86400000;

function dateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function atMidnight(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function minutesOfDay(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

/**
 * Calendário: decide se um dia está aberto para uma linha e com que turno.
 * @param {object} cal { paragens:Set<string>, excecoes:Array, turno }
 * @returns {object|null} janela {inicio,fim,almocoIni,almocoFim} ou null se fechado
 */
function janelaDoDia(ms, linha, cal) {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return null;          // fim de semana
  const chave = dateKey(d);
  if (cal.paragens.has(chave)) return null;          // feriado / férias

  let janela = { ...(cal.turno || DEFAULT_TURNO) };
  // Excepções: primeiro as que valem para todas as linhas, depois as da linha.
  for (const alvo of [null, linha]) {
    for (const e of cal.excecoes || []) {
      if (e.data !== chave) continue;
      const eLinha = e.linha || null;
      if (eLinha !== alvo) continue;
      if (e.tipo === "fechado") return null;
      if (e.tipo === "turno") {
        janela = {
          inicio: hm(e.inicio, janela.inicio),
          fim: hm(e.fim, janela.fim),
          almocoIni: hm(e.almocoIni, janela.almocoIni),
          almocoFim: hm(e.almocoFim, janela.almocoFim),
        };
      }
    }
  }
  if (janela.fim <= janela.inicio) return null;
  return janela;
}

function hm(v, defeito) {
  if (v === undefined || v === null || v === "") return defeito;
  const [h, m] = String(v).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutos úteis entre o instante t e o fim da janela. */
function disponivelApos(t, j) {
  if (t >= j.fim) return 0;
  const ini = Math.max(t, j.inicio);
  if (ini < j.almocoIni) return (j.almocoIni - ini) + (j.fim - j.almocoFim);
  if (ini < j.almocoFim) return j.fim - j.almocoFim;
  return j.fim - ini;
}

/** Instante em que se termina, partindo de t e consumindo m minutos úteis. */
function fimApos(t, m, j) {
  const ini = (t >= j.almocoIni && t < j.almocoFim) ? j.almocoFim : Math.max(t, j.inicio);
  if (ini < j.almocoIni) {
    const manha = j.almocoIni - ini;
    if (m <= manha) return ini + m;
    return j.almocoFim + (m - manha);
  }
  return ini + m;
}

/** Minutos úteis totais de uma janela. */
function minutosDaJanela(j) {
  return (j.fim - j.inicio) - Math.max(0, Math.min(j.fim, j.almocoFim) - Math.max(j.inicio, j.almocoIni));
}

function proximoDiaAberto(ms, linha, cal) {
  let cur = ms;
  for (let i = 0; i < 500; i++) {
    const j = janelaDoDia(cur, linha, cal);
    if (j) return { ms: cur, janela: j };
    cur += DIA_MS;
  }
  throw new Error("Sem dia aberto nos próximos 500 dias — verifica paragens e fechos.");
}

/** Equivalente a WORKDAY.INTL para a Data LoG. */
function workdayCal(ms, n, linha, cal) {
  let cur = ms;
  if (n === 0) return cur;
  const passo = n > 0 ? DIA_MS : -DIA_MS;
  let restantes = Math.abs(n);
  while (restantes > 0) {
    cur += passo;
    if (janelaDoDia(cur, linha, cal)) restantes--;
  }
  return cur;
}

/**
 * Agenda uma OP: percorre os dias abertos consumindo minutos até esgotar.
 * @returns {{inicio: Date, fim: Date, fatias: Array}} fatias = minutos por dia
 */
function agendar(start, horas, linha, cal) {
  const totalMin = Math.max(0, horas * 60);
  const d0 = atMidnight(start);
  const t0 = minutesOfDay(start);

  // arranque: se já passou o fecho do dia proposto, tenta o dia seguinte
  const janela0 = janelaDoDia(d0, linha, cal);
  const dCand = (janela0 && t0 < janela0.fim) ? d0 : d0 + DIA_MS;
  let { ms: dia, janela } = proximoDiaAberto(dCand, linha, cal);

  let tIni = (dia === d0) ? Math.max(janela.inicio, t0) : janela.inicio;
  if (tIni >= janela.almocoIni && tIni < janela.almocoFim) tIni = janela.almocoFim;

  const inicio = new Date(dia + tIni * 60000);
  if (totalMin === 0) return { inicio, fim: inicio, fatias: [] };

  const fatias = [];
  let restante = totalMin;
  let t = tIni;

  for (let guarda = 0; guarda < 1000; guarda++) {
    const disp = disponivelApos(t, janela);
    if (restante <= disp) {
      const tFim = fimApos(t, restante, janela);
      fatias.push({
        dia: dateKey(new Date(dia)), minutos: restante,
        ini: new Date(dia + t * 60000).toISOString(),
        fim: new Date(dia + tFim * 60000).toISOString(),
      });
      return { inicio, fim: new Date(dia + tFim * 60000), fatias };
    }
    if (disp > 0) {
      fatias.push({
        dia: dateKey(new Date(dia)), minutos: disp,
        ini: new Date(dia + Math.max(t, janela.inicio) * 60000).toISOString(),
        fim: new Date(dia + janela.fim * 60000).toISOString(),
      });
    }
    restante -= disp;
    const seg = proximoDiaAberto(dia + DIA_MS, linha, cal);
    dia = seg.ms; janela = seg.janela; t = janela.inicio;
  }
  throw new Error("Ordem demasiado longa para o horizonte de cálculo.");
}

/** "2026-09-01" + "08:10" -> ms UTC, ou null. */
function instante(data, hora) {
  if (!data) return null;
  const t = Date.parse(`${data}T${String(hora || "00:00").slice(0, 5)}:00Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Minutos úteis por dia entre dois instantes, respeitando a janela de cada dia.
 * Usa-se quando o intervalo é imposto de fora (execução real) em vez de ser
 * calculado a partir de uma duração.
 */
function fatiasEntre(iniMs, fimMs, linha, cal) {
  const fatias = [];
  const d0 = atMidnight(new Date(iniMs));
  const d1 = atMidnight(new Date(fimMs));
  const tIni = minutesOfDay(new Date(iniMs));
  const tFim = minutesOfDay(new Date(fimMs));

  for (let d = d0; d <= d1; d += DIA_MS) {
    const j = janelaDoDia(d, linha, cal);
    if (!j) continue;
    const de = d === d0 ? Math.max(j.inicio, tIni) : j.inicio;
    const ate = d === d1 ? Math.min(j.fim, tFim) : j.fim;
    if (ate <= de) continue;
    let minutos = ate - de;
    const almoco = Math.max(0, Math.min(ate, j.almocoFim) - Math.max(de, j.almocoIni));
    minutos -= almoco;
    if (minutos > 0) {
      fatias.push({
        dia: dateKey(new Date(d)), minutos,
        ini: new Date(d + de * 60000).toISOString(),
        fim: new Date(d + ate * 60000).toISOString(),
      });
    }
  }
  return fatias;
}

/**
 * Escalona a fila de uma linha em cadeia: fim da OP anterior + setup = início
 * da seguinte. As datas nunca são guardadas — recalculam-se sempre.
 */
function escalonarLinha(ops, cfg) {
  const { krh, setupMin, ancora, linha, cal } = cfg;
  let cursor = ancora;
  const out = [];

  for (const op of ops) {
    const qtd = Number(op.qtd) || 0;
    const horasExtra = Number(op.horas_extra) || 0;
    // "Tempo atraso" do registo de execução soma-se ao tempo da ordem.
    const atrasoHr = (Number(op.atraso_min) || 0) / 60;
    const necessidadeHr = krh > 0 ? qtd / krh : 0;
    const horas = necessidadeHr + horasExtra + atrasoHr;

    // Fixar num dia: a OP não arranca antes desse dia, mas continua presa à
    // cadeia — se a fila anterior crescer e passar essa data, é empurrada.
    // Assim, largar no dia 08 mantém-na no 08 mesmo que o 05 tenha espaço.
    let inicioMin = cursor.getTime();
    if (op.dia_fixo) inicioMin = Math.max(inicioMin, Date.parse(op.dia_fixo + "T00:00:00Z"));
    if (op.inicio_manual) inicioMin = Math.max(inicioMin, Date.parse(op.inicio_manual));
    const startProposto = new Date(inicioMin);
    const plan = agendar(startProposto, horas, linha, cal);

    // A execução real sobrepõe-se ao plano: o que já aconteceu não se prevê.
    // Início real manda no arranque; fim real manda no fim e, por consequência,
    // arrasta tudo o que vem depois na fila.
    const realIni = instante(op.real_inicio_data, op.real_inicio_hora);
    const realFim = instante(op.real_fim_data, op.real_fim_hora);

    let inicio = plan.inicio;
    let fim = plan.fim;
    let fatias = plan.fatias;
    let origem = "plano";

    if (realIni != null) {
      inicio = new Date(realIni);
      const recalc = agendar(inicio, horas, linha, cal);
      fim = recalc.fim;
      fatias = recalc.fatias;
      origem = "inicio_real";
    }
    if (realFim != null && realFim > inicio.getTime()) {
      fim = new Date(realFim);
      fatias = fatiasEntre(inicio.getTime(), fim.getTime(), linha, cal);
      // Se o intervalo real cair fora do turno, não há minutos úteis para
      // repartir: mantém-se uma fatia no dia de arranque, para a OP não
      // desaparecer da grelha.
      if (!fatias.length) fatias = [{ dia: dateKey(inicio), minutos: 0 }];
      origem = "fim_real";
    }

    out.push({
      ...op,
      necessidade_hr: necessidadeHr,
      necessidade_dias: Math.floor(horas / 8),
      horas_totais: horas,
      data_inicio: inicio.toISOString(),
      data_final: fim.toISOString(),
      plan_inicio: plan.inicio.toISOString(),
      plan_final: plan.fim.toISOString(),
      origem_datas: origem,
      data_log: new Date(workdayCal(atMidnight(inicio), -1, linha, cal)).toISOString(),
      _fatias: fatias,
    });

    cursor = new Date(fim.getTime() + setupMin * 60000);
  }

  return out;
}

/** Reparte a quantidade da OP pelos dias, proporcional aos minutos de cada um. */
function repartirQtd(fatias, qtd) {
  const total = fatias.reduce((s, f) => s + f.minutos, 0);
  const q = Number(qtd) || 0;
  let acum = 0;
  return fatias.map((f, i) => {
    const parte = i === fatias.length - 1
      ? q - acum
      : Math.round(q * (f.minutos / (total || 1)) * 1000) / 1000;
    acum += parte;
    return { ...f, qtd: parte };
  });
}

// --- config.js ---
const LINHAS = ["EE1", "EE2", "EM"];

function turnoEmMinutos(turno) {
  const p = (s) => {
    const [h, m] = String(s).split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return {
    inicio: p(turno.inicio),
    fim: p(turno.fim),
    almocoIni: p(turno.almocoIni),
    almocoFim: p(turno.almocoFim),
  };
}

// --- index.js ---
function inicioManualDe(op) {
  if (op.inicio_modo !== "manual" || !op.dia_fixo || !op.hora_inicio) return op.inicio_manual || null;
  return `${op.dia_fixo}T${String(op.hora_inicio).slice(0, 5)}:00Z`;
}

// Subconjunto de CONFIG_DEFAULT (server/config.js) que o motor usa — para o caso de a config vir incompleta.
// lerConfig() da app faz { ...CONFIG_DEFAULT, ...guardada }; /api/estado já devolve a config fundida.
const CONFIG_BASE = {
  capacidade: { EE1: 9000, EE2: 9000, EM: 6000 },
  setupMin: 15,
  turno: { inicio: "08:00", fim: "17:00", almocoIni: "12:00", almocoFim: "13:00" },
  ancora: "2026-09-01T08:00:00Z",
  paragens: [
  { data: "2026-01-20", motivo: "Feriado" },
  { data: "2026-02-17", motivo: "Carnaval" },
  { data: "2026-04-03", motivo: "Sexta-feira Santa" },
  { data: "2026-04-06", motivo: "Segunda de Páscoa" },
  { data: "2026-04-25", motivo: "Feriado" },
  { data: "2026-05-01", motivo: "Feriado" },
  { data: "2026-06-04", motivo: "Corpo de Deus" },
  { data: "2026-06-05", motivo: "Férias" },
  { data: "2026-06-10", motivo: "Feriado" },
  { data: "2026-08-17", motivo: "Férias" },
  { data: "2026-08-18", motivo: "Férias" },
  { data: "2026-08-19", motivo: "Férias" },
  { data: "2026-08-20", motivo: "Férias" },
  { data: "2026-08-21", motivo: "Férias" },
  { data: "2026-08-24", motivo: "Férias" },
  { data: "2026-08-25", motivo: "Férias" },
  { data: "2026-08-26", motivo: "Férias" },
  { data: "2026-08-27", motivo: "Férias" },
  { data: "2026-08-28", motivo: "Férias" },
  { data: "2026-10-05", motivo: "Feriado" },
  { data: "2026-12-01", motivo: "Feriado" },
  { data: "2026-12-08", motivo: "Feriado" },
],
  excecoes: [],
};

// Parte "linhas" de calcular(opsBruto, cfg, mes) da app (buffer/kanban/dias não interessam ao plano).
// cfg = config devolvida por /api/estado (já é {...CONFIG_DEFAULT, ...guardada}).
function calcularLinhas(opsBruto, cfgIn) {
  const cfg = { ...CONFIG_BASE, ...(cfgIn || {}) };
  const ops = Array.isArray(opsBruto) ? opsBruto : [];
  const cal = {
    paragens: new Set((cfg.paragens || []).map((p) => p.data)),
    excecoes: cfg.excecoes || [],
    turno: turnoEmMinutos(cfg.turno),
  };
  const linhas = {};
  for (const linha of LINHAS) {
    const fila = ops
      .filter((o) => o.linha === linha)
      .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999))
      .map((o, i) => ({ ...o, ordem: i, inicio_manual: inicioManualDe(o) }));
    linhas[linha] = escalonarLinha(fila, {
      krh: cfg.capacidade[linha] || 1,
      setupMin: cfg.setupMin,
      ancora: new Date(cfg.ancora),
      linha,
      cal,
    });
  }
  return linhas;
}

// Plano completo: Map id -> { maquina, inicio, fim, origem, fatias:[{dia,minutos,ini,fim,qtd}] }
// inicio/fim: Date em UTC-parede (ler com getUTC*).
function calcularPlano(ops, cfg) {
  const out = new Map();
  const linhas = calcularLinhas(ops, cfg);
  for (const linha of Object.keys(linhas)) {
    for (const o of linhas[linha]) {
      out.set(o.id, {
        maquina: linha, inicio: new Date(o.data_inicio), fim: new Date(o.data_final),
        origem: o.origem_datas, fatias: repartirQtd(o._fatias || [], o.qtd),
      });
    }
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { calcularLinhas, calcularPlano, agendar, janelaDoDia, LINHAS };
