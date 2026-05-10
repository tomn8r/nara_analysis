/* engine.js — All analysis computation (v2) */
const Engine = (() => {
  const WINDOW_DAYS = { '1d':1, '7d':7, '14d':14, '1mo':30 };

  // ─── ENTRY POINT ─────────────────────────────────────────────
  function analyse(events) {
    // Feeds = breastfeeds + bottle feeds
    const feeds  = events.filter(e => e.type === 'Breastfeed' || e.type === 'Bottle Feed');
    // Completed sleeps only for statistics; keep ongoing for dashboard
    const sleeps        = events.filter(e => e.type === 'Sleep');
    const completeSleeps = sleeps.filter(s => s.endTime);
    const ongoingSleep   = sleeps.filter(s => s.isOngoing).sort((a,b)=>b.startTime-a.startTime)[0] || null;
    const growth = events.filter(e => e.type === 'Growth');
    const allDays    = getAllSleepDays(events);
    const dailyStats = allDays.map(day => buildDayStats(day, feeds, completeSleeps));

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
  function buildDayStats(sleepDay, feeds, completeSleeps) {
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
    const feedIntervals = [];
    let hasClusterFeeds = false;
    for (let i = 1; i < sortedFeeds.length; i++) {
      const gap = (sortedFeeds[i].startTime - sortedFeeds[i-1].startTime) / 60000;
      if (gap > 0) feedIntervals.push(gap);
    }
    for (let i = 0; i < sortedFeeds.length - 2; i++) {
      if ((sortedFeeds[i+2].startTime - sortedFeeds[i].startTime) <= 2 * 3600000) {
        hasClusterFeeds = true;
        break;
      }
    }

    // Sleep stats (clip to this 24h window)
    let totalSleepSec = 0, nightSleepSec = 0, longestBlock = 0;
    const nightEnd = new Date(dayStart.getTime() + 12 * 3600000); // 7pm + 12h = 7am

    // Night feeds
    const nightFeeds = dayFeeds.filter(f => f.startTime < nightEnd);
    const nightFeedCount = nightFeeds.length;

    daySleeps.forEach(s => {
      const ss  = Math.max(s.startTime.getTime(), dayStart.getTime());
      const se  = Math.min(s.endTime.getTime(),   dayEnd.getTime());
      const dur = Math.max(0, se - ss) / 1000;
      totalSleepSec += dur;
      if (s.sleepDuration > longestBlock) longestBlock = s.sleepDuration;
      const ns = Math.max(ss, dayStart.getTime());
      const ne = Math.min(se, nightEnd.getTime());
      if (ne > ns) nightSleepSec += (ne - ns) / 1000;
    });

    // Wake windows
    const sortedSleeps = [...daySleeps].sort((a,b) => a.startTime - b.startTime);
    const wakeWindows  = [];
    for (let i = 1; i < sortedSleeps.length; i++) {
      const gap = (sortedSleeps[i].startTime - sortedSleeps[i-1].endTime) / 60000;
      if (gap > 0 && gap < 480) wakeWindows.push(gap);
    }

    // Bottle feed volume
    const totalBottleML = dayFeeds
      .filter(f => f.feedSubtype === 'bottle')
      .reduce((s, f) => s + (f.totalVolume || 0), 0);

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
      dayFeeds, daySleeps,
    };
  }

  // ─── DAY BOUNDARY (7pm → 7pm) ────────────────────────────────
  function getDayBoundary(sleepDay) {
    const [y, mo, d] = sleepDay.split('-').map(Number);
    const start = new Date(y, mo - 1, d, 19, 0, 0);
    const end   = new Date(start.getTime() + 24 * 3600000);
    return { start, end };
  }

  // ─── ROLLING AVERAGE ─────────────────────────────────────────
  // Returns array aligned to dailyStats; each entry = avg of prev N complete days
  function rollingAvg(dailyStats, metric, windowKey) {
    const n = WINDOW_DAYS[windowKey] || 7;
    const complete = dailyStats.slice(0, -1); // exclude today (partial)
    return dailyStats.map((_, i) => {
      const startIdx = Math.max(0, Math.min(i, complete.length) - n);
      const slice    = complete.slice(startIdx, Math.min(i, complete.length));
      const vals     = slice.map(s => s[metric]).filter(v => v != null && !isNaN(v));
      return vals.length ? +avg(vals).toFixed(3) : null;
    });
  }

  // Scalar: avg over last N complete days before today
  function rollingAvgScalar(dailyStats, metric, windowKey) {
    const n       = WINDOW_DAYS[windowKey] || 7;
    const complete = dailyStats.slice(0, -1);
    const slice    = complete.slice(-n);
    const vals     = slice.map(s => s[metric]).filter(v => v != null && !isNaN(v));
    return vals.length ? avg(vals) : null;
  }

  function todayElapsedFraction() {
    const now = new Date();
    const { start, end } = getDayBoundary(Parser.getSleepDay(now));
    return Math.min(1, Math.max(0, (now - start) / (end - start)));
  }

  function todaySleepDay() { return Parser.getSleepDay(new Date()); }

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
    const valid = yValues.map((v, i) => ({ i, v: v ?? 0 }));
    const n = valid.length;
    if (n < 2) return yValues.map(() => null);
    const sumX  = valid.reduce((s, p) => s + p.i, 0);
    const sumY  = valid.reduce((s, p) => s + p.v, 0);
    const sumXY = valid.reduce((s, p) => s + p.i * p.v, 0);
    const sumXX = valid.reduce((s, p) => s + p.i * p.i, 0);
    const denom = n * sumXX - sumX * sumX;
    if (!denom) return yValues.map(() => +(sumY / n).toFixed(3));
    const m = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / n;
    return valid.map(p => +(m * p.i + b).toFixed(3));
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

  return {
    analyse, buildDayStats, getDayBoundary, getAllSleepDays,
    rollingAvg, rollingAvgScalar, dailyChartData,
    todayElapsedFraction, todaySleepDay,
    linearRegressionLine, scatterRegression,
    lastEvent, allFeedIntervals,
    avg, stdDev, fmtMin, fmtHr, fmtTime, fmtDuration, pct,
    WINDOW_DAYS,
  };
})();
