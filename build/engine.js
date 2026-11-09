/* ===== Discrete-event simulator: TCP-style reliability vs plain UDP datagrams ===== */
function rngf(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
class Heap{constructor(){this.a=[];this.k=0}get size(){return this.a.length}
  push(t,type,data){const a=this.a,n={t,type,data,k:this.k++};let i=a.push(n)-1;while(i>0){const p=(i-1)>>1;if(this.lt(a[i],a[p])){[a[i],a[p]]=[a[p],a[i]];i=p}else break}}
  lt(x,y){return x.t<y.t||(x.t===y.t&&x.k<y.k)}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<a.length&&this.lt(a[l],a[m]))m=l;if(r<a.length&&this.lt(a[r],a[m]))m=r;if(m===i)break;[a[i],a[m]]=[a[m],a[i]];i=m}}return top}}

const SIM_DEFAULTS={proto:'tcp',n:4,mss:500,isn:1000,window:4,owd:100,jitter:0,gap:22,rto:450,adaptive:false,minRto:200,maxRto:60000,
  maxRetries:15,delack:false,delackMs:500,fast:true,lossData:0,lossAck:0,dup:0,reorder:0,dropData:[],dropAck:[],seed:1,log:false,tmax:1e8};

function simulate(cfg){
  const c=Object.assign({},SIM_DEFAULTS,cfg),R=rngf(c.seed),H=new Heap();
  const dd=new Set(c.dropData),da=new Set(c.dropAck),cnt={data:{},ack:{}};
  const pk=[],log=[],marks=[],rttSeries=[];
  const seqOf=i=>c.isn+i*c.mss;
  const L=(t,who,text,kind)=>{if(c.log)log.push({t,who,text,kind:kind||''})};
  const udp=c.proto==='udp';
  const name=(kind,i)=>kind==='ack'?`ACK=${seqOf(i)}`:(udp?`datagram #${i}`:`Seq=${seqOf(i)}`);

  function xmit(kind,idx,t,extra){
    const set=kind==='data'?dd:da,m=cnt[kind],k=idx+':'+(m[idx]||0);m[idx]=(m[idx]||0)+1;
    const lost=set.has(k)||R()<(kind==='data'?c.lossData:c.lossAck);
    let d=c.owd+R()*c.jitter,reo=false;
    if(R()<c.reorder){d+=c.owd*1.2+R()*c.owd*.5;reo=true}
    const p=Object.assign({id:pk.length,kind,n:idx,t0:t,t1:t+d,lost,reo},extra);pk.push(p);
    if(lost)L(t+d*.55,'net',`network drops ${name(kind,idx)}`,'drop');
    else{
      H.push(t+d,kind==='data'?'rxData':'rxAck',p);
      if(R()<c.dup){const d2=d+10+R()*c.owd*.5,q=Object.assign({},p,{id:pk.length,t1:t+d2,dupCopy:true});pk.push(q);H.push(t+d2,kind==='data'?'rxData':'rxAck',q);L(t+d2,'net',`network duplicates ${name(kind,idx)}`,'drop')}
    }
    return p;
  }

  const st={n:c.n,delivered:0,lost:0,appDup:0,appOoo:0,retx:0,timeouts:0,fast:0,dupAcks:0,segsSent:0,completion:null,aborted:false,complete:false,inOrder:true,recvDupSegs:0};

  if(udp){
    const seen=new Set();let maxSeen=-1,last=0,order=[];
    for(let i=0;i<c.n;i++){const t=i*c.gap;st.segsSent++;xmit('data',i,t,{seq:i});L(t,'A',`send ${name('data',i)}`)}
    while(H.size){const e=H.pop(),i=e.data.n,t=e.t;
      if(seen.has(i)){st.appDup++;L(t,'B',`receive ${name('data',i)} again (duplicate delivered to the app)`,'bad')}
      else{if(i<maxSeen){st.appOoo++;L(t,'B',`receive ${name('data',i)} after #${maxSeen} (out of order)`,'bad')}else L(t,'B',`receive ${name('data',i)}`);
        seen.add(i);maxSeen=Math.max(maxSeen,i);order.push(i)}
      last=Math.max(last,t)}
    st.delivered=seen.size;st.lost=c.n-seen.size;st.completion=seen.size?last:null;st.complete=seen.size===c.n;
    st.inOrder=st.appOoo===0;
  }else{
    let base=0,nxt=0,lastSend=-1e9,timerId=0,timerOn=false,rto=c.rto,dupacks=0,est=null,dev=0,done=null;
    const sentAt=[],att=[],cons=[];
    let expected=0,ackPending=null,ackPendId=0;const buf=new Set();
    const clamp=()=>Math.min(c.maxRto,Math.max(c.minRto,est+4*dev));
    const startTimer=t=>{timerId++;timerOn=true;H.push(t+rto,'timeout',{id:timerId})};
    const stopTimer=()=>{timerId++;timerOn=false};
    function sendSeg(i,t,how){
      t=Math.max(t,lastSend+c.gap);lastSend=t;att[i]=(att[i]||0)+1;if(att[i]===1)sentAt[i]=t;st.segsSent++;
      const p=xmit('data',i,t,{seq:seqOf(i),how,attempt:att[i]});
      L(t,'A',`send ${name('data',i)} (${c.mss}B)${how?' as retransmission':''}`,how?'retx':'');
      if(!timerOn)startTimer(t);return p}
    function sendAck(t,echo){const p=xmit('ack',expected,t,{echo});L(t,'B',`send ${name('ack',expected)}`)}
    const trySend=t=>{while(nxt<c.n&&nxt<base+c.window){sendSeg(nxt,t,null);nxt++}};
    trySend(0);
    while(H.size){
      const e=H.pop(),t=e.t;if(t>c.tmax||st.aborted)break;
      if(e.type==='rxData'){
        const i=e.data.n;
        if(i===expected){
          expected++;let filled=false;while(buf.has(expected)){buf.delete(expected);expected++;filled=true}
          st.delivered=expected;
          L(t,'B',`receive ${name('data',i)} in order`);
          if(c.delack&&!filled&&ackPending===null){ackPending={echo:i};ackPendId++;H.push(t+c.delackMs,'delack',{id:ackPendId});L(t,'B',`delay the ACK (up to ${c.delackMs} ms)`)}
          else{if(ackPending){ackPendId++;ackPending=null;L(t,'B','second segment arrived: one cumulative ACK covers both')}sendAck(t,i)}
        }else if(i>expected){
          if(buf.has(i))st.recvDupSegs++;else buf.add(i);
          L(t,'B',`receive ${name('data',i)}: gap, expected ${seqOf(expected)}`,'warn');
          if(ackPending){ackPendId++;ackPending=null}
          sendAck(t,i);
        }else{
          st.recvDupSegs++;L(t,'B',`receive ${name('data',i)} again: discard, re-ACK`,'warn');
          if(ackPending){ackPendId++;ackPending=null}
          sendAck(t,i);
        }
      }else if(e.type==='delack'){
        if(e.data.id===ackPendId&&ackPending){const echo=ackPending.echo;ackPending=null;L(t,'B','delayed ACK timer fired');sendAck(t,echo)}
      }else if(e.type==='rxAck'){
        if(done!==null)continue;
        const a=e.data.n,echo=e.data.echo;
        if(att[echo]===1&&sentAt[echo]!==undefined){
          const s=t-sentAt[echo];
          if(est===null){est=s;dev=s/2}else{dev=.75*dev+.25*Math.abs(s-est);est=.875*est+.125*s}
          rttSeries.push({t,sample:s,est,dev,rto:Math.min(c.maxRto,Math.max(c.minRto,est+4*dev))});
        }
        if(a>base){
          base=a;dupacks=0;cons.length=0;
          rto=c.adaptive&&est!==null?clamp():c.rto;
          L(t,'A',`receive ${name('ack',a)}`);
          if(base>=c.n){done=t;stopTimer();st.completion=t;L(t,'A','all data acknowledged','ok')}
          else{if(base<nxt)startTimer(t);else stopTimer();trySend(t)}
        }else if(a===base&&base<nxt){
          dupacks++;st.dupAcks++;L(t,'A',`duplicate ${name('ack',a)} (#${dupacks})`,'warn');
          if(c.fast&&dupacks===3){
            st.fast++;marks.push({t,type:'fast'});L(t,'A','3 duplicate ACKs: fast retransmit, no waiting for the timer','retx');
            const p=sendSeg(base,t,'fast');startTimer(p.t0);
          }
        }
      }else if(e.type==='timeout'){
        if(e.data.id!==timerId||!timerOn||base>=nxt||done!==null)continue;
        st.timeouts++;cons[base]=(cons[base]||0)+1;
        if(cons[base]>c.maxRetries){st.aborted=true;L(t,'A','too many retransmissions: connection reset','bad');break}
        marks.push({t,type:'timeout'});L(t,'A',`timer expired (RTO ${Math.round(rto)} ms): retransmit oldest segment`,'retx');
        const p=sendSeg(base,t,'timeout');rto=Math.min(rto*2,c.maxRto);startTimer(p.t0);
      }
    }
    st.retx=st.timeouts+st.fast;st.complete=st.delivered===c.n;st.inOrder=true;st.lost=c.n-st.delivered;
  }
  let T=0;for(const p of pk)T=Math.max(T,p.t1);for(const m of marks)T=Math.max(T,m.t);
  log.sort((a,b)=>a.t-b.t);
  return{proto:c.proto,cfg:c,pk,log,marks,rttSeries,stats:st,T:T+40};
}
