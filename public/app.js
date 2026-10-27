// ============================================================
// Dashboard OPS — cliente (JS puro, sem dependências)
// Lê /api/resumo a cada N segundos e renderiza KPIs, unidades e tabela.
// ============================================================
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nR = n => (Math.round(+n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dPT = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
const dhPT = s => s ? (s.length > 10 ? `${dPT(s)} ${s.slice(11, 16)}` : dPT(s)) : '—';
const minH = m => !m ? '—' : (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);

const ESTADOS_ORDEM = ['pre', 'aberto', 'liberada', 'entregue_log', 'em_processo', 'terminada', 'espera_job', 'fechada', 'desconhecido'];
const BARRA_ESTADOS = ['pre', 'aberto', 'liberada', 'entregue_log', 'em_processo', 'desconhecido'];
const MAQ_ESTADO = { em_processo: 'a processar', manutencao: 'manutenção', planeada: 'parada · com fila', sem_plano: 'sem plano' };
const horaDe = s => (s && s.length > 10) ? s.slice(11, 16) : null;
const decorrido = m => m == null ? '' : (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`));

let DADOS = null;
let FILTRO = { unidade: '', estado: '', atrasos: false, hoje: false, fechadas: false, pesq: '', kpi: '' };
let ORDENACAO = { k: '', dir: 1 };
let temporizador = null;

// ------------------------------------------------------------
// Carregamento
// ------------------------------------------------------------
async function carregar(forcar) {
  const main = $('#main');
  main.classList.add('a-actualizar');
  try {
    if (forcar) await fetch('/api/refresh', { method: 'POST' }).catch(() => {});
    const r = await fetch('/api/resumo', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DADOS = await r.json();
    render();
    main.classList.remove('a-carregar');
  } catch (e) {
    toast('Falha a ler o dashboard: ' + e.message);
  } finally {
    main.classList.remove('a-actualizar');
  }
}
function agendar() {
  clearInterval(temporizador);
  const seg = (DADOS && DADOS.refresh_seg) || 60;
  temporizador = setInterval(() => { if (!document.hidden) carregar(false); }, seg * 1000);
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function render() {
  if (!DADOS) return;
  renderMeta(); renderFontes(); renderKpis(); renderMaquinas(); renderUnidades(); renderFiltros(); renderTabela();
  agendar();
}

// ------------------------------------------------------------
// Painel de máquinas
// ------------------------------------------------------------
function linhaOrdem(o, comTempo) {
  const t = [];
  if (o.real_inicio && comTempo) t.push(`início ${dhPT(o.real_inicio)}`);
  if (o.decorrido_min != null && comTempo) t.push(`<b>há ${decorrido(o.decorrido_min)}</b>`);
  if (!o.real_inicio && o.hora_plano_ini) t.push(`plano ${dPT(o.data_plano)} ${o.hora_plano_ini}${o.hora_plano_fim ? '→' + o.hora_plano_fim : ''}`);
  else if (!o.real_inicio && o.data_plano) t.push(`plano ${dPT(o.data_plano)}`);
  if (o.real_fim && comTempo) t.push(`fim ${dhPT(o.real_fim)}`);
  if (o.atraso_prod_min) t.push(`paragem ${minH(o.atraso_prod_min)}`);
  return t.join(' · ');
}
function renderMaquinas() {
  $('#maquinas').innerHTML = DADOS.unidades.map(u => {
    const f = u.fonte;
    const cls = !f.ok ? 'falha' : (f.idade_min != null && f.idade_min > 10 ? 'velho' : 'ok');
    const tiles = u.maquinas.length ? u.maquinas.map(m => {
      const a = m.atuais[0];
      const corpo = a ? `
        <div class="mop"><b>${esc(a.op || a.ref || '—')}${a.urgente ? ' <span class="tag urg">urg</span>' : ''}${a.manutencao ? ' <span class="tag manut">manut.</span>' : ''}</b><span>${a.qtd ? nR(a.qtd) + ' un.' : ''}</span></div>
        <div class="mdet" title="${esc([a.cliente, a.produto, a.fase].filter(Boolean).join(' · '))}">${esc([a.cliente, a.produto].filter(Boolean).join(' · ') || a.fase || '')}</div>
        <div class="mtempo">${linhaOrdem(a, true) || `<span class="origem">${esc(a.estado_origem)}</span>`}${m.n_atuais > 1 ? ` <span class="mais">+${m.n_atuais - 1} em processo</span>` : ''}</div>`
        : `<div class="mop"><span class="mvazio">${m.estado === 'planeada' ? 'nada em processo' : 'sem ordens planeadas'}</span></div>`;
      const prox = m.proximas.length ? `<div class="mprox" title="${esc(m.proximas.map(o => `${o.op} · ${o.cliente} · ${nR(o.qtd)} un. · ${DADOS.estados[o.estado]}${o.data_plano ? ' · ' + dPT(o.data_plano) : ''}${o.hora_plano_ini ? ' ' + o.hora_plano_ini : ''}`).join('\n'))}">a seguir: ${m.proximas.slice(0, 2).map(o => `<b>${esc(o.op || o.ref)}</b>${o.hora_plano_ini && !o.real_inicio ? ' ' + esc(o.hora_plano_ini) : (o.data_plano && u.granularidade === 'dia' ? ' ' + dPT(o.data_plano) : '')}`).join(', ')}${m.n_fila > 2 ? ` <span class="mais">+${m.n_fila - 2}</span>` : ''}</div>` : '';
      const rod = u.granularidade === 'dia' ? `<div class="mrod"><span>hoje ${m.hoje_n}${m.hoje_qtd ? ' · ' + nR(m.hoje_qtd) + ' un.' : ''}</span><span>feitas ${m.feitas_hoje_n}</span>${m.atrasadas ? `<span class="alerta">⚠ ${m.atrasadas} em atraso</span>` : ''}</div>`
        : `<div class="mrod"><span>fila ${m.n_fila}</span>${m.atrasadas ? `<span class="alerta">⚠ ${m.atrasadas} em atraso</span>` : ''}</div>`;
      return `<div class="maq ${m.estado}" data-unidade="${esc(u.unidade)}" data-maquina="${esc(m.nome)}" title="Ver ordens desta máquina">
        <div class="mcab"><b><span class="munit">${esc(u.unidade)} · </span>${esc(m.nome)}</b><span class="mest">${MAQ_ESTADO[m.estado] || m.estado}</span></div>${corpo}${prox}${rod}</div>`;
    }).join('') : `<div class="nota">${f.ok ? 'sem máquinas configuradas' : 'sem ligação — ' + esc(f.erro || '')}</div>`;
    return `<div class="grupo-maq"><div class="gcab"><b>${esc(u.unidade)}</b><span>${esc(u.nome)}</span><span class="chip ${cls}" title="${esc(f.ok ? 'ligação OK' : f.erro || '')}"><i class="pt"></i>${f.ok ? 'ligado' : 'sem ligação'}</span></div><div class="tiles">${tiles}</div></div>`;
  }).join('');
  $$('#maquinas .maq').forEach(el => el.addEventListener('click', () => {
    FILTRO.unidade = el.dataset.unidade; $('#fUnidade').value = FILTRO.unidade;
    FILTRO.pesq = el.dataset.maquina; $('#fPesq').value = FILTRO.pesq;
    FILTRO.kpi = ''; FILTRO.estado = ''; FILTRO.atrasos = false; FILTRO.hoje = false; $('#fEstado').value = ''; $('#fAtrasos').checked = false; $('#fHoje').checked = false;
    renderKpis(); renderTabela();
    if (!document.body.classList.contains('tv')) $('#tabelaSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderMeta() {
  const d = DADOS;
  const hora = d.ultima_agregacao ? new Date(d.ultima_agregacao).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '—';
  $('#meta').textContent = `${dPT(d.hoje)}/${d.hoje.slice(0, 4)} · semana ${d.semana.split('-W')[1]} · última leitura ${hora} · ${d.fontes_ok}/${d.fontes_total} apps ligadas · actualiza a cada ${d.refresh_seg} s`;
}

function renderFontes() {
  $('#fontes').innerHTML = DADOS.unidades.map(u => {
    const f = u.fonte;
    const cls = !f.ok ? 'falha' : (f.idade_min != null && f.idade_min > 10 ? 'velho' : 'ok');
    const tit = f.ok ? `OK · ${f.n} registos · ${f.ms} ms · lida há ${f.idade_min ?? 0} min` : `FALHA: ${f.erro || '?'}${f.ultima_ok ? ' · última leitura boa ' + new Date(f.ultima_ok).toLocaleString('pt-PT') : ''}`;
    return `<span class="chip ${cls}" title="${esc(tit)}"><i class="pt"></i>${esc(u.unidade)}</span>`;
  }).join('');
}

function kpiTile(cls, rot, val, det, chave, alerta) {
  const act = FILTRO.kpi === chave ? ' activo' : '';
  return `<div class="kpi ${cls}${act}" data-kpi="${chave}" role="button" tabindex="0">
    <div class="rot">${rot}</div>
    <div class="val${alerta ? ' alerta' : ''}">${val}</div>
    <div class="det">${det}</div></div>`;
}
function renderKpis() {
  const t = DADOS.total;
  $('#kpis').innerHTML = [
    kpiTile('k-proc', 'Em processo agora', t.em_curso, `${nR(t.qtd_em_curso)} un. · ${DADOS.maquinas_em_processo}/${DADOS.maquinas_total} máquinas a processar`, 'em_curso'),
    kpiTile('k-prazo', '<span class="ico">⏰</span> Atraso prazo cliente', t.atraso_prazo, 'data limite ultrapassada, não terminada', 'atraso_prazo', t.atraso_prazo > 0),
    kpiTile('k-plano', '<span class="ico">⚠</span> Atraso plano', t.atraso_plano, 'dia planeado passou, não terminada', 'atraso_plano', t.atraso_plano > 0),
    kpiTile('k-hoje', 'Planeado para hoje', t.hoje, `${nR(t.qtd_hoje)} un. por fazer · ${t.feitas_hoje} terminadas hoje (${nR(t.qtd_feita_hoje)} un.)`, 'hoje'),
    kpiTile('k-semana', 'Esta semana', t.semana, `${nR(t.qtd_semana)} un. · activas`, 'semana'),
    kpiTile('k-ativas', 'Ordens activas', t.ativas, `${t.urgentes} urgentes · ${t.espera_job} à espera de JOB · paragens 7 d ${minH(t.paragens_7d_min)}`, 'ativas'),
  ].join('');
  $$('#kpis .kpi').forEach(el => el.addEventListener('click', () => { aplicarKpi(el.dataset.kpi); }));
}

function barraEstados(k) {
  const tot = BARRA_ESTADOS.reduce((s, e) => s + (k.por_estado[e] || 0), 0);
  if (!tot) return '<div class="nota">sem ordens activas</div>';
  const segs = BARRA_ESTADOS.filter(e => k.por_estado[e] > 0).map(e => `<i class="${e}" style="width:${(100 * k.por_estado[e] / tot).toFixed(1)}%" title="${esc(DADOS.estados[e])}: ${k.por_estado[e]}"></i>`).join('');
  const leg = BARRA_ESTADOS.filter(e => k.por_estado[e] > 0).map(e => `<span><i class="sw ${e}"></i>${esc(DADOS.estados[e])} ${k.por_estado[e]}</span>`).join('');
  return `<div class="barra" aria-label="Ordens activas por estado">${segs}</div><div class="legenda">${leg}</div>`;
}

function renderUnidades() {
  $('#unidades').innerHTML = DADOS.unidades.map(u => {
    const k = u.kpi, f = u.fonte;
    const lista = u.em_curso.length ? u.em_curso.map(o => `<li class="${o.manutencao ? 'manut' : ''}">
        <span class="op">${esc(o.op || o.ref || '—')}${o.urgente ? ' <span class="tag urg">urgente</span>' : ''}${o.manutencao ? ' <span class="tag manut">manutenção</span>' : ''}</span>
        <span class="lmaq">${esc(o.maquina || (o.fase ? o.fase.split(' (')[0] : '') || '—')}</span>
        <span class="qtd">${o.qtd ? nR(o.qtd) + ' un.' : ''}</span>
        <span class="det">${esc([o.cliente, o.produto, o.real_inicio ? 'início ' + dhPT(o.real_inicio) : (o.data_plano ? 'plano ' + dPT(o.data_plano) : '')].filter(Boolean).join(' · '))}</span>
      </li>`).join('') : '<li class="vazio">nada em processo</li>';
    const notas = [];
    if (u.estado_derivado) notas.push('a app não regista execução: só LOTE FINAL (fechada) e CONTADO; não há "em processo"');
    if (u.granularidade === 'semana') notas.push('plano à semana: "hoje" não se aplica; atraso conta a partir da segunda-feira seguinte');
    if (u.granularidade === 'fila') notas.push('fila por máquina sem data: "hoje" e "atraso plano" não se aplicam; só a data limite');
    if (k.espera_job) notas.push(`${k.espera_job} terminadas à espera de JOB (SAP)`);
    if (!f.ok && f.ultima_ok) notas.push('a mostrar a última leitura boa');
    return `<article class="card ${f.ok ? '' : 'falha'}" data-unidade="${esc(u.unidade)}">
      <div class="cab"><h2>${esc(u.unidade)}</h2><span class="nome">${esc(u.nome)}</span><a href="${esc(u.url)}" target="_blank" rel="noopener">abrir ↗</a></div>
      ${f.ok ? '' : `<div class="erro">Sem ligação: ${esc(f.erro || '?')}</div>`}
      <div class="mini">
        <div class="m-proc" data-kpi="em_curso"><b>${k.em_curso}</b><span>em proc.</span></div>
        <div class="m-prazo" data-kpi="atraso_prazo"><b class="${k.atraso_prazo ? 'alerta' : ''}">${k.atraso_prazo}</b><span>atr. prazo</span></div>
        <div class="m-plano" data-kpi="atraso_plano"><b class="${k.atraso_plano ? 'alerta' : ''}">${k.atraso_plano}</b><span>atr. plano</span></div>
        <div data-kpi="hoje"><b>${u.granularidade !== 'dia' ? '·' : k.hoje}</b><span>hoje</span></div>
        <div data-kpi="semana"><b>${k.semana}</b><span>semana</span></div>
      </div>
      ${barraEstados(k)}
      <ul class="emcurso">${lista}</ul>
      ${notas.length ? `<div class="nota">${esc(notas.join(' · '))}</div>` : ''}
    </article>`;
  }).join('');
  $$('#unidades .mini div').forEach(el => el.addEventListener('click', () => {
    const u = el.closest('.card').dataset.unidade;
    FILTRO.unidade = u; $('#fUnidade').value = u; aplicarKpi(el.dataset.kpi, true);
  }));
}

function aplicarKpi(chave, manterUnidade) {
  if (!manterUnidade) { FILTRO.unidade = ''; $('#fUnidade').value = ''; }
  FILTRO.kpi = (FILTRO.kpi === chave && !manterUnidade) ? '' : chave;
  FILTRO.estado = ''; FILTRO.atrasos = false; FILTRO.hoje = false; FILTRO.fechadas = false;
  if (FILTRO.kpi === 'em_curso') FILTRO.estado = 'em_processo';
  if (FILTRO.kpi === 'atraso_prazo' || FILTRO.kpi === 'atraso_plano') FILTRO.atrasos = true;
  if (FILTRO.kpi === 'hoje') FILTRO.hoje = true;
  $('#fEstado').value = FILTRO.estado; $('#fAtrasos').checked = FILTRO.atrasos; $('#fHoje').checked = FILTRO.hoje; $('#fFechadas').checked = false;
  renderKpis(); renderTabela();
  if (!document.body.classList.contains('tv')) $('#tabelaSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFiltros() {
  const su = $('#fUnidade');
  if (su.options.length <= 1) {
    DADOS.unidades.forEach(u => su.insertAdjacentHTML('beforeend', `<option value="${esc(u.unidade)}">${esc(u.unidade)}</option>`));
    const se = $('#fEstado');
    ESTADOS_ORDEM.forEach(e => se.insertAdjacentHTML('beforeend', `<option value="${e}">${esc(DADOS.estados[e])}</option>`));
  }
}

function filtrar() {
  const p = FILTRO.pesq.trim().toLowerCase();
  const hoje = DADOS.hoje;
  return DADOS.ordens.filter(o => {
    if (o.manutencao && FILTRO.estado !== 'em_processo') return false;
    if (FILTRO.unidade && o.unidade !== FILTRO.unidade) return false;
    if (FILTRO.estado) { if (o.estado !== FILTRO.estado) return false; }
    else if (o.terminal) { if (!FILTRO.fechadas || !o.fechada_7d) return false; }
    if (FILTRO.kpi === 'atraso_prazo' && !o.atraso_prazo) return false;
    if (FILTRO.kpi === 'atraso_plano' && !o.atraso_plano) return false;
    if (FILTRO.atrasos && !(o.atraso_prazo || o.atraso_plano)) return false;
    if (FILTRO.hoje && !o.hoje) return false;
    if (FILTRO.kpi === 'semana' && !o.semana) return false;
    if (p) {
      const txt = [o.op, o.ref, o.pedido, o.cliente, o.produto, o.maquina, o.estado_origem, o.obs].join(' ').toLowerCase();
      if (!txt.includes(p)) return false;
    }
    return true;
  });
}

function ordenar(lista) {
  const k = ORDENACAO.k; if (!k) return lista;
  const val = o => k === 'atraso' ? Math.max(o.atraso_prazo_dias, o.atraso_plano_dias) : (k === 'estado' ? ESTADOS_ORDEM.indexOf(o.estado) : (o[k] == null ? '' : o[k]));
  return [...lista].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt')) * ORDENACAO.dir; });
}

function renderTabela() {
  const lista = ordenar(filtrar());
  $('#contagem').textContent = `${lista.length} ordens`;
  const linhas = lista.slice(0, 800).map(o => {
    const cls = o.em_curso ? 'proc' : (o.atraso_prazo ? 'prazo' : (o.atraso_plano ? 'plano' : ''));
    const atr = o.atraso_prazo ? `<span class="atr-prazo" title="prazo cliente">${o.atraso_prazo_dias} d</span>` : (o.atraso_plano ? `<span class="atr-plano" title="plano">${o.atraso_plano_dias} d</span>` : '—');
    const plano = o.plano_granularidade === 'semana' ? `S${(o.semana_plano || '').split('-W')[1] || '—'}` : (o.plano_granularidade === 'fila' ? `fila${o.semana_plano ? ' S' + o.semana_plano.split('-W')[1] : ''}` : dPT(o.data_plano) + (o.hora_plano_ini ? ` ${o.hora_plano_ini}` : ''));
    return `<tr class="${cls}">
      <td>${esc(o.unidade)}</td>
      <td><b>${esc(o.op || '—')}</b>${o.urgente ? ' <span class="tag urg">urg</span>' : ''}${o.manutencao ? ' <span class="tag manut">manut.</span>' : ''}${o.ref ? `<div class="origem">${esc(o.ref)}</div>` : ''}</td>
      <td class="cliente" title="${esc(o.cliente)}">${esc(o.cliente || '—')}</td>
      <td class="produto" title="${esc(o.produto + (o.obs ? ' · ' + o.obs : ''))}">${esc(o.produto || '—')}</td>
      <td>${esc(o.maquina || '—')}${o.fase ? `<div class="origem">${esc(o.fase)}</div>` : ''}</td>
      <td><span class="est ${o.estado}"><i></i>${esc(DADOS.estados[o.estado] || o.estado)}</span><div class="origem">${esc(o.estado_origem)}${o.estado_derivado ? ' *' : ''}</div></td>
      <td title="${esc(o.data_plano || '')}${o.data_fim_plano && o.data_fim_plano !== o.data_plano ? ' → ' + esc(o.data_fim_plano) : ''}">${plano}${o.data_fim_plano && o.data_fim_plano !== o.data_plano && o.plano_granularidade === 'dia' ? `<div class="origem">até ${dPT(o.data_fim_plano)}${o.hora_plano_fim ? ' ' + o.hora_plano_fim : ''}</div>` : ''}</td>
      <td>${dPT(o.data_limite)}${o.data_log ? `<div class="origem">log. ${dPT(o.data_log)}</div>` : ''}</td>
      <td class="num">${atr}</td>
      <td class="num" title="${esc(o.motivo_paragem || '')}">${minH(o.atraso_prod_min)}</td>
      <td>${o.real_inicio || o.real_fim ? `${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}` : '—'}${o.decorrido_min != null ? `<div class="origem">há ${decorrido(o.decorrido_min)}</div>` : ''}</td>
      <td class="num">${o.qtd ? nR(o.qtd) : '—'}</td>
    </tr>`;
  }).join('');
  $('#tbody').innerHTML = linhas || '<tr><td colspan="12" class="nota" style="padding:18px">Sem ordens para este filtro.</td></tr>';
  $$('#tabela th').forEach(th => { th.classList.toggle('sort-asc', ORDENACAO.k === th.dataset.k && ORDENACAO.dir === 1); th.classList.toggle('sort-desc', ORDENACAO.k === th.dataset.k && ORDENACAO.dir === -1); });
}

function exportarCsv() {
  const lista = ordenar(filtrar());
  const cab = ['Unidade', 'OP', 'Lote/Ref', 'Pedido', 'Cliente', 'Produto', 'Calibre', 'Maquina', 'Fase', 'Estado', 'Estado origem', 'Dia plano', 'Hora plano ini', 'Fim plano', 'Hora plano fim', 'Semana plano', 'Data limite', 'Data logistica', 'Atraso prazo (dias)', 'Atraso plano (dias)', 'Paragem (min)', 'Motivo paragem', 'Inicio real', 'Fim real', 'Qtd (un)', 'Urgente', 'Obs'];
  const linhas = lista.map(o => [o.unidade, o.op, o.ref, o.pedido, o.cliente, o.produto, o.calibre, o.maquina, o.fase, DADOS.estados[o.estado], o.estado_origem, o.data_plano, o.hora_plano_ini, o.data_fim_plano, o.hora_plano_fim, o.semana_plano, o.data_limite, o.data_log, o.atraso_prazo_dias || '', o.atraso_plano_dias || '', o.atraso_prod_min || '', o.motivo_paragem, o.real_inicio, o.real_fim, o.qtd, o.urgente ? 'sim' : '', o.obs]
    .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';'));
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ordens_csp1_${DADOS.hoje}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 4000); }

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
$('#fUnidade').addEventListener('change', e => { FILTRO.unidade = e.target.value; renderTabela(); });
$('#fEstado').addEventListener('change', e => { FILTRO.estado = e.target.value; FILTRO.kpi = ''; renderKpis(); renderTabela(); });
$('#fAtrasos').addEventListener('change', e => { FILTRO.atrasos = e.target.checked; if (!e.target.checked && (FILTRO.kpi === 'atraso_prazo' || FILTRO.kpi === 'atraso_plano')) { FILTRO.kpi = ''; renderKpis(); } renderTabela(); });
$('#fHoje').addEventListener('change', e => { FILTRO.hoje = e.target.checked; if (!e.target.checked && FILTRO.kpi === 'hoje') { FILTRO.kpi = ''; renderKpis(); } renderTabela(); });
$('#fFechadas').addEventListener('change', e => { FILTRO.fechadas = e.target.checked; renderTabela(); });
$('#fPesq').addEventListener('input', e => { FILTRO.pesq = e.target.value; renderTabela(); });
$('#btnCsv').addEventListener('click', exportarCsv);
$('#btnAtualizar').addEventListener('click', () => carregar(true));
$('#btnTv').addEventListener('click', () => { document.body.classList.toggle('tv'); const u = new URL(location.href); if (document.body.classList.contains('tv')) u.searchParams.set('tv', '1'); else u.searchParams.delete('tv'); history.replaceState(null, '', u); });
$$('#tabela th').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; if (ORDENACAO.k === k) ORDENACAO.dir = -ORDENACAO.dir; else { ORDENACAO.k = k; ORDENACAO.dir = 1; } renderTabela(); }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && DADOS) carregar(false); });

if (new URLSearchParams(location.search).get('tv') === '1') document.body.classList.add('tv');
carregar(false);
