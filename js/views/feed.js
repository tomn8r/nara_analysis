/* views/feed.js — Feed tab (v3): pro-rata today, intake chart, all charts + insights */
const FeedView = (() => {
  const charts = {};
  const C = {
    feed:'#FFB74D', feedLeft:'#FFB74D', feedRight:'#FF8A65', bottle:'#CE93D8',
    feedDim:'rgba(255,183,77,0.18)', feedProj:'rgba(255,183,77,0.3)',
    trend:'#69F0AE', avg:'rgba(255,255,255,0.4)',
    grid:'rgba(255,255,255,0.05)', text:'#5A7090',
  };

  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id); if (!el) return null;
    charts[id] = new Chart(el.getContext('2d'), cfg); return charts[id];
  }
  function insight(id, html) { const el=document.getElementById(id); if(el) el.innerHTML=html; }

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

  function render(data, windowKey) {
    const { dailyStats, feeds } = data;
    const breastFeeds = feeds.filter(f=>f.feedSubtype==='breast');
    renderStatCards(dailyStats, windowKey);
    renderDailyCount(dailyStats, windowKey);
    renderIntake(dailyStats, windowKey);
    renderIntervals(feeds, dailyStats, windowKey);
    renderDuration(breastFeeds, dailyStats, windowKey);
    renderBalance(dailyStats, windowKey);
    renderHeatmap(feeds);
  }

  // ── stat cards ───────────────────────────────────────────
  function renderStatCards(ds, wk) {
    const sc = key => Engine.rollingAvgScalar(ds, key, wk);
    const avgBottleML = Engine.rollingAvgScalar(ds,'totalBottleML',wk);
    const cards = [
      { label:'Avg Feeds / Day',      color:'var(--feed)',   value:(sc('feedCount')||0).toFixed(1) },
      { label:'Avg Breast Time',      color:'var(--feed)',   value:Engine.fmtMin(sc('totalFeedMin')) },
      { label:'Avg Bottle Volume',    color:'var(--purple)', value:avgBottleML!=null?`${Math.round(avgBottleML)} mL`:'—' },
      { label:'Avg Feed Interval',    color:'var(--feed)',   value:Engine.fmtMin(sc('avgFeedIntervalMin')) },
    ];
    document.getElementById('feed-stat-cards').innerHTML = cards.map(c=>`
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

  // ── chart 1: daily feed count + duration ───────────────────
  function renderDailyCount(ds, wk) {
    const labels  = fmtDate(ds);
    const { completeVals:completeCounts, todayActual:actualCounts } = Engine.dailyChartData(ds,'feedCount');
    const { completeVals:completeDurs,   todayActual:actualDurs   } = Engine.dailyChartData(ds,'totalFeedMin');
    const ra_c    = Engine.rollingAvg(ds,'feedCount',wk);
    const ra_d    = Engine.rollingAvg(ds,'totalFeedMin',wk);
    const trendC  = Engine.linearRegressionLine(completeCounts.map(v=>v??0));

    mk('chart-feed-daily',{
      type:'bar',
      data:{labels, datasets:[
        { label:'Feed count (complete)', data:completeCounts,
          backgroundColor:C.feedDim, borderColor:C.feed, borderWidth:1.5, borderRadius:4, yAxisID:'y' },
        { label:'Feed count (today)', data:actualCounts,
          backgroundColor:C.feedProj, borderColor:C.feed, borderWidth:1.5,
          borderDash:[4,4], borderRadius:4, yAxisID:'y' },
        { label:'Trend', data:trendC, type:'line',
          borderColor:C.trend, borderWidth:2, pointRadius:0, tension:0.01, fill:false, yAxisID:'y' },
        { label:`${wk} avg (count)`, data:ra_c, type:'line',
          borderColor:C.avg, borderDash:[5,5], borderWidth:1.5, pointRadius:0, fill:false, yAxisID:'y' },
        { label:'Total duration (min)', data:completeDurs, type:'line',
          borderColor:C.feedRight, backgroundColor:'rgba(255,138,101,0.08)',
          fill:true, tension:0.3, pointRadius:3, pointBackgroundColor:C.feedRight, yAxisID:'y1' },
        { label:'Duration (today)', data:actualDurs, type:'line',
          borderColor:C.feedRight, borderDash:[4,4], borderWidth:2,
          pointRadius:5, pointStyle:'circle', yAxisID:'y1' },
        { label:`${wk} avg (dur)`, data:ra_d, type:'line',
          borderColor:'rgba(255,138,101,0.4)', borderDash:[5,5], borderWidth:1.5,
          pointRadius:0, fill:false, yAxisID:'y1' },
      ]},
      options:{
        ...baseOpts(),
        plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10,padding:14}},
                 tooltip:baseOpts().plugins.tooltip},
        scales:{
          x:{grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{position:'left',grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Feed count',color:C.text}},
          y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:C.feedRight},
              title:{display:true,text:'Total minutes',color:C.feedRight}},
        },
      },
    });

    const complete = ds.slice(0,-1).filter(d=>d.feedCount>0);
    if (!complete.length) return;
    const avgCount = Engine.avg(complete.map(d=>d.feedCount));
    const avgDur   = Engine.avg(complete.map(d=>d.totalFeedMin));
    const tr = Engine.linearRegressionLine(complete.map(d=>d.feedCount));
    const dir = tr.length>=2?tr[tr.length-1]-tr[0]:0;
    const dirText = dir>0.3?`<span class="warn">increasing ↑</span>`:dir<-0.3?`<span class="up">decreasing ↓</span>`:'<strong>stable</strong>';
    insight('insight-feed-daily',
      `Raffy feeds an average of <strong>${avgCount.toFixed(1)} times per day</strong>, with <strong>${Engine.fmtMin(avgDur)}</strong> total breast time. ` +
      `Feed frequency is ${dirText}. Today's bar shows actual feeds so far and is excluded from trends. ` +
      `${avgCount>=8&&avgCount<=12?'<span class="up">Within the ideal 8–12 feeds/day for a newborn.</span>':avgCount<8?'<span class="warn">Below the typical 8–12 feeds/day target.</span>':'High frequency — possible cluster feeding.'}`
    );
  }

  // ── chart 2: INTAKE — breast time + bottle mL ────────────
  function renderIntake(ds, wk) {
    const labels = fmtDate(ds);
    const { completeVals:breastComplete, todayActual:breastActual } = Engine.dailyChartData(ds,'totalFeedMin');
    const { completeVals:bottleComplete, todayActual:bottleActual } = Engine.dailyChartData(ds,'totalBottleML');
    const ra_breast  = Engine.rollingAvg(ds,'totalFeedMin',wk);
    const ra_bottle  = Engine.rollingAvg(ds,'totalBottleML',wk);

    mk('chart-feed-intake',{
      type:'bar',
      data:{labels, datasets:[
        { label:'Breast time (min)', data:breastComplete,
          backgroundColor:'rgba(255,183,77,0.35)', borderColor:C.feed,
          borderWidth:1.5, borderRadius:4, yAxisID:'y' },
        { label:'Breast (today)', data:breastActual,
          backgroundColor:'rgba(255,183,77,0.15)', borderColor:C.feed,
          borderWidth:1.5, borderDash:[4,4], borderRadius:4, yAxisID:'y' },
        { label:`${wk} avg (breast)`, data:ra_breast, type:'line',
          borderColor:'rgba(255,183,77,0.6)', borderDash:[5,5], borderWidth:1.5,
          pointRadius:0, fill:false, yAxisID:'y' },
        { label:'Bottle volume (mL)', data:bottleComplete, type:'line',
          borderColor:C.bottle, backgroundColor:'rgba(206,147,216,0.15)',
          fill:true, tension:0.3, pointRadius:4, pointBackgroundColor:C.bottle, yAxisID:'y1' },
        { label:'Bottle (today)', data:bottleActual, type:'line',
          borderColor:C.bottle, borderDash:[4,4], borderWidth:2,
          pointRadius:6, pointStyle:'circle', yAxisID:'y1' },
        { label:`${wk} avg (bottle)`, data:ra_bottle, type:'line',
          borderColor:'rgba(206,147,216,0.5)', borderDash:[5,5], borderWidth:1.5,
          pointRadius:0, fill:false, yAxisID:'y1' },
      ]},
      options:{
        ...baseOpts(),
        plugins:{
          legend:{display:true,labels:{color:C.text,boxWidth:10,padding:14}},
          tooltip:baseOpts().plugins.tooltip,
        },
        scales:{
          x:{grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{position:'left',grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Breast time (min)',color:C.feed}},
          y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:C.bottle},
              title:{display:true,text:'Bottle volume (mL)',color:C.bottle}},
        },
      },
    });

    const complete = ds.slice(0,-1);
    const avgBreast = Engine.rollingAvgScalar(ds,'totalFeedMin',wk);
    const avgBottle = Engine.rollingAvgScalar(ds,'totalBottleML',wk);
    const bottleDays = complete.filter(d=>d.totalBottleML>0).length;
    const hasBottle  = bottleDays > 0;
    insight('insight-feed-intake',
      `Average daily breast time is <strong>${Engine.fmtMin(avgBreast)}</strong>. ` +
      (hasBottle
        ? `Bottle feeds supplement with an average of <strong>${avgBottle!=null?Math.round(avgBottle):0} mL/day</strong> across <strong>${bottleDays} days</strong> with bottles. `
        : 'No bottle feeds recorded in the selected window. ') +
      `Note: breastfeed volume cannot be measured directly — time is used as a proxy for intake. Longer sessions and more sessions generally mean more milk. Today's actual accumulated intake is shown independently.`
    );
  }

  // ── chart 3: feed intervals scatter ─────────────────────
  function renderIntervals(feeds, ds, wk) {
    const intervals = Engine.allFeedIntervals(feeds);
    if (!intervals.length) { insight('insight-feed-intervals','<span class="warn">Not enough feed data for intervals.</span>'); return; }
    const colorFn = v=>v<180?'rgba(105,240,174,0.7)':v<240?'rgba(255,213,79,0.7)':'rgba(239,83,80,0.7)';
    const pts  = intervals.map(i=>({x:i.time,y:+i.intervalMin.toFixed(1)}));
    const tr   = pts.length>=2?Engine.linearRegressionLine(pts.map(p=>p.y)):[];
    const avgSc= Engine.rollingAvgScalar(ds,'avgFeedIntervalMin',wk);

    mk('chart-feed-intervals',{
      type:'scatter',
      data:{datasets:[
        {label:'Feed interval',data:pts,backgroundColor:intervals.map(i=>colorFn(i.intervalMin)),pointRadius:5,pointHoverRadius:7},
        {label:'Trend',type:'line',data:tr.length?pts.map((p,i2)=>({x:p.x,y:tr[i2]})):[],
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false},
        {label:`${wk} avg`,type:'line',
         data:avgSc&&pts.length?[{x:pts[0].x,y:avgSc},{x:pts[pts.length-1].x,y:avgSc}]:[],
         borderColor:C.avg,borderDash:[5,5],borderWidth:1.5,pointRadius:0,fill:false},
      ]},
      options:{...baseOpts('Minutes'),
        scales:{
          x:{type:'time',time:{tooltipFormat:'d MMM HH:mm',unit:'day'},grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{grid:{color:C.grid},ticks:{color:C.text},title:{display:true,text:'Minutes since last feed',color:C.text}},
        },
        plugins:{...baseOpts().plugins,
          annotation:{annotations:{
            h3:{type:'line',yMin:180,yMax:180,borderColor:'rgba(105,240,174,0.4)',borderWidth:1,borderDash:[4,4]},
            h4:{type:'line',yMin:240,yMax:240,borderColor:'rgba(239,83,80,0.4)',borderWidth:1,borderDash:[4,4]},
          }},
        },
      },
    });
    const avgI    = Engine.avg(intervals.map(i=>i.intervalMin));
    const w3h     = Math.round(intervals.filter(i=>i.intervalMin<=180).length/intervals.length*100);
    const over4h  = Math.round(intervals.filter(i=>i.intervalMin>240).length/intervals.length*100);
    insight('insight-feed-intervals',
      `Average gap between feeds: <strong>${Engine.fmtMin(avgI)}</strong>. <strong>${w3h}%</strong> of intervals are within 3 hours. ` +
      `${over4h>10?`<span class="warn">${over4h}% exceeded 4h — longer than recommended for newborns.</span>`:'Gaps over 4h are infrequent — well paced.'}`
    );
  }

  // ── chart 4: session duration scatter ────────────────────
  function renderDuration(breastFeeds, ds, wk) {
    const isNight = f=>{const h=f.startTime.getHours();return h>=19||h<7;};
    const pts  = breastFeeds.filter(f=>f.totalDuration>0).map(f=>({x:f.startTime,y:+(f.totalDuration/60).toFixed(1),night:isNight(f)}));
    const tr   = pts.length>=2?Engine.linearRegressionLine(pts.map(p=>p.y)):[];

    mk('chart-feed-duration',{
      type:'scatter',
      data:{datasets:[
        {label:'Night feed',data:pts.filter(p=>p.night).map(p=>({x:p.x,y:p.y})),backgroundColor:'rgba(255,183,77,0.5)',pointRadius:5,pointHoverRadius:7},
        {label:'Day feed',data:pts.filter(p=>!p.night).map(p=>({x:p.x,y:p.y})),backgroundColor:'rgba(255,183,77,0.9)',pointRadius:5,pointHoverRadius:7},
        {label:'Trend',type:'line',data:tr.length?pts.map((p,i)=>({x:p.x,y:tr[i]})):[],
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false},
      ]},
      options:{...baseOpts('Minutes'),
        scales:{
          x:{type:'time',time:{tooltipFormat:'d MMM HH:mm',unit:'day'},grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{grid:{color:C.grid},ticks:{color:C.text},title:{display:true,text:'Session (min)',color:C.text}},
        },
        plugins:{...baseOpts().plugins,legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}}},
      },
    });
    if (!pts.length) return;
    const avgDur  = Engine.avg(pts.map(p=>p.y));
    const nightAvg= pts.filter(p=>p.night).length?Engine.avg(pts.filter(p=>p.night).map(p=>p.y)):null;
    const dayAvg  = pts.filter(p=>!p.night).length?Engine.avg(pts.filter(p=>!p.night).map(p=>p.y)):null;
    const dir = tr.length>=2?tr[tr.length-1]-tr[0]:0;
    const dirText = dir>1?'<span class="up">getting longer ↑</span>':dir<-1?'<span class="down">getting shorter ↓</span>':'<strong>stable</strong>';
    insight('insight-feed-duration',
      `Each breastfeed session averages <strong>${Engine.fmtMin(avgDur)}</strong>. Session duration is ${dirText}. ` +
      `${nightAvg&&dayAvg?`Night feeds average <strong>${Engine.fmtMin(nightAvg)}</strong> vs day feeds <strong>${Engine.fmtMin(dayAvg)}</strong>. `:''}` +
      `${dir<-1?'Shorter sessions often indicate improving efficiency as babies get older.':''}`
    );
  }

  // ── chart 5: L/R balance ────────────────────────────────
  function renderBalance(ds, wk) {
    const labels   = fmtDate(ds);
    const leftPct  = ds.map(d=>+(d.leftPct||50).toFixed(1));
    const rightPct = ds.map(d=>+(d.rightPct||50).toFixed(1));
    mk('chart-feed-balance',{
      type:'line',
      data:{labels,datasets:[
        {label:'Left %',data:leftPct,borderColor:C.feedLeft,fill:false,tension:0.3,pointRadius:3,pointBackgroundColor:C.feedLeft},
        {label:'Right %',data:rightPct,borderColor:C.feedRight,fill:false,tension:0.3,pointRadius:3,pointBackgroundColor:C.feedRight},
        {label:'50% balance',data:labels.map(()=>50),type:'line',
         borderColor:'rgba(255,255,255,0.15)',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false},
      ]},
      options:{...baseOpts('%'),
        plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}},tooltip:baseOpts().plugins.tooltip},
        scales:{...baseOpts().scales,y:{min:0,max:100,grid:{color:C.grid},ticks:{color:C.text,callback:v=>v+'%'}}},
      },
    });
    const complete = ds.slice(0,-1).filter(d=>d.totalFeedSec>0);
    if (!complete.length) return;
    const avgL = Engine.avg(complete.map(d=>d.leftPct));
    const avgR = Engine.avg(complete.map(d=>d.rightPct));
    const balanced = Math.abs(avgL-avgR)<10;
    insight('insight-feed-balance',
      `On average: <strong>${avgL.toFixed(0)}%</strong> left, <strong>${avgR.toFixed(0)}%</strong> right. ` +
      `${balanced?'<span class="up">Well balanced between both sides.</span>':
        `Clear preference for the <strong>${avgL>avgR?'left':'right'}</strong> breast — consistent imbalance may be worth discussing with a lactation consultant.`}`
    );
  }

  // ── chart 6: heatmap ─────────────────────────────────────
  function renderHeatmap(feeds) {
    const days = [...new Set(feeds.map(f=>f.sleepDay))].sort();
    const matrix = {};
    feeds.forEach(f=>{const k=`${f.sleepDay}_${f.startTime.getHours()}`;matrix[k]=(matrix[k]||0)+1;});
    const maxCount = Math.max(...Object.values(matrix),1);
    mk('chart-feed-heatmap',{
      type:'scatter',
      data:{datasets:[{
        label:'Feed count',
        data:days.flatMap(d=>{
          const [y,m,day]=d.split('-'); const md=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const label = `${parseInt(day)} ${md[parseInt(m)-1]}`;
          return Array.from({length:24},(_,h)=>({x:label,y:h,v:(matrix[`${d}_${h}`]||0)}))
        }),
        backgroundColor:days.flatMap(d=>Array.from({length:24},(_,h)=>{
          const v=(matrix[`${d}_${h}`]||0)/maxCount;
          return v>0?`rgba(255,183,77,${Math.max(0.08,v)})`:'rgba(255,183,77,0.02)';
        })),
        pointStyle:'rect',pointRadius:10,pointHoverRadius:10,
      }]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:300},
        plugins:{legend:{display:false},
          tooltip:{...baseOpts().plugins.tooltip,
            callbacks:{label:ctx=>ctx.raw.v>0?`${ctx.raw.v} feed${ctx.raw.v>1?'s':''} at ${ctx.raw.y}:00`:'No feeds'},
          },
        },
        scales:{
          x:{type:'category',grid:{color:C.grid},ticks:{color:C.text,maxRotation:45}},
          y:{min:0,max:23,grid:{color:C.grid},
             ticks:{color:C.text,stepSize:3,callback:v=>`${v}:00`},
             title:{display:true,text:'Hour of day',color:C.text}},
        },
      },
    });
    const hourTotals = Array.from({length:24},(_,h)=>({h,count:days.reduce((s,d)=>s+(matrix[`${d}_${h}`]||0),0)}));
    hourTotals.sort((a,b)=>b.count-a.count);
    const busiest = hourTotals[0];
    const nightFeeds = feeds.filter(f=>{const h=f.startTime.getHours();return h>=19||h<7;}).length;
    const nightPct   = Math.round(nightFeeds/feeds.length*100);
    insight('insight-feed-heatmap',
      `Busiest feeding hour: <strong>${busiest.h}:00–${busiest.h+1}:00</strong>. ` +
      `<strong>${nightPct}%</strong> of all feeds occur between 7pm and 7am. ` +
      `${nightPct>40?'<span class="warn">A high proportion at night — increasing daytime feed volume may help extend overnight stretches.</span>':
        'Most feeds are during the day — a good sign for longer overnight sleep.'}`
    );
  }

  return { render };
})();
