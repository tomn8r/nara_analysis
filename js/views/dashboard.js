/* views/dashboard.js (v2) — Dashboard: pulse, alerts, compare, activity strip, weekly */
const DashboardView = (() => {
  let _data=null, _window='7d';

  function render(data, windowKey) {
    _data=data; _window=windowKey;
    renderPulse(); renderAlerts(); renderCompare(); renderActivity(); renderWeekly();
  }

  // ── pulse cards ───────────────────────────────────────────
  function renderPulse() {
    const { feeds, completeSleeps } = _data;
    const now = Engine.getNow().getTime();
    const lastFeed  = [...feeds].sort((a,b)=>b.startTime-a.startTime)[0];
    const lastSleep = [...completeSleeps].sort((a,b)=>b.startTime-a.startTime)[0];
    const msSinceFeed  = lastFeed  ? now-lastFeed.startTime.getTime()  : null;
    const msSinceWake  = lastSleep&&lastSleep.endTime ? now-lastSleep.endTime.getTime() : null;
    const feedGapH     = msSinceFeed?msSinceFeed/3600000:0;
    const feedStatus   = feedGapH<3?'green':feedGapH<4?'amber':'red';
    const wakeMin      = msSinceWake?msSinceWake/60000:0;
    const wakeStatus   = wakeMin<90?'green':wakeMin<120?'amber':'red';

    const today = Engine.todaySleepDay();
    const ts    = _data.dailyStats.find(d=>d.sleepDay===today);

    const avgFeedGapM = Engine.rollingAvgScalar(_data.dailyStats,'avgFeedIntervalMin',_window);
    const predictedFeed = (lastFeed && avgFeedGapM) ? new Date(lastFeed.startTime.getTime() + avgFeedGapM*60000) : null;
    
    const avgWakeM = Engine.rollingAvgScalar(_data.dailyStats,'avgWakeWindowMin',_window);
    const predictedSleep = (lastSleep && lastSleep.endTime && avgWakeM) ? new Date(lastSleep.endTime.getTime() + avgWakeM*60000) : null;

    const cards=[
      { icon:'🍼', title:'Since Last Feed',
        value:msSinceFeed?Engine.fmtDuration(msSinceFeed):'No data',
        sub:lastFeed?`Last: ${Engine.fmtTime(lastFeed.startTime)} · Predict next: <strong>${predictedFeed?Engine.fmtTime(predictedFeed):'?'}</strong>`:'',
        status:feedStatus },
      { icon:'😴', title:'Awake For',
        value:msSinceWake?Engine.fmtDuration(msSinceWake):'No data',
        sub:lastSleep?`Woke: ${Engine.fmtTime(lastSleep.endTime)} · Predict next: <strong>${predictedSleep?Engine.fmtTime(predictedSleep):'?'}</strong>`:'',
        status:wakeStatus },
      { icon:'🌙', title:'Night Feeds',
        value:ts?`${ts.nightFeedCount}`:'0',
        sub:`${_window} avg: ${(Engine.rollingAvgScalar(_data.dailyStats,'nightFeedCount',_window)||0).toFixed(1)}/night`, status:'neu' },
      { icon:'🏆', title:'Longest Stretch',
        value:ts?Engine.fmtHr(ts.longestBlockHr):'0h',
        sub:`Personal best: ${Engine.fmtHr(Math.max(..._data.dailyStats.map(d=>d.longestBlockHr)))}`, status:'neu' },
    ];
    document.getElementById('pulse-grid').innerHTML=cards.map(c=>`
      <div class="pulse-card">
        <div class="pulse-icon">${c.icon}</div>
        <div class="pulse-info">
          <div class="pulse-title">${c.title}</div>
          <div class="pulse-value">${c.value}</div>
          <div class="pulse-sub">${c.sub}</div>
        </div>
        ${c.status!=='neu'?`<div class="pulse-status ${c.status}"></div>`:''}
      </div>`).join('');
    document.getElementById('last-updated-label').textContent=
      `Updated ${new Date().toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}`;
  }

  // ── alerts ────────────────────────────────────────────────
  function renderAlerts() {
    const { feeds, completeSleeps, dailyStats } = _data;
    const now = Engine.getNow().getTime(); const alerts = [];
    const lastFeed  = [...feeds].sort((a,b)=>b.startTime-a.startTime)[0];
    const lastSleep = [...completeSleeps].sort((a,b)=>b.startTime-a.startTime)[0];

    if (lastFeed) {
      const h=(now-lastFeed.startTime.getTime())/3600000;
      if (h>4) alerts.push({type:'crit',icon:'🍼',msg:`${Engine.fmtHr(h)} since last feed — consider waking to feed`});
      else if (h>3) alerts.push({type:'warn',icon:'🍼',msg:`${Engine.fmtHr(h)} since last feed — may be due soon`});
    }
    if (lastSleep&&lastSleep.endTime) {
      const wakeMin=(now-lastSleep.endTime.getTime())/60000;
      if (wakeMin>120) alerts.push({type:'warn',icon:'😴',msg:`Awake ${Engine.fmtMin(wakeMin)} — approaching overtired territory (>2h)`});
    }
    const ts = dailyStats.find(d=>d.sleepDay===Engine.todaySleepDay());
    if (ts) {
      if (ts.hasClusterFeeds) {
        alerts.push({type:'warn',icon:'🍼',msg:`Cluster feeding detected today (3+ feeds within 2 hours)`});
      }
      if (ts.isRegression) {
        alerts.push({type:'crit',icon:'📉',msg:`Sleep regression flagged: recent sleep is significantly below historical baseline`});
      }
    }
    document.getElementById('alert-strip').innerHTML=alerts.length
      ?alerts.map(a=>`<div class="alert-item ${a.type}"><span class="alert-icon">${a.icon}</span>${a.msg}</div>`).join('')
      :'<div class="alert-item info"><span class="alert-icon">✅</span>All looking good right now.</div>';
  }

  // ── today vs rolling average cards ───────────────────────
  function renderCompare() {
    const today = Engine.todaySleepDay();
    const ts    = _data.dailyStats.find(d=>d.sleepDay===today);
    const frac  = Engine.todayElapsedFraction();
    document.getElementById('prorata-label').textContent=`${Math.round(frac*100)}% of day elapsed`;

    const metrics=[
      {key:'feedCount',         label:'🍼 Feed Count',      fmt:v=>v!=null?Math.round(v)+'':'—', color:'feed'},
      {key:'totalFeedMin',      label:'⏱ Breast Time',      fmt:v=>v!=null?Engine.fmtMin(v):'—', color:'feed'},
      {key:'totalSleepHr',      label:'😴 Total Sleep',     fmt:v=>v!=null?Engine.fmtHr(v):'—',  color:'sleep'},
      {key:'nightSleepHr',      label:'🌙 Night Sleep',     fmt:v=>v!=null?Engine.fmtHr(v):'—',  color:'sleep'},
      {key:'nightWakings',      label:'⚠️ Night Wakings',   fmt:v=>v!=null?v.toFixed(1):'—',  color:'amber'},
      {key:'longestBlockHr',    label:'💤 Longest Block',   fmt:v=>v!=null?Engine.fmtHr(v):'—',  color:'sleep'},
      {key:'avgFeedIntervalMin',label:'🔄 Avg Feed Gap',    fmt:v=>v!=null?Engine.fmtMin(v):'—', color:'feed'},
    ];
    document.getElementById('compare-grid').innerHTML=metrics.map(m=>{
      const tv=ts?ts[m.key]:null;
      const av=Engine.rollingAvgScalar(_data.dailyStats,m.key,_window);
      const max=Math.max(tv||0,av||0)||1;
      const tp=tv?Math.min(100,(tv/max)*100):0;
      const ap=av?Math.min(100,(av/max)*100):null;
      let delta='';
      if (tv!=null&&av!=null) {
        const d=((tv-av)/av*100).toFixed(0);
        delta=`<span class="stat-delta ${+d>=0?'delta-up':'delta-down'}">${+d>=0?'+':''}${d}%</span>`;
      }
      return `<div class="compare-card">
        <div class="compare-title">${m.label}</div>
        <div class="compare-row">
          <div><div class="compare-col-label">Today (so far)</div><div class="compare-col-val today">${m.fmt(tv)}</div></div>
          <div><div class="compare-col-label">${_window} Avg</div><div class="compare-col-val avgv">${m.fmt(av)} ${delta}</div></div>
        </div>
        <div class="compare-bar-wrap">
          <div class="compare-bar-today${m.color==='feed'?' feed-bar':''}" style="width:${tp}%"></div>
          ${ap!=null?`<div class="compare-avg-marker" style="left:${ap}%"></div>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // ── 24h activity strip ────────────────────────────────────
  function renderActivity() {
    const canvas=document.getElementById('activity-canvas');
    const ctx=canvas.getContext('2d');
    const now=Engine.getNow().getTime(), start=now-24*3600000;
    const W=canvas.parentElement.offsetWidth-36||700, H=72;
    canvas.width=W; canvas.height=H;
    const toPx=ts=>((ts-start)/(24*3600000))*W;

    ctx.fillStyle='#0c1525'; ctx.fillRect(0,0,W,H);
    for (let h=0;h<=24;h++) {
      const x=(h/24)*W;
      ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
      if (h%3===0&&h<24) {
        const t=new Date(start+h*3600000);
        ctx.fillStyle='#2E4060'; ctx.font='9px Inter,sans-serif';
        ctx.fillText(t.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true}),x+2,H-4);
      }
    }
    // Sleep blocks
    const allSleeps = [...(_data.completeSleeps||[])];
    allSleeps.forEach(s=>{
      const ss=Math.max(s.startTime.getTime(),start);
      const se=Math.min((s.endTime||new Date()).getTime(),now);
      if (se<start||ss>now) return;
      const x1=toPx(ss), x2=toPx(se);
      ctx.fillStyle='rgba(79,195,247,0.45)';
      ctx.beginPath(); ctx.roundRect(x1,10,Math.max(x2-x1,2),H-26,3); ctx.fill();
    });
    // Feed marks
    _data.feeds.forEach(f=>{
      if (f.startTime.getTime()<start) return;
      const x=toPx(f.startTime.getTime());
      ctx.fillStyle=f.feedSubtype==='bottle'?'rgba(206,147,216,0.9)':'rgba(255,183,77,0.9)';
      ctx.beginPath(); ctx.moveTo(x,H-18); ctx.lineTo(x-4,H-6); ctx.lineTo(x+4,H-6); ctx.closePath(); ctx.fill();
    });
    // Now line
    const nowX=toPx(now);
    ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1.5; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(nowX,0); ctx.lineTo(nowX,H); ctx.stroke(); ctx.setLineDash([]);
  }

  // ── weekly summary ────────────────────────────────────────
  function renderWeekly() {
    let complete=_data.dailyStats.filter(d=>d.sleepDay!==Engine.todaySleepDay());
    complete = Engine.sliceData(complete, _window);
    const weeks=[]; for(let i=0;i<complete.length;i+=7) weeks.push(complete.slice(i,i+7));
    document.getElementById('weekly-summary').innerHTML=weeks.map((wk,wi)=>{
      const aS=Engine.avg(wk.map(d=>d.totalSleepHr));
      const aF=Engine.avg(wk.map(d=>d.feedCount));
      const aL=Engine.avg(wk.map(d=>d.longestBlockHr));
      const lbl=`Week ${wi+1}: ${wk[0].sleepDay.slice(5)} → ${wk[wk.length-1].sleepDay.slice(5)}`;
      const pw=weeks[wi-1]; let sd='',fd='';
      if (pw) {
        const ps=Engine.avg(pw.map(d=>d.totalSleepHr)),pf=Engine.avg(pw.map(d=>d.feedCount));
        const sv=((aS-ps)/ps*100).toFixed(0),fv=((aF-pf)/pf*100).toFixed(0);
        sd=`<span class="stat-delta ${+sv>=0?'delta-up':'delta-down'}">${+sv>=0?'↑':'↓'}${Math.abs(sv)}%</span>`;
        fd=`<span class="stat-delta ${+fv<=0?'delta-up':'delta-down'}">${+fv>=0?'↑':'↓'}${Math.abs(fv)}%</span>`;
      }
      return `<div class="stat-card" style="min-width:200px">
        <div class="stat-label">${lbl}</div>
        <div style="font-size:.75rem;color:var(--text1);display:flex;flex-direction:column;gap:4px;margin-top:6px">
          <div>😴 Sleep: <strong class="text-sleep">${Engine.fmtHr(aS)}</strong> ${sd}</div>
          <div>💤 Longest: <strong>${Engine.fmtHr(aL)}</strong></div>
          <div>🍼 Feeds: <strong class="text-feed">${(aF||0).toFixed(1)}/day</strong> ${fd}</div>
        </div></div>`;
    }).join('');
  }

  return { render };
})();
