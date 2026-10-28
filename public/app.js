// ============================================================
// Dashboard Geral — urgências de planeamento (JS puro, sem dependências)
// Lê /api/resumo a cada N segundos e mostra: OPs por abrir, excepções ("Atenção") e pesquisa global.
// ============================================================
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nR = n => (Math.round(+n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const dPT = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
const dhPT = s => s ? (s.length > 10 ? `${dPT(s)} ${s.slice(11, 16)}` : dPT(s)) : '—';
const minH = m => !m ? '—' : (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const decorrido = m => m == null ? '' : (m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`));
const opTxt = o => o.op || o.ref || '—';
const semanaTxt = o => { const s = (o.semana_plano || '').split('-W')[1]; return s ? `S${s}` : null; };
function planoTxt(o) {
  if (o.plano_granularidade === 'semana') return semanaTxt(o) || '—';
  if (o.plano_granularidade === 'fila') return semanaTxt(o) ? `fila ${semanaTxt(o)}` : 'fila';
  return o.data_plano ? dPT(o.data_plano) + (o.hora_plano_ini ? ' ' + o.hora_plano_ini : '') : '—';
}
function diasTxt(o) {
  const d = o.dias_plano;
  if (d == null) return 'sem data';
  if (d === 0) return 'hoje';
  return d < 0 ? `há ${-d} d` : `em ${d} d`;
}
const ORDEM_UNID = ['PURECORK', 'DSL', 'DENSIDADES', 'WIM', 'VOCUS', 'DS100', 'DSL TALIS'];

let DADOS = null;
let ECRA = new URLSearchParams(location.search).get('unidade') || ''; // ?unidade=DSL -> só essa unidade
let OPS_TUDO = false;
let temporizador = null;
const unidade = u => DADOS.unidades.find(x => x.unidade === u);

// ------------------------------------------------------------
// Pesquisa global (todas as unidades, activas e fechadas, sem limite de data)
// ------------------------------------------------------------
const normTexto = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const CAMPOS_PESQUISA = ['op', 'ref', 'pedido', 'cliente', 'produto', 'calibre', 'maquina', 'fase', 'estado_origem', 'obs', 'unidade'];
const textoPesquisa = o => normTexto(CAMPOS_PESQUISA.map(k => o[k]).filter(Boolean).join(' | '));
function procurar(q) {
  const toks = normTexto(q).split(' ').filter(Boolean);
  if (!toks.length || !DADOS) return [];
  return DADOS.ordens.filter(o => { const t = textoPesquisa(o); return toks.every(k => t.includes(k)); });
}
function realcar(txt, q) {
  const toks = normTexto(q).split(' ').filter(Boolean);
  let h = esc(txt);
  for (const t of toks) { if (t.length < 2) continue; const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'); h = h.replace(re, m => `<mark>${m}</mark>`); }
  return h;
}
function renderPesquisa() {
  const q = $('#qGlobal').value.trim();
  const box = $('#qResultados');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const res = procurar(q);
  const porUnid = {};
  for (const o of res) (porUnid[o.unidade] = porUnid[o.unidade] || []).push(o);
  const unids = Object.keys(porUnid).sort((a, b) => ORDEM_UNID.indexOf(a) - ORDEM_UNID.indexOf(b));
  const MAX = 12;
  const linha = o => `<div class="q-item" data-id="${esc(o.id)}" title="Ver detalhe">
      <div class="q1"><b>${realcar(opTxt(o), q)}</b>${o.ref && o.ref !== o.op ? `<span class="origem">${realcar(o.ref, q)}</span>` : ''}${o.pedido ? `<span class="origem">· ${realcar(o.pedido, q)}</span>` : ''}${o.urgente ? ' <span class="tag urg">urg</span>' : ''}${o.sem_op ? ' <span class="tag semop">sem OP</span>' : ''}</div>
      <div class="q2">${realcar([o.cliente, o.produto, o.maquina ? 'máq. ' + o.maquina : '', o.fase].filter(Boolean).join(' · '), q)}</div>
      <div class="q3"><span class="est ${o.estado}"><i></i>${esc(DADOS.estados[o.estado] || o.estado)}</span><div class="origem">${esc(o.estado_origem)} · plano ${esc(planoTxt(o))}${o.data_limite ? ' · limite ' + dPT(o.data_limite) : ''}</div><div class="origem">${o.real_inicio || o.real_fim ? `real ${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}` : ''}${o.qtd ? ` · ${nR(o.qtd)} un.` : ''}</div></div>
    </div>`;
  box.innerHTML = res.length ? `<div class="q-cab"><span><b>${res.length}</b> resultado${res.length === 1 ? '' : 's'} em <b>${unids.length}</b> unidade${unids.length === 1 ? '' : 's'} para "${esc(q)}"</span><span>Esc fecha · clique abre o detalhe</span></div>`
    + unids.map(u => { const l = porUnid[u]; const uni = unidade(u); return `<div class="q-grupo"><h4>${esc(u)} <span>${l.length}</span>${uni ? `<a href="${esc(uni.url)}" target="_blank" rel="noopener">abrir app ↗</a>` : ''}</h4>${l.slice(0, MAX).map(linha).join('')}${l.length > MAX ? `<div class="q-mais">+ ${l.length - MAX} nesta unidade — refina a pesquisa</div>` : ''}</div>`; }).join('')
    : `<div class="q-vazio">Nada encontrado para "${esc(q)}" em ${DADOS.ordens.length} ordens das 7 unidades (activas e fechadas).</div>`;
  box.hidden = false;
  $$('#qResultados .q-item').forEach(el => el.addEventListener('click', () => { box.hidden = true; abrirDetalhe(el.dataset.id); }));
}

// ------------------------------------------------------------
// Detalhe de uma ordem (modal)
// ------------------------------------------------------------
function abrirDetalhe(id) {
  const o = DADOS.ordens.find(x => x.id === id);
  if (!o) { toast('Ordem já não está na leitura actual'); return; }
  const uni = unidade(o.unidade);
  const campos = [
    ['Unidade', `${o.unidade}${uni ? ' · ' + uni.nome : ''}`],
    ['Campo OP', `${o.op || '—'}${o.op_num ? ` <span class="origem">(OP ${o.op_num})</span>` : ' <span class="tag semop">sem número de OP</span>'}`],
    ['Lote / ref.', o.ref || '—'], ['Pedido', o.pedido || '—'], ['Cliente', o.cliente || '—'], ['Produto', `${o.produto || '—'}${o.calibre ? ' · ' + o.calibre : ''}`],
    ['Quantidade', o.qtd ? nR(o.qtd) + ' un.' : '—'], ['Máquina / linha', `${o.maquina || '—'}${o.fase ? ' · ' + o.fase : ''}`],
    ['Estado', `<span class="est ${o.estado}"><i></i>${esc(DADOS.estados[o.estado] || o.estado)}</span> <span class="origem">${esc(o.estado_origem)}${o.estado_derivado ? ' (derivado)' : ''}</span>`],
    ['Plano', `${planoTxt(o)}${o.data_fim_plano && o.data_fim_plano !== o.data_plano ? ' → ' + dPT(o.data_fim_plano) + (o.hora_plano_fim ? ' ' + o.hora_plano_fim : '') : ''} · ${diasTxt(o)}`],
    ['Data limite', o.data_limite ? `${dPT(o.data_limite)}${o.atraso_prazo ? ` <b class="atr-prazo">ultrapassada há ${o.atraso_prazo_dias} d</b>` : ''}` : '—'],
    ['Real', o.real_inicio || o.real_fim ? `${dhPT(o.real_inicio)} → ${dhPT(o.real_fim)}${o.decorrido_min != null ? ' · há ' + decorrido(o.decorrido_min) : ''}` : '—'],
    ['Paragens', o.atraso_prod_min ? `${minH(o.atraso_prod_min)}${o.motivo_paragem ? ' · ' + esc(o.motivo_paragem) : ''}` : '—'],
    ['Obs.', o.obs || '—'],
  ];
  $('#detCorpo').innerHTML = `<h3>${esc(opTxt(o))}${o.urgente ? ' <span class="tag urg">urgente</span>' : ''}${o.manutencao ? ' <span class="tag manut">manutenção</span>' : ''}</h3>
    <table class="det-tab">${campos.map(([k, v]) => `<tr><th>${k}</th><td>${['Campo OP', 'Estado', 'Plano', 'Data limite', 'Real', 'Paragens'].includes(k) ? v : esc(v)}</td></tr>`).join('')}</table>
    <div class="det-rod">${uni ? `<a class="btn" href="${esc(uni.url)}" target="_blank" rel="noopener">abrir ${esc(o.unidade)} na app ↗</a>` : ''}<span class="nota">o dashboard só lê — qualquer correcção faz-se na app de origem</span></div>`;
  $('#detalhe').hidden = false;
}
function fecharDetalhe() { $('#detalhe').hidden = true; }

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
  document.body.classList.toggle('uma-unidade', !!ECRA);
  renderMeta(); renderFontes(); renderSelects(); renderKpis(); renderOps();
  if (!$('#qResultados').hidden) renderPesquisa();
  agendar();
}

function renderMeta() {
  const d = DADOS;
  const hora = d.ultima_agregacao ? new Date(d.ultima_agregacao).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '—';
  $('#meta').textContent = `${ECRA ? 'UNIDADE ' + ECRA + ' · ' : ''}${dPT(d.hoje)}/${d.hoje.slice(0, 4)} · semana ${d.semana.split('-W')[1]} · última leitura ${hora} · ${d.fontes_ok}/${d.fontes_total} apps ligadas · actualiza a cada ${d.refresh_seg} s`;
}

function renderFontes() {
  $('#fontes').innerHTML = DADOS.unidades.map(u => {
    const f = u.fonte;
    const cls = !f.ok ? 'falha' : (f.idade_min != null && f.idade_min > 10 ? 'velho' : 'ok');
    const tit = f.ok ? `OK · ${f.n} registos · ${f.ms} ms · lida há ${f.idade_min ?? 0} min` : `FALHA: ${f.erro || '?'}${f.ultima_ok ? ' · última leitura boa ' + new Date(f.ultima_ok).toLocaleString('pt-PT') : ''}`;
    return `<span class="chip ${cls}" title="${esc(tit)}"><i class="pt"></i>${esc(u.unidade)}</span>`;
  }).join('');
}

function renderSelects() {
  const se = $('#selUnidade');
  if (se.options.length <= 1) {
    DADOS.unidades.forEach(u => se.insertAdjacentHTML('beforeend', `<option value="${esc(u.unidade)}">${esc(u.unidade)}</option>`));
    se.value = ECRA;
  }
}

function kpiTile(cls, rot, val, det, alvo, alerta) {
  return `<div class="kpi ${cls}" data-alvo="${alvo}" role="button" tabindex="0">
    <div class="rot">${rot}</div>
    <div class="val${alerta ? ' alerta' : ''}">${val}</div>
    <div class="det">${det}</div></div>`;
}
function renderKpis() {
  const base = (DADOS.ops_por_abrir || []).filter(o => !ECRA || o.unidade === ECRA);
  const vis = base.filter(o => !(ANTIGAS && antiga(o)));
  const nAntigas = base.filter(antiga).length;
  const hoje = vis.filter(o => o.dias_plano != null && o.dias_plano <= 0).length;
  const hojeSo = vis.filter(o => o.dias_plano === 0).length;
  const d12 = vis.filter(o => o.dias_plano === 1 || o.dias_plano === 2).length;
  const d1 = vis.filter(o => o.dias_plano === 1).length;
  $('#kpis').innerHTML = [
    kpiTile('k-op', 'OP por abrir', vis.length, `${ANTIGAS ? 'sem as antigas · ' : ''}${vis.filter(o => o.dias_plano != null && o.dias_plano <= 3).length} até D+3 · ${vis.filter(o => o.dias_plano == null || o.dias_plano > 3).length} depois ou sem data`, 'todas', false),
    kpiTile('k-hoje', 'Hoje', hoje, ANTIGAS || hoje === hojeSo ? 'plano para hoje — a OP tem de ser aberta já' : `${hojeSo} para hoje + ${hoje - hojeSo} atrasadas`, 'd0', hoje > 0),
    kpiTile('k-d12', 'D+1 e D+2', d12, `${d1} para amanhã · ${d12 - d1} para daqui a 2 dias`, 'd2', d12 > 0),
    kpiTile('k-antigas', 'Antigas', nAntigas, ANTIGAS ? 'plano anterior a hoje — ignoradas (ver "ignorar antigas")' : 'plano anterior a hoje — lixo de planeamento ou já feitas sem OP', 'antigas', false),
  ].join('');
  $$('#kpis .kpi').forEach(el => el.addEventListener('click', () => {
    const m = el.dataset.alvo;
    if (m === 'antigas') { if (ANTIGAS) definirAntigas(false); definirFiltroData('antigas'); }
    else definirFiltroData(m);
    if (!document.body.classList.contains('tv')) $('#opsSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ------------------------------------------------------------
// OPs por abrir
// ------------------------------------------------------------
// Filtro de datas (dia planeado): Hoje (dias = 0; inclui atrasadas se não ignoradas), até D+1, até D+2, até D+3, personalizado (de…até), todas
// "Ignorar antigas" tira da lista e das contagens as ordens com plano antes de hoje.
const PARAMS = new URLSearchParams(location.search);
let FDATA = { modo: PARAMS.get('dias') != null ? (['todas', 'antigas'].includes(PARAMS.get('dias')) ? PARAMS.get('dias') : 'd' + PARAMS.get('dias')) : (PARAMS.get('de') || PARAMS.get('ate') ? 'custom' : 'd3'), de: PARAMS.get('de') || '', ate: PARAMS.get('ate') || '' };
let ANTIGAS = PARAMS.get('antigas') != null ? PARAMS.get('antigas') === 'ignorar' : (() => { try { return localStorage.getItem('dg_antigas') === 'ignorar'; } catch (e) { return false; } })();
const refPlano = o => o.data_plano || (o.semana_plano ? segundaISO(o.semana_plano) : null);
function segundaISO(wk) { const m = /(\d{4})-W(\d{1,2})/.exec(wk || ''); if (!m) return null; const j4 = new Date(Date.UTC(+m[1], 0, 4)); const dn = (j4.getUTCDay() + 6) % 7; j4.setUTCDate(j4.getUTCDate() - dn + (+m[2] - 1) * 7); return j4.toISOString().slice(0, 10); }
const antiga = o => o.dias_plano != null && o.dias_plano < 0;
function passaData(o) {
  const m = FDATA.modo;
  if (m === 'todas') return true;
  if (m === 'antigas') return antiga(o);
  if (m === 'custom') { const r = refPlano(o); if (!r) return false; return (!FDATA.de || r >= FDATA.de) && (!FDATA.ate || r <= FDATA.ate); }
  const n = +m.slice(1); return o.dias_plano != null && o.dias_plano <= n;
}
function opsUnidade() { return (DADOS.ops_por_abrir || []).filter(o => (!ECRA || o.unidade === ECRA) && !(ANTIGAS && antiga(o))); }
function opsVisiveis() { return opsUnidade().filter(passaData); }
function definirFiltroData(modo, de, ate) {
  FDATA = { modo, de: de || '', ate: ate || '' };
  const u = new URL(location.href); u.searchParams.delete('dias'); u.searchParams.delete('de'); u.searchParams.delete('ate');
  if (modo === 'todas') u.searchParams.set('dias', 'todas'); else if (modo === 'custom') { if (FDATA.de) u.searchParams.set('de', FDATA.de); if (FDATA.ate) u.searchParams.set('ate', FDATA.ate); } else if (modo === 'antigas') u.searchParams.set('dias', 'antigas'); else if (modo !== 'd3') u.searchParams.set('dias', modo.slice(1));
  history.replaceState(null, '', u); OPS_TUDO = false; renderOps();
  $$('#kpis .kpi').forEach(el => el.classList.toggle('activo', el.dataset.alvo === FDATA.modo));
}
function definirAntigas(ignorar) {
  ANTIGAS = !!ignorar; try { localStorage.setItem('dg_antigas', ANTIGAS ? 'ignorar' : 'mostrar'); } catch (e) { /* sem storage */ }
  const u = new URL(location.href); if (ANTIGAS) u.searchParams.set('antigas', 'ignorar'); else u.searchParams.delete('antigas');
  history.replaceState(null, '', u); OPS_TUDO = false; renderKpis(); renderOps();
}
// cor do cartão: hoje (e atrasadas) = vermelho · D+1 e D+2 = amarelo · D+3 em diante = azul · sem data = cinzento
const classeDias = o => o.dias_plano == null ? 'semdata' : (o.dias_plano <= 0 ? 'hoje' : (o.dias_plano <= 2 ? 'd' + o.dias_plano : 'd3mais'));
function etiquetaDias(o) {
  const d = o.dias_plano;
  if (d == null) return 'sem data';
  if (d < 0) return `ATRASADA · há ${-d} d`;
  if (d === 0) return 'HOJE';
  return `D+${d} · ${d === 1 ? 'amanhã' : 'em ' + d + ' d'}`;
}
function renderOps() {
  const todas = DADOS.ops_por_abrir || [];
  const daUnidade = opsUnidade();
  const lista = opsVisiveis();
  const porU = {}; for (const o of todas) porU[o.unidade] = (porU[o.unidade] || 0) + 1;
  $('#opsChips').innerHTML = DADOS.unidades.map(u => `<button type="button" class="chip${ECRA === u.unidade ? ' activo' : ''}${porU[u.unidade] ? '' : ' zero'}" data-unidade="${esc(u.unidade)}" title="${porU[u.unidade] ? 'só ' + u.unidade : u.unidade + ': nada por abrir'}">${esc(u.unidade)} <b>${porU[u.unidade] || 0}</b></button>`).join('');
  $$('#opsChips .chip').forEach(el => el.addEventListener('click', () => definirEcra(ECRA === el.dataset.unidade ? '' : el.dataset.unidade)));
  // filtros rápidos de data (contagens sobre a unidade escolhida)
  const nAte = n => daUnidade.filter(o => o.dias_plano != null && o.dias_plano <= n).length;
  const nAntigas = (DADOS.ops_por_abrir || []).filter(o => (!ECRA || o.unidade === ECRA) && antiga(o)).length;
  const btn = (modo, rot, n, tit) => `<button type="button" class="fd ${modo}${FDATA.modo === modo ? ' activo' : ''}" data-modo="${modo}" title="${esc(tit)}">${rot} <b>${n}</b></button>`;
  $('#opsFiltroData').innerHTML = btn('d0', 'Hoje', nAte(0), ANTIGAS ? 'plano para hoje' : 'plano para hoje (inclui atrasadas)')
    + btn('d1', 'até D+1', nAte(1), 'plano até amanhã') + btn('d2', 'até D+2', nAte(2), 'plano até daqui a 2 dias') + btn('d3', 'até D+3', nAte(3), 'plano até daqui a 3 dias')
    + btn('todas', 'Todas', daUnidade.length, 'sem horizonte')
    + `<span class="fd-custom${FDATA.modo === 'custom' ? ' activo' : ''}"><button type="button" class="fd custom${FDATA.modo === 'custom' ? ' activo' : ''}" data-modo="custom" title="intervalo de dias planeados">Personalizado</button>
       <label>de <input type="date" id="fdDe" value="${esc(FDATA.de)}"></label><label>até <input type="date" id="fdAte" value="${esc(FDATA.ate)}"></label></span>
       <label class="fd-antigas" title="esconder as ordens com dia planeado anterior a hoje (lixo de planeamento ou já resolvidas na prática)"><input type="checkbox" id="fdAntigas"${ANTIGAS ? ' checked' : ''}> ignorar antigas <b>${nAntigas}</b></label>`;
  $$('#opsFiltroData .fd').forEach(b => b.addEventListener('click', () => { const m = b.dataset.modo; if (m === 'custom') { const de = $('#fdDe').value || DADOS.hoje, ate = $('#fdAte').value || de; definirFiltroData('custom', de, ate); } else definirFiltroData(m); }));
  const aoMudarData = () => { const de = $('#fdDe').value, ate = $('#fdAte').value; if (de || ate) definirFiltroData('custom', de, ate); };
  $('#fdDe').addEventListener('change', aoMudarData); $('#fdAte').addEventListener('change', aoMudarData);
  $('#fdAntigas').addEventListener('change', e => definirAntigas(e.target.checked));
  const nHoje = lista.filter(o => classeDias(o) === 'hoje').length, nAmarelas = lista.filter(o => o.dias_plano === 1 || o.dias_plano === 2).length, nAtr = lista.filter(antiga).length;
  const descFiltro = FDATA.modo === 'todas' ? 'todas as datas' : (FDATA.modo === 'custom' ? `plano de ${dPT(FDATA.de) === '—' ? '…' : dPT(FDATA.de)} até ${dPT(FDATA.ate) === '—' ? '…' : dPT(FDATA.ate)}` : (FDATA.modo === 'd0' ? 'plano para hoje' : (FDATA.modo === 'antigas' ? 'só antigas (plano antes de hoje)' : `plano até D+${FDATA.modo.slice(1)}`)));
  $('#opsResumo').textContent = lista.length ? `${lista.length} sem número de OP (${descFiltro}) · ${nHoje - nAtr} para hoje · ${nAtr} atrasadas · ${nAmarelas} para D+1/D+2${ANTIGAS ? ' · antigas ignoradas' : ''}` : (daUnidade.length ? `nenhuma neste filtro (${descFiltro}); ${daUnidade.length} no total${ANTIGAS ? ', antigas ignoradas' : ''}` : 'todas as ordens activas têm número de OP');
  const tv = document.body.classList.contains('tv');
  const MAX = tv ? 25 : (OPS_TUDO ? 5000 : 60);
  $('#opsCards').innerHTML = lista.length ? lista.slice(0, MAX).map(o => `<article class="ocard ${classeDias(o)} ${o.sem_op_nivel}" data-id="${esc(o.id)}" title="Ver detalhe">
      <div class="oc-cab"><span class="oc-unid">${esc(o.unidade)}</span><span class="oc-dias">${esc(etiquetaDias(o))}</span></div>
      <div class="oc-op"><b>${esc(o.op || '(campo OP vazio)')}</b>${o.urgente ? ' <span class="tag urg">urg</span>' : ''}</div>
      <div class="oc-plano">plano <b>${esc(planoTxt(o))}</b>${o.plano_granularidade !== 'dia' ? ' <span class="origem">(semana → 2.ª feira)</span>' : ''}${o.data_limite ? ` · limite ${dPT(o.data_limite)}` : ''}</div>
      <div class="oc-det" title="${esc([o.cliente, o.produto, o.calibre].filter(Boolean).join(' · '))}">${esc(o.cliente || '—')} · ${esc(o.produto || '—')}${o.calibre ? ' · ' + esc(o.calibre) : ''}</div>
      <div class="oc-lin"><span>${o.pedido ? 'pedido ' + esc(o.pedido) : ''}${o.ref && o.ref !== o.op ? (o.pedido ? ' · ' : '') + esc(o.ref) : ''}</span><span>${o.qtd ? nR(o.qtd) + ' un.' : ''}</span></div>
      <div class="oc-rod"><span class="est ${o.estado}" title="${esc(DADOS.estados[o.estado] || '')}"><i></i>${esc(o.estado_origem || DADOS.estados[o.estado])}</span><span class="oc-maq" title="${esc([o.maquina, o.fase].filter(Boolean).join(' · '))}">${esc(o.maquina || '')}</span><a class="oc-lnk" href="${esc((unidade(o.unidade) || {}).url || '#')}" target="_blank" rel="noopener" title="abrir a app de ${esc(o.unidade)}">↗</a></div>
      ${o.obs ? `<div class="oc-obs" title="${esc(o.obs)}">${esc(o.obs)}</div>` : ''}
    </article>`).join('') : `<div class="vazio-ok">${daUnidade.length ? '✔ Nada por abrir neste filtro.' : '✔ Todas as ordens activas têm número de OP.'}</div>`;
  $('#opsMais').innerHTML = lista.length > MAX ? `+ ${lista.length - MAX} ordens${tv ? ' (modo TV mostra as mais próximas)' : ` — <a href="#" id="opsVerTudo">mostrar todas</a>`}` : (OPS_TUDO && lista.length > 60 ? '<a href="#" id="opsVerMenos">mostrar menos</a>' : '');
  const vt = $('#opsVerTudo'); if (vt) vt.addEventListener('click', e => { e.preventDefault(); OPS_TUDO = true; renderOps(); });
  const vm = $('#opsVerMenos'); if (vm) vm.addEventListener('click', e => { e.preventDefault(); OPS_TUDO = false; renderOps(); });
  $$('#opsCards .ocard').forEach(c => c.addEventListener('click', e => { if (e.target.closest('a')) return; abrirDetalhe(c.dataset.id); }));
}
function exportarCsvOps() {
  const lista = opsVisiveis();
  const niv = { critico: 'plano passado/hoje', serio: 'próximos 7 dias', aviso: 'mais tarde' };
  const cab = ['Unidade', 'Urgencia', 'D-n', 'Dias ate ao plano', 'Dia plano', 'Semana plano', 'Campo OP', 'Lote/Ref', 'Pedido', 'Cliente', 'Produto', 'Calibre', 'Qtd (un)', 'Maquina', 'Fase', 'Estado na app', 'Data limite', 'Urgente', 'Obs'];
  const linhas = lista.map(o => [o.unidade, niv[o.sem_op_nivel] || '', etiquetaDias(o), o.dias_plano ?? '', o.data_plano || '', o.semana_plano || '', o.op, o.ref, o.pedido, o.cliente, o.produto, o.calibre, o.qtd, o.maquina, o.fase, o.estado_origem, o.data_limite || '', o.urgente ? 'sim' : '', o.obs]
    .map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(';'));
  const blob = new Blob(['﻿' + [cab.join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ops_por_abrir_${ECRA ? ECRA.replace(/\s+/g, '_') + '_' : ''}${FDATA.modo}_${DADOS.hoje}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function definirEcra(u) {
  ECRA = u || ''; const url = new URL(location.href);
  if (ECRA) url.searchParams.set('unidade', ECRA); else url.searchParams.delete('unidade');
  history.replaceState(null, '', url);
  $('#selUnidade').value = ECRA; OPS_TUDO = false; render();
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 4000); }

// ------------------------------------------------------------
// Eventos
// ------------------------------------------------------------
$('#qGlobal').addEventListener('input', renderPesquisa);
$('#qGlobal').addEventListener('focus', renderPesquisa);
$('#qGlobal').addEventListener('keydown', e => { if (e.key === 'Escape') { $('#qResultados').hidden = true; e.target.blur(); } });
document.addEventListener('click', e => { if (!e.target.closest('.pesq-global')) $('#qResultados').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharDetalhe(); });
$('#detalhe').addEventListener('click', e => { if (e.target === e.currentTarget) fecharDetalhe(); });
$('#detFechar').addEventListener('click', fecharDetalhe);
$('#btnCsvOps').addEventListener('click', exportarCsvOps);
$('#selUnidade').addEventListener('change', e => definirEcra(e.target.value));
$('#btnAtualizar').addEventListener('click', () => carregar(true));
$('#btnTema').addEventListener('click', () => { const claro = document.documentElement.dataset.theme === 'light'; if (claro) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light'; try { localStorage.setItem('dg_tema', claro ? 'escuro' : 'claro'); } catch (e) { /* sem storage */ } });
$('#btnTv').addEventListener('click', () => { document.body.classList.toggle('tv'); const u = new URL(location.href); if (document.body.classList.contains('tv')) u.searchParams.set('tv', '1'); else u.searchParams.delete('tv'); history.replaceState(null, '', u); if (DADOS) renderOps(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && DADOS) carregar(false); });

if (new URLSearchParams(location.search).get('tv') === '1') document.body.classList.add('tv');
carregar(false);
