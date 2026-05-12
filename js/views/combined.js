/* views/combined.js — Combined tab (v2): dual-axis, correlations + insight paragraphs */
const CombinedView = (() => {
  const charts = {};
  const C = {
    sleep:'#4FC3F7', feed:'#FFB74D', trend:'#69F0AE',
    avg:'rgba(255,255,255,0.4)', grid:'rgba(255,255,255,0.05)', text:'#5A7090',
  };

  function mk(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id); if (!el) return null;
    charts[id] = new Chart(el.getContext('2d'), cfg); return charts[id];
  }
  function insight(id, html) {
    const el = document.getElementById(id); if (el) el.innerHTML = html;
  }
  function ttBase() {
    return {backgroundColor:'#172640',titleColor:'#9BAEC8',bodyColor:'#E8EDF5',
            borderColor:'rgba(255,255,255,0.1)',borderWidth:1,padding:10};
  }

  function render(data, windowKey) {
    renderDual(data, windowKey);
    renderPreSleep({feeds: [...data.feeds], completeSleeps: [...data.completeSleeps]}, windowKey);
    renderFeedVsSleep(data, windowKey);
    renderOverlap(data, windowKey);
  }

  function fmtDate(ds) {
    return ds.map(d => {
      const [y,m,day]=d.sleepDay.split('-');
      const md=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${parseInt(day)} ${md[parseInt(m)-1]}`;
    });
  }

  // ── chart 1: dual-axis sleep vs feed count ───────────────
  function renderDual(data, wk) {
    const { dailyStats:ds } = data;
    const sl = a => Engine.sliceData(a, wk);
    const labels = sl(fmtDate(ds));
    
    const fullSleep = Engine.dailyChartData(ds,'totalSleepHr');
    const fullFeed  = Engine.dailyChartData(ds,'feedCount');
    
    const sleepComplete = sl(fullSleep.completeVals), sleepActual = sl(fullSleep.todayActual);
    const feedComplete  = sl(fullFeed.completeVals),  feedActual  = sl(fullFeed.todayActual);
    
    const ra_sleep = sl(Engine.rollingAvg(ds,'totalSleepHr',wk));
    const ra_feed  = sl(Engine.rollingAvg(ds,'feedCount',wk));
    const trendSleep = Engine.linearRegressionLine(sleepComplete);
    const trendFeed  = Engine.linearRegressionLine(feedComplete);

    mk('chart-combined-dual',{
      type:'bar',
      data:{labels,datasets:[
        {label:'Total sleep (hrs)',data:sleepComplete,backgroundColor:'rgba(79,195,247,0.2)',
         borderColor:C.sleep,borderWidth:1.5,borderRadius:4,yAxisID:'y'},
        {label:'Today sleep',data:sleepActual,backgroundColor:'rgba(79,195,247,0.1)',
         borderColor:C.sleep,borderWidth:1.5,borderDash:[4,4],borderRadius:4,yAxisID:'y'},
        {label:'Trend (sleep)',data:trendSleep,type:'line',
         borderColor:C.trend,borderWidth:2,pointRadius:0,tension:0.01,fill:false,yAxisID:'y'},
        {label:`${wk} avg sleep`,data:ra_sleep,type:'line',
         borderColor:C.avg,borderDash:[5,5],borderWidth:1.5,pointRadius:0,fill:false,yAxisID:'y'},
        {label:'Feed count',data:feedComplete,type:'line',
         borderColor:C.feed,fill:false,tension:0.3,pointRadius:3,
         pointBackgroundColor:C.feed,yAxisID:'y1'},
        {label:'Feed (today)',data:feedActual,type:'line',
         borderColor:C.feed,borderDash:[4,4],pointRadius:5,pointStyle:'circle',fill:false,yAxisID:'y1'},
        {label:'Trend (feeds)',data:trendFeed,type:'line',
         borderColor:'rgba(255,183,77,0.5)',borderWidth:2,borderDash:[3,3],
         pointRadius:0,tension:0.01,fill:false,yAxisID:'y1'},
        {label:`${wk} avg feeds`,data:ra_feed,type:'line',
         borderColor:'rgba(255,183,77,0.35)',borderDash:[5,5],borderWidth:1.5,
         pointRadius:0,fill:false,yAxisID:'y1'},
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:400},
        plugins:{
          legend:{display:true,labels:{color:C.text,boxWidth:10,padding:14}},
          tooltip:ttBase(),
        },
        scales:{
          x:{grid:{color:C.grid},ticks:{color:C.text,maxRotation:45,autoSkipPadding:16}},
          y:{position:'left',grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Sleep (hrs)',color:C.sleep}},
          y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:C.feed},
              title:{display:true,text:'Feed count',color:C.feed}},
        },
      },
    });

    // Correlation insight
    const slicedDs = Engine.sliceData(ds, wk);
    const complete = slicedDs.slice(0,-1).filter(d=>d.feedCount>0&&d.totalSleepHr>0);
    if (complete.length>=3) {
      const reg = Engine.scatterRegression(complete.map(d=>({x:d.feedCount,y:d.totalSleepHr})));
      if (reg) {
        const r2text = reg.rSquared>0.4?'<strong>moderately correlated</strong>':
                       reg.rSquared>0.2?'<span>weakly correlated</span>':'<strong>not strongly correlated</strong>';
        const dir = reg.m>0?`<span class="up">more feeds ↔ more sleep</span>`:
                    reg.m<0?`<span class="warn">more feeds ↔ less sleep</span>`:'no clear direction';
        insight('insight-combined-dual',
          `Feed count and total sleep are ${r2text} (R²=${reg.rSquared.toFixed(2)}), showing ${dir}. ` +
          `${reg.rSquared<0.2?'Day-to-day variation is likely driven by other factors like time of day and hunger cues rather than raw feed count.':
            'The relationship is worth tracking as patterns become clearer over more days.'}`
        );
      }
    } else {
      insight('insight-combined-dual','Collect more days of data to see whether total feed count is related to total sleep.');
    }
  }

  // ── chart 2: pre-sleep feed → sleep quality ──────────────
  function renderPreSleep(data, wk) {
    const minTime = Engine.getNow().getTime() - (Engine.WINDOW_DAYS[wk]||99999)*24*3600000;
    data.completeSleeps = data.completeSleeps.filter(s => s.startTime.getTime() >= minTime);
    data.feeds = data.feeds.filter(f => f.startTime.getTime() >= minTime);
    const { completeSleeps:sleeps, feeds } = data;
    const significant = sleeps.filter(s=>s.endTime&&s.sleepDuration>1800);
    const points = [];
    significant.forEach(s=>{
      const preFeed = [...feeds]
        .filter(f=>f.feedSubtype==='breast'&&f.startTime<s.startTime&&(s.startTime-f.startTime)<3600000)
        .sort((a,b)=>b.startTime-a.startTime)[0];
      if (preFeed&&preFeed.totalDuration>0)
        points.push({x:+(preFeed.totalDuration/60).toFixed(1),y:+(s.sleepDuration/3600).toFixed(2)});
    });

    let trendData=[];
    const reg = points.length>=3?Engine.scatterRegression(points):null;
    if (reg) {
      const xs=points.map(p=>p.x);
      const mn=Math.min(...xs),mx=Math.max(...xs);
      trendData=[{x:mn,y:+(reg.m*mn+reg.b).toFixed(2)},{x:mx,y:+(reg.m*mx+reg.b).toFixed(2)}];
    }

    mk('chart-presleep',{
      type:'scatter',
      data:{datasets:[
        {label:'Feed → Sleep',data:points,backgroundColor:'rgba(105,240,174,0.6)',
         pointRadius:6,pointHoverRadius:8},
        {label:'Regression',data:trendData,type:'line',
         borderColor:C.trend,borderWidth:2,pointRadius:0,fill:false,tension:0},
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:400},
        plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}},tooltip:ttBase()},
        scales:{
          x:{grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Pre-sleep feed duration (min)',color:C.text}},
          y:{grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Subsequent sleep (hrs)',color:C.text}},
        },
      },
    });

    if (!points.length) {
      insight('insight-presleep','Not enough matched feed-before-sleep pairs to analyse this relationship yet.');
      return;
    }
    if (reg) {
      const dir = reg.m>0.02?'<span class="up">longer feeds tend to precede longer sleeps</span>':
                  reg.m<-0.02?'<span class="warn">longer feeds show no clear benefit for subsequent sleep length</span>':
                  'feed duration shows no clear relationship with the subsequent sleep length';
      insight('insight-presleep',
        `Across <strong>${points.length}</strong> feed-before-sleep events, ${dir} (R²=${reg.rSquared.toFixed(2)}). ` +
        `${reg.m>0.02&&reg.rSquared>0.2?'Ensuring a full feed before sleep may help extend the sleep block.':
          'Sleep duration appears to be driven more by other factors (time of day, tiredness) than feed length alone.'}`
      );
    } else {
      insight('insight-presleep',`Plotted <strong>${points.length}</strong> feed-before-sleep pairs. Collect more data for a reliable trend.`);
    }
  }

  // ── chart 3: daily feed count vs longest sleep ───────────
  function renderFeedVsSleep(data, wk) {
    const { dailyStats:ds } = data;
    const slicedDs = Engine.sliceData(ds, wk);
    const pts = slicedDs.filter(d=>d.feedCount>0&&d.longestBlockHr>0)
                  .map(d=>({x:d.feedCount,y:+d.longestBlockHr.toFixed(2)}));
    const reg = pts.length>=3?Engine.scatterRegression(pts):null;
    let trendData=[];
    if (reg) {
      const xs=pts.map(p=>p.x);
      const mn=Math.min(...xs),mx=Math.max(...xs);
      trendData=[{x:mn,y:+(reg.m*mn+reg.b).toFixed(2)},{x:mx,y:+(reg.m*mx+reg.b).toFixed(2)}];
    }

    mk('chart-feed-vs-sleep',{
      type:'scatter',
      data:{datasets:[
        {label:'Day: feeds vs longest sleep',data:pts,
         backgroundColor:'rgba(255,183,77,0.6)',pointRadius:6,pointHoverRadius:8},
        {label:'Regression',data:trendData,type:'line',
         borderColor:C.trend,borderWidth:2,pointRadius:0,fill:false,tension:0},
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:400},
        plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}},
          tooltip:{...ttBase(),callbacks:{label:ctx=>`Feeds: ${ctx.raw.x}, Longest sleep: ${Engine.fmtHr(ctx.raw.y)}`}}},
        scales:{
          x:{grid:{color:C.grid},ticks:{color:C.text,stepSize:1},
             title:{display:true,text:'Feed count that day',color:C.text}},
          y:{grid:{color:C.grid},ticks:{color:C.text},
             title:{display:true,text:'Longest sleep block (hrs)',color:C.text}},
        },
      },
    });

    if (!pts.length) { insight('insight-feed-vs-sleep','Not enough data yet.'); return; }
    if (reg) {
      const dir = reg.m>0.05?`<span class="up">days with more feeds tend to include a longer sleep block</span>`:
                  reg.m<-0.05?`<span class="warn">days with more feeds show shorter longest blocks — possibly due to fragmented sleep</span>`:
                  'no clear relationship between daily feed count and the longest sleep block';
      insight('insight-feed-vs-sleep',
        `Across <strong>${pts.length} days</strong>, there is ${dir} (R²=${reg.rSquared.toFixed(2)}). ` +
        `${reg.rSquared<0.15?'The connection is weak — many other factors influence when the longest sleep occurs.':''}`
      );
    } else {
      insight('insight-feed-vs-sleep',`Plotted <strong>${pts.length}</strong> days. More data needed for a reliable trend.`);
    }
  }

  // ── chart 4: sleep + feed overlap (last 7 days) ──────────
  function renderOverlap(data, wk) {
    const { completeSleeps:sleeps, feeds } = data;
    const now = Engine.getNow();
    const days = Engine.WINDOW_DAYS[wk]||99999;
    const winStart = new Date(now.getTime() - days*24*3600000);
    const rSleeps  = sleeps.filter(s=>s.endTime&&s.startTime>=winStart);
    const rFeeds   = feeds.filter(f=>f.startTime>=winStart);

    // Represent as scatter: sleep = y:0.25, feed = y:0.75, time axis x
    const sleepPts = rSleeps.flatMap(s=>[{x:s.startTime,y:0.25},{x:s.endTime,y:0.25},{x:null,y:null}]);
    const feedPts  = rFeeds.map(f=>({x:f.startTime,y:f.feedSubtype==='bottle'?0.82:0.75}));

    mk('chart-overlap',{
      type:'scatter',
      data:{datasets:[
        {label:'Sleep',data:sleepPts,backgroundColor:'rgba(79,195,247,0)',borderColor:C.sleep,
         showLine:true,fill:false,pointRadius:0,
         segment:{borderWidth:14,borderCapStyle:'round'}},
        {label:'Breastfeed',data:rFeeds.filter(f=>f.feedSubtype==='breast').map(f=>({x:f.startTime,y:0.75})),
         backgroundColor:C.feed,pointRadius:5,pointStyle:'triangle',rotation:180,pointHoverRadius:7},
        {label:'Bottle feed',data:rFeeds.filter(f=>f.feedSubtype==='bottle').map(f=>({x:f.startTime,y:0.82})),
         backgroundColor:'#CE93D8',pointRadius:5,pointStyle:'circle',pointHoverRadius:7},
      ]},
      options:{
        responsive:true,maintainAspectRatio:false,animation:{duration:300},
        plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10,padding:12}},tooltip:ttBase()},
        scales:{
          x:{type:'time',time:{tooltipFormat:'EEE d MMM HH:mm',unit:'day'},
             grid:{color:C.grid},ticks:{color:C.text},
             min:winStart.toISOString(),max:now.toISOString()},
          y:{min:0,max:1,display:true,grid:{display:false},
             ticks:{color:C.text,callback:v=>v===0.25?'Sleep':v>=0.7?'Feed':''}},
        },
      },
    });

    // Insight
    const avgSleepBlock = rSleeps.length?Engine.avg(rSleeps.map(s=>s.sleepDuration/3600)):null;
    const feedsPerDay   = rFeeds.length/Math.min(days, Math.max(1, (now.getTime() - rFeeds[0]?.startTime?.getTime())/86400000||1));
    insight('insight-overlap',
      `In the selected period: <strong>${rSleeps.length} sleep sessions</strong> averaging <strong>${avgSleepBlock?Engine.fmtHr(avgSleepBlock):'—'}</strong> each, ` +
      `and <strong>${rFeeds.length} feeds</strong> (<strong>${feedsPerDay.toFixed(1)}/day</strong>). ` +
      `Look for clusters of feeds (amber triangles) that immediately precede longer blue sleep bars — these are the patterns that link daytime feeding to overnight rest.`
    );
  }

  return { render };
})();
