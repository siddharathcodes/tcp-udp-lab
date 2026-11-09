/* ===== UI ===== */
const $=id=>document.getElementById(id);
const fmt=(x,d=1)=>x==null||isNaN(x)?'n/a':(+x).toFixed(d).replace(/\.0+$/,'');
const ms=x=>x==null?'n/a':x>=10000?fmt(x/1000,1)+' s':Math.round(x)+' ms';
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc=s=>String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const redraw={};

/* ---- theme ---- */
const themes=['auto','light','dark'];let themeIx=Math.max(0,themes.indexOf(store.get('rl-theme')||'auto'));
function applyTheme(){const t=themes[themeIx];if(t==='auto')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);
  $('themeBtn').textContent='Theme: '+t;requestAnimationFrame(()=>Object.values(redraw).forEach(f=>f&&f()))}
$('themeBtn').onclick=()=>{themeIx=(themeIx+1)%3;store.set('rl-theme',themes[themeIx]);applyTheme()};
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>themeIx===0&&applyTheme())}catch(e){}

/* ---- chart helper ---- */
const charts={};
function mkChart(id,cfg){
  if(charts[id])charts[id].destroy();
  const ink=css('--muted'),grid=css('--grid');
  cfg.options=Object.assign({responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false}},cfg.options||{});
  const o=cfg.options;o.plugins=Object.assign({legend:{labels:{color:css('--ink'),boxWidth:12,font:{family:'IBM Plex Sans',size:12}}}},o.plugins||{});
  o.scales=o.scales||{};
  for(const k in o.scales){const s=o.scales[k];s.ticks=Object.assign({color:ink,font:{family:'IBM Plex Mono',size:11}},s.ticks||{});s.grid=Object.assign({color:grid},s.grid||{});
    if(s.title)s.title=Object.assign({color:ink,font:{family:'IBM Plex Sans',size:12}},s.title)}
  charts[id]=new Chart($(id),cfg);return charts[id];
}
const ds=(label,data,color,extra)=>Object.assign({label,data,borderColor:color,backgroundColor:color,borderWidth:2.2,pointRadius:3,pointHoverRadius:5,tension:.15},extra||{});

