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
    setupTabs();
    setupNewFileBtn();
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
    const lastDayStats = _data.dailyStats[_data.dailyStats.length - 1];
    if (lastDayStats && lastDayStats.ageWeeks != null) {
      const w = lastDayStats.ageWeeks;
      headerText += ` (Week ${w})`;
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
      document.querySelectorAll('.seg-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      if (_data) renderActiveTab();
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

  document.addEventListener('DOMContentLoaded', init);
  return { switchTab };
})();
