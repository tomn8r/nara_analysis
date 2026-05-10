/* parser.js — NARA CSV → normalised event objects (v2) */
const Parser = (() => {

  // Keep birthDate at module scope so all rows can access it if needed
  let _birthDate = null;

  function parseCSV(csvText) {
    _birthDate = null; // Reset on parse
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: false });
    const events = result.data.map(normaliseRow).filter(Boolean);
    events.sort((a, b) => a.startTime - b.startTime);
    // Attach birthDate to the first event or as a static property (we'll return it)
    if (events.length > 0) events[0].profileBirthDate = _birthDate;
    return events;
  }

  function normaliseRow(row) {
    const type = (row['Type'] || '').trim();
    if (type === 'Profile') {
      const bDateStr = row['[Profile] Birth Date'];
      if (bDateStr) {
        // usually YYYY-MM-DD
        const m = bDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) _birthDate = new Date(+m[1], +m[2] - 1, +m[3]);
      }
      return null;
    }
    if (!type) return null;

    const startStr = row['Start Date/time'];
    if (!startStr) return null;
    const startTime = parseLocalDT(startStr);
    if (!startTime) return null;

    const event = {
      type,
      profileName: (row['Profile Name'] || '').trim(),
      startTime,
      caregiver: (row['Created By Caregiver'] || '').trim(),
      updatedBy:  (row['Last Updated By Caregiver'] || '').trim(),
      note:       (row['Note'] || '').trim(),
      sleepDay:   getSleepDay(startTime),
    };

    if (type === 'Sleep') {
      const endStr = row['[Sleep] End Date/time'];
      const endTime = endStr ? parseLocalDT(endStr) : null;
      const dur     = parseSec(row['[Sleep] Duration (Seconds)']);
      event.endTime      = endTime;
      event.sleepDuration = dur;
      event.isOngoing    = !endTime; // true if sleep has no end yet
    }

    if (type === 'Breastfeed') {
      const left  = parseSec(row['[Breastfeed] Left Duration (Seconds)']);
      const right = parseSec(row['[Breastfeed] Right Duration (Seconds)']);
      event.beginSide     = normSide(row['[Breastfeed] Begin Side']);
      event.endSide       = normSide(row['[Breastfeed] End Side']);
      event.leftDuration  = left;
      event.rightDuration = right;
      event.totalDuration = left + right;
      event.feedSubtype   = 'breast';
    }

    if (type === 'Bottle Feed') {
      const fVol  = parseFloat(row['[Bottle Feed] Formula Volume'])     || 0;
      const bmVol = parseFloat(row['[Bottle Feed] Breast Milk Volume']) || 0;
      const total = parseFloat(row['[Bottle Feed] Volume'])             || fVol || bmVol;
      event.bottleType    = (row['[Bottle Feed] Type'] || '').trim();
      event.formulaVolume  = fVol;
      event.breastMilkVolume = bmVol;
      event.totalVolume   = total;
      event.volumeUnit    = (row['[Bottle Feed] Volume Unit'] || 'ML').trim();
      // Treat as 0-duration feed (no left/right sides)
      event.leftDuration  = 0;
      event.rightDuration = 0;
      event.totalDuration = 0;
      event.feedSubtype   = 'bottle';
    }

    if (type === 'Growth') {
      event.weight   = parseFloat(row['[Growth] Weight'])    || null;
      event.height   = parseFloat(row['[Growth] Height'])    || null;
      event.headSize = parseFloat(row['[Growth] Head Size']) || null;
      event.weightUnit   = (row['[Growth] Weight Unit']    || 'KG').trim();
      event.heightUnit   = (row['[Growth] Height Unit']    || 'CM').trim();
      event.headSizeUnit = (row['[Growth] Head Size Unit'] || 'CM').trim();
    }

    if (type === 'Diaper') {
      event.diaperType    = (row['[Diaper] Type']          || '').trim();
      event.diaperColor   = (row['[Diaper] Dirty Color']   || '').trim();
      event.diaperTexture = (row['[Diaper] Dirty Texture'] || '').trim();
    }

    return event;
  }

  function parseLocalDT(str) {
    if (!str) return null;
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function getSleepDay(date) {
    // 7pm to 7pm day: named after the day it starts.
    // Subtracting 19 hours aligns everything from 7pm Day X to 6:59pm Day X+1 into Day X.
    const d = new Date(date.getTime() - 19 * 3600000);
    return fmtDate(d);
  }

  function fmtDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function pad(n)       { return String(n).padStart(2, '0'); }
  function parseSec(v)  { const n = parseInt(v); return isNaN(n) ? 0 : n; }
  function normSide(v)  { return (v || '').replace('.nonTimer','').trim().toUpperCase(); }

  return { parseCSV, getSleepDay, fmtDate };
})();
