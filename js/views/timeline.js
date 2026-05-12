/* views/timeline.js — Full Gantt timeline (v2): handles incomplete sleep + bottle feeds */
const TimelineView = (() => {
  let _canvas = null, _tooltip = null, _hitData = [];
  const SLEEP_COLOR  = 'rgba(79,195,247,0.55)';
  const SLEEP_BORDER = '#4FC3F7';
  const SLEEP_ONGOING= 'rgba(79,195,247,0.25)'; // lighter for in-progress sleep
  const FEED_COLOR   = 'rgba(255,183,77,0.9)';
  const BOTTLE_COLOR = 'rgba(206,147,216,0.9)';
  const TEXT_COLOR   = '#5A7090';
  const BG_COLOR     = '#0c1525';
  const GRID_COLOR   = 'rgba(255,255,255,0.05)';
  const ROW_H = 36, LABEL_W = 58, HDR_H = 30;

  function render(data, windowKey) {
    _canvas  = document.getElementById('timeline-canvas');
    _tooltip = document.getElementById('timeline-tooltip');
    if (!_canvas) return;

    const { sleeps, feeds, dailyStats } = data;
    const slicedDs = Engine.sliceData(dailyStats, windowKey);
    const days  = [...slicedDs].sort((a,b)=>a.sleepDay<b.sleepDay?-1:1);
    const totalH= HDR_H + days.length * ROW_H + 10;
    const totalW= (_canvas.parentElement.clientWidth - 40) || 700;
    _canvas.width  = Math.max(totalW, 600);
    _canvas.height = totalH;
    const W = _canvas.width;
    const ctx = _canvas.getContext('2d');
    ctx.clearRect(0,0,W,totalH);
    ctx.fillStyle=BG_COLOR; ctx.fillRect(0,0,W,totalH);

    const contentW = W - LABEL_W;
    const xForMin  = m => LABEL_W + (m/1440)*contentW;
    const now      = Engine.getNow();

    // Night Mode Shading (19:00 to 07:00, which is the first 12 hours)
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(xForMin(0), HDR_H, xForMin(720) - xForMin(0), totalH - HDR_H);

    // Header hour labels
    ctx.font='9px Inter,sans-serif'; ctx.fillStyle=TEXT_COLOR;
    for (let h=0;h<=24;h+=2) {
      const x = xForMin(h*60);
      const actualHour = (19+h)%24;
      ctx.fillStyle=TEXT_COLOR;
      ctx.fillText(`${String(actualHour).padStart(2,'0')}:00`, x-14, HDR_H-6);
      ctx.strokeStyle = h===0?'rgba(255,255,255,0.15)':GRID_COLOR;
      ctx.lineWidth=1; ctx.setLineDash(h===0?[]:[3,3]);
      ctx.beginPath(); ctx.moveTo(x,HDR_H); ctx.lineTo(x,totalH); ctx.stroke();
      ctx.setLineDash([]);
    }

    _hitData = [];

    days.forEach((dayStats, di) => {
      const { start:dayStart } = Engine.getDayBoundary(dayStats.sleepDay);
      const y = HDR_H + di * ROW_H;

      // Row background
      ctx.fillStyle = di%2===0?'rgba(255,255,255,0.01)':'transparent';
      ctx.fillRect(LABEL_W, y, contentW, ROW_H);
      ctx.font='9px Inter,sans-serif'; ctx.fillStyle=TEXT_COLOR;
      ctx.fillText(dayStats.sleepDay.slice(5), 4, y+ROW_H/2+4);

      // Completed sleep blocks
      const allSleepsForDay = sleeps.filter(s=>s.sleepDay===dayStats.sleepDay);
      allSleepsForDay.forEach(s=>{
        const endT    = s.endTime;
        const offStart= (s.startTime.getTime()-dayStart.getTime())/60000;
        const offEnd  = (endT.getTime()-dayStart.getTime())/60000;
        const x1=xForMin(Math.max(0,offStart)), x2=xForMin(Math.min(1440,offEnd));
        const bw=Math.max(x2-x1,2), bh=ROW_H-10, by=y+5;

        ctx.fillStyle = SLEEP_COLOR;
        roundRect(ctx,x1,by,bw,bh,4);
        ctx.strokeStyle=SLEEP_BORDER; ctx.lineWidth=1;
        ctx.strokeRect(x1,by,bw,bh);
        ctx.setLineDash([]);

        if (bw>40) {
          ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='8px Inter,sans-serif';
          ctx.fillText(Engine.fmtHr(s.sleepDuration/3600), x1+4, by+bh-4);
        }
        _hitData.push({type:'sleep',event:{...s,isOngoing:false},x1,x2,y1:by,y2:by+bh});
      });

      // Feed events
      const dayFeeds = feeds.filter(f=>f.sleepDay===dayStats.sleepDay);
      dayFeeds.forEach(f=>{
        const off = (f.startTime.getTime()-dayStart.getTime())/60000;
        const x   = xForMin(Math.max(0,Math.min(1440,off)));
        const fy  = y+ROW_H-9;
        ctx.fillStyle = f.feedSubtype==='bottle'?BOTTLE_COLOR:FEED_COLOR;
        ctx.beginPath(); ctx.moveTo(x,fy-8); ctx.lineTo(x-4,fy); ctx.lineTo(x+4,fy);
        ctx.closePath(); ctx.fill();
        _hitData.push({type:'feed',event:f,x1:x-5,x2:x+5,y1:fy-9,y2:fy+1});
      });
    });

    // Current time line
    const todayIdx = days.findIndex(d=>d.sleepDay===Engine.todaySleepDay());
    if (todayIdx>=0) {
      const { start:todayStart } = Engine.getDayBoundary(days[todayIdx].sleepDay);
      const offNow = (now.getTime()-todayStart.getTime())/60000;
      const xNow   = xForMin(Math.max(0,Math.min(1440,offNow)));
      const yRow   = HDR_H + todayIdx*ROW_H;
      ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.5; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(xNow,yRow); ctx.lineTo(xNow,yRow+ROW_H); ctx.stroke();
      ctx.setLineDash([]);
    }

    _canvas.onmousemove = showTip;
    _canvas.onmouseleave = ()=>{ if(_tooltip) _tooltip.classList.add('hidden'); };
  }

  function showTip(evt) {
    const rect=_canvas.getBoundingClientRect();
    const mx=evt.clientX-rect.left, my=evt.clientY-rect.top;
    const hit=_hitData.find(h=>mx>=h.x1&&mx<=h.x2&&my>=h.y1&&my<=h.y2);
    if (!hit) { _tooltip.classList.add('hidden'); return; }
    let html='';
    if (hit.type==='sleep') {
      const s=hit.event;
      html=`😴 <strong>${Engine.fmtHr(s.sleepDuration/3600)}</strong><br>${Engine.fmtTime(s.startTime)} → ${Engine.fmtTime(s.endTime)}<br><span style="color:#5A7090">${s.caregiver||''}</span>`;
    } else {
      const f=hit.event;
      html=f.feedSubtype==='bottle'
        ?`🍼 <strong>Bottle (${f.bottleType||''})</strong><br>${Engine.fmtTime(f.startTime)} · ${f.totalVolume||'?'}${f.volumeUnit||'mL'}<br><span style="color:#5A7090">${f.caregiver||''}</span>`
        :`🍼 <strong>${Engine.fmtMin(f.totalDuration/60)}</strong> total<br>${Engine.fmtTime(f.startTime)} · L:${Engine.fmtMin(f.leftDuration/60)} R:${Engine.fmtMin(f.rightDuration/60)}<br><span style="color:#5A7090">${f.caregiver||''}</span>`;
    }
    _tooltip.innerHTML=html;
    _tooltip.classList.remove('hidden');
    _tooltip.style.left=(evt.clientX+12)+'px';
    _tooltip.style.top=(evt.clientY-10)+'px';
  }

  function roundRect(ctx,x,y,w,h,r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
    ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
    ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r); ctx.closePath(); ctx.fill();
  }

  return { render };
})();
