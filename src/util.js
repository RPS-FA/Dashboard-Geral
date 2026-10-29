// ============================================================
// Utilitários de datas / números — fuso Europe/Lisbon
// ============================================================
'use strict';

const TZ = 'Europe/Lisbon';
const DIA_MS = 86400000;

const fmtData = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHora = new Intl.DateTimeFormat('pt-PT', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** 'YYYY-MM-DD' de hoje em Lisboa. */
function hoje() { return fmtData.format(new Date()); }

/** 'YYYY-MM-DD' em Lisboa para um Date/ISO. */
function dataLisboa(d) { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? null : fmtData.format(x); }

/** 'HH:MM' em Lisboa para um Date/ISO. */
function horaLisboa(d) { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? null : fmtHora.format(x); }

/** Date (UTC 00:00) a partir de 'YYYY-MM-DD'. */
function dUTC(ds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ds || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function dataStr(d) { return d ? d.toISOString().slice(0, 10) : null; }
function addDias(ds, n) { const d = dUTC(ds); if (!d) return null; d.setUTCDate(d.getUTCDate() + n); return dataStr(d); }

/** Diferença em dias (b - a) entre duas 'YYYY-MM-DD'. */
function difDias(a, b) { const da = dUTC(a), db = dUTC(b); if (!da || !db) return null; return Math.round((db - da) / DIA_MS); }

/** Semana ISO 'YYYY-Www' de uma 'YYYY-MM-DD'. */
function semanaISO(ds) {
  const t = dUTC(ds); if (!t) return null;
  const dn = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dn + 3);
  const ano = t.getUTCFullYear();
  const j4 = new Date(Date.UTC(ano, 0, 4));
  const wk = 1 + Math.round(((t - j4) / DIA_MS - 3 + ((j4.getUTCDay() + 6) % 7)) / 7);
  return `${ano}-W${String(wk).padStart(2, '0')}`;
}

/** Segunda-feira ('YYYY-MM-DD') de uma semana 'YYYY-Www'. */
function segundaDaSemana(wk) {
  const m = /(\d{4})-W(\d{1,2})/.exec(wk || ''); if (!m) return null;
  const j4 = new Date(Date.UTC(+m[1], 0, 4));
  const dn = (j4.getUTCDay() + 6) % 7;
  j4.setUTCDate(j4.getUTCDate() - dn + (+m[2] - 1) * 7);
  return dataStr(j4);
}
function domingoDaSemana(wk) { const s = segundaDaSemana(wk); return s ? addDias(s, 6) : null; }

/**
 * Normaliza qualquer valor de data para 'YYYY-MM-DD' (ou null).
 * Aceita: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ssZ', 'YYYY-MM-DD HH:mm', 'DD/MM/YYYY', Date.
 * Para datetimes ISO com hora, converte para o dia em Lisboa.
 */
function paraData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return dataLisboa(v);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(\.000)?Z$/.exec(s);
  if (m) return s.slice(0, 10); // data "pura" guardada como meia-noite UTC
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (m) { return /Z|[+-]\d{2}:?\d{2}$/.test(s) ? dataLisboa(s) : s.slice(0, 10); }
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s); // D/M/YYYY (pt) — nunca interpretar como M/D/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (s.includes('/')) return null; // formato com barras desconhecido: não arriscar o parser do JS (M/D/Y)
  const d = new Date(s);
  return isNaN(d) ? null : dataLisboa(d);
}

/** Combina data ('YYYY-MM-DD') + hora ('HH:MM') -> 'YYYY-MM-DD HH:MM' (ou só data, ou null). */
function dataHora(data, hora) {
  const d = paraData(data); if (!d) return null;
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hora || '').trim());
  return h ? `${d} ${h[1].padStart(2, '0')}:${h[2]}` : d;
}

