/* views/sleep.js — Sleep tab (v2): 5 charts + insight paragraphs */
const SleepView = (() => {
  const charts = {};
  const C = {
    sleep:'#4FC3F7', sleepDark:'#1976D2', trend:'#69F0AE',
    avg:'rgba(255,255,255,0.4)', amber:'#FFD54F', red:'#EF5350',
    purple:'#CE93D8', grid:'rgba(255,255,255,0.05)', text:'#5A7090',
  };

  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id); if (!el) return null;
    charts[id] = new Chart(el.getContext('2d'), cfg); return charts[id];
  }
  function insight(id, html) {
    const el = document.getElementById(id); if (el) el.innerHTML = html;
  }
  function baseOpts(yLabel) {
    return {
      responsive:true, maintainAspectRatio:false, animation:{duration:400},
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#172640',titleColor:'#9BAEC8',bodyColor:'#E8EDF5',
                 borderColor:'rgba(255,255,255,0.1)',borderWidth:1,padding:10},
      },
      scales:{
        x:{grid:{color:C.grid},ticks:{color:C.text,maxRotation:45,autoSkipPadding:16}},
        y:{grid:{color:C.grid},ticks:{color:C.text},
           title:{display:!!yLabel,text:yLabel||'',color:C.text}},
      },
    };
  }
  function trendDs(vals, yAxisID) {
    return { label:'Trend', data:Engine.linearRegressionLine(vals), type:'line',
      borderColor:C.trend, borderWidth:2, pointRadius:0, tension:0.01,
      fill:false, yAxisID:yAxisID||'y' };
  }
  function avgDs(vals, label) {
    return { label:label||'Rolling avg', data:vals, type:'line',
      borderColor:C.avg, borderWidth:1.5, borderDash:[5,5],
      pointRadius:0, tension:0.3, fill:false, yAxisID:'y' };
  }

  function render(data, windowKey) {
    const { dailyStats, completeSleeps } = data;
    renderStatCards(dailyStats, windowKey);
    renderDailyTotal(dailyStats, windowKey);
    renderLongest(dailyStats, windowKey);
    renderWakeWindows(dailyStats, completeSleeps, windowKey);
    renderScatter(completeSleeps, windowKey);
    renderNightPct(dailyStats, windowKey);
    renderNightWakings(dailyStats, windowKey);
    renderDayNaps(dailyStats, windowKey);
  }

  // ── stat cards ────────────────────────────────────────────
  function renderStatCards(ds, wk) {
    const mk2 = (key, fmt) => fmt(Engine.rollingAvgScalar(ds, key, wk));
    const cards = [
      { label:'Avg Total Sleep',    color:'var(--sleep)',      value:mk2('totalSleepHr',  v=>v?Engine.fmtHr(v):'—') },
      { label:'Avg Longest Block',  color:'var(--sleep-dark)', value:mk2('longestBlockHr',v=>v?Engine.fmtHr(v):'—') },
      { label:'Avg Night Sleep',    color:'var(--sleep)',      value:mk2('nightSleepHr',  v=>v?Engine.fmtHr(v):'—') },
      { label:'Avg Wake Window',    color:'var(--amber)',      value:mk2('avgWakeWindowMin',v=>v?Engine.fmtMin(v):'—') },
    ];
    document.getElementById('sleep-stat-cards').innerHTML = cards.map(c=>`
      <div class="stat-card">
        <div class="stat-label" style="color:${c.color}">${c.label}</div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-sub">${wk} rolling avg</div>
      </div>`).join('');
  }

  function fmtDate(ds) {
    return ds.map(d => {
      const [y,m,day]=d.sleepDay.split('-');
      const md=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${parseInt(day)} ${md[parseInt(m)-1]}`;
    });
  }

  // ── chart 1: daily total sleep ────────────────────────────
  function renderDailyTotal(ds, wk) {
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(fmtDate(ds));
    const fullNight = Engine.dailyChartData(ds,'nightSleepHr');
    const fullDay   = Engine.dailyChartData(ds,'daySleepHr');
    const fullTot   = Engine.dailyChartData(ds,'totalSleepHr');
    
    const completeNight = sl(fullNight.completeVals), actualNight = sl(fullNight.todayActual);
    const completeDay = sl(fullDay.completeVals),     actualDay = sl(fullDay.todayActual);
    const completeTot = sl(fullTot.completeVals),     actualTot = sl(fullTot.todayActual);
    
    const ra = sl(Engine.rollingAvg(ds,'totalSleepHr',wk));
    const trendVals = Engine.linearRegressionLine(completeTot);

    mk('chart-sleep-daily',{
      type:'bar',
      data:{labels, datasets:[
        {label:'Night (7pm–7am)',data:completeNight,backgroundColor:C.sleepDark,
         stack:'s',borderRadius:{topLeft:0,topRight:0,bottomLeft:3,bottomRight:3}},
        {label:'Day naps',data:completeDay,backgroundColor:C.sleep,
         stack:'s',borderRadius:{topLeft:3,topRight:3,bottomLeft:0,bottomRight:0}},
        // Today actual (lighter, stacked together on 'sactual')
        {label:'Night (today)',data:actualNight,backgroundColor:'rgba(25,118,210,0.25)',
         stack:'sactual',borderWidth:1.5,borderColor:C.sleepDark,
         borderRadius:{topLeft:0,topRight:0,bottomLeft:3,bottomRight:3}},
        {label:'Day (today)',data:actualDay,backgroundColor:'rgba(79,195,247,0.25)',
         stack:'sactual',borderWidth:1.5,borderColor:C.sleep,
         borderRadius:{topLeft:3,topRight:3,bottomLeft:0,bottomRight:0}},
        {label:'Trend',data:trendVals,type:'line',
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false,yAxisID:'y'},
        {label:`${wk} avg`,data:ra,type:'line',
         borderColor:C.avg,borderDash:[5,5],borderWidth:1.5,pointRadius:0,fill:false,yAxisID:'y'},
      ]},
      options:{...baseOpts('Hours'),
        plugins:{...baseOpts().plugins,
          legend:{display:true,labels:{color:C.text,boxWidth:10,padding:14}},
          annotation:{annotations:{
            ideal:{type:'box',yMin:14,yMax:17,
              backgroundColor:'rgba(105,240,174,0.04)',borderColor:'rgba(105,240,174,0.15)',borderWidth:1},
          }},
        },
        scales:{...baseOpts().scales,x:{...baseOpts().scales.x,stacked:true}},
      },
    });

    const slicedDs = Engine.sliceData(ds, wk);
    const completeDays = slicedDs.slice(0,-1).filter(d=>d.totalSleepHr>0);
    if (!completeDays.length) return;
    const avgSleep = Engine.avg(completeDays.map(d=>d.totalSleepHr));
    const trend    = Engine.linearRegressionLine(completeDays.map(d=>d.totalSleepHr));
    const trendDir = trend.length>=2?trend[trend.length-1]-trend[0]:0;
    const inRange  = completeDays.filter(d=>d.totalSleepHr>=14&&d.totalSleepHr<=17).length;
    const pctRange = Math.round(inRange/completeDays.length*100);
    const dirText  = trendDir>0.2?`<span class="up">trending up ↑</span>`:trendDir<-0.2?`<span class="down">trending down ↓</span>`:'<strong>stable</strong>';
    insight('insight-sleep-daily',
      `Over <strong>${completeDays.length} complete days</strong>, Raffy averaged <strong>${Engine.fmtHr(avgSleep)}</strong> of sleep — ${dirText}. ` +
      `<strong>${pctRange}%</strong> of days hit the recommended <strong>14–17h</strong>. ` +
      `Today's bar shows the accumulated sleep so far and is excluded from trend lines.`
    );
  }

  // ── chart 2: longest block ────────────────────────────────
  function renderLongest(ds, wk) {
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(fmtDate(ds));
    const full = Engine.dailyChartData(ds,'longestBlockHr');
    const completeVals = sl(full.completeVals), todayActual = sl(full.todayActual);
    const ra = sl(Engine.rollingAvg(ds,'longestBlockHr',wk));

    mk('chart-sleep-longest',{
      type:'line',
      data:{labels,datasets:[
        {label:'Longest block',data:completeVals,borderColor:C.sleep,
         backgroundColor:'rgba(79,195,247,0.08)',fill:true,tension:0.3,
         pointRadius:3,pointBackgroundColor:C.sleep},
        {label:'Today (so far)',data:todayActual,type:'line',
         borderColor:C.sleep,borderDash:[4,4],borderWidth:2,
         pointRadius:6,pointStyle:'circle',fill:false},
        trendDs(completeVals),
        avgDs(ra,`${wk} avg`),
      ]},
      options:{...baseOpts('Hours'),
        plugins:{...baseOpts().plugins,
          legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}},
        },
      },
    });

    const slicedDs = Engine.sliceData(ds, wk);
    const complete = slicedDs.slice(0,-1).filter(d=>d.longestBlockHr>0);
    if (complete.length<2) return;
    const firstHalf = complete.slice(0,Math.floor(complete.length/2));
    const lastHalf  = complete.slice(Math.floor(complete.length/2));
    const avg1 = Engine.avg(firstHalf.map(d=>d.longestBlockHr));
    const avg2 = Engine.avg(lastHalf.map(d=>d.longestBlockHr));
    const overall = Engine.avg(complete.map(d=>d.longestBlockHr));
    const diff = avg2-avg1;
    const dirText = diff>0.25?`<span class="up">grown by ${Engine.fmtHr(diff)} ↑</span>`:
                    diff<-0.25?`<span class="down">reduced by ${Engine.fmtHr(Math.abs(diff))} ↓</span>`:'<strong>remained stable</strong>';
    insight('insight-sleep-longest',
      `Longest single sleep block averages <strong>${Engine.fmtHr(overall)}</strong>. ` +
      `Comparing first half vs second half of the data, the longest block has ${dirText}. ` +
      `${diff>0.25?'<span class="up">Sleep is consolidating — a positive sign.</span>':diff<-0.25?'<span class="warn">Sleep fragmentation may be increasing.</span>':'No clear consolidation trend yet.'}`
    );
  }

  // ── chart 3: wake windows ─────────────────────────────────
  function renderWakeWindows(ds, sleeps, wk) {
    const minTime = Engine.getNow().getTime() - (Engine.WINDOW_DAYS[wk]||99999)*24*3600000;
    const rSleeps = sleeps.filter(s => s.startTime.getTime() >= minTime);
    const sorted = [...rSleeps].filter(s=>s.endTime).sort((a,b)=>a.startTime-b.startTime);
    const points = [];
    for (let i=1;i<sorted.length;i++) {
      const gap=(sorted[i].startTime-sorted[i-1].endTime)/60000;
      if (gap>0&&gap<480) points.push({x:sorted[i].startTime,y:+gap.toFixed(1)});
    }
    const colorFn = v=>v<90?'rgba(105,240,174,0.75)':v<120?'rgba(255,213,79,0.75)':'rgba(239,83,80,0.75)';
    const avgScalar = Engine.rollingAvgScalar(ds,'avgWakeWindowMin',wk);
    const trendVals = points.length>=2 ? Engine.linearRegressionLine(points.map(p=>p.y)) : [];

    mk('chart-wake-windows',{
      type:'scatter',
      data:{datasets:[
        {label:'Wake window',data:points,backgroundColor:points.map(p=>colorFn(p.y)),pointRadius:5,pointHoverRadius:7},
        {label:'Trend',type:'line',
         data:trendVals.length?points.map((p,i)=>({x:p.x,y:trendVals[i]})):[],
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false},
        {label:`${wk} avg`,type:'line',
         data:avgScalar&&points.length?[{x:points[0].x,y:avgScalar},{x:points[points.length-1].x,y:avgScalar}]:[],
         borderColor:C.avg,borderDash:[5,5],borderWidth:1.5,pointRadius:0,fill:false},
      ]},
      options:{...baseOpts('Minutes awake'),
        scales:{
          x:{type:'time',time:{tooltipFormat:'d MMM HH:mm',unit:'day'},
             grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Minutes awake',color:C.text}},
        },
        plugins:{...baseOpts().plugins,
          annotation:{annotations:{
            g:{type:'box',yMin:0,yMax:90,backgroundColor:'rgba(105,240,174,0.04)',borderColor:'transparent'},
            a:{type:'box',yMin:90,yMax:120,backgroundColor:'rgba(255,213,79,0.04)',borderColor:'transparent'},
            l90:{type:'line',yMin:90,yMax:90,borderColor:'rgba(105,240,174,0.3)',borderWidth:1,borderDash:[4,4]},
            l120:{type:'line',yMin:120,yMax:120,borderColor:'rgba(255,213,79,0.3)',borderWidth:1,borderDash:[4,4]},
          }},
        },
      },
    });

    if (!points.length) return;
    const avgWW = Engine.avg(points.map(p=>p.y));
    const idealPct = Math.round(points.filter(p=>p.y<=90).length/points.length*100);
    const overPct  = Math.round(points.filter(p=>p.y>120).length/points.length*100);
    const status = avgWW<=90?`<span class="up">well within</span>`:
                   avgWW<=120?`<span class="warn">slightly above</span>`:`<span class="down">above</span>`;
    insight('insight-wake-windows',
      `Average wake window is <strong>${Engine.fmtMin(avgWW)}</strong> — ${status} the ideal 45–90 minute range for newborns. ` +
      `<strong>${idealPct}%</strong> of wake windows were under 90 minutes. ` +
      `${overPct>20?`<span class="warn">${overPct}% exceeded 120 minutes, suggesting Raffy may have been overtired on those occasions.</span>`:'Overtired windows are infrequent.'}`
    );
  }

  // ── chart 4: sleep session scatter ───────────────────────
  function renderScatter(sleeps, wk) {
    const minTime = Engine.getNow().getTime() - (Engine.WINDOW_DAYS[wk]||99999)*24*3600000;
    sleeps = sleeps.filter(s => s.startTime.getTime() >= minTime);
    const isNight = s=>{const h=s.startTime.getHours();return h>=19||h<7;};
    const pts = sleeps.map(s=>({x:s.startTime,y:+(s.sleepDuration/3600).toFixed(2),night:isNight(s)}));
    const yVals = pts.map(p=>p.y);
    const tr    = pts.length>=2 ? Engine.linearRegressionLine(yVals) : [];

    mk('chart-sleep-scatter',{
      type:'scatter',
      data:{datasets:[
        {label:'Night session',data:pts.filter(p=>p.night).map(p=>({x:p.x,y:p.y})),
         backgroundColor:'rgba(25,118,210,0.75)',pointRadius:5,pointHoverRadius:7},
        {label:'Day nap',data:pts.filter(p=>!p.night).map(p=>({x:p.x,y:p.y})),
         backgroundColor:'rgba(79,195,247,0.65)',pointRadius:5,pointHoverRadius:7},
        {label:'Trend',type:'line',
         data:tr.length?pts.map((p,i)=>({x:p.x,y:tr[i]})):[],
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false},
      ]},
      options:{...baseOpts('Hours'),
        scales:{
          x:{type:'time',time:{tooltipFormat:'d MMM HH:mm',unit:'day'},
             grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Session duration (hrs)',color:C.text}},
        },
        plugins:{...baseOpts().plugins,legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}}},
      },
    });

    const night = pts.filter(p=>p.night), day = pts.filter(p=>!p.night);
    const avgN = night.length ? Engine.avg(night.map(p=>p.y)) : null;
    const avgD = day.length   ? Engine.avg(day.map(p=>p.y))   : null;
    const max  = pts.length   ? Math.max(...pts.map(p=>p.y))  : 0;
    insight('insight-sleep-scatter',
      `Across <strong>${pts.length} sleep sessions</strong>, night sessions average <strong>${avgN?Engine.fmtHr(avgN):'—'}</strong> ` +
      `vs day naps averaging <strong>${avgD?Engine.fmtHr(avgD):'—'}</strong>. ` +
      `The longest individual sleep was <strong>${Engine.fmtHr(max)}</strong>. ` +
      `${avgN&&avgD&&avgN>avgD?'<span class="up">Night sessions are longer than day naps</span> — healthy consolidation.':'Day naps and night sessions are similar in length.'}`
    );
  }

  // ── chart 5: night sleep % ────────────────────────────────
  function renderNightPct(ds, wk) {
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(fmtDate(ds));
    const today  = Engine.todaySleepDay();
    const pcts   = sl(ds.map(d=>{
      if (d.sleepDay === today) return null;
      return d.totalSleepHr>0?+((d.nightSleepHr/d.totalSleepHr)*100).toFixed(1):0;
    }));
    const fullRa = Engine.rollingAvg(ds,'nightSleepHr',wk).map((a,i)=>{
      const t=Engine.rollingAvg(ds,'totalSleepHr',wk)[i];
      return a!=null&&t!=null&&t>0?+((a/t)*100).toFixed(1):null;
    });
    const ra = sl(fullRa);
    
    mk('chart-sleep-nightpct',{
      type:'line',
      data:{labels,datasets:[
        {label:'Night %',data:pcts,borderColor:C.purple,backgroundColor:'rgba(206,147,216,0.1)',
         fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:C.purple},
        trendDs(pcts),
        avgDs(ra,`${wk} avg`),
      ]},
      options:{...baseOpts('%'),
        plugins:{...baseOpts().plugins,
          annotation:{annotations:{
            half:{type:'line',yMin:50,yMax:50,borderColor:'rgba(255,255,255,0.15)',borderWidth:1,borderDash:[4,4]},
          }},
        },
        scales:{...baseOpts().scales,
          y:{min:0,max:100,grid:{color:C.grid},ticks:{color:C.text,callback:v=>v+'%'}},
        },
      },
    });

    const slicedDs = Engine.sliceData(ds, wk);
    const complete = slicedDs.slice(0,-1).filter(d=>d.totalSleepHr>0);
    if (!complete.length) return;
    const avgPct = Engine.avg(complete.map(d=>d.totalSleepHr>0?(d.nightSleepHr/d.totalSleepHr)*100:0));
    const tr = Engine.linearRegressionLine(complete.map(d=>d.totalSleepHr>0?(d.nightSleepHr/d.totalSleepHr)*100:0));
    const trendDir = tr.length>=2?tr[tr.length-1]-tr[0]:0;
    const shifting = trendDir>3?`<span class="up">increasing ↑</span>`:trendDir<-3?`<span class="down">decreasing ↓</span>`:'<strong>stable</strong>';
    insight('insight-sleep-nightpct',
      `Night sleep (7pm–7am) accounts for an average of <strong>${avgPct.toFixed(0)}%</strong> of total daily sleep. ` +
      `This proportion is ${shifting}. ` +
      `${avgPct>60?'<span class="up">More than half of sleep is at night</span> — Raffy\'s circadian rhythm is developing well.':
        avgPct>40?'Sleep is fairly evenly split between day and night.':
        '<span class="warn">More sleep is occurring during the day than at night.</span>'}`
    );
  }

  // ── night wakings ─────────────────────────────────────────
  function renderNightWakings(ds, wk) {
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(ds.map(d=>d.sleepDay.slice(5)));
    const actual = sl(Engine.dailyChartData(ds, 'nightWakings').todayActual);
    const completeTot = sl(Engine.dailyChartData(ds, 'nightWakings').completeVals);
    const ra = sl(Engine.rollingAvg(ds, 'nightWakings', wk));

    mk('chart-sleep-wakings', {
      type:'bar',
      data:{labels, datasets:[
        {label:'Completed',data:completeTot,backgroundColor:C.red,borderRadius:4},
        {label:'Today (partial)',data:actual,backgroundColor:'rgba(239,83,80,0.3)',borderRadius:4},
        trendDs(completeTot),
        avgDs(ra)
      ]},
      options: baseOpts('Wakings'),
    });

    const slicedDs = Engine.sliceData(ds, wk);
    const completeDays = slicedDs.slice(0,-1).filter(d=>d.nightWakings!=null);
    if (!completeDays.length) return;
    const avgW = Engine.avg(completeDays.map(d=>d.nightWakings));
    const trend = Engine.linearRegressionLine(completeDays.map(d=>d.nightWakings));
    const trendDir = trend.length>=2?trend[trend.length-1]-trend[0]:0;
    const dirText = trendDir>0.5?`<span class="down">trending worse ↑</span>`:trendDir<-0.5?`<span class="up">improving ↓</span>`:'<strong>stable</strong>';
    insight('insight-sleep-wakings',
      `Over <strong>${completeDays.length} complete days</strong>, Raffy averaged <strong>${avgW.toFixed(1)} night wakings</strong> — ${dirText}.`
    );
  }

  // ── day naps ──────────────────────────────────────────────
  function renderDayNaps(ds, wk) {
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(ds.map(d=>d.sleepDay.slice(5)));
    const actual = sl(Engine.dailyChartData(ds, 'daySleepCount').todayActual);
    const completeTot = sl(Engine.dailyChartData(ds, 'daySleepCount').completeVals);
    const ra = sl(Engine.rollingAvg(ds, 'daySleepCount', wk));

    mk('chart-sleep-naps', {
      type:'bar',
      data:{labels, datasets:[
        {label:'Completed',data:completeTot,backgroundColor:C.amber,borderRadius:4},
        {label:'Today (partial)',data:actual,backgroundColor:'rgba(255,213,79,0.3)',borderRadius:4},
        trendDs(completeTot),
        avgDs(ra)
      ]},
      options: baseOpts('Naps'),
    });

    const slicedDs = Engine.sliceData(ds, wk);
    const completeDays = slicedDs.slice(0,-1).filter(d=>d.daySleepCount!=null);
    if (!completeDays.length) return;
    const avgN = Engine.avg(completeDays.map(d=>d.daySleepCount));
    const trend = Engine.linearRegressionLine(completeDays.map(d=>d.daySleepCount));
    const trendDir = trend.length>=2?trend[trend.length-1]-trend[0]:0;
    const dirText = trendDir>0.3?`<span class="up">trending up ↑</span>`:trendDir<-0.3?`<span class="down">trending down ↓</span>`:'<strong>stable</strong>';
    insight('insight-sleep-naps',
      `Over <strong>${completeDays.length} complete days</strong>, Raffy took an average of <strong>${avgN.toFixed(1)} naps</strong> per day — ${dirText}.`
    );
  }

  return { render };
})();