/* ---- router ---- */
const views=['scenarios','experiment','rtt','headers','live','guide'];const inited={};
const inits={scenarios:initScenarios,experiment:initExperiment,rtt:initRtt,headers:initHeaders,live:initLive,guide:initGuide};
function route(){
  let h=(location.hash||'#scenarios').slice(1);if(!views.includes(h))h='scenarios';
  views.forEach(v=>{$('v-'+v).hidden=v!==h});
  document.querySelectorAll('#tabs a').forEach(a=>{if(a.getAttribute('href')==='#'+h)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  if(!inited[h]){inited[h]=1;inits[h]()}else if(redraw[h])redraw[h]();
  if(h!=='scenarios')anim.playing=false,updPlay();
}
addEventListener('hashchange',route);

/* ================= SCENARIOS ================= */
const SC={
 noloss:{name:'No loss',cfg:{n:4,window:4},note:'Every segment is acknowledged. Turn on delayed ACK to see slide 12: the receiver waits up to 500 ms and answers two in-order segments with one cumulative ACK. UDP has nothing to acknowledge, it just delivers.'},
 ploss:{name:'Packet loss',cfg:{n:4,window:4,dropData:['1:0']},note:'The second segment (Seq=1500) is dropped. Later segments make the receiver repeat ACK=1500, but only two duplicates arrive, so fast retransmit does not fire. The sender waits for the timer, retransmits, and the stream completes. UDP never notices: the app is left with a hole.'},
 aloss:{name:'ACK loss',cfg:{n:2,window:2,dropAck:['2:0']},note:'The ACK for the last segment is lost (slide 13, left). The timer expires, TCP retransmits, the receiver discards the duplicate and ACKs again. UDP sends no ACKs, so the sender never learns what happened.'},
 cum:{name:'Cumulative ACK',cfg:{n:2,window:2,dropAck:['1:0']},note:'The first ACK is lost, but the next one says ACK=2000, meaning everything below 2000 arrived (slide 14). No retransmission is needed.'},
 prem:{name:'Premature timeout',cfg:{n:2,window:2,rto:150},note:'The timer (150 ms) is shorter than the round trip (about 200 ms), so TCP retransmits data that was fine (slide 13, right). The receiver sees a duplicate, drops it and sends a cumulative ACK. UDP has no timers, so this cannot happen.'},
 fast:{name:'Fast retransmit',cfg:{n:6,window:6,dropData:['1:0'],rto:1200},note:'Segment 2 is lost while segments 3 to 6 arrive, each triggering a duplicate ACK. After the third, the sender retransmits immediately instead of waiting for the 1.2 s timer (slide 15). Untick fast retransmit to compare.'},
 custom:{name:'Random network',cfg:{},note:'Random data loss, ACK loss, duplication and reordering. Change the seed for a different run. This shows what UDP hands to the application: holes, duplicates and shuffled order.'}
};
const anim={key:'ploss',ph:0,T:1,playing:false,speed:1,last:0,tcp:null,udp:null};
function initScenarios(){
  $('scChips').innerHTML=Object.entries(SC).map(([k,v])=>`<button class="pill" data-k="${k}" aria-pressed="${k===anim.key}">${v.name}</button>`).join('');
  $('scChips').onclick=e=>{const b=e.target.closest('button');if(b){anim.key=b.dataset.k;buildScenario(true)}};
  $('speedBtns').innerHTML=[.5,1,2].map(s=>`<button class="pill" data-s="${s}" aria-pressed="${s===1}">${s}×</button>`).join('');
  $('speedBtns').onclick=e=>{const b=e.target.closest('button');if(!b)return;anim.speed=+b.dataset.s;[...$('speedBtns').children].forEach(x=>x.setAttribute('aria-pressed',x===b))};
  $('playBtn').onclick=()=>{if(anim.ph>=anim.T)anim.ph=0;anim.playing=!anim.playing;anim.last=performance.now();updPlay();if(anim.playing)requestAnimationFrame(tick)};
  $('restartBtn').onclick=()=>{anim.ph=0;anim.playing=true;anim.last=performance.now();updPlay();requestAnimationFrame(tick)};
  $('tSlider').oninput=e=>{anim.playing=false;updPlay();anim.ph=+e.target.value;paint()};
  ['optFast','optDelack'].forEach(i=>$(i).onchange=()=>buildScenario(false));
  [['c_n','cN',''],['c_loss','cL','%'],['c_aloss','cA','%'],['c_dup','cD','%'],['c_reo','cR','%'],['c_seed','cS','']].forEach(([i,o,u])=>{$(i).oninput=()=>{$(o).textContent=$(i).value+u;buildScenario(false)};$(o).textContent=$(i).value+u});
  buildScenario(false);anim.ph=anim.T;paint();
}
function updPlay(){const b=$('playBtn');if(b)b.textContent=anim.playing?'Pause':(anim.ph>=anim.T?'Replay':'Play')}
function scenarioCfg(){
  const s=SC[anim.key],base=Object.assign({gap:22,owd:100,fast:$('optFast').checked,delack:$('optDelack').checked,log:true,rto:450},s.cfg);
  if(anim.key==='custom'){Object.assign(base,{n:+$('c_n').value,window:+$('c_n').value,lossData:$('c_loss').value/100,lossAck:$('c_aloss').value/100,dup:$('c_dup').value/100,reorder:$('c_reo').value/100,jitter:30,seed:+$('c_seed').value})}
  return base;
}
function buildScenario(play){
  const s=SC[anim.key];$('scNote').textContent=s.note;$('customCtl').hidden=anim.key!=='custom';
  [...$('scChips').children].forEach(b=>b.setAttribute('aria-pressed',b.dataset.k===anim.key));
  const cfg=scenarioCfg();
  anim.tcp=simulate(Object.assign({},cfg,{proto:'tcp'}));anim.udp=simulate(Object.assign({},cfg,{proto:'udp'}));
  anim.T=Math.ceil(Math.max(anim.tcp.T,anim.udp.T));
  $('tSlider').max=anim.T;
  drawDiagram('svgTcp',anim.tcp,'--tcp','TCP');drawDiagram('svgUdp',anim.udp,'--udp','UDP');
  fillLog('logTcp',anim.tcp);fillLog('logUdp',anim.udp);
  anim.ph=play?0:Math.min(anim.ph,anim.T);anim.playing=!!play;anim.last=performance.now();updPlay();paint();
  if(play)requestAnimationFrame(tick);
}
function tick(now){
  if(!anim.playing)return;
  anim.ph=Math.min(anim.T,anim.ph+(now-anim.last)*0.4*anim.speed);anim.last=now;
  if(anim.ph>=anim.T){anim.playing=false;updPlay()}
  paint();if(anim.playing)requestAnimationFrame(tick);
}
const GEO={W:440,xA:74,xB:366,top:50};
function drawDiagram(id,sim,colorVar,tag){
  const svg=$(id),{W,xA,xB,top}=GEO,scale=Math.min(.5,760/sim.T),H=top+anim.T*scale+24,Y=t=>top+t*scale;
  sim._Y=Y;sim._scale=scale;
  const col=`var(${colorVar})`;
  let o=`<defs><clipPath id="clip-${id}"><rect id="clipr-${id}" x="0" y="0" width="${W}" height="0"/></clipPath></defs>`;
  o+=`<text x="${xA}" y="20" text-anchor="middle" style="font-weight:500;font-size:11px">Host A</text><text x="${xA}" y="33" text-anchor="middle" class="mu">sender</text>`;
  o+=`<text x="${xB}" y="20" text-anchor="middle" style="font-weight:500;font-size:11px">Host B</text><text x="${xB}" y="33" text-anchor="middle" class="mu">receiver</text>`;
  o+=`<line x1="${xA}" y1="${top-8}" x2="${xA}" y2="${H-10}" stroke="var(--line)" stroke-width="2"/><line x1="${xB}" y1="${top-8}" x2="${xB}" y2="${H-10}" stroke="var(--line)" stroke-width="2"/>`;
  for(let t=0;t<=anim.T;t+=100){o+=`<text x="${W-2}" y="${Y(t)+3}" text-anchor="end" class="mu" style="font-size:8px">${t}</text><line x1="${xB+6}" x2="${xB+14}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)"/>`}
  o+=`<g clip-path="url(#clip-${id})">`;
  for(const p of sim.pk){
    const fromA=p.kind==='data',x0=fromA?xA:xB,x1=fromA?xB:xA,y0=Y(p.t0),y1=Y(p.t1);
    let stroke=p.kind==='ack'?'var(--muted)':col,w=p.kind==='ack'?1.4:1.8,dash='';
    if(p.how==='timeout'||p.how==='fast'){stroke='var(--warn)';w=2.4}
    if(p.dupCopy)dash='3 3';
    if(p.lost){
      const f=.55,ex=x0+(x1-x0)*f,ey=y0+(y1-y0)*f;
      o+=`<line x1="${x0}" y1="${y0}" x2="${ex}" y2="${ey}" stroke="var(--bad)" stroke-width="${w}" stroke-dasharray="4 3"/>`;
      o+=`<g stroke="var(--bad)" stroke-width="2"><line x1="${ex-5}" y1="${ey-5}" x2="${ex+5}" y2="${ey+5}"/><line x1="${ex-5}" y1="${ey+5}" x2="${ex+5}" y2="${ey-5}"/></g>`;
    }else{
      o+=`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${stroke}" stroke-width="${w}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
      const a=Math.atan2(y1-y0,x1-x0),hx=x1,hy=y1,s=7;
      o+=`<polygon points="${hx},${hy} ${hx-s*Math.cos(a-.4)},${hy-s*Math.sin(a-.4)} ${hx-s*Math.cos(a+.4)},${hy-s*Math.sin(a+.4)}" fill="${stroke}"/>`;
    }
    const lbl=p.kind==='ack'?`ACK ${p.n?seqLabel(sim,p.n):''}`:(sim.proto==='udp'?`#${p.n}`:`Seq ${p.seq}`);
    const mx=(x0+x1)/2,my=(y0+y1)/2;let ang=Math.atan2(y1-y0,x1-x0)*180/Math.PI;if(Math.abs(ang)>90)ang+=180;
    o+=`<text x="${mx}" y="${my}" transform="rotate(${ang.toFixed(1)} ${mx} ${my})" text-anchor="middle" dy="-3.5" style="font-size:8.5px" fill="${p.lost?'var(--bad)':'var(--ink)'}">${lbl}${p.how?(p.how==='fast'?' fast-retx':' retx'):''}</text>`;
  }
  for(const m of sim.marks){
    const y=Y(m.t);o+=`<circle cx="${xA}" cy="${y}" r="5" fill="var(--warn)"/><text x="${xA-10}" y="${y+3}" text-anchor="end" style="font-size:9px;font-weight:500" fill="var(--warn)">${m.type==='fast'?'3 dup ACKs':'RTO'}</text>`;
  }
  o+='</g>';
  o+=`<line id="ph-${id}" x1="0" x2="${W-26}" y1="0" y2="0" stroke="var(--ink)" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=o;
}
function seqLabel(sim,n){return sim.cfg.isn+n*sim.cfg.mss}
function fillLog(id,sim){
  $(id).innerHTML=sim.log.map(l=>`<div data-t="${l.t}" ${l.kind==='bad'||l.kind==='drop'?'style="color:var(--bad)"':l.kind==='retx'?'style="color:var(--warn)"':l.kind==='ok'?'style="color:var(--ok)"':''}><b>${Math.round(l.t)}</b><span>${l.who==='net'?'':l.who+' '}${esc(l.text)}</span></div>`).join('');
}
function paint(){
  const ph=anim.ph;$('tSlider').value=ph;$('tVal').textContent=Math.round(ph)+' ms';
  for(const [id,sim] of [['svgTcp',anim.tcp],['svgUdp',anim.udp]]){
    if(!sim)continue;const y=sim._Y(ph);
    $('clipr-'+id).setAttribute('height',Math.max(0,y));const l=$('ph-'+id);l.setAttribute('y1',y);l.setAttribute('y2',y);
  }
  for(const id of ['logTcp','logUdp']){
    const box=$(id);let lastVis=null;
    for(const d of box.children){const f=+d.dataset.t>ph;d.classList.toggle('future',f);if(!f)lastVis=d}
    if(anim.playing&&lastVis)box.scrollTop=Math.max(0,lastVis.offsetTop-box.clientHeight+30);
  }
  statChips('tcpChips',anim.tcp,ph);statChips('udpChips',anim.udp,ph);updPlay();
}
function statChips(id,sim,ph){
  const s=sim.stats,end=ph>=anim.T-1;let h='';
  const ok=s.complete,col=ok?'ok':'bad';
  if(sim.proto==='tcp'){
    h=`<span class="chip ${col}">${ok?'All '+s.n+' segments delivered, in order':s.delivered+'/'+s.n+' delivered'}</span><span class="chip ${s.retx?'warn':''}">${s.retx} retransmission${s.retx===1?'':'s'}${s.retx?` (${s.timeouts} timer, ${s.fast} fast)`:''}</span><span class="chip">${s.completion!=null?'done at '+Math.round(s.completion)+' ms':'never finished'}</span>`;
  }else{
    h=`<span class="chip ${col}">${s.delivered}/${s.n} datagrams delivered</span>${s.lost?`<span class="chip bad">${s.lost} lost for good</span>`:''}${s.appDup?`<span class="chip bad">${s.appDup} duplicate${s.appDup>1?'s':''} reached the app</span>`:''}${s.appOoo?`<span class="chip bad">${s.appOoo} out of order</span>`:''}<span class="chip">no ACKs, no retransmission</span>`;
  }
  $(id).innerHTML=h;
}

/* ================= EXPERIMENT ================= */
let expData=null;
function initExperiment(){
  [['e_n','eNv',''],['e_t','eTv',''],['e_d','eDv',' ms'],['e_j','eJv',' ms'],['e_u','eUv','%'],['e_r','eRv','%'],['e_w','eWv',' seg']].forEach(([i,o,u])=>{const f=()=>$(o).textContent=$(i).value+u;$(i).oninput=f;f()});
  $('runExp').onclick=runExperiment;$('copyCsv').onclick=copyCsv;
  redraw.experiment=()=>expData&&renderExp();
  runExperiment();
}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
async function runExperiment(){
  const btn=$('runExp');btn.disabled=true;
  const P={n:+$('e_n').value,trials:+$('e_t').value,owd:+$('e_d').value,jit:+$('e_j').value,dup:$('e_u').value/100,reo:$('e_r').value/100,w:+$('e_w').value,ack:$('e_ack').checked,fast:$('e_fr').checked};
  let losses=$('e_loss').value.split(/[ ,;]+/).map(Number).filter(x=>!isNaN(x)&&x>=0&&x<=60).slice(0,12);if(!losses.length)losses=[0,5,10];
  const rows=[];
  for(const L of losses){
    $('expStatus').textContent=`Running ${L}% loss…`;await new Promise(r=>setTimeout(r,0));
    const T={del:[],comp:[],to:[],fa:[],segs:[],ab:0,ok:0},U={del:[],comp:[],dup:[],ooo:[],ok:0};
    for(let t=0;t<P.trials;t++){
      const base={n:P.n,window:P.w,owd:P.owd,jitter:P.jit,gap:10,adaptive:true,rto:1000,minRto:200,delack:false,fast:P.fast,lossData:L/100,lossAck:P.ack?L/100:0,dup:P.dup,reorder:P.reo,seed:t*7919+Math.round(L*100)+1,log:false};
      const a=simulate({...base,proto:'tcp'}),b=simulate({...base,proto:'udp'});
      T.del.push(100*a.stats.delivered/P.n);if(a.stats.completion!=null&&a.stats.complete)T.comp.push(a.stats.completion);
      T.to.push(100*a.stats.timeouts/P.n);T.fa.push(100*a.stats.fast/P.n);T.segs.push(a.stats.segsSent);T.ab+=a.stats.aborted?1:0;T.ok+=a.stats.complete?1:0;
      U.del.push(100*b.stats.delivered/P.n);if(b.stats.completion!=null)U.comp.push(b.stats.completion);U.dup.push(100*b.stats.appDup/P.n);U.ooo.push(100*b.stats.appOoo/P.n);U.ok+=b.stats.complete?1:0;
    }
    rows.push({loss:L,tcpDel:mean(T.del),tcpComp:mean(T.comp),tcpTo:mean(T.to),tcpFast:mean(T.fa),tcpAb:100*T.ab/P.trials,tcpOk:100*T.ok/P.trials,tcpSegs:mean(T.segs),
      udpDel:mean(U.del),udpComp:mean(U.comp),udpDup:mean(U.dup),udpOoo:mean(U.ooo),udpOk:100*U.ok/P.trials});
  }
  expData={P,rows};$('expStatus').textContent=`Done. ${P.trials} trials × ${rows.length} loss rates × 2 protocols.`;btn.disabled=false;renderExp();
}
function renderExp(){
  const {P,rows}=expData,labels=rows.map(r=>r.loss+'%'),tc=css('--tcp'),uc=css('--udp');
  $('expCharts').hidden=false;$('expTableBox').hidden=false;
  const yPct={beginAtZero:true,max:100,title:{display:true,text:'% delivered'}};
  mkChart('ch1',{type:'line',data:{labels,datasets:[ds('TCP',rows.map(r=>r.tcpDel),tc),ds('UDP',rows.map(r=>r.udpDel),uc)]},options:{scales:{y:yPct,x:{title:{display:true,text:'Loss rate'}}}}});
  mkChart('ch2',{type:'line',data:{labels,datasets:[ds('TCP',rows.map(r=>r.tcpComp),tc),ds('UDP',rows.map(r=>r.udpComp),uc)]},options:{scales:{y:{type:'logarithmic',title:{display:true,text:'ms (log scale)'}},x:{title:{display:true,text:'Loss rate'}}}}});
  mkChart('ch3',{type:'bar',data:{labels,datasets:[{label:'After timer expiry',data:rows.map(r=>r.tcpTo),backgroundColor:css('--warn')},{label:'Fast retransmit',data:rows.map(r=>r.tcpFast),backgroundColor:tc}]},options:{scales:{x:{stacked:true,title:{display:true,text:'Loss rate'}},y:{stacked:true,beginAtZero:true,title:{display:true,text:'per 100 segments'}}}}});
  mkChart('ch4',{type:'bar',data:{labels,datasets:[{label:'UDP duplicates',data:rows.map(r=>r.udpDup),backgroundColor:uc},{label:'UDP out of order',data:rows.map(r=>r.udpOoo),backgroundColor:css('--bad')},{label:'TCP (always 0)',data:rows.map(()=>0),backgroundColor:tc}]},options:{scales:{x:{title:{display:true,text:'Loss rate'}},y:{beginAtZero:true,title:{display:true,text:'per 100 datagrams'}}}}});
  const f=$('expFindings');f.hidden=false;
  const ref=rows.reduce((b,r)=>Math.abs(r.loss-10)<Math.abs(b.loss-10)?r:b,rows[0]),worst=rows[rows.length-1];
  const slow=ref.tcpComp&&ref.udpComp?ref.tcpComp/ref.udpComp:null;
  f.innerHTML=`<h3 style="margin-bottom:8px">What the numbers say</h3><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
  <li>At <b>${ref.loss}%</b> loss, UDP delivered <b class="udp-c">${fmt(ref.udpDel)}%</b> of the stream (${fmt(100-ref.udpDel)} of every 100 datagrams never reached the app). TCP delivered <b class="tcp-c">${fmt(ref.tcpDel)}%</b>.</li>
  <li>That reliability cost time: TCP finished in <b class="tcp-c">${ms(ref.tcpComp)}</b> versus <b class="udp-c">${ms(ref.udpComp)}</b> for UDP${slow?` (${fmt(slow,1)}× longer)`:''}.</li>
  <li>At <b>${worst.loss}%</b> loss TCP needed <b>${fmt(worst.tcpTo+worst.tcpFast)}</b> retransmissions per 100 segments${worst.tcpFast+worst.tcpTo?`, ${fmt(100*worst.tcpFast/(worst.tcpFast+worst.tcpTo),0)}% of them fast retransmits`:''}, and only <b>${fmt(worst.udpOk,0)}%</b> of UDP runs were complete.</li>
  <li>TCP completed <b>${fmt(worst.tcpOk,0)}%</b> of runs at ${worst.loss}% loss${worst.tcpAb?` and gave up in ${fmt(worst.tcpAb,0)}%`:''}.</li></ul>`;
  const t=$('expTable');
  t.innerHTML=`<tr><th>Loss</th><th>TCP delivered %</th><th>TCP time</th><th>TCP timer retx/100</th><th>TCP fast retx/100</th><th>TCP wire segs</th><th>UDP delivered %</th><th>UDP time</th><th>UDP dup/100</th><th>UDP ooo/100</th></tr>`+rows.map(r=>`<tr><td>${r.loss}%</td><td>${fmt(r.tcpDel,2)}</td><td>${ms(r.tcpComp)}</td><td>${fmt(r.tcpTo,2)}</td><td>${fmt(r.tcpFast,2)}</td><td>${fmt(r.tcpSegs,0)}</td><td>${fmt(r.udpDel,2)}</td><td>${ms(r.udpComp)}</td><td>${fmt(r.udpDup,2)}</td><td>${fmt(r.udpOoo,2)}</td></tr>`).join('');
}
function copyText(txt,btn){
  const done=()=>{const o=btn.textContent;btn.textContent='Copied';setTimeout(()=>btn.textContent=o,1400)};
  try{navigator.clipboard.writeText(txt).then(done,()=>fallbackCopy(txt,done))}catch(e){fallbackCopy(txt,done)}
}
function fallbackCopy(txt,done){const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();try{document.execCommand('copy');done()}catch(e){}t.remove()}
function copyCsv(){
  const {rows}=expData,h='loss_pct,tcp_delivered_pct,tcp_time_ms,tcp_timer_retx_per100,tcp_fast_retx_per100,tcp_wire_segments,udp_delivered_pct,udp_time_ms,udp_dup_per100,udp_ooo_per100';
  copyText([h,...rows.map(r=>[r.loss,r.tcpDel,r.tcpComp,r.tcpTo,r.tcpFast,r.tcpSegs,r.udpDel,r.udpComp,r.udpDup,r.udpOoo].map(x=>x==null?'':(+x).toFixed(3)).join(','))].join('\n'),$('copyCsv'));
}

/* ================= RTT ================= */
function initRtt(){
  const sync=()=>{$('aV').textContent=$('r_a').value;$('bV').textContent=$('r_b').value;$('rbV').textContent=$('r_base').value+' ms';$('rsV').textContent=$('r_spike').value+'%'};
  $('r_samples').value='120, 126, 118, 131, 124, 305, 140, 128, 122, 119, 280, 135, 127, 121, 125, 130, 123, 118, 126, 122';
  ['r_a','r_b'].forEach(i=>$(i).oninput=()=>{sync();renderRtt()});['r_base','r_spike'].forEach(i=>$(i).oninput=sync);
  $('r_samples').oninput=renderRtt;
  $('rGen').onclick=()=>{const b=+$('r_base').value,sp=$('r_spike').value/100,a=[];for(let i=0;i<24;i++){let v=b*(.85+Math.random()*.3);if(Math.random()<sp)v*=2.2+Math.random()*1.8;a.push(Math.round(v))}$('r_samples').value=a.join(', ');renderRtt()};
  sync();redraw.rtt=renderRtt;renderRtt();
}
function renderRtt(){
  const a=+$('r_a').value,b=+$('r_b').value,S=$('r_samples').value.split(/[ ,;\n]+/).map(Number).filter(x=>x>0).slice(0,80);
  if(!S.length)return;
  let est=S[0],dev=S[0]/2;const E=[],D=[],T=[],bad=[];
  S.forEach((s,i)=>{
    if(i>0){const prevT=T[i-1];if(s>prevT)bad.push(i);dev=(1-b)*dev+b*Math.abs(s-est);est=(1-a)*est+a*s}
    E.push(est);D.push(dev);T.push(est+4*dev);
  });
  $('rChip').className='chip '+(bad.length?'bad':'ok');$('rChip').textContent=bad.length?`${bad.length} sample${bad.length>1?'s':''} would beat the timer`:'no premature timeouts';
  const labels=S.map((_,i)=>i+1),tc=css('--tcp'),uc=css('--udp');
  mkChart('chR',{type:'line',data:{labels,datasets:[
    ds('SampleRTT',S,css('--muted'),{showLine:false,pointRadius:4,backgroundColor:css('--muted')}),
    ds('EstimatedRTT',E,tc,{pointRadius:0}),ds('TimeoutInterval',T,uc,{pointRadius:0,borderDash:[6,4]}),
    ds('Premature timeout',S.map((s,i)=>bad.includes(i)?s:null),css('--bad'),{showLine:false,pointRadius:9,pointStyle:'crossRot',borderWidth:3})]},
    options:{scales:{x:{title:{display:true,text:'Sample number'}},y:{beginAtZero:true,title:{display:true,text:'ms'}}}}});
  $('rTable').innerHTML=`<tr><th>#</th><th>SampleRTT</th><th>EstimatedRTT</th><th>DevRTT</th><th>TimeoutInterval</th></tr>`+S.map((s,i)=>`<tr><td>${i+1}</td><td>${s}</td><td>${fmt(E[i],1)}</td><td>${fmt(D[i],1)}</td><td>${fmt(T[i],1)}</td></tr>`).join('');
}

/* ================= HEADERS & CHECKSUM ================= */
const HF={
 tcp:[[['Source port',16,0,'Sending process. With the IP address it forms a socket (slide 20).'],['Destination port',16,0,'Receiving process. This is how the receiver demultiplexes a segment to the right socket.']],
  [['Sequence number',32,1,'Byte-stream number of the first data byte in the segment. It lets the receiver put data back in order and spot gaps.']],
  [['Acknowledgment number',32,1,'Next byte the receiver expects. It is cumulative: ACK=1500 confirms every byte below 1500. Repeated values are the duplicate ACKs that trigger fast retransmit.']],
  [['Offset',4,0,'Header length in 32-bit words.'],['Rsvd',4,0,'Reserved bits.'],['Flags',8,1,'ACK marks the acknowledgment field as valid. SYN and FIN open and close the connection, RST aborts it.'],['Receive window',16,1,'How many more bytes the receiver can buffer. This is flow control, so a fast sender cannot overrun a slow receiver.']],
  [['Checksum',16,1,'Covers header, data and a pseudo-header. A segment that fails the check is dropped and never ACKed, so the sender retransmits it.'],['Urgent pointer',16,0,'Rarely used (shown as "not used" in the slides).']],
  [['Options and data',32,0,'Optional fields such as MSS and timestamps, then the application bytes.']]],
 udp:[[['Source port',16,0,'Optional return port of the sending process.'],['Destination port',16,0,'Selects the receiving socket.']],
  [['Length',16,0,'Header plus data in bytes. The minimum is 8.'],['Checksum',16,1,'The only integrity feature. A datagram that fails is silently discarded. Nothing is retransmitted and nobody is told.']],
  [['Application data',32,0,'The whole payload. There is no sequence number, no ACK, no window and no connection state, so loss, duplication and reordering all go undetected.']]]
};
let hdrProto='tcp';
function drawHdr(){
  const g=$('hdrGrid');g.className='hdr '+hdrProto;g.innerHTML='';
  HF[hdrProto].forEach((row,ri)=>row.forEach((f,fi)=>{const b=document.createElement('button');b.style.gridColumn=`span ${f[1]}`;b.className=f[2]?'rel':'';b.innerHTML=`${esc(f[0])}<small>${f[1]===32&&row.length===1?'32 bits':f[1]+' bits'}</small>`;
    b.onclick=()=>{g.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');showField(f)};g.appendChild(b)}));
  const first=HF[hdrProto][hdrProto==='tcp'?1:1][0];showField(first);g.children[hdrProto==='tcp'?2:2].classList.add('on');
  $('hTcp').setAttribute('aria-pressed',hdrProto==='tcp');$('hUdp').setAttribute('aria-pressed',hdrProto==='udp');
}
function showField(f){const i=$('fieldInfo');i.className='callout '+(hdrProto==='udp'?'udp':'');i.innerHTML=`<b>${esc(f[0])}</b> · ${f[1]} bits${f[2]?' · <span class="'+(hdrProto==='udp'?'udp-c':'tcp-c')+'">reliability field</span>':''}<br>${esc(f[3])}`}
function initHeaders(){
  $('bitscale').innerHTML=Array.from({length:32},(_,i)=>`<span>${[0,8,16,24].includes(i)?i:i===31?31:''}</span>`).join('');
  $('hTcp').onclick=()=>{hdrProto='tcp';drawHdr()};$('hUdp').onclick=()=>{hdrProto='udp';drawHdr()};drawHdr();
  ['k_proto','k_sip','k_dip','k_sp','k_dp','k_data'].forEach(i=>$(i).oninput=()=>{flipped=false;calcChecksum()});
  $('k_flip').onclick=()=>{flipped=true;calcChecksum()};$('k_reset').onclick=()=>{flipped=false;calcChecksum()};
  calcChecksum();
}
let flipped=false;
const h16=x=>'0x'+(x&0xFFFF).toString(16).toUpperCase().padStart(4,'0');
function ipW(s){const p=s.split('.').map(Number);if(p.length!==4||p.some(x=>!(x>=0&&x<=255)))return[0,0];return[(p[0]<<8)|p[1],(p[2]<<8)|p[3]]}
function calcChecksum(){
  const proto=$('k_proto').value,data=new TextEncoder().encode($('k_data').value),hl=proto==='udp'?8:20,len=hl+data.length;
  const sip=ipW($('k_sip').value),dip=ipW($('k_dip').value),sp=+$('k_sp').value&0xFFFF,dp=+$('k_dp').value&0xFFFF;
  const words=[];const add=(g,l,v)=>words.push({g,l,v:v&0xFFFF});
  add('Pseudo-header','Source IP (high)',sip[0]);add('Pseudo-header','Source IP (low)',sip[1]);add('Pseudo-header','Destination IP (high)',dip[0]);add('Pseudo-header','Destination IP (low)',dip[1]);
  add('Pseudo-header','Zero + protocol',proto==='udp'?17:6);add('Pseudo-header','Segment length',len);
  add('Header','Source port',sp);add('Header','Destination port',dp);
  if(proto==='udp'){add('Header','Length',len)}else{add('Header','Sequence (high)',0x0000);add('Header','Sequence (low)',0x03E8);add('Header','ACK number (high)',0);add('Header','ACK number (low)',0x07D0);add('Header','Offset, flags (ACK)',0x5010);add('Header','Window',0xFFFF)}
  const ck0=words.length;add('Header','Checksum (zero while computing)',0);
  if(proto==='tcp')add('Header','Urgent pointer',0);
  const dstart=words.length;
  for(let i=0;i<data.length;i+=2)add('Data',`"${String.fromCharCode(data[i])}${i+1<data.length?String.fromCharCode(data[i+1]):''}"`,(data[i]<<8)|(i+1<data.length?data[i+1]:0));
  let sum=0;words.forEach(w=>sum+=w.v);const raw=sum;while(sum>0xFFFF)sum=(sum&0xFFFF)+(sum>>>16);
  const ck=(~sum)&0xFFFF;
  let rx=words.map(w=>w.v);rx[ck0]=ck;let flipIx=-1;
  if(flipped&&dstart<rx.length){flipIx=dstart;rx[flipIx]^=0x0008}
  let rs=rx.reduce((a,b)=>a+b,0);while(rs>0xFFFF)rs=(rs&0xFFFF)+(rs>>>16);
  $('k_stats').innerHTML=[['Sum of words','0x'+raw.toString(16).toUpperCase()],['After carry fold',h16(sum)],['Checksum (~sum)',h16(ck)],['Receiver sum',h16(rs)]].map(([a,b])=>`<div class="stat"><span>${a}</span><b>${b}</b></div>`).join('');
  const okc=rs===0xFFFF,v=$('k_verdict');v.className='verdict '+(okc?'ok-c':'bad-c');
  v.textContent=okc?'Receiver sum is 0xFFFF: segment accepted.':proto==='udp'?'Sum is not 0xFFFF: UDP silently discards the datagram. The sender is never told.':'Sum is not 0xFFFF: TCP discards the segment, sends no ACK, and the sender retransmits after its timer.';
  let run=0;
  $('k_table').innerHTML=`<tr><th>Part</th><th>Word</th><th>Value</th><th>Running sum</th></tr>`+words.map((w,i)=>{run+=(i===ck0?ck:w.v)*0+w.v;const hot=i===flipIx;return`<tr ${hot?'style="color:var(--bad)"':''}><td>${w.g}</td><td>${esc(w.l)}</td><td class="mono">${h16(i===ck0?0:w.v)}${hot?' → '+h16(w.v^8):''}</td><td class="mono">0x${run.toString(16).toUpperCase()}</td></tr>`}).join('')+`<tr><td><b>Result</b></td><td colspan="3" class="mono" style="text-align:left"><b>~${h16(sum)} = ${h16(ck)}</b> goes into the checksum field</td></tr>`;
}

/* ================= LIVE ================= */
const SAMPLE=__SAMPLE__;
let live={on:false,data:SAMPLE.run,sweep:SAMPLE.sweep,sample:true};
const PN={udp:['UDP echo','udp','--udp'],tcp:['TCP echo (kernel)','tcp','--tcp'],tcp_like:['TCP-style over UDP','tcp','--tcp']};
async function initLive(){
  [['l_n','lNv',''],['l_loss','lLv','%'],['l_dup','lUv','%'],['l_reo','lRv','%'],['l_delay','lDv',' ms'],['l_jit','lJv',' ms']].forEach(([i,o,u])=>{const f=()=>$(o).textContent=$(i).value+u;$(i).oninput=f;f()});
  $('liveRun').onclick=()=>runLive(false);$('liveSweep').onclick=()=>runLive(true);
  redraw.live=renderLive;renderLive();
  try{const r=await fetch('api/health',{cache:'no-store'});const j=await r.json();live.on=!!j.ok}catch(e){live.on=false}
  setLiveState();
}
function setLiveState(){
  const b=$('liveBadge');b.className='chip '+(live.on?'ok':'warn');b.textContent=live.on?'server connected':'static page, no server';
  $('liveRun').disabled=!live.on;$('liveSweep').disabled=!live.on;
  $('liveNote').innerHTML=live.on?'Connected. Each run opens real UDP and TCP sockets on the server, so numbers vary a little between runs.':
   'No Python server is attached to this page, so the buttons are off and you are looking at <b>a real run captured on loopback</b> (200 messages, 10% loss, 5 ms delay). Start the project with <span class="mono">python app.py</span> to run your own tests.';
}
async function runLive(sweep){
  const body={n:+$('l_n').value,loss:$('l_loss').value/100,dup:$('l_dup').value/100,reorder:$('l_reo').value/100,delay_ms:+$('l_delay').value,jitter_ms:+$('l_jit').value,seed:Math.floor(Math.random()*1e4)};
  $('liveRun').disabled=$('liveSweep').disabled=true;$('liveStatus').textContent=sweep?'Running sweep, about 20 seconds…':'Running…';
  try{
    const r=await fetch('api/'+(sweep?'sweep':'run'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sweep?{...body,losses:[0,.02,.05,.1,.2,.3]}:body)});
    const j=await r.json();if(!r.ok)throw new Error(j.error||'failed');
    if(sweep)live.sweep=j;else live.data=j;live.sample=false;$('liveStatus').textContent='Done.';renderLive();
  }catch(e){$('liveStatus').textContent='Error: '+e.message}
  $('liveRun').disabled=$('liveSweep').disabled=!live.on;
}
function renderLive(){
  const d=live.data,res=d.results,p=d.params;
  $('liveCards').innerHTML=['udp','tcp','tcp_like'].filter(k=>res[k]).map(k=>{
    const r=res[k],[nm,cls]=PN[k],okc=r.delivery_pct>=100;
    const tiles=[['Lost',r.lost],['Duplicates',r.duplicates],['Out of order',r.reordered],['Retransmissions',r.retransmissions+(k==='tcp'?'*':'')],['Time',fmt(r.duration_s,2)+' s'],['RTT avg / p95',fmt(r.rtt_ms.avg)+' / '+fmt(r.rtt_ms.p95)+' ms']];
    if(k==='tcp_like')tiles.push(['Timer / fast',r.timeout_retransmissions+' / '+r.fast_retransmissions],['Extra segments',fmt(r.overhead_pct,0)+'%'],['Final RTO',fmt(r.final_rto_ms)+' ms']);
    return`<div class="panel" style="display:flex;flex-direction:column;gap:12px"><div class="row" style="justify-content:space-between"><h3 class="${cls}-c">${nm}</h3><span class="chip ${okc?'ok':'bad'}">${r.in_order?'in order':'out of order'}</span></div>
    <div><div class="mono" style="font-size:34px;line-height:1;font-weight:500">${fmt(r.delivery_pct,1)}%</div><span class="muted" style="font-size:13px">${r.received} of ${r.sent} messages delivered</span></div>
    <div class="grid2" style="gap:8px">${tiles.map(([a,b])=>`<div class="stat"><span>${a}</span><b style="font-size:15px">${b}</b></div>`).join('')}</div>
    ${k==='tcp'?'<p class="muted" style="font-size:12px">* Kernel TCP hides loss, so each simulated lost segment stalls the stream for one 200 ms retransmission timeout.</p>':''}</div>`}).join('');
  const n=p.n,labels=Array.from({length:n},(_,i)=>i);
  const sets=[];
  if(res.udp)sets.push(ds('UDP',res.udp.rtt_series,css('--udp'),{pointRadius:0,borderWidth:1.6,spanGaps:false}));
  if(res.tcp)sets.push(ds('TCP (kernel)',res.tcp.rtt_series,css('--tcp'),{pointRadius:0,borderWidth:1.6}));
  mkChart('chL1',{type:'line',data:{labels,datasets:sets},options:{scales:{x:{ticks:{maxTicksLimit:10},title:{display:true,text:'Message number'}},y:{beginAtZero:true,title:{display:true,text:'ms'}}}}});
  const rs=res.tcp_like?res.tcp_like.rto_series:[];
  mkChart('chL2',{type:'line',data:{labels:rs.map(r=>Math.round(r[0])),datasets:[ds('EstimatedRTT',rs.map(r=>r[1]),css('--tcp'),{pointRadius:0,borderWidth:1.6}),ds('TimeoutInterval',rs.map(r=>r[2]),css('--udp'),{pointRadius:0,borderWidth:1.6,borderDash:[6,4]})]},options:{scales:{x:{ticks:{maxTicksLimit:8},title:{display:true,text:'Elapsed ms'}},y:{beginAtZero:true,title:{display:true,text:'ms'}}}}});
  if(live.sweep){
    $('sweepBox').hidden=false;const rows=live.sweep.rows,lab=rows.map(r=>Math.round(r.loss*100)+'%');
    const pick=(k,f)=>rows.map(r=>r.results[k]?r.results[k][f]:null);
    const cols={udp:css('--udp'),tcp:css('--tcp'),tcp_like:css('--ok')},names={udp:'UDP',tcp:'TCP (kernel)',tcp_like:'TCP-style over UDP'};
    mkChart('chL3',{type:'line',data:{labels:lab,datasets:['udp','tcp','tcp_like'].map(k=>ds(names[k],pick(k,'delivery_pct'),cols[k]))},options:{scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'% delivered'}},x:{title:{display:true,text:'Injected loss'}}}}});
    mkChart('chL4',{type:'line',data:{labels:lab,datasets:['udp','tcp','tcp_like'].map(k=>ds(names[k],pick(k,'duration_s'),cols[k]))},options:{scales:{y:{beginAtZero:true,title:{display:true,text:'seconds'}},x:{title:{display:true,text:'Injected loss'}}}}});
  }
}

/* ================= GUIDE ================= */
function initGuide(){
  $('codeTcp').textContent=`import socket, sys
HOST, PORT = "127.0.0.1", 12000

def server():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind((HOST, PORT))
    s.listen()
    conn, addr = s.accept()          # three-way handshake done
    with conn:
        while data := conn.recv(1024):
            conn.sendall(data)       # echo back

def client(msg="hello"):
    c = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    c.connect((HOST, PORT))
    c.sendall(msg.encode())
    print("echo:", c.recv(1024).decode())
    c.close()

if __name__ == "__main__":
    server() if sys.argv[1] == "server" else client()`;
  $('codeUdp').textContent=`import socket, sys
HOST, PORT = "127.0.0.1", 12001

def server():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind((HOST, PORT))             # no listen(), no accept()
    while True:
        data, addr = s.recvfrom(1024)
        s.sendto(data, addr)         # echo back

def client(msg="hello"):
    c = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    c.settimeout(1.0)                # UDP will not tell you about loss
    c.sendto(msg.encode(), (HOST, PORT))
    try:
        print("echo:", c.recvfrom(1024)[0].decode())
    except socket.timeout:
        print("no reply: lost, or the server is down")

if __name__ == "__main__":
    server() if sys.argv[1] == "server" else client()`;
  $('codeRun').textContent=`pip install -r requirements.txt
python cli.py run --loss 0.1 --n 200
python cli.py sweep --losses 0 0.05 0.1 0.2
python -m pytest tests
python app.py        # dashboard + live lab on http://localhost:5000`;
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copyText($(b.dataset.copy).textContent,b));
}

applyTheme();route();
