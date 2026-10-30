// ============================================================
// Motor DSL (Dupla escolha) — cópia FIEL do agendador da app planeamento-dsl
// (public/index.html, sha256 a446d16bb991c46c…, extraído 2026-10-29: fecho transitivo de scheduleLine).
// Não editar à mão. Só muda o âmbito: DATA/SETTINGS injectados (a app usa st.ops/st.settings
// de /api/state sem merge). Modos da app: 'plan' (só quantidade), 'efet', 'eff' (quadro, defeito).
// Minutos (startMin/endMin) contam a partir da meia-noite local do dia do segmento (podem passar 1440).
// ============================================================
'use strict';

function criar(opsIn, settingsIn) {
  const ALL_LINES=['1','2','3','4','5','6','7','8','EM','EEB'];

  let DATA=[];

  let SETTINGS={};

  const pad=n=>String(n).padStart(2,'0');

  function mondayOf(d){const x=new Date(d);const w=(x.getDay()+6)%7;x.setDate(x.getDate()-w);x.setHours(0,0,0,0);return x;}

  function dateKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}

  function hm2min(s){if(!s||!/^\d{1,2}:\d{2}/.test(s))return null;const[a,b]=s.split(':');return(+a)*60+(+b);}

  function oeeOf(linha){const caps=(SETTINGS.capacidades||{});const key=(linha==='EM')?'EM':linha;const c=caps[key];let o=(c&&c.oee!=null)?+c.oee:100;if(!(o>0))o=100;return Math.min(o,100)/100;}

  function capOf(linha,bt){const caps=(SETTINGS.capacidades||{});let base;
    if(linha==='EM'){const c=caps['EM']||caps['EM_B'];base=c&&c.krH?c.krH:2000;}
    else{const c=caps[linha];base=c&&c.krH?c.krH:17000;}
    return base*oeeOf(linha);}

  function durHoras(op){const kr=capOf(op.linha,op.bancaTapete);let q=(+op.qtd||0);if(op.desdobrar){const real=+op.qtdDesdobramento||0;const prev=+op.qtdPrevistaDesd||0;q+=(real>0?real:prev);}let h=kr>0?q*1000/kr:0;const atr=hm2min(op.tempoAtraso);if(atr)h+=atr/60;return h;}

  function turnoWindow(turno){const t=(SETTINGS.turnos||{})[turno]||(SETTINGS.turnos||{})[1]||{ini:'08:00',fim:'17:00',almocoIni:'12:00',almocoFim:'13:00'};return t;}

  function dayOverride(d){return (SETTINGS.turnosPorDia||{})[dateKey(d)]||null;}

  function isDayClosed(d){const o=dayOverride(d);if(o&&o.fechado)return true;const dow=(d.getDay()+6)%7;if(dow===6&&SETTINGS.domingoFechado)return true;return false;}

  function breaksOf(turno){const t=turnoWindow(turno);const b=[];if(t.almocoIni&&t.almocoFim)b.push([hm2min(t.almocoIni),hm2min(t.almocoFim)]);if(t.jantarIni&&t.jantarFim)b.push([hm2min(t.jantarIni),hm2min(t.jantarFim)]);return b;}

  function lineBreaks(l,tno){const c=(SETTINGS.capacidades||{})[l];if(!c||!c.int)return [];const out=[];
    const nIni=hm2min((turnoWindow(2).ini)||'17:00');
    const add=(pair,night)=>{if(!pair||!pair[0]||!pair[1])return;let s=hm2min(pair[0]),e=hm2min(pair[1]);if(night){if(s<nIni)s+=1440;if(e<nIni)e+=1440;}if(e>s)out.push([s,e]);};
    add(c.int.d1,false);add(c.int.d2,false);
    if(tno>=2){add(c.int.n1,true);add(c.int.n2,true);}
    return out;}

  function difBreaks(){const t=turnoWindow('dif');const b=[];const ni=hm2min(t.ini)||0;const push=(is,fs)=>{let s=hm2min(is),e=hm2min(fs);if(s==null||e==null)return;if(s<ni)s+=1440;if(e<ni)e+=1440;if(e>s)b.push([s,e]);};if(t.almocoIni&&t.almocoFim)push(t.almocoIni,t.almocoFim);if(t.jantarIni&&t.jantarFim)push(t.jantarIni,t.jantarFim);return b;}

  function isDifDay(l,d){const dd=(SETTINGS.difDia||{})[dateKey(d)];return !!(dd&&(dd[l]===true||dd[l]==='true'));}

  function lineTurnoForDate(l,d){const td=(SETTINGS.turnosDia||{})[dateKey(d)];const v=td&&td[l];if(v===0||v==='0')return 0;return (v===2||v==='2')?2:1;}

  function dDate(o){const m=(o.weekKey||'').match(/(\d+)-W(\d+)/);if(!m)return null;const j=new Date(+m[1],0,4);const mon=mondayOf(j);mon.setDate(mon.getDate()+(+m[2]-1)*7+(+o.diaIdx||0));mon.setHours(0,0,0,0);return mon;}

  function cmpDay(a,b){const ka=dateKey(a),kb=dateKey(b);return ka<kb?-1:ka>kb?1:0;}

  function dayWindowFor(l,d){
    if(isDayClosed(d))return null;
    if(lineTurnoForDate(l,d)===0)return null;   // linha fechada nesse dia
    const ov=dayOverride(d);const dow=(d.getDay()+6)%7;let ini,fim,breaks;
    if(dow===5){ini=hm2min(SETTINGS.sabadoIni||'07:00');fim=hm2min(SETTINGS.sabadoFim||'11:00');breaks=[];}
    else{const tno=lineTurnoForDate(l,d);const t1=turnoWindow(1);
      if(tno>=2){const t2=turnoWindow(2);ini=hm2min(t1.ini);fim=hm2min(t2.fim);if(fim<=ini)fim+=1440;breaks=breaksOf(1).concat(breaksOf(2)).concat(lineBreaks(l,2));}
      else{ini=hm2min(t1.ini);fim=hm2min(t1.fim);if(fim<=ini)fim+=1440;breaks=breaksOf(1).concat(lineBreaks(l,1));}}
    if(isDifDay(l,d)){const t=turnoWindow('dif');ini=hm2min(t.ini);fim=hm2min(t.fim);if(fim<=ini)fim+=1440;breaks=difBreaks().concat(lineBreaks(l,2));}
    if(ov&&ov.ini)ini=hm2min(ov.ini);
    if(ov&&ov.fim){fim=hm2min(ov.fim);if(fim<=ini)fim+=1440;}
    return {ini,fim,breaks};
  }

  function workCapacity(start,breaks,winFim){let cap=winFim-start;for(const b of breaks){const s=Math.max(b[0],start),e=Math.min(b[1],winFim);if(e>s)cap-=(e-s);}return Math.max(0,cap);}

  function spanEnd(start,work,breaks,winFim){let t=start,left=work,g=0;while(left>0.0001&&t<winFim&&g++<60){const ib=breaks.find(b=>t>=b[0]&&t<b[1]);if(ib){t=ib[1];continue;}let nb=null;for(const b of breaks)if(t<b[0]&&(nb===null||b[0]<nb))nb=b[0];const stop=Math.min(winFim,nb===null?winFim:nb);const chunk=Math.min(left,stop-t);t+=chunk;left-=chunk;if(left>0.0001){const bb=breaks.find(b=>b[0]===t);if(bb)t=bb[1];else break;}}return t;}

  const _schedCaches={plan:{},efet:{},eff:{}};

  function scheduleLine(l,mode){
    mode=(mode===true?'plan':(mode||'eff'));
    const cache=_schedCaches[mode]||_schedCaches.eff;
    if(cache[l])return cache[l];
    const orders=DATA.filter(o=>o.linha===l&&o.weekKey&&dDate(o))
      .sort((a,b)=>cmpDay(dDate(a),dDate(b))||((+a.sortIdx||0)-(+b.sortIdx||0)));
    const segs={};const setup=+SETTINGS.setupMin||0;
    const push=(date,op,s,e,q)=>{const k=dateKey(date);(segs[k]=segs[k]||[]).push({op,startMin:s,endMin:e,qtdSeg:q,date:new Date(date)});};
    const nextOpen=(date)=>{let d=new Date(date);for(let i=0;i<500;i++){d.setDate(d.getDate()+1);if(dayWindowFor(l,d))return d;}return null;};
    // fim (data,min) após 'workMin' minutos de trabalho a partir de (d0,m0)
    const endAfter=(d0,m0,workMin)=>{let d=new Date(d0),m=m0,left=workMin,g=0;
      while(left>0.01&&g++<800){const win=dayWindowFor(l,d);
        if(!win){const nd=nextOpen(d);if(!nd)return {date:new Date(d),min:m};d=nd;m=dayWindowFor(l,d).ini;continue;}
        if(m<win.ini)m=win.ini;const cap=workCapacity(m,win.breaks,win.fim);
        if(cap<=0){const nd=nextOpen(d);if(!nd)return {date:new Date(d),min:win.fim};d=nd;m=dayWindowFor(l,d).ini;continue;}
        const work=Math.min(left,cap);const e=spanEnd(m,work,win.breaks,win.fim);left-=work;
        if(left>0.01){const nd=nextOpen(d);if(!nd)return {date:new Date(d),min:e};d=nd;m=dayWindowFor(l,d).ini;}
        else return {date:new Date(d),min:e};}
      return {date:new Date(d),min:m};};
    // minutos de trabalho entre (d0,m0) e (d2,m2)
    const workMinsBetween=(d0,m0,d2,m2)=>{let d=new Date(d0),m=m0,mins=0,g=0;
      while(g++<800){const win=dayWindowFor(l,d);
        if(win){if(m<win.ini)m=win.ini;
          if(cmpDay(d,d2)<0){mins+=workCapacity(m,win.breaks,win.fim);}
          else{const e=Math.min(m2,win.fim);if(e>m)mins+=workCapacity(m,win.breaks,e);return mins;}}
        else if(cmpDay(d,d2)>=0)return mins;
        const nd=nextOpen(d);if(!nd)return mins;d=nd;m=dayWindowFor(l,d).ini;}
      return mins;};
    let curDate=null,curMin=0,pullUntil=null;   // pullUntil: dia até ao qual as seguintes fluem (fim real mais cedo)
    for(const op of orders){
      let startDay=dDate(op),w=dayWindowFor(l,startDay);
      while(!w){startDay=nextOpen(startDay);if(!startDay)break;w=dayWindowFor(l,startDay);}
      if(!startDay)continue;
      if(curDate===null||cmpDay(curDate,startDay)<0){
        if(pullUntil&&cmpDay(startDay,pullUntil)<=0){curMin+=setup;}   // fluxo contínuo puxado por fim real
        else{curDate=startDay;curMin=dayWindowFor(l,curDate).ini;pullUntil=null;}
      }
      else curMin+=setup;
      const _manual=(op.inicioMode==='manual')?hm2min(op.hInicioP):null;
      if(_manual!=null){const win0=dayWindowFor(l,startDay);if(win0){curDate=startDay;curMin=Math.min(Math.max(_manual,win0.ini),win0.fim-1);}}
      let remMin=durHoras(op)*60;const totalQtd=(+op.qtd||0);let guard=0;
      // Horas reais (data+hora)
      const _rft=hm2min(op.hFimR);
      const _rfd=/^\d{4}-\d{2}-\d{2}/.test(op.dataFimR||'')?new Date(op.dataFimR+'T00:00:00'):null;
      const _rst=hm2min(op.hInicioR);
      const _rsd=/^\d{4}-\d{2}-\d{2}/.test(op.dataInicioR||'')?new Date(op.dataInicioR+'T00:00:00'):null;
      const _hasRealEnd=(mode!=='plan'&&_rft!=null&&_rfd&&!isNaN(_rfd));
      const _hasRealStart=(mode!=='plan'&&_rst!=null&&_rsd&&!isNaN(_rsd));
      let _plannedEnd=null;
      if(mode!=='plan'&&(_hasRealEnd||_hasRealStart))_plannedEnd=endAfter(curDate,curMin,remMin);  // fim planeado (posição em cascata)
      if(_hasRealStart){curDate=new Date(_rsd);curMin=_rst;}   // arranque real fixa o início
      if(mode==='eff'&&_hasRealEnd){const rm=workMinsBetween(curDate,curMin,_rfd,_rft);if(rm>0)remMin=rm;}  // eff trunca até ao fim real
      const totalDur=remMin||1;
      while(remMin>0.01&&guard++<800){
        let win=dayWindowFor(l,curDate);
        if(!win){const nd=nextOpen(curDate);if(!nd)break;curDate=nd;curMin=dayWindowFor(l,curDate).ini;continue;}
        if(curMin<win.ini)curMin=win.ini;
        for(const br of win.breaks)if(curMin>=br[0]&&curMin<br[1])curMin=br[1];
        if(curMin>=win.fim){const nd=nextOpen(curDate);if(!nd)break;curDate=nd;curMin=dayWindowFor(l,curDate).ini;continue;}
        const cap=workCapacity(curMin,win.breaks,win.fim);
        if(cap<=0){const nd=nextOpen(curDate);if(!nd)break;curDate=nd;curMin=dayWindowFor(l,curDate).ini;continue;}
        const work=Math.min(remMin,cap);const segEnd=spanEnd(curMin,work,win.breaks,win.fim);
        push(curDate,op,curMin,segEnd,totalQtd*(work/totalDur));
        remMin-=work;
        if(remMin>0.01){const nd=nextOpen(curDate);if(!nd)break;curDate=nd;curMin=dayWindowFor(l,curDate).ini;}
        else curMin=segEnd;
      }
      // 'efet': manteve a duração planeada (do início real); reancora o CURSOR no fim real p/ as seguintes
      if(mode==='efet'&&_hasRealEnd){curDate=new Date(_rfd);curMin=_rft;}
      // Fim efetivo desta ordem (cursor atual) -> se for mais cedo que o planeado, puxa as seguintes
      if(_plannedEnd&&(cmpDay(curDate,_plannedEnd.date)<0||(cmpDay(curDate,_plannedEnd.date)===0&&curMin<_plannedEnd.min)))pullUntil=_plannedEnd.date;
    }
    const byOp={};Object.values(segs).flat().forEach(s=>{(byOp[s.op.id]=byOp[s.op.id]||[]).push(s);});
    Object.values(byOp).forEach(list=>{
      list.sort((a,b)=>a.date-b.date||a.startMin-b.startMin);
      const days=new Set(list.map(s=>dateKey(s.date)));
      list.forEach((s,i)=>{s.partIdx=i+1;s.total=list.length;s.multiDay=days.size>1;
        s.carriedNext=list.slice(i+1).reduce((a,x)=>a+(+x.qtdSeg||0),0);
        s.carriedPrev=list.slice(0,i).reduce((a,x)=>a+(+x.qtdSeg||0),0);});
    });
    cache[l]=segs;return segs;
  }

  DATA = Array.isArray(opsIn) ? opsIn : [];
  SETTINGS = settingsIn || {};
  return { ALL_LINES, scheduleLine, dDate, dateKey };
}

