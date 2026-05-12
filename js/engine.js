/* engine.js — All analysis computation (v2) */
const Engine = (() => {
  const WINDOW_DAYS = { '1d':1, '7d':7, '14d':14, '1mo':30, '1yr':365, 'all':99999 };
  let currentAppTime = null;
  let _boundaryHour = 19;

  function setBoundaryHour(hour) {
    _boundaryHour = hour;
  }

  function getNow() {
    return currentAppTime || new Date();
  }

  function sliceData(array, windowKey) {
    const days = WINDOW_DAYS[windowKey] || 99999;
    if (days === 99999) return array;
    // Return the selected number of days PLUS today (the partial day at the end)
    return array.slice(-(days + 1));
  }

  // ─── ENTRY POINT ─────────────────────────────────────────────
  function analyse(events) {
    // Feeds = breastfeeds + bottle feeds
    const feeds  = events.filter(e => e.type === 'Breastfeed' || e.type === 'Bottle Feed');
    // Completed sleeps only for statistics; keep ongoing for dashboard
    const sleeps        = events.filter(e => e.type === 'Sleep');
    const completeSleeps = sleeps.filter(s => s.endTime);
    const ongoingSleep   = null; // Ignored as requested
    const growth = events.filter(e => e.type === 'Growth');
    const diapers = events.filter(e => e.type === 'Diaper');
    const allDays    = getAllSleepDays(events);
    
    // Find absolute latest timestamp to anchor "Now"
    let maxTs = 0;
    feeds.forEach(f => {
      const ms = f.startTime.getTime() + (f.totalDuration?f.totalDuration*1000:0);
      if (ms > maxTs) maxTs = ms;
    });
    completeSleeps.forEach(s => {
      if (s.endTime && s.endTime.getTime() > maxTs) maxTs = s.endTime.getTime();
    });
    currentAppTime = maxTs > 0 ? new Date(maxTs) : new Date();

    // Global Wake Windows & Feed Intervals
    const sortedCompleteSleeps = [...completeSleeps].sort((a,b)=>a.startTime - b.startTime);
    sortedCompleteSleeps.forEach((s, i) => {
      if (i > 0) {
        const gap = (s.startTime - sortedCompleteSleeps[i-1].endTime) / 60000;
        if (gap > 0 && gap < 480) s.wakeWindowBefore = gap;
      }
    });

    const sortedAllFeeds = [...feeds].sort((a,b)=>a.startTime - b.startTime);
    sortedAllFeeds.forEach((f, i) => {
      if (i > 0) {
        const gap = (f.startTime - sortedAllFeeds[i-1].startTime) / 60000;
        if (gap > 0 && gap < 480) f.intervalBefore = gap;
      }
    });

    const dailyStats = allDays.map(day => buildDayStats(day, feeds, completeSleeps, diapers));

    // Compute sleep regressions (recent 3 days < 80% of prev 14 days)
    for (let i = 0; i < dailyStats.length; i++) {
      dailyStats[i].isRegression = false;
      if (i >= 14) {
        const recent3 = dailyStats.slice(Math.max(0, i-2), i+1);
        const prev14  = dailyStats.slice(Math.max(0, i-16), i-2);
        const recentAvg = avg(recent3.map(d=>d.totalSleepHr));
        const prevAvg   = avg(prev14.map(d=>d.totalSleepHr));
        if (recentAvg && prevAvg && recentAvg < prevAvg * 0.8) {
          dailyStats[i].isRegression = true;
        }
      }
    }

    return { feeds, sleeps, completeSleeps, ongoingSleep, growth, allDays, dailyStats };
  }

  function getAllSleepDays(events) {
    const days = new Set(events.map(e => e.sleepDay));
    return [...days].sort();
  }

  // ─── PER-DAY STATS ────────────────────────────────────────────
  function buildDayStats(sleepDay, feeds, completeSleeps, diapers) {
    const { start: dayStart, end: dayEnd } = getDayBoundary(sleepDay);

    const dayFeeds  = feeds.filter(f => f.startTime >= dayStart && f.startTime < dayEnd);
    const daySleeps = completeSleeps.filter(s =>
      s.startTime < dayEnd && s.endTime >= dayStart
    );

    // Feed stats (breastfeed-only for duration & balance)
    const breastFeeds  = dayFeeds.filter(f => f.feedSubtype === 'breast');
    const feedCount    = dayFeeds.length;
    const totalFeedSec = breastFeeds.reduce((s, f) => s + (f.totalDuration||0), 0);
    const leftSec      = breastFeeds.reduce((s, f) => s + (f.leftDuration||0),  0);
    const rightSec     = breastFeeds.reduce((s, f) => s + (f.rightDuration||0), 0);

    // Feed intervals and cluster feeding
    const sortedFeeds   = [...dayFeeds].sort((a,b) => a.startTime - b.startTime);
    const feedIntervals = sortedFeeds.map(f => f.intervalBefore).filter(i => i != null);
    let hasClusterFeeds = false;
    for (let i = 0; i < sortedFeeds.length - 2; i++) {
      if ((sortedFeeds[i+2].startTime - sortedFeeds[i].startTime) <= 2 * 3600000) {
        hasClusterFeeds = true;
        break;
      }
    }

    // Sleep stats (clip to this 24h window)
    let totalSleepSec = 0, nightSleepSec = 0, longestBlock = 0;

    // Night feeds (always 19:00 to 07:00, regardless of boundary)
    const nightFeeds = dayFeeds.filter(f => {
      const h = f.startTime.getHours();
      return h >= 19 || h < 7;
    });
    const nightFeedCount = nightFeeds.length;

    daySleeps.forEach(s => {
      const ss  = Math.max(s.startTime.getTime(), dayStart.getTime());
      const se  = Math.min(s.endTime.getTime(),   dayEnd.getTime());
      const dur = Math.max(0, se - ss) / 1000;
      totalSleepSec += dur;
      if (s.sleepDuration > longestBlock) longestBlock = s.sleepDuration;
      
      // Calculate intersection with 19:00-07:00
      nightSleepSec += getOverlapWithNight(ss, se);
    });

    // Wake windows and Sleep counts
    const sortedSleeps = [...daySleeps].sort((a,b) => a.startTime - b.startTime);
    const wakeWindows  = sortedSleeps.map(s => s.wakeWindowBefore).filter(w => w != null);
    
    const nightSleepCount = daySleeps.filter(s => s.startTime.getHours() >= 19 || s.startTime.getHours() < 7).length;
    const nightWakings = Math.max(0, nightSleepCount - 1);
    const daySleepCount = daySleeps.filter(s => s.startTime.getHours() >= 7 && s.startTime.getHours() < 19).length;

    // Bottle feed volume
    const totalBottleML = dayFeeds
      .filter(f => f.feedSubtype === 'bottle')
      .reduce((s, f) => s + (f.totalVolume || 0), 0);

    // Diapers
    const dayDiapers = diapers.filter(d => d.startTime >= dayStart && d.startTime < dayEnd);
    const wetCount = dayDiapers.filter(d => d.diaperType === 'Wet' || d.diaperType === 'Mixed').length;
    const dirtyCount = dayDiapers.filter(d => d.diaperType === 'Dirty' || d.diaperType === 'Mixed').length;

    // Age context
    let ageDays = null, ageWeeks = null;
    const birthDate = feeds.length && feeds[0].profileBirthDate ? feeds[0].profileBirthDate : null;
    if (birthDate) {
      ageDays = Math.floor((dayStart - birthDate) / 86400000);
      ageWeeks = Math.floor(ageDays / 7);
    }

    return {
      sleepDay,
      ageDays, ageWeeks,
      feedCount,
      nightFeedCount,
      hasClusterFeeds,
      breastFeedCount: breastFeeds.length,
      bottleFeedCount: dayFeeds.filter(f=>f.feedSubtype==='bottle').length,
      totalFeedSec,
      totalFeedMin:     totalFeedSec / 60,
      totalBottleML,
      leftSec, rightSec,
      leftPct:  totalFeedSec > 0 ? (leftSec  / totalFeedSec) * 100 : 50,
      rightPct: totalFeedSec > 0 ? (rightSec / totalFeedSec) * 100 : 50,
      feedIntervals,
      avgFeedIntervalMin: feedIntervals.length ? avg(feedIntervals) : null,
      totalSleepSec,
      totalSleepHr:   totalSleepSec / 3600,
      nightSleepHr:   nightSleepSec / 3600,
      daySleepHr:     Math.max(0, totalSleepSec - nightSleepSec) / 3600,
      longestBlockHr: longestBlock / 3600,
      wakeWindows,
      avgWakeWindowMin: wakeWindows.length ? avg(wakeWindows) : null,
      maxWakeWindowMin: wakeWindows.length ? Math.max(...wakeWindows) : null,
      nightWakings,
      daySleepCount,
      wetCount,
      dirtyCount,
      dayFeeds, daySleeps, dayDiapers,
    };
  }

  // ─── NIGHT OVERLAP (19:00 - 07:00) ───────────────────────────
  function getOverlapWithNight(startMs, endMs) {
    let overlapMs = 0;
    const startDt = new Date(startMs);
    let currentDay = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
    
    while (currentDay.getTime() < endMs) {
       const dY = currentDay.getFullYear(), dM = currentDay.getMonth(), dD = currentDay.getDate();
       const mornStart = new Date(dY, dM, dD, 0, 0, 0).getTime();
       const mornEnd   = new Date(dY, dM, dD, 7, 0, 0).getTime();
       const eveStart  = new Date(dY, dM, dD, 19, 0, 0).getTime();
       const eveEnd    = new Date(dY, dM, dD + 1, 0, 0, 0).getTime();

       const oMornStart = Math.max(startMs, mornStart), oMornEnd = Math.min(endMs, mornEnd);
       if (oMornEnd > oMornStart) overlapMs += (oMornEnd - oMornStart);

       const oEveStart = Math.max(startMs, eveStart), oEveEnd = Math.min(endMs, eveEnd);
       if (oEveEnd > oEveStart) overlapMs += (oEveEnd - oEveStart);
       
       currentDay.setDate(currentDay.getDate() + 1);
    }
    return overlapMs / 1000;
  }

  // ─── DAY BOUNDARY ────────────────────────────────────────────
  function getDayBoundary(sleepDay) {
    const [y, mo, d] = sleepDay.split('-').map(Number);
    const start = new Date(y, mo - 1, d, _boundaryHour, 0, 0);
    const end   = new Date(start.getTime() + 24 * 3600000);
    return { start, end };
  }

  // ─── ROLLING AVERAGE ─────────────────────────────────────────
  // Returns array aligned to dailyStats
  function rollingAvg(dailyStats, metric, windowKey) {
    const n = WINDOW_DAYS[windowKey] || 7;
    const today = todaySleepDay();
    
    return dailyStats.map((d, i) => {
      let slice;
      if (d.sleepDay === today) {
        // For today, compare against the n completed days BEFORE today
        slice = dailyStats.slice(0, i).slice(-n);
      } else {
        // For a past complete day, the trailing average includes that day
        slice = dailyStats.slice(0, i + 1).slice(-n);
      }
      const vals = slice.map(s => s[metric]).filter(v => v != null && !isNaN(v));
      return vals.length ? +avg(vals).toFixed(3) : null;
    });
  }

  // Scalar: avg over last N complete days before today
  function rollingAvgScalar(dailyStats, metric, windowKey) {
    const n = WINDOW_DAYS[windowKey] || 7;
    const today = todaySleepDay();
    const isTodayLast = dailyStats.length > 0 && dailyStats[dailyStats.length - 1].sleepDay === today;
    const complete = isTodayLast ? dailyStats.slice(0, -1) : dailyStats;
    const slice = complete.slice(-n);
    const vals = slice.map(s => s[metric]).filter(v => v != null && !isNaN(v));
    return vals.length ? avg(vals) : null;
  }

  function todayElapsedFraction() {
    const now = getNow();
    const { start, end } = getDayBoundary(Parser.getSleepDay(now));
    return Math.min(1, Math.max(0, (now - start) / (end - start)));
  }

  function todaySleepDay() { return Parser.getSleepDay(getNow()); }

  /**
   * dailyChartData — for charting daily data cleanly.
   * Returns { completeVals, todayActual, labels } where:
   *   completeVals[i] = raw value for complete days, null for today
   *   todayActual[i]  = raw value only for today's bar (partial, dimmed)
   * Trend lines should be computed only on completeVals (filtering nulls).
   */
  function dailyChartData(dailyStats, metricKey) {
    const today  = todaySleepDay();
    const completeVals = [], todayActual = [];
    dailyStats.forEach(d => {
      const v = d[metricKey];
      const rounded = v != null ? +v.toFixed(3) : null;
      if (d.sleepDay === today) {
        completeVals.push(null);
        todayActual.push(rounded);
      } else {
        completeVals.push(rounded);
        todayActual.push(null);
      }
    });
    return { completeVals, todayActual };
  }

  // ─── LINEAR REGRESSION TREND LINE ────────────────────────────
  function linearRegressionLine(yValues) {
    const points = yValues
      .map((v, i) => ({ x: i, y: v }))
      .filter(p => p.y !== null && !isNaN(p.y));
    const n = points.length;
    if (n < 2) return yValues.map(() => null);
    
    const sumX  = points.reduce((s, p) => s + p.x, 0);
    const sumY  = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
    
    const denom = n * sumXX - sumX * sumX;
    if (!denom) {
      const avgY = sumY / n;
      return yValues.map(() => +avgY.toFixed(3));
    }
    
    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    
    return yValues.map((_, i) => +(m * i + b).toFixed(3));
  }

  // Scatter regression (x,y pairs) — returns {m,b,rSquared}
  function scatterRegression(points) {
    const n = points.length;
    if (n < 3) return null;
    const sumX  = points.reduce((s,p)=>s+p.x,0);
    const sumY  = points.reduce((s,p)=>s+p.y,0);
    const sumXY = points.reduce((s,p)=>s+p.x*p.y,0);
    const sumXX = points.reduce((s,p)=>s+p.x*p.x,0);
    const denom = n*sumXX - sumX*sumX;
    if (!denom) return null;
    const m = (n*sumXY - sumX*sumY) / denom;
    const b = (sumY - m*sumX) / n;
    const yMean = sumY / n;
    const ssTot = points.reduce((s,p)=>s+(p.y-yMean)**2,0);
    const ssRes = points.reduce((s,p)=>s+(p.y-(m*p.x+b))**2,0);
    const r2    = ssTot ? 1 - ssRes/ssTot : 0;
    return { m, b, rSquared: r2 };
  }

  // ─── MISC ────────────────────────────────────────────────────
  function lastEvent(events, ...types) {
    return [...events].filter(e=>types.includes(e.type))
                      .sort((a,b)=>b.startTime-a.startTime)[0] || null;
  }

  function allFeedIntervals(feeds) {
    const sorted = [...feeds].sort((a,b)=>a.startTime-b.startTime);
    return sorted.slice(1).map((f, i) => ({
      time:        f.startTime,
      intervalMin: (f.startTime - sorted[i].startTime) / 60000,
      caregiver:   f.caregiver,
      subtype:     f.feedSubtype,
    }));
  }

  function avg(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }
  function stdDev(arr) {
    if (!arr || arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
  }
  function fmtMin(minutes) {
    if (minutes == null || isNaN(minutes)) return '—';
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function fmtHr(hours) {
    if (hours == null || isNaN(hours)) return '—';
    const h = Math.floor(hours), m = Math.round((hours-h)*60);
    return `${h}h ${m}m`;
  }
  function fmtTime(date) {
    if (!date) return '—';
    return date.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:true});
  }
  function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    return fmtMin(ms / 60000);
  }
  function pct(v, total) { return total > 0 ? (v/total*100).toFixed(0)+'%' : '—'; }

  function getBabyAgeString(dateStr, birthDateStr) {
    if (!dateStr || !birthDateStr) return null;
    const d = new Date(dateStr);
    const b = new Date(birthDateStr);
    const ms = d.getTime() - b.getTime();
    if (ms < 0) return null;
    const days = Math.floor(ms / 86400000);
    const m = Math.floor(days / 30.44);
    const w = Math.floor((days % 30.44) / 7);
    const remD = Math.floor(days % 7);
    
    if (m > 0) return `${m} month${m!==1?'s':''}${w>0?`, ${w} wk`:''}`;
    if (w > 0) return `${w} week${w!==1?'s':''}${remD>0?`, ${remD} d`:''}`;
    return `${days} day${days!==1?'s':''}`;
  }

  return { analyse, rollingAvg, rollingAvgScalar, todayElapsedFraction, todaySleepDay,
           proRataDaily: dailyChartData, dailyChartData, linearRegressionLine, scatterRegression, allFeedIntervals,
           fmtHr, fmtMin, fmtDuration, fmtTime, avg, stdDev, getBabyAgeString, getNow, sliceData, pct,
           setBoundaryHour, getDayBoundary,
    WINDOW_DAYS,
  };
})();