/** Datetime ISO -> 'YYYY-MM-DD HH:MM' em Lisboa. */
function isoParaLocal(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`; // já local, sem fuso
  const d = new Date(s); if (isNaN(d)) return null;
  return `${dataLisboa(d)} ${horaLisboa(d)}`;
}

/** Converte tempos de atraso ('', '30', 30, '1:30', '01h30', '90 min') para minutos. */
function paraMinutos(v) {
  if (v == null || v === '' || v === false) return 0;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  let m = /^(\d{1,3})[:h](\d{1,2})/.exec(s);
  if (m) return (+m[1]) * 60 + (+m[2]);
  m = /^(\d+(?:\.\d+)?)\s*h$/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = /^(\d+(?:\.\d+)?)/.exec(s);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

/** Minutos decorridos desde 'YYYY-MM-DD HH:MM' (hora de Lisboa) até `agora` (Date). */
function minutosDesde(local, agora) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(local || '');
  if (!m) return null;
  // Converte hora local de Lisboa para UTC usando o desvio em vigor nessa data
  const aprox = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)));
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(aprox);
  const off = (partes.find(p => p.type === 'timeZoneName') || {}).value || 'GMT';
  const mo = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
  const offMin = mo ? (mo[1] === '-' ? -1 : 1) * ((+mo[2]) * 60 + (+(mo[3] || 0))) : 0;
  const utc = aprox.getTime() - offMin * 60000;
  return Math.max(0, Math.round((agora.getTime() - utc) / 60000));
}


// ------------------------------------------------------------
// Dias úteis (2.ª a 6.ª, sem feriados). Fontes:
//   feriados obrigatórios — Código do Trabalho, art. 234.º, n.º 1 (1/1, Sexta-Feira Santa, Páscoa, 25/4, 1/5, Corpo de Deus,
//   10/6, 15/8, 5/10, 1/11, 1/12, 8/12, 25/12); feriado municipal de Santa Maria da Feira: 20/1 (S. Sebastião).
// Configurável: FERIADO_MUNICIPAL (MM-DD, defeito 01-20; vazio = nenhum) e FERIADOS_EXTRA (lista separada por vírgulas de
// AAAA-MM-DD ou MM-DD — ex.: Carnaval, pontes, férias colectivas).
// ------------------------------------------------------------
function pascoa(ano) { // algoritmo anónimo gregoriano (Meeus/Jones/Butcher)
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const _feriadosCache = {};
function feriados(ano, env) {
  const e = env || process.env;
  const chave = `${ano}|${e.FERIADO_MUNICIPAL === undefined ? '(defeito)' : e.FERIADO_MUNICIPAL}|${e.FERIADOS_EXTRA ?? ''}`;
  if (_feriadosCache[chave]) return _feriadosCache[chave];
  const p = pascoa(ano);
  const fixos = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'].map(md => `${ano}-${md}`);
  const moveis = [addDias(p, -2), p, addDias(p, 60)]; // Sexta-Feira Santa, Páscoa, Corpo de Deus
  const mun = e.FERIADO_MUNICIPAL === undefined ? '01-20' : String(e.FERIADO_MUNICIPAL).trim();
  const extra = String(e.FERIADOS_EXTRA || '').split(',').map(x => x.trim()).filter(Boolean)
    .map(x => /^\d{2}-\d{2}$/.test(x) ? `${ano}-${x}` : x).filter(x => x.startsWith(`${ano}-`));
  const set = new Set([...fixos, ...moveis, ...(/^\d{2}-\d{2}$/.test(mun) ? [`${ano}-${mun}`] : []), ...extra]);
  _feriadosCache[chave] = set;
  return set;
}
/** true se 'YYYY-MM-DD' é dia útil (2.ª–6.ª e não feriado). */
function diaUtil(ds, env) {
  const d = dUTC(ds); if (!d) return false;
  const dow = d.getUTCDay(); if (dow === 0 || dow === 6) return false;
  return !feriados(d.getUTCFullYear(), env).has(ds.slice(0, 10));
}
/**
 * Distância de `hoje` a `alvo` para a regra D / D+n:
 *  · alvo > hoje → nº de DIAS ÚTEIS em (hoje, alvo] — um plano ao sábado/domingo/feriado conta como o último dia útil antes
 *    (ex.: hoje 6.ª, plano sábado → 0 = "Hoje"; hoje 5.ª, plano 2.ª → 2 = D+2)
 *  · alvo = hoje → 0
 *  · alvo < hoje → dias corridos negativos (atrasada)
 */
function diasUteisAte(hoje, alvo, env) {
  const cor = difDias(hoje, alvo);
  if (cor == null || cor <= 0) return cor;
  let n = 0;
  for (let i = 1; i <= cor; i++) if (diaUtil(addDias(hoje, i), env)) n++;
  return n;
}

/** Texto para pesquisa: minúsculas, sem acentos, espaços colapsados. */
function normTexto(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/** Campos de uma ordem usados na pesquisa global. */
const CAMPOS_PESQUISA = ['op', 'ref', 'pedido', 'cliente', 'produto', 'calibre', 'maquina', 'fase', 'estado_origem', 'obs', 'unidade'];
function textoPesquisa(o) { return normTexto(CAMPOS_PESQUISA.map(k => o[k]).filter(Boolean).join(' | ')); }
/** Todas as palavras da pesquisa têm de aparecer (em qualquer campo). Devolve true/false. */
function corresponde(texto, q) { const toks = normTexto(q).split(' ').filter(Boolean); return toks.length > 0 && toks.every(t => texto.includes(t)); }

/**
 * Número de OP (SAP) escrito no campo OP: 8 dígitos seguidos, não colados a letras/dígitos e sem começar por 0
 * (as OPs do CSP1 começam por 11…18; os lotes "LT02356473" e os pedidos "4400041993-10" não contam).
 * Aceita "12063090- LT02356473", "14400249 -2", "OP12063090". Devolve '12063090' ou null.
 */
const RE_OP8 = /(?<![A-Za-z0-9])([1-9]\d{7})(?!\d)/;
function numOP(s) { const m = RE_OP8.exec(String(s == null ? '' : s).replace(/OP(?=\d)/gi, 'OP ')); return m ? m[1] : null; }

function num(v) { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function limpa(s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); }

module.exports = { TZ, hoje, dataLisboa, horaLisboa, addDias, difDias, semanaISO, segundaDaSemana, domingoDaSemana, paraData, dataHora, isoParaLocal, paraMinutos, minutosDesde, normTexto, textoPesquisa, corresponde, CAMPOS_PESQUISA, numOP, num, limpa, pascoa, feriados, diaUtil, diasUteisAte };