// hora de parede: dia (meia-noite local) + minutos (podem passar 1440); igual a min2hm() da app mesmo em dias de mudança de hora
function parede(d, min) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min); }

// Plano completo: Map id -> { maquina, inicio, fim, segs:[{inicio,fim,qtd}] }
function calcularPlano(ops, settings, modo) {
  const m = criar(ops, settings);
  const linhas = new Set(m.ALL_LINES);
  for (const o of (Array.isArray(ops) ? ops : [])) if (o && o.linha) linhas.add(o.linha);
  const out = new Map();
  for (const l of linhas) {
    const segs = m.scheduleLine(l, modo || 'eff');
    const todos = Object.values(segs).flat().sort((a, b) => a.date - b.date || a.startMin - b.startMin);
    for (const s of todos) {
      const ini = parede(s.date, s.startMin), fim = parede(s.date, s.endMin);
      let r = out.get(s.op.id);
      if (!r) { r = { maquina: l, inicio: ini, fim, segs: [] }; out.set(s.op.id, r); }
      r.segs.push({ inicio: ini, fim, qtd: s.qtdSeg });
      if (ini < r.inicio) r.inicio = ini;
      if (fim > r.fim) r.fim = fim;
    }
  }
  return out;
}

if (typeof module === 'object' && module.exports) module.exports = { criar, calcularPlano, parede };
