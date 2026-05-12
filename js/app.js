/* app.js — Main orchestrator (v2): polyfills, file loading, routing */
const App = (() => {
  let _data = null, _windowKey = '7d', _activeTab = 'dashboard';

  // ─── CANVAS ROUNDRECT POLYFILL ────────────────────────────
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r) {
      r = Math.min(r, w/2, h/2);
      this.beginPath();
      this.moveTo(x+r,y); this.lineTo(x+w-r,y);
      this.arcTo(x+w,y,x+w,y+r,r); this.lineTo(x+w,y+h-r);
      this.arcTo(x+w,y+h,x+w-r,y+h,r); this.lineTo(x+r,y+h);
      this.arcTo(x,y+h,x,y+h-r,r); this.lineTo(x,y+r);
      this.arcTo(x,y,x+r,y,r); this.closePath();
      return this;
    };
  }

  // ─── INIT ─────────────────────────────────────────────────
  function init() {
    setupUpload();
    setupWindowButtons();
    setupBoundaryButtons();
    setupTabs();
    setupNewFileBtn();
    setupDrReport();
    tryLoadFromStorage();
  }

  // ─── UPLOAD ───────────────────────────────────────────────
  function setupUpload() {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    dropZone.addEventListener('dragover',  e=>{e.preventDefault();dropZone.classList.add('drag-over');});
    dropZone.addEventListener('dragleave', ()=>dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e=>{
      e.preventDefault(); dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e=>{ if(e.target.files[0]) readFile(e.target.files[0]); });
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        processCSV(e.target.result);
        try { localStorage.setItem('nara_csv', e.target.result); } catch(_) {}
      } catch(err) {
        console.error('CSV parse error:', err);
        alert('Could not parse this CSV. Please check it is a valid NARA export.\n\n' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function tryLoadFromStorage() {
    try {
      const csv = localStorage.getItem('nara_csv');
      if (csv) processCSV(csv);
    } catch(_) {}
  }

  function processCSV(csvText) {
    const events = Parser.parseCSV(csvText);
    if (!events.length) throw new Error('No events found in CSV.');

    _data = Engine.analyse(events);

    // Guard: need at least feeds or sleeps
    if (!_data.feeds.length && !_data.sleeps.length) {
      throw new Error('No feed or sleep events found.');
    }

    const babyName = events[0]?.profileName || 'Baby';
    let headerText = babyName;
    const birthDate = events[0]?.profileBirthDate || null;
    const now = Engine.getNow();
    if (birthDate) {
      const ageStr = Engine.getBabyAgeString(now, birthDate);
      if (ageStr) headerText += ` (${ageStr})`;
    }
    document.getElementById('baby-name-label').textContent = headerText;
    showApp();
    renderActiveTab();
  }

  // ─── SCREEN SWITCH ────────────────────────────────────────
  function showApp() {
    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
  }
  function showUpload() {
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('upload-screen').classList.add('active');
  }

  // ─── WINDOW SELECTOR ──────────────────────────────────────
  function setupWindowButtons() {
    document.getElementById('window-btns').addEventListener('click', e=>{
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      _windowKey = btn.dataset.window;
      document.getElementById('window-btns').querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if (_data) renderActiveTab();
    });
  }

  // ─── BOUNDARY SELECTOR ────────────────────────────────────
  function setupBoundaryButtons() {
    const container = document.getElementById('boundary-btns');
    if (!container) return;
    container.addEventListener('click', e=>{
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      const hour = parseInt(btn.dataset.boundary);
      
      Parser.setBoundaryHour(hour);
      Engine.setBoundaryHour(hour);
      
      container.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      
      // Reprocess from local storage string
      tryLoadFromStorage();
    });
  }

  // ─── TABS ─────────────────────────────────────────────────
  function setupTabs() {
    document.getElementById('tab-nav').addEventListener('click', e=>{
      const btn = e.target.closest('.tab-btn'); if (!btn) return;
      switchTab(btn.dataset.tab);
    });
  }

  function switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('active',el.id===`tab-${tab}`));
    if (_data) renderActiveTab();
  }

  function renderActiveTab() {
    if (!_data) return;
    try {
      switch(_activeTab) {
        case 'dashboard': DashboardView.render(_data, _windowKey); break;
        case 'sleep':     SleepView.render(_data, _windowKey);     break;
        case 'feed':      FeedView.render(_data, _windowKey);      break;
        case 'combined':  CombinedView.render(_data, _windowKey);  break;
        case 'timeline':  TimelineView.render(_data);              break;
      }
    } catch(err) {
      console.error('Render error on tab', _activeTab, err);
    }
  }

  // ─── NEW FILE ─────────────────────────────────────────────
  function setupNewFileBtn() {
    document.getElementById('btn-new-file').addEventListener('click', ()=>{
      try { localStorage.removeItem('nara_csv'); } catch(_) {}
      _data = null;
      showUpload();
    });
  }

  // ─── DOCTOR'S REPORT ──────────────────────────────────────
  function setupDrReport() {
    const btnDr = document.getElementById('btn-dr-report');
    const modal = document.getElementById('dr-report-modal');
    const btnClose = document.getElementById('btn-close-dr');
    const btnPrint = document.getElementById('btn-print-dr');
    const body = document.getElementById('dr-report-body');

    if (!btnDr || !modal) return;

    btnDr.addEventListener('click', () => {
      if (!_data) return;
      const sliced = Engine.sliceData(_data.dailyStats, _windowKey);
      const completeDays = sliced.slice(0, -1);
      
      const numDays = completeDays.length;
      if (numDays === 0) {
        alert("Not enough complete days of data to generate a report.");
        return;
      }

      // Age calculation
      const birthDate = _data.feeds.length && _data.feeds[0].profileBirthDate ? _data.feeds[0].profileBirthDate : null;
      const ageStr = birthDate ? Engine.getBabyAgeString(Engine.getNow(), birthDate) : 'Unknown';

      // Averages
      const avgFeedCount = Engine.avg(completeDays.map(d=>d.feedCount));
      const avgBreastMin = Engine.avg(completeDays.map(d=>d.totalFeedMin));
      const avgBottleVol = Engine.avg(completeDays.map(d=>d.totalBottleML));
      
      const avgTotalSleep = Engine.avg(completeDays.map(d=>d.totalSleepHr));
      const avgNightSleep = Engine.avg(completeDays.map(d=>d.nightSleepHr));
      const avgNightWakings = Engine.avg(completeDays.map(d=>d.nightWakings));
      const avgLongestBlock = Engine.avg(completeDays.map(d=>d.longestBlockHr));

      const avgWet = Engine.avg(completeDays.map(d=>d.wetCount));
      const avgDirty = Engine.avg(completeDays.map(d=>d.dirtyCount));

      body.innerHTML = `
        <div class="dr-section">
          <h3>Patient Profile</h3>
          <p><strong>Name:</strong> ${document.getElementById('baby-name-label').textContent.split(' (')[0]}</p>
          <p><strong>Age:</strong> ${ageStr}</p>
          <p><strong>Time Window Analyzed:</strong> Last ${numDays} complete days</p>
          <p><strong>Day Boundary Config:</strong> ${document.querySelector('#boundary-btns .active').textContent}</p>
        </div>
        
        <div class="dr-section">
          <h3>Output (Averages per Day)</h3>
          <div class="dr-grid">
            <div class="dr-stat"><div class="dr-stat-label">Wet Diapers</div><div class="dr-stat-val">${avgWet.toFixed(1)} / day</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Dirty Diapers</div><div class="dr-stat-val">${avgDirty.toFixed(1)} / day</div></div>
          </div>
        </div>

        <div class="dr-section">
          <h3>Feeding (Averages per Day)</h3>
          <div class="dr-grid">
            <div class="dr-stat"><div class="dr-stat-label">Total Feeds</div><div class="dr-stat-val">${avgFeedCount.toFixed(1)} / day</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Breastfeed Duration</div><div class="dr-stat-val">${Engine.fmtMin(avgBreastMin)}</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Bottle Volume</div><div class="dr-stat-val">${Math.round(avgBottleVol)} mL</div></div>
          </div>
        </div>

        <div class="dr-section">
          <h3>Sleep (Averages per Day)</h3>
          <div class="dr-grid">
            <div class="dr-stat"><div class="dr-stat-label">Total Daily Sleep</div><div class="dr-stat-val">${Engine.fmtHr(avgTotalSleep)}</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Night Sleep</div><div class="dr-stat-val">${Engine.fmtHr(avgNightSleep)}</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Longest Block</div><div class="dr-stat-val">${Engine.fmtHr(avgLongestBlock)}</div></div>
            <div class="dr-stat"><div class="dr-stat-label">Night Wakings</div><div class="dr-stat-val">${avgNightWakings.toFixed(1)}</div></div>
          </div>
        </div>
      `;
      modal.classList.add('active');
    });

    btnClose.addEventListener('click', () => modal.classList.remove('active'));
    
    btnPrint.addEventListener('click', () => {
      document.body.classList.add('printing-report');
      window.print();
      document.body.classList.remove('printing-report');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { switchTab };
})();
