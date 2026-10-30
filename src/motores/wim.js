// ============================================================
// Motor WIM — cópia FIEL dos agendadores da app planeamento-wim
// (public/index.html, sha256 1a3af96af0270e12…, extraído 2026-10-29).
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
  const PREF={W:'w',I:'i',M:'m'};

  let DATA=[], SETTINGS={}, ACTIVE_TAB='W', ANCHOR=null;

  function sections(){return SETTINGS.sections||{W:{label:'Wash',maqs:[]},I:{label:'Innocork',maqs:[]},M:{label:'Make-up',maqs:[]}};}

  function maqsOf(sec){return (sections()[sec]||{}).maqs||[];}

  function secOfMaq(maq){const s=sections();for(const k of ['W','I','M'])if((s[k].maqs||[]).includes(maq))return k;return null;}

  const pad=n=>String(n).padStart(2,'0');

  function mondayOf(d){const x=new Date(d);const w=(x.getDay()+6)%7;x.setDate(x.getDate()-w);x.setHours(0,0,0,0);return x;}

  function dateKey(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}

  function hm2min(s){if(!s||!/^\d{1,2}:\d{2}/.test(s))return null;const[a,b]=s.split(':');return(+a)*60+(+b);}

  function dDateStage(o,sec){const p=PREF[sec];const m=(o[p+'_wk']||'').match(/(\d+)-W(\d+)/);if(!m)return null;const j=new Date(+m[1],0,4);const mon=mondayOf(j);mon.setDate(mon.getDate()+(+m[2]-1)*7+(+o[p+'_dia']||0));mon.setHours(0,0,0,0);return mon;}

  function cmpDay(a,b){const ka=dateKey(a),kb=dateKey(b);return ka<kb?-1:ka>kb?1:0;}

  function washProgramFor(o){
    if(o.w_progFixed)return o.w_progFixed;                       // ordem processual (ex.: L11 → ESP BARTOPS)
    if(o.l11Stage==='BTOPS')return 'L01_Btops';                  // 2ª lavação do L11
    // REGRA FIXA: material que começa por "B" (B-tops) → programa L01_Btops, independentemente do escalão/lavação final
    if(/^\s*B/i.test(String(o.produtoEntrada||'')))return 'L01_Btops';
    const q=(+o.qtd||0)/1000;const tier=q<15?15:(q<30?30:50);
    const lav=((o.lavacao||o.w_prog||'')+'').trim();const m=SETTINGS.washMap||{};
    return m[tier+'-'+lav]||m[lav]||lav||'L03';
  }

  function innoBatchCap(o){const ic=SETTINGS.innoCap||{};const raw=((o.calibre||'')+'').trim();const cands=[raw,raw.replace(/X/g,'x'),raw.replace(/x/g,'X')];
    const m=raw.match(/^(\w+)[xX](\d{3})$/);if(m)cands.push(m[1]+'x'+m[2].slice(0,2),m[1]+'X'+m[2].slice(0,2));
    if(/^\s*B/i.test(String(o.produtoEntrada||''))&&ic['B']!=null)cands.unshift('B');
    for(const k of cands){if(ic[k]!=null&&+ic[k]>0)return +ic[k]*1000;}
    return +SETTINGS.innoCargaCap||52000;}

  function washBatchCap(o,maq){
    const grp=(maq==='Maq 3')?'M3':'M12';const wc=(SETTINGS.washCap||{})[grp]||{};
    const raw=((o.calibre||'')+'').trim();const cands=[raw,raw.replace(/X/g,'x')];
    const m=raw.match(/^(\w+)[xX](\d{3})$/);if(m)cands.push(m[1]+'x'+m[2].slice(0,2),m[1]+'X'+m[2].slice(0,2));
    for(const k of cands){if(wc[k]!=null)return wc[k]*1000;}
    return +SETTINGS.batchCap||52000;
  }

  function mqTier(o){const prog=((o.m_prog||'')+'');const mt=prog.match(/(\d+)\s*K\b/i);if(mt)return mt[1].toUpperCase()+'K';
    const cap=+SETTINGS.mqBatchCap||40000;return cap>=40000?'40K':(cap>=20000?'20K':'10K');}

  function mqCap(o){const q=(SETTINGS.mqQtdMax||{})[o.m_prog];if(+q>0)return +q;const tiers=SETTINGS.mqTierCap||{'40K':40000,'20K':20000,'10K':10000};const t=mqTier(o);return tiers[t]||(+SETTINGS.mqBatchCap||40000);}

  function mqExtra(){return (+SETTINGS.mqPassagemTSTI||0)+(+SETTINGS.mqDescarga||0);}

  function is406(o){return String(o.lavacao||'').trim()==='406';}

  function mqPerBatch(o){const cyc=SETTINGS.mqCycle||{};const t=mqTier(o);const def=+SETTINGS.mqCycleDefault||45;const ex=mqExtra();
    const phys=Math.max(1,Math.ceil((+o.qtd||0)/mqCap(o)));
    if(is406(o)){const kB=(cyc['406 N '+t]||cyc[o.m_prog]||def)+ex;const kR=(cyc['406 N '+t+'-R']||(cyc['406 N '+t]||def))+ex;const a=[];for(let i=0;i<phys;i++){a.push(kB);a.push(kR);}return a;}
    const k=((o.m_prog&&cyc[o.m_prog]!=null)?cyc[o.m_prog]:def)+ex;return new Array(phys).fill(k);}

  function mqRecups(o){return Array.isArray(o.m_recups)?o.m_recups:[];}

  function mqBatchesFull(o){const base=mqPerBatch(o);const arr=base.map((cyc,i)=>({cyc,isRecup:false,srcBi:i+1}));
    mqRecups(o).forEach((r,ri)=>{const src=+r.bi||1;const cyc=(base[src-1]!=null?base[src-1]:(base[0]||45));arr.push({cyc,isRecup:true,srcBi:src,qtd:+r.qtd||0,recIdx:ri});});return arr;}

  function nBatches(o,sec,maq){
    if(sec==='W')return Math.max(1,Math.ceil((+o.qtd||0)/washBatchCap(o,maq)));
    if(sec==='M')return mqPerBatch(o).length;   // 406 já vem dobrado
    return Math.max(1,Math.ceil((+o.qtd||0)/innoBatchCap(o)));
  }

  function secCfg(sec){
    const d={turnos:{1:{ini:'06:00',fim:'14:00',almocoIni:'12:00',almocoFim:'12:30'},2:{ini:'14:00',fim:'22:00',jantarIni:'19:30',jantarFim:'20:00'},3:{ini:'22:00',fim:'06:00',jantarIni:'02:00',jantarFim:'02:30'}},
      setupMin:10,interBatchMin:20,sabadoIni:'06:00',sabadoFim:'14:00',domingoFechado:true};
    const s=(SETTINGS.sec||{})[sec];
    if(!s){if(SETTINGS.turnos)return Object.assign({},d,{turnos:Object.assign({},d.turnos,SETTINGS.turnos),setupMin:(SETTINGS.setupMin!=null?SETTINGS.setupMin:10),interBatchMin:(SETTINGS.interBatchMin!=null?SETTINGS.interBatchMin:20),sabadoIni:SETTINGS.sabadoIni||'06:00',sabadoFim:SETTINGS.sabadoFim||'14:00',domingoFechado:SETTINGS.domingoFechado!==false});return d;}
    return Object.assign({},d,s,{turnos:Object.assign({},d.turnos,s.turnos||{})});
  }

  function washCycleFor(maq,prog){const wm=(SETTINGS.washCycleMaq||{})[maq];if(wm&&wm[prog]!=null&&wm[prog]!==''&&+wm[prog]>0)return +wm[prog];return (SETTINGS.washCycle||{})[prog]||90;}

  function turnoWindow(sec,t){const T=(secCfg(sec).turnos||{})[t]||(secCfg(sec).turnos||{})[1]||{ini:'06:00',fim:'15:00'};return T;}

  function dayOverride(d){return (SETTINGS.turnosPorDia||{})[dateKey(d)]||null;}

  function isDayClosed(d,sec){const o=dayOverride(d);if(o&&o.fechado)return true;const dow=(d.getDay()+6)%7;if(dow===6&&secCfg(sec||ACTIVE_TAB).domingoFechado)return true;return false;}

  function breaksOf(sec,t){const T=turnoWindow(sec,t);const b=[];if(T.almocoIni&&T.almocoFim)b.push([hm2min(T.almocoIni),hm2min(T.almocoFim)]);if(T.jantarIni&&T.jantarFim)b.push([hm2min(T.jantarIni),hm2min(T.jantarFim)]);return b;}

  function maqTurnoForDate(maq,d){const td=(SETTINGS.turnosDia||{})[dateKey(d)];const v=td&&td[maq];if(v===0||v==='0')return 0;const n=parseInt(v,10);return (n>=1&&n<=4)?n:1;}

  function dayCustom(maq,d){return ((SETTINGS.turnosCustom||{})[dateKey(d)]||{})[maq]||null;}

  function dayWindowFor(maq,d){
    const sec=secOfMaq(maq);const c=secCfg(sec);
    if(isDayClosed(d,sec))return null;
    if(maqTurnoForDate(maq,d)===0)return null;
    const ov=dayOverride(d);const dow=(d.getDay()+6)%7;let ini,fim,breaks;const tno=maqTurnoForDate(maq,d);
    let slots=null;
    if(tno===4){const cc=dayCustom(maq,d)||{};const tc=turnoWindow(sec,4);ini=hm2min(cc.ini||tc.ini||'06:00');fim=hm2min(cc.fim||tc.fim||'14:00');if(fim<=ini)fim+=1440;breaks=breaksOf(sec,4);
      // 2º slot personalizado (ex.: 06:00–10:00 e 14:00–18:00): a janela passa a ir do início do 1º ao fim do 2º, com o intervalo entre eles fechado
      let i2=hm2min(cc.ini2||''),f2=hm2min(cc.fim2||'');
      if(i2!=null&&f2!=null){if(i2<fim)i2+=1440*(i2<ini?1:0);if(i2<fim)i2=fim;if(f2<=i2)f2+=1440;breaks=breaks.concat([[fim,i2]]);slots=[[ini,fim],[i2,f2]];fim=f2;}}
    else if(dow===5){ini=hm2min(c.sabadoIni||'06:00');fim=hm2min(c.sabadoFim||'14:00');breaks=breaksOf(sec,1);}
    else{const t1=turnoWindow(sec,1);ini=hm2min(t1.ini);
      const last=tno>=3?3:(tno>=2?2:1);const tl=turnoWindow(sec,last);fim=hm2min(tl.fim);if(fim<=ini)fim+=1440;
      breaks=breaksOf(sec,1);if(tno>=2)breaks=breaks.concat(breaksOf(sec,2));if(tno>=3)breaks=breaks.concat(breaksOf(sec,3));}
    if(ov&&ov.ini)ini=hm2min(ov.ini);
    if(ov&&ov.fim){fim=hm2min(ov.fim);if(fim<=ini)fim+=1440;}
    return slots?{ini,fim,breaks,slots}:{ini,fim,breaks};
  }

  function dayIntervalsAbs(maq,anchorDate,k){const d=new Date(anchorDate);d.setDate(d.getDate()+k);const w=dayWindowFor(maq,d);if(!w)return [];if(w.slots)return w.slots.map(sl=>({ini:k*1440+sl[0],fim:k*1440+sl[1]}));return [{ini:k*1440+w.ini,fim:k*1440+w.fim}];}

  function mergedIntervalFrom(maq,anchorDate,absMin){
    const MAXD=1200;let first=null,firstK=-1,firstI=-1;
    const sk=Math.max(0,Math.floor(absMin/1440)-1);
    for(let k=sk;k<MAXD&&!first;k++){const ivs=dayIntervalsAbs(maq,anchorDate,k);for(let i=0;i<ivs.length;i++){if(ivs[i].fim>absMin){first=ivs[i];firstK=k;firstI=i;break;}}}
    if(!first)return null;
    let fim=first.fim;
    // funde intervalos seguintes contíguos (2º slot do mesmo dia só se colar ao 1º; dias seguintes se colarem, ex.: 3 turnos)
    for(let k=firstK;k<MAXD;k++){const ivs=dayIntervalsAbs(maq,anchorDate,k);if(!ivs.length)break;let stop=false;
      for(let i=(k===firstK?firstI+1:0);i<ivs.length;i++){if(ivs[i].ini<=fim){if(ivs[i].fim>fim)fim=ivs[i].fim;}else{stop=true;break;}}
      if(stop)break;}
    return {ini:first.ini,fim};
  }

  function batchMinutes(o,sec,maq){
    if(sec==='W')return washCycleFor(maq,washProgramFor(o));
    if(sec==='I'){const ic=(SETTINGS.innoCycle||{})[o.i_prog];return (typeof ic==='number')?ic:(ic?((+ic.carga||0)+(+ic.ciclo||0)+(+ic.desc||0)):45);}
    // Make-up por BATCH: secagem (Base dados MQ, col K) + passagem TS-TI + descarga; sem programa usa o default
    const mc=(SETTINGS.mqCycle||{})[o.m_prog];return (mc||(+SETTINGS.mqCycleDefault||45))+mqExtra();
  }

  const _sched={};

  function scheduleMaq(maq){
    if(_sched[maq])return _sched[maq];
    const sec=secOfMaq(maq);const p=PREF[sec];const c=secCfg(sec);
    const orders=DATA.filter(o=>o[p+'_maq']===maq&&o[p+'_wk']&&dDateStage(o,sec))
      .sort((a,b)=>cmpDay(dDateStage(a,sec),dDateStage(b,sec))||((+a[p+'_sort']||0)-(+b[p+'_sort']||0)));
    const segs={};const setup=+c.setupMin||0;const gap=+c.interBatchMin||0;let redesList=[];
    const push=(date,op,bi,s,e,q)=>{const k=dateKey(date);const seg={op,batchIdx:bi,startMin:s,endMin:e,qtdSeg:q,date:new Date(date)};(segs[k]=segs[k]||[]).push(seg);return seg;};
    const nextOpen=(date)=>{let d=new Date(date);for(let i=0;i<400;i++){d.setDate(d.getDate()+1);if(dayWindowFor(maq,d))return d;}return null;};
    const nextCal=(date)=>{const x=new Date(date);x.setDate(x.getDate()+1);return x;};
    let curDate=null,curMin=0;
    // MANUTENÇÕES COM HORA FIXA (w_mode manual + hora): ficam exactamente à hora definida; as ordens contornam-nas
    // (uma batch que não caiba antes do bloco passa para depois dele)
    const blocks=[];
    orders.filter(op=>op.manut&&op[p+'_mode']==='manual'&&hm2min(op[p+'_hIni'])!=null).forEach(op=>{
      const day=dDateStage(op,sec);if(!day)return;const h=hm2min(op[p+'_hIni']);const dur=+op.dur||(SETTINGS.manutencao||{})[op.nome]||90;
      const seg=push(day,op,1,h,h+dur,0);seg.fixed=true;blocks.push({dk:dateKey(day),ini:h,fim:h+dur,prev:new Date(day)});});
    const blockEndFor=(dd,s,e)=>{   // devolve o fim (em minutos de dd) do 1º bloco fixo que colide com [s,e) nesse dia, ou null
      const dk=dateKey(dd);const pd=new Date(dd);pd.setDate(pd.getDate()-1);const pk=dateKey(pd);let best=null;
      blocks.forEach(b=>{let bi=null,bf=null;if(b.dk===dk){bi=b.ini;bf=b.fim;}else if(b.dk===pk&&b.fim>1440){bi=b.ini-1440;bf=b.fim-1440;}
        if(bi==null)return;if(s<bf&&e>bi){if(best===null||bf>best)best=bf;}});return best;};
    for(const op of orders){
      if(op.manut&&op[p+'_mode']==='manual'&&hm2min(op[p+'_hIni'])!=null)continue;   // já colocada como bloco fixo
      let startDay=dDateStage(op,sec),w=dayWindowFor(maq,startDay);
      while(!w){startDay=nextOpen(startDay);if(!startDay)break;w=dayWindowFor(maq,startDay);}
      if(!startDay)continue;
      // REDES: lavada/processada em conjunto (só W e I) — guardar para anexar ao host (não ocupa tempo).
      // No MQ não há processos em conjunto: a REDES é ordem normal e ocupa tempo como qualquer outra.
      if(op.redes&&sec!=='M'){redesList.push(op);continue;}
      if(curDate===null||cmpDay(curDate,startDay)<0){curDate=startDay;curMin=dayWindowFor(maq,curDate).ini;}
      else curMin+=setup;
      // manual: mantém o DIA onde a ordem está a ser escalonada, muda só a hora de início
      const manual=(op[p+'_mode']==='manual')?hm2min(op[p+'_hIni']):null;
      if(manual!=null){const w0=dayWindowFor(maq,curDate);if(w0)curMin=Math.max(manual,w0.ini);}
      const isManut=!!op.manut;
      const nb=isManut?1:nBatches(op,sec,maq);const cycConst=isManut?((SETTINGS.manutencao||{})[op.nome]||90):batchMinutes(op,sec,maq);const qPer=(+op.qtd||0)/nb;
      // Make-up: tempo pode variar por batch (406 alterna 1ª aplicação / 2ª aplicação -R)
      const cycArr=(!isManut&&sec==='M')?mqPerBatch(op):null;
      // 1º batch arranca dentro da janela do dia planeado
      {const w1=dayWindowFor(maq,curDate);if(w1&&curMin<w1.ini)curMin=w1.ini;}
      // batches seguidos numa linha de tempo CONTÍNUA de disponibilidade: dias contíguos (ex. 3 turnos = 24h)
      // fluem sem corte; só há salto quando existe folga real (turno mais curto, dia fechado). O cartão parte-se
      // no limite do dia mas a ordem seguinte só arranca quando esta termina (não no início do turno).
      const hostSegs=[];let curAbs=curMin;   // minutos absolutos a partir da meia-noite de curDate
      const t1ini=hm2min((turnoWindow(sec,1)||{}).ini)||0;   // início do turno 1 (fronteira do dia)
      for(let bi=1;bi<=nb;bi++){
        const cyc=cycArr?(cycArr[bi-1]||cycArr[cycArr.length-1]):cycConst;
        let iv=mergedIntervalFrom(maq,curDate,curAbs);if(!iv)break;
        if(curAbs<iv.ini)curAbs=iv.ini;
        let g=0;while(curAbs+cyc>iv.fim&&g++<800){curAbs=iv.fim;iv=mergedIntervalFrom(maq,curDate,curAbs);if(!iv)break;curAbs=iv.ini;}
        if(!iv)break;
        // o dia só "roda" quando o INÍCIO do batch atinge o início do turno 1 (ex.: um batch às 01:40 fica no dia anterior)
        let dayIdx=Math.max(0,Math.floor((curAbs-t1ini)/1440));let s=curAbs-dayIdx*1440;let dd=new Date(curDate);dd.setDate(dd.getDate()+dayIdx);
        // colisão com manutenção de hora fixa → salta para depois do bloco (e volta a validar a janela)
        {let gb=0;let be=blockEndFor(dd,s,s+cyc);while(be!==null&&gb++<20){curAbs=curAbs+(be-s)+gap;iv=mergedIntervalFrom(maq,curDate,curAbs);if(!iv)break;if(curAbs<iv.ini)curAbs=iv.ini;
            let g2=0;while(curAbs+cyc>iv.fim&&g2++<800){curAbs=iv.fim;iv=mergedIntervalFrom(maq,curDate,curAbs);if(!iv)break;curAbs=iv.ini;}if(!iv)break;
            dayIdx=Math.max(0,Math.floor((curAbs-t1ini)/1440));s=curAbs-dayIdx*1440;dd=new Date(curDate);dd.setDate(dd.getDate()+dayIdx);be=blockEndFor(dd,s,s+cyc);}
          if(!iv)break;}
        const seg=push(dd,op,bi,s,s+cyc,qPer);hostSegs.push(seg);
        curAbs=curAbs+cyc+gap;
      }
      curMin=curAbs;   // continua a partir do fim desta ordem
      // só "roda" para o dia seguinte quando a hora já está DENTRO da janela desse dia; se a janela do dia actual ainda
      // está a decorrer de madrugada (ex.: 14:00–05:15 e a ordem acabou às 00:05), a próxima ordem continua nesse dia
      {let g=0;while(curMin>=1440&&g++<60){const nd=nextCal(curDate);const wn=dayWindowFor(maq,nd);if(wn&&curMin-1440>=wn.ini){curMin-=1440;curDate=nd;}else break;}}
    }
    // anexar REDES ao HOST EXPLÍCITO (w_redesHost) — determinístico, não muda quando se planeiam outras ordens
    const byOpId={};Object.values(segs).flat().forEach(s=>{(byOpId[s.op.id]=byOpId[s.op.id]||[]).push(s);});
    redesList.forEach(rop=>{let hs=null;const hid=rop[p+'_redesHost'];
      if(hid!=null&&byOpId[hid])hs=byOpId[hid];                                   // host fixo escolhido
      else{const h=findRedesHost(sec,maq,dDateStage(rop,sec)||new Date());if(h&&byOpId[h.id])hs=byOpId[h.id];}   // fallback (ordens antigas sem host fixo)
      if(hs&&hs.length){hs=hs.slice().sort((a,b)=>a.batchIdx-b.batchIdx);const bidx=Math.min(Math.max(+rop[p+'_redesBatch']||1,1),hs.length);const tgt=hs.find(x=>x.batchIdx===bidx)||hs[0];tgt.redesOps=(tgt.redesOps||[]).concat(rop);_attachedRedes.add(sec+':'+rop.id);}});
    // REDES sem host (não há ordem para acompanhar) → NÃO se planeia sozinha; fica no Kanban (ver renderPool)
    const byOp={};Object.values(segs).flat().forEach(s=>{(byOp[s.op.id]=byOp[s.op.id]||[]).push(s);});
    Object.values(byOp).forEach(list=>{list.sort((a,b)=>a.date-b.date||a.startMin-b.startMin);const days=new Set(list.map(s=>dateKey(s.date)));list.forEach(s=>{s.total=list.length;s.multiDay=days.size>1;});});
    _sched[maq]=segs;return segs;
  }

  const _attachedRedes=new Set();

  function finishOfSection(sec){
    const out={};
    maqsOf(sec).forEach(maq=>{const segs=scheduleMaq(maq);
      Object.values(segs).flat().forEach(s=>{const id=s.op.id;const cur=out[id];
        if(!cur||cmpDay(s.date,cur.d)>0||(cmpDay(s.date,cur.d)===0&&s.endMin>cur.min))out[id]={d:new Date(s.date),min:s.endMin};
        // REDES lavadas em conjunto: o seu fim = fim do batch host
        (s.redesOps||[]).forEach(r=>{const c=out[r.id];if(!c||cmpDay(s.date,c.d)>0||(cmpDay(s.date,c.d)===0&&s.endMin>c.min))out[r.id]={d:new Date(s.date),min:s.endMin};});
      });});
    return out;
  }

  let WASH_FIN=null;

  function washFinishMap(){return WASH_FIN||(WASH_FIN=finishOfSection('W'));}

  function released(o){return o.liberado!==false;}

  function realFinishOf(o,sec){const p=PREF[sec];const arr=o[p+'_real'];if(!Array.isArray(arr))return '';const nb=nBatches(o,sec,o[p+'_maq']||'');const last=arr[nb-1];return (last&&last.f)?last.f:'';}

  function bizDayPlus(d,n){const x=new Date(d);let a=0;while(a<n){x.setDate(x.getDate()+1);const w=x.getDay();if(w!==0&&w!==6)a++;}return x;}

  function mqBaseDate(o){
    if(o.temW){let bd=null;splitSiblings(o).forEach(x=>{if(!x.temW)return;const f=washFinishMap()[x.id];if(f&&f.d&&(!bd||f.d>bd))bd=f.d;});if(bd)return new Date(bd.getFullYear(),bd.getMonth(),bd.getDate());}   // último dia da Lavação (lotes de 2 dias / divisões: a maior)
    let d=dDateStage(o,'W');if(!d)d=dDateStage(o,'I');if(!d&&/^\d{4}-\d{2}-\d{2}/.test(o.diaPlano||''))d=new Date(o.diaPlano+'T00:00:00');return d||null;}

  function mqExpectDate(o){const b=mqBaseDate(o);return b?bizDayPlus(b,1):null;}

  function effMqDay(o){
    if(o.temW)return mqExpectDate(o);
    if(/^\d{4}-\d{2}-\d{2}/.test(o.m_data||''))return new Date(o.m_data+'T00:00:00');
    return null;
  }

  function batchMaq(o,bi){const mb=o.m_maqB||{};return (mb[bi]!=null&&mb[bi]!=='')?mb[bi]:(o.m_maq||'');}

  function mqSeqOf(o,bi){return +((o.m_bseq||{})[bi]||0);}

  function innoBatchProg(o,bi){return ((o.i_progB||{})[bi])||o.i_prog||'INNO 2H';}

  function innoWashPlusDay(o){
    const wf=washFinishDM(o,washFinishMap());if(!wf)return null;const maq=maqsOf('I')[0]||'INNOCORK';
    let d=new Date(wf.d.getFullYear(),wf.d.getMonth(),wf.d.getDate());const start=(typeof wf.min==='number'?wf.min:0)+120;
    const win=dayWindowFor(maq,d);
    if(!win||start>win.fim){for(let i=0;i<120;i++){d.setDate(d.getDate()+1);if(dayWindowFor(maq,d))break;}}
    return d;
  }

  function innoDay(o){if(o.i_manual&&o.i_wk)return dDateStage(o,'I');if(o.temW){const ad=innoWashPlusDay(o);if(ad)return ad;}return dDateStage(o,'I');}

  function innoBatchDay(o,bi){const db=(o.i_dayB||{})[bi];if(db&&/^\d{4}-\d{2}-\d{2}/.test(db))return new Date(db+'T00:00:00');return innoDay(o);}

  function isProtoI(o){return !!(o&&o.i_tipo==='PROTO');}

  function isRedesI(o){return !!(o&&!isProtoI(o)&&(o.redes||o.i_tipo==='REDES'));}

  function innoBatchMin(prog){const ic=(SETTINGS.innoCycle||{})[prog];return (typeof ic==='number')?ic:(ic?((+ic.carga||0)+(+ic.ciclo||0)+(+ic.desc||0)):45);}

  function washFinishDM(o,finW){const fin=finW[o.id];if(!fin)return null;const rf=realFinishOf(o,'W');const m=rf?hm2min(rf):null;return {d:fin.d,min:(m!=null?m:fin.min)};}

  function scheduleInno(maq){
    // ordens já colocadas manualmente (buffer/overrides/limpeza) + ordens da Lavação que entram automaticamente
    const planned=innoPlannedSet(maq);
    const baseIdx=new Map();planned.slice().sort((a,b)=>cmpDay(innoDay(a),innoDay(b))||((+a.i_sort||0)-(+b.i_sort||0))).forEach((o,i)=>baseIdx.set(o.id,i));
    const items=[];
    planned.forEach(o=>{if(isRedesI(o)){items.push({o,bi:0,kind:'r'});}else if(isProtoI(o)){items.push({o,bi:0,nb:1,kind:'p'});}else if(o.manut){items.push({o,bi:1,nb:1,kind:'m'});}else{const nb=nBatches(o,'I',maq);for(let bi=1;bi<=nb;bi++)items.push({o,bi,nb,kind:'b'});}});
    const keyOf=it=>(it.kind==='r'||it.kind==='p')?'R':it.bi;
    const seqOf=it=>{const s=(it.o.i_bseq||{})[keyOf(it)];return s!=null?+s:((baseIdx.get(it.o.id)||0)*1000+((it.kind==='r'||it.kind==='p')?999:it.bi));};
    // ordenar primeiro por DIA (do batch, se tiver override; senão da ordem), depois por sequência
    const itemDay=it=>(it.kind==='b')?innoBatchDay(it.o,it.bi):innoDay(it.o);
    items.sort((a,b)=>(cmpDay(itemDay(a),itemDay(b))||0)||(seqOf(a)-seqOf(b)));
    let anchor=null;planned.forEach(o=>{const d=innoDay(o);if(d&&(!anchor||d<anchor))anchor=d;});
    anchor=anchor?new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()):new Date();
    let aw=dayWindowFor(maq,anchor),g=0;while(!aw&&g++<400){anchor.setDate(anchor.getDate()+1);aw=dayWindowFor(maq,anchor);}
    const segs=[];let curAbs=aw?aw.ini:360;let lastSeg=null;const t1=hm2min((turnoWindow('I',1)||{}).ini)||360;const gap=+secCfg('I').interBatchMin||0;
    const finW=finishOfSection('W');   // fim planeado do Wash por ordem
    const segByKey={};const redesItems=[];const protoItems=[];
    for(const it of items){
      if(it.kind==='r'){redesItems.push(it);continue;}   // REDES: ligadas depois, ao batch host explícito
      if(it.kind==='p'){protoItems.push(it);continue;}   // PROTÓTIPO: linha própria, sem ocupar tempo
      const cyc=(it.kind==='m')?(+it.o.dur||(SETTINGS.manutencao||{})[it.o.nome]||90):innoBatchMin(innoBatchProg(it.o,it.bi));
      // disponibilidade / piso do dia:
      //  • batch com dia próprio (i_dayB) → esse dia   • ordem da Lavação (auto) → fim da Lavação + 2h   • restantes → dia da ordem
      const dbOv=(it.kind==='b')?(it.o.i_dayB||{})[it.bi]:null;
      if(dbOv){const od=new Date(dbOv+'T00:00:00');const oda=Math.round((od-anchor)/86400000)*1440+t1;if(oda>curAbs)curAbs=oda;}
      else if(it.kind==='b'&&it.bi===1&&it.o.temW&&!it.o.i_manual&&it.o.i_mode!=='manual'){const wf=washFinishDM(it.o,finW);if(wf){const wa=Math.round((wf.d-anchor)/86400000)*1440+wf.min+120;if(wa>curAbs)curAbs=wa;}}
      else if((it.kind==='b'&&it.bi===1)||it.kind==='m'){const od=innoDay(it.o);if(od){const oda=Math.round((od-anchor)/86400000)*1440+t1;if(oda>curAbs)curAbs=oda;}}
      // início MANUAL: 1º batch da ordem arranca à hora definida no modal, no dia onde cai (não recua)
      const manualHere=(it.kind==='b'&&it.bi===1&&it.o.i_mode==='manual'&&hm2min(it.o.i_hIni)!=null);
      if(manualHere){const di=Math.max(0,Math.floor((curAbs-t1)/1440));curAbs=Math.max(curAbs,di*1440+hm2min(it.o.i_hIni));}
      let iv=mergedIntervalFrom(maq,anchor,curAbs);if(!iv)break;if(curAbs<iv.ini)curAbs=iv.ini;
      // início manual é autoritário: fica à hora definida mesmo que ultrapasse o fim do turno (não transborda)
      if(!manualHere){let gg=0;while(curAbs+cyc>iv.fim&&gg++<800){curAbs=iv.fim;iv=mergedIntervalFrom(maq,anchor,curAbs);if(!iv)break;curAbs=iv.ini;}}
      if(!iv)break;
      const dayIdx=Math.max(0,Math.floor((curAbs-t1)/1440));const s=curAbs-dayIdx*1440;const dd=new Date(anchor);dd.setDate(dd.getDate()+dayIdx);
      const seg={o:it.o,bi:it.bi,nb:it.nb,kind:it.kind,startMin:s,endMin:s+cyc,date:dd,manual:manualHere};segs.push(seg);lastSeg=seg;curAbs=curAbs+cyc+gap;
      if(it.kind==='b')segByKey[it.o.id+':'+it.bi]=seg;
    }
    // REDES: entram no fim do seu dia (fim Lavação + 2h) SEM consumir tempo (lavadas em conjunto)
    // REDES têm de ser processadas EM CONJUNTO com um batch de outra ordem: se o seu dia estiver fechado ou sem batches,
    // saltam para o 1º dia seguinte com batches (senão o último dia anterior com batches)
    const batchDays=[...new Set(segs.filter(sg=>sg.kind==='b').map(sg=>dateKey(sg.date)))].sort();
    redesItems.forEach(it=>{const r=it.o;let day=innoBatchDay(r,0)||anchor;
      let dk=dateKey(day);
      if(!batchDays.includes(dk)||!dayWindowFor(maq,day)){const nx=batchDays.find(k=>k>dk)||batchDays.filter(k=>k<dk).pop();if(nx){dk=nx;day=new Date(nx+'T00:00:00');}}
      let last=null;segs.forEach(sg=>{if(dateKey(sg.date)===dk&&sg.kind==='b'&&(!last||sg.endMin>last.endMin))last=sg;});
      // host explícito (escolhido na linha da REDES): esse batch, se estiver nesse dia; senão o último batch do dia
      let host=null;if(r.i_redesHost){const hb=+r.i_redesHostBi||1;host=segs.find(sg=>dateKey(sg.date)===dk&&sg.kind==='b'&&sg.o.id===r.i_redesHost&&sg.bi===hb)||segs.find(sg=>dateKey(sg.date)===dk&&sg.kind==='b'&&sg.o.id===r.i_redesHost)||null;}
      if(!host)host=last;
      const startM=host?host.endMin:((dayWindowFor(maq,day)||{ini:t1}).ini);
      const dd=host?new Date(host.date):new Date(day);
      const seg={o:r,bi:0,nb:1,kind:'r',startMin:startM,endMin:startM,date:dd,host};segs.push(seg);   // endMin=startM → 0 tempo
      if(host)host.redesOps=(host.redesOps||[]).concat(seg);   // aninhada DENTRO do batch host (como na Lavação)
      _attachedRedes.add('I:'+r.id);});
    // PROTÓTIPOS: linha individual no seu dia (no fim do que já está planeado), 0 minutos — não consomem capacidade
    protoItems.forEach(it=>{const o=it.o;let day=innoBatchDay(o,0)||anchor;let g=0;while(!dayWindowFor(maq,day)&&g++<60){day=new Date(day);day.setDate(day.getDate()+1);}
      const dk=dateKey(day);let last=null;segs.forEach(sg=>{if(dateKey(sg.date)===dk&&sg.kind!=='r'&&(!last||sg.endMin>last.endMin))last=sg;});
      const st=last?last.endMin:((dayWindowFor(maq,day)||{ini:t1}).ini);segs.push({o,bi:0,nb:1,kind:'p',startMin:st,endMin:st,date:last?new Date(last.date):new Date(day)});});
    return segs;
  }

  function innoPlannedSet(maq){return DATA.filter(x=>x.i_maq===maq&&x.i_wk&&dDateStage(x,'I'));}

  function findRedesHost(sec,maq,d){const p=PREF[sec];
    const hosts=DATA.filter(o=>!o.redes&&!o.manut&&o[p+'_maq']===maq&&o[p+'_wk']&&dDateStage(o,sec));
    const key=dateKey(d);const sameDay=hosts.filter(o=>dateKey(dDateStage(o,sec))===key).sort((a,b)=>(+a[p+'_sort']||0)-(+b[p+'_sort']||0));
    if(sameDay.length)return sameDay[sameDay.length-1];
    const after=hosts.filter(o=>cmpDay(dDateStage(o,sec),d)>=0).sort((a,b)=>cmpDay(dDateStage(a,sec),dDateStage(b,sec)));
    return after[0]||null;}

  function splitSiblings(o){const pid=o.splitParent||o.id;return DATA.filter(x=>x.id===pid||(x.splitParent||null)===pid);}

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
