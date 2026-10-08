'use strict';
/* ============================================================
   STRIDE — self-hosted fitness tracker
   All data stays on this device (localStorage). No servers.
   ============================================================ */

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const fmtInt = n => Math.round(n).toLocaleString('en-IN');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function dayKey(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDateLong(d = new Date()) {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtDur(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtPace(minPerKm) {
  if (!isFinite(minPerKm) || minPerKm <= 0 || minPerKm > 60) return '–';
  const m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
  return `${m}:${pad(s)}`;
}
function haversineKm(a, b) {
  const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- store ---------- */
const DB_KEY = 'stride.v1';
const DEFAULTS = {
  v: 1,
  onboarded: false,
  profile: { goal: 10000, weight: 70, height: null, sensitivity: 'medium' },
  days: {},       // 'YYYY-MM-DD' -> {steps, workoutDist, workoutKcal, manualKcal, manualMin, activeMin}
  workouts: [],   // {id,date,type,durSec,distKm,steps,kcal,route:[[lat,lng]..],distSrc}
  manual: []      // {id,date,type,minutes,intensity,kcal}
};
let DB;
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      DB = Object.assign({}, DEFAULTS, d);
      DB.profile = Object.assign({}, DEFAULTS.profile, d.profile || {});
      return;
    }
  } catch (e) { console.warn('db load failed', e); }
  DB = JSON.parse(JSON.stringify(DEFAULTS));
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
    catch (e) { console.warn('db save failed', e); }
  }, 250);
}
function saveDBNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {}
}
function dayRec(key) {
  key = key || dayKey();
  if (!DB.days[key]) DB.days[key] = { steps: 0, workoutDist: 0, workoutKcal: 0, manualKcal: 0, manualMin: 0, activeMin: 0 };
  return DB.days[key];
}
function strideM() { // metres per step
  const h = DB.profile.height;
  return h ? (h * 0.414) / 100 : 0.75;
}
function kcalPerStep() { return 0.04 * (DB.profile.weight / 70); }
function dayTotals(key) {
  const d = dayRec(key);
  const dist = d.steps * strideM() / 1000 + d.workoutDist;
  const kcal = d.steps * kcalPerStep() + d.workoutKcal + d.manualKcal;
  const active = d.activeMin + d.manualMin;
  return { steps: d.steps, dist, kcal, active };
}
const MET = { walk: 3.5, run: 9.8, cycle: 7.5, gym: 6.0, strength: 6.0, yoga: 3.0, swimming: 8.0, cycling: 7.0, hiit: 10.0, sports: 8.0, other: 4.5 };
const INT_MULT = { light: 0.8, moderate: 1.0, hard: 1.25 };
function metKcal(type, minutes, intensity = 'moderate') {
  return (MET[type] || 4.5) * INT_MULT[intensity] * DB.profile.weight * (minutes / 60);
}
const TYPE_LABEL = { walk: 'Walk', run: 'Run', cycle: 'Ride', gym: 'Gym', strength: 'Strength', yoga: 'Yoga', swimming: 'Swim', cycling: 'Cycling', hiit: 'HIIT', sports: 'Sports', other: 'Exercise' };

/* ---------- canvas helpers ---------- */
function fitCanvas(cv, hCss) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = cv.clientWidth || cv.parentElement.clientWidth;
  const h = hCss || cv.clientHeight || 120;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
function roundBar(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, 0);
  ctx.arcTo(x, y + h, x, y, 0);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawBars(cv, labels, values, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv, opts.height || 150);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(...values, 1);
  const n = values.length, gap = opts.gap ?? 8;
  const bw = (w - gap * (n - 1)) / n;
  const baseY = h - 22;
  const color = opts.color || '#c8f542';
  values.forEach((v, i) => {
    const bh = Math.max(3, (v / max) * (baseY - 14));
    const x = i * (bw + gap), y = baseY - bh;
    const hl = opts.highlight === i;
    ctx.fillStyle = hl ? color : 'rgba(200,245,66,.28)';
    if (hl) { ctx.shadowColor = 'rgba(200,245,66,.55)'; ctx.shadowBlur = 12; } else ctx.shadowBlur = 0;
    roundBar(ctx, x, y, bw, bh, 5); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = hl ? '#f2f5f7' : '#5b6776';
    ctx.font = '600 10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + bw / 2, h - 7);
  });
}
function drawRoute(cv, points, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv, opts.height || 220);
  ctx.clearRect(0, 0, w, h);
  // dotted grid backdrop
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  for (let x = 14; x < w; x += 26) for (let y = 14; y < h; y += 26) { ctx.beginPath(); ctx.arc(x, y, 1, 0, 7); ctx.fill(); }
  if (!points || points.length < 2) {
    ctx.fillStyle = '#5b6776'; ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center'; ctx.fillText(opts.emptyText || 'Route will appear here', w / 2, h / 2);
    return;
  }
  let minLat = 1e9, maxLat = -1e9, minLng = 1e9, maxLng = -1e9;
  points.forEach(p => { minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]); minLng = Math.min(minLng, p[1]); maxLng = Math.max(maxLng, p[1]); });
  const padPx = 26;
  const spanLat = Math.max(maxLat - minLat, 1e-7), spanLng = Math.max(maxLng - minLng, 1e-7);
  const kx = (w - padPx * 2) / spanLng, ky = (h - padPx * 2) / spanLat;
  const k = Math.min(kx, ky);
  const ox = (w - spanLng * k) / 2, oy = (h - spanLat * k) / 2;
  const X = lng => ox + (lng - minLng) * k, Y = lat => oy + (maxLat - lat) * k;
  // glow path
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#c8f542'); grad.addColorStop(1, '#3fe0c5');
  ctx.strokeStyle = grad; ctx.lineWidth = 4.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(200,245,66,.5)'; ctx.shadowBlur = 10;
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(X(p[1]), Y(p[0])) : ctx.moveTo(X(p[1]), Y(p[0])));
  ctx.stroke(); ctx.shadowBlur = 0;
  // start / end markers
  const s = points[0], e = points[points.length - 1];
  ctx.fillStyle = '#3fe0c5'; ctx.beginPath(); ctx.arc(X(s[1]), Y(s[0]), 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#07090d'; ctx.font = '900 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('S', X(s[1]), Y(s[0]) + 3);
  ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(X(e[1]), Y(e[0]), 7, 0, 7); ctx.fill();
  ctx.fillStyle = '#07090d'; ctx.fillText('E', X(e[1]), Y(e[0]) + 3);
}
function drawRing(steps, goal) {
  const C = 2 * Math.PI * 84;
  const frac = clamp(steps / Math.max(goal, 1), 0, 1);
  $('#ringFg').style.strokeDashoffset = C * (1 - frac);
}

/* ---------- navigation ---------- */
const SCREENS = ['home', 'workout', 'history', 'log', 'settings'];
function goto(name) {
  SCREENS.forEach(s => $('#screen-' + s).classList.toggle('active', s === name));
  $$('#tabbar .tab').forEach(t => t.classList.toggle('on', t.dataset.screen === name));
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'log') renderLog();
  if (name === 'workout') renderWorkoutIdle();
}

/* ============================================================
   STEP COUNTER — Generic Sensor API (Android Chrome) with
   DeviceMotion fallback. Peak detection on linear acceleration.
   ============================================================ */
const SENS_THRESH = { low: 1.7, medium: 1.15, high: 0.75 };

const StepCounter = {
  running: false, paused: false, mode: 'none', // 'linear' | 'gravity' | 'motion'
  _sensor: null, _onStep: null,
  _g: [0, 0, 0], _gInit: false,
  _smooth: 0, _inPeak: false, _peakMax: 0, _peakT: 0, _lastStep: 0,
  _stepTimes: [],

  threshold() { return SENS_THRESH[DB.profile.sensitivity] || SENS_THRESH.medium; },

  start(onStep) {
    if (this.running) return true;
    this._onStep = onStep;
    // 1) try LinearAccelerationSensor (gravity-free, best)
    if (this._trySensor('linear')) return true;
    // 2) try Accelerometer (gravity removed by filter)
    if (this._trySensor('gravity')) return true;
    // 3) DeviceMotion fallback
    if ('DeviceMotionEvent' in window) {
      this.mode = 'motion';
      this._motionHandler = e => {
        const a = e.accelerationIncludingGravity;
        if (a && a.x != null) this._feed(a.x, a.y, a.z, true);
      };
      window.addEventListener('devicemotion', this._motionHandler);
      this.running = true;
      setPill('live', 'Counting');
      return true;
    }
    this.mode = 'unsupported';
    setPill('off', 'No sensors');
    return false;
  },

  _trySensor(kind) {
    try {
      const Cls = kind === 'linear' ? window.LinearAccelerationSensor : window.Accelerometer;
      if (!Cls) return false;
      const s = new Cls({ frequency: 50 });
      s.addEventListener('reading', () => this._feed(s.x, s.y, s.z, kind === 'gravity'));
      s.addEventListener('error', ev => {
        console.warn('sensor error', ev.error && ev.error.name);
        if (ev.error && (ev.error.name === 'NotAllowedError' || ev.error.name === 'SecurityError')) {
          setPill('off', 'Blocked');
          toast('Motion sensor blocked — allow it in site settings (tap the lock icon in Chrome\'s address bar).');
        }
      });
      s.start();
      this._sensor = s; this.mode = kind; this.running = true;
      this._gInit = false; this._smooth = 0;
      setPill('live', 'Counting');
      return true;
    } catch (e) { console.warn(kind, 'sensor unavailable:', e && e.message); return false; }
  },

  _feed(x, y, z, removeGravity) {
    if (this.paused) return;
    let mag;
    if (removeGravity) {
      // low-pass to isolate gravity, subtract it
      if (!this._gInit) { this._g = [x, y, z]; this._gInit = true; }
      const a = 0.92;
      this._g[0] = a * this._g[0] + (1 - a) * x;
      this._g[1] = a * this._g[1] + (1 - a) * y;
      this._g[2] = a * this._g[2] + (1 - a) * z;
      const lx = x - this._g[0], ly = y - this._g[1], lz = z - this._g[2];
      mag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    } else {
      mag = Math.sqrt(x * x + y * y + z * z);
    }
    // exponential smoothing
    this._smooth = this._smooth === 0 ? mag : 0.55 * this._smooth + 0.45 * mag;
    const s = this._smooth, thr = this.threshold(), now = performance.now();
    if (!this._inPeak) {
      if (s > thr && now - this._lastStep > 240) { this._inPeak = true; this._peakMax = s; this._peakT = now; }
    } else {
      if (s > this._peakMax) this._peakMax = s;
      if (s < thr * 0.5) {
        const dur = now - this._peakT;
        this._inPeak = false;
        if (dur > 90 && dur < 1200 && this._peakMax > thr * 1.08) {
          this._lastStep = now;
          this._registerStep(now);
        }
      } else if (now - this._peakT > 1500) { this._inPeak = false; } // stale peak
    }
  },

  _registerStep(now) {
    this._stepTimes.push(now);
    const cut = now - 60000;
    while (this._stepTimes.length && this._stepTimes[0] < cut) this._stepTimes.shift();
    if (this._onStep) this._onStep();
  },

  cadence() { return this._stepTimes.length; }, // steps in last 60s

  setPaused(p) {
    this.paused = p;
    if (!this.running) return;
    setPill(p ? 'paused' : 'live', p ? 'Paused' : 'Counting');
  },

  stop() {
    try { if (this._sensor) this._sensor.stop(); } catch (e) {}
    if (this._motionHandler) window.removeEventListener('devicemotion', this._motionHandler);
    this._sensor = null; this._motionHandler = null; this.running = false;
    setPill('off', 'Off');
  }
};

function setPill(state, text) {
  const pill = $('#sensorPill');
  pill.classList.toggle('live', state === 'live');
  $('#pillText').textContent = text;
}

/* ---------- permissions ---------- */
async function ensureMotion() {
  // On Android Chrome motion sensors generally just work over HTTPS.
  const ok = StepCounter.start(onStepCounted);
  updatePermUI();
  return ok;
}
function ensureLocation() {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) { updatePermUI('unsupported'); return resolve(false); }
    navigator.geolocation.getCurrentPosition(
      () => { updatePermUI(); resolve(true); },
      err => {
        console.warn('geo denied', err);
        toast('Location permission denied — GPS tracking will be off. You can enable it later in Settings.');
        updatePermUI('denied'); resolve(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}
async function queryPermState(name) {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    const r = await navigator.permissions.query({ name });
    return r.state; // granted | denied | prompt
  } catch (e) { return 'unknown'; }
}
async function updatePermUI() {
  const motion = StepCounter.running ? 'granted' : await queryPermState('accelerometer');
  const loc = await queryPermState('geolocation');
  const mTxt = { granted: '✓ Enabled', denied: '✕ Blocked — enable in site settings', prompt: 'Not enabled yet', unknown: StepCounter.running ? '✓ Enabled' : 'Not enabled yet', unsupported: 'Not supported on this device' };
  const lTxt = { granted: '✓ Enabled', denied: '✕ Blocked — enable in site settings', prompt: 'Not enabled yet', unknown: 'Not enabled yet', unsupported: 'Not supported' };
  [['#motionStatus', mTxt[motion] || mTxt.unknown, motion === 'granted'],
   ['#motionStatus2', mTxt[motion] || mTxt.unknown, motion === 'granted'],
   ['#locStatus', lTxt[loc] || lTxt.unknown, loc === 'granted'],
   ['#locStatus2', lTxt[loc] || lTxt.unknown, loc === 'granted']].forEach(([sel, txt, ok]) => {
    const el = $(sel); if (!el) return;
    el.textContent = txt; el.classList.toggle('ok', !!ok);
  });
}

/* ---------- wake lock (keeps screen on during workouts) ---------- */
let wakeLock = null;
async function lockScreen() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => console.log('wakelock released'));
    }
  } catch (e) { console.warn('wakelock failed', e); }
}
function releaseScreen() {
  try { if (wakeLock) wakeLock.release(); } catch (e) {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Workout.state === 'active') lockScreen();
});

/* ============================================================
   WORKOUT ENGINE — GPS tracking, timer, live stats
   ============================================================ */
const Workout = {
  state: 'idle', // idle | active | paused
  type: 'walk',
  t0: 0, elapsed: 0, tickId: null,
  stepsStart: 0, stepsNow: 0,
  points: [], distKm: 0, distSrc: 'gps',
  watchId: null, lastMoveT: 0, autoPaused: false,
  curPace: 0,

  usesGps() { return this.type !== 'gym'; },

  start(type) {
    this.type = type;
    this.state = 'active';
    this.t0 = Date.now(); this.elapsed = 0;
    this.stepsStart = dayRec().steps; this.stepsNow = this.stepsStart;
    this.points = []; this.distKm = 0; this.distSrc = this.usesGps() ? 'gps' : 'steps';
    this.lastMoveT = Date.now(); this.autoPaused = false; this.curPace = 0;
    $('#workoutIdle').hidden = true;
    $('#workoutActive').hidden = false;
    $('#wTypeLabel').textContent = (TYPE_LABEL[type] || type).toUpperCase();
    $('#routeMap').style.display = this.usesGps() ? 'block' : 'none';
    $('#btnPause').textContent = 'Pause';
    lockScreen();
    if (this.usesGps()) this._startGps();
    this.tickId = setInterval(() => this._tick(), 1000);
    this._tick();
    toast(TYPE_LABEL[type] + ' started — go get it 💪');
  },

  _startGps() {
    if (!('geolocation' in navigator)) { this._gpsBadge('unsupported'); return; }
    this._gpsBadge('searching');
    try {
      this.watchId = navigator.geolocation.watchPosition(
        p => this._onFix(p), err => { console.warn('gps err', err); this._gpsBadge('denied'); },
        { enableHighAccuracy: true, maximumAge: 800, timeout: 15000 }
      );
    } catch (e) { this._gpsBadge('denied'); }
  },
  _gpsBadge(s) {
    const el = $('#wGpsState');
    el.textContent = { searching: 'GPS…', ok: '● GPS', denied: 'GPS off', unsupported: 'No GPS' }[s] || s;
    el.classList.toggle('ok', s === 'ok');
  },
  _onFix(p) {
    const c = p.coords;
    if (c.accuracy && c.accuracy > 30) return; // noisy fix
    const pt = { lat: c.latitude, lng: c.longitude, t: p.timestamp, acc: c.accuracy };
    const last = this.points[this.points.length - 1];
    if (!last) { this.points.push(pt); this._gpsBadge('ok'); this.lastMoveT = Date.now(); this._draw(); return; }
    const d = haversineKm(last, pt);
    if (d * 1000 < 2.5) return; // ignore jitter
    this.points.push(pt);
    if (this.state === 'active') { this.distKm += d; this.lastMoveT = Date.now(); }
    this._gpsBadge('ok');
    this._updatePace();
    this._draw();
  },
  _updatePace() {
    // rolling 45s window pace
    const now = Date.now(), win = [];
    for (let i = this.points.length - 1; i >= 0; i--) {
      if (now - this.points[i].t > 45000) break;
      win.unshift(this.points[i]);
    }
    if (win.length >= 2) {
      let d = 0;
      for (let i = 1; i < win.length; i++) d += haversineKm(win[i - 1], win[i]);
      const hrs = (win[win.length - 1].t - win[0].t) / 3600000;
      this.curPace = (d > 0.005 && hrs > 0) ? (hrs * 60) / d : 0;
    } else this.curPace = 0;
  },

  _tick() {
    if (this.state === 'active') {
      this.elapsed += 1;
      // auto-pause when stationary > 20s (GPS workouts)
      if (this.usesGps() && this.points.length > 3 && Date.now() - this.lastMoveT > 20000) {
        this.pause(true);
        toast('Auto-paused — no movement detected.');
      }
    }
    this.stepsNow = dayRec().steps;
    const steps = this.stepsNow - this.stepsStart;
    // distance fallback: estimate from steps when GPS has nothing yet
    let dist = this.distKm;
    let srcNote = '';
    if (this.distSrc === 'gps' && this.points.length < 2) {
      dist = steps * strideM() / 1000; srcNote = ' (est.)';
    }
    const hrs = this.elapsed / 3600;
    const kcal = this.usesGps()
      ? MET[this.type] * DB.profile.weight * hrs
      : metKcal('gym', this.elapsed / 60);
    $('#wTime').textContent = fmtDur(this.elapsed);
    $('#wDist').textContent = dist.toFixed(2) + srcNote;
    $('#wPace').textContent = this.usesGps() ? fmtPace(this.curPace) : fmtPace(steps > 10 && hrs > 0 ? (hrs * 60) / (steps * strideM() / 1000) : 0);
    $('#wSteps').textContent = fmtInt(steps);
    $('#wCal').textContent = fmtInt(kcal);
    this._live = { dist, kcal, steps };
  },

  _draw() {
    drawRoute($('#routeMap'), this.points.map(p => [p.lat, p.lng]), { emptyText: 'Waiting for GPS fix…' });
  },

  pause(auto) {
    if (this.state !== 'active') return;
    this.state = 'paused'; this.autoPaused = !!auto;
    $('#btnPause').textContent = 'Resume';
  },
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'active'; this.autoPaused = false;
    this.lastMoveT = Date.now();
    $('#btnPause').textContent = 'Pause';
    lockScreen();
  },
  togglePause() { this.state === 'active' ? this.pause(false) : this.resume(); },

  end() {
    clearInterval(this.tickId);
    if (this.watchId != null) { try { navigator.geolocation.clearWatch(this.watchId); } catch (e) {} this.watchId = null; }
    releaseScreen();
    const L = this._live || { dist: 0, kcal: 0, steps: 0 };
    this._summary = {
      type: this.type, durSec: this.elapsed,
      distKm: +L.dist.toFixed(3), steps: L.steps, kcal: Math.round(L.kcal),
      route: this.points.filter((_, i) => i % 2 === 0).map(p => [+p.lat.toFixed(6), +p.lng.toFixed(6)]),
      distSrc: this.distSrc
    };
    this.state = 'idle';
    $('#workoutActive').hidden = true;
    // summary sheet
    const s = this._summary;
    $('#sumStats').innerHTML = [
      [fmtDur(s.durSec), 'duration'], [s.distKm.toFixed(2) + ' km', 'distance'],
      [fmtInt(s.steps), 'steps'], [fmtInt(s.kcal), 'kcal'],
    ].map(([v, l]) => `<div><div class="w-val">${v}</div><div class="w-lbl">${l}</div></div>`).join('');
    drawRoute($('#sumMap'), s.route);
    $('#workoutSummary').hidden = false;
  },

  abort() {
    clearInterval(this.tickId);
    if (this.watchId != null) { try { navigator.geolocation.clearWatch(this.watchId); } catch (e) {} this.watchId = null; }
    releaseScreen();
    this.state = 'idle';
    $('#workoutActive').hidden = true;
    $('#workoutIdle').hidden = false;
    renderWorkoutIdle();
  },

  save() {
    const s = this._summary;
    const rec = dayRec();
    rec.workoutDist += s.distKm;
    rec.workoutKcal += s.kcal;
    rec.activeMin += Math.max(1, Math.round(s.durSec / 60));
    DB.workouts.unshift(Object.assign({ id: 'w' + Date.now(), date: dayKey() }, s));
    saveDB();
    $('#workoutSummary').hidden = true;
    $('#workoutIdle').hidden = false;
    renderWorkoutIdle(); renderHome();
    toast('Workout saved 🎉');
  },

  discard() {
    $('#workoutSummary').hidden = true;
    $('#workoutIdle').hidden = false;
    renderWorkoutIdle();
    toast('Workout discarded.');
  }
};

function renderWorkoutIdle() {
  const w = DB.workouts[0];
  $('#lastWorkout').innerHTML = w
    ? `<div class="day-row"><span class="d">${TYPE_LABEL[w.type] || w.type} · ${w.date}</span><span class="v">${w.distKm.toFixed(2)} km <small>· ${fmtDur(w.durSec)} · ${fmtInt(w.kcal)} kcal</small></span></div>`
    : '<div class="empty-note">Nothing logged yet.</div>';
}

/* ---------- step hookup ---------- */
let lastHomePaint = 0;
function onStepCounted() {
  const rec = dayRec();
  rec.steps += 1;
  saveDB();
  const now = performance.now();
  if ($('#screen-home').classList.contains('active') && now - lastHomePaint > 900) {
    lastHomePaint = now;
    paintHomeNumbers();
  }
}

/* ============================================================
   RENDERING
   ============================================================ */
function paintHomeNumbers() {
  const t = dayTotals(), goal = DB.profile.goal;
  $('#stepsNow').textContent = fmtInt(t.steps);
  $('#goalSub').textContent = 'of ' + fmtInt(goal) + ' goal';
  drawRing(t.steps, goal);
  $('#statDist').textContent = t.dist.toFixed(1);
  $('#statCal').textContent = fmtInt(t.kcal);
  $('#statActive').textContent = Math.round(t.active);
}
function renderHome() {
  $('#todayDate').textContent = fmtDateLong();
  paintHomeNumbers();
  // week mini chart (last 7 days)
  const labels = [], vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    labels.push(i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'narrow' }));
    vals.push(dayTotals(k).steps);
  }
  drawBars($('#weekMini'), labels, vals, { height: 110, highlight: 6, gap: 10 });
  // today's workouts
  const k = dayKey();
  const list = DB.workouts.filter(w => w.date === k);
  $('#todayWorkouts').innerHTML = list.length ? list.map(w => `
    <div class="day-row"><span class="d">${TYPE_LABEL[w.type] || w.type}</span>
    <span class="v">${w.distKm.toFixed(2)} km <small>· ${fmtDur(w.durSec)} · ${fmtInt(w.kcal)} kcal</small></span></div>`).join('')
    : '<div class="empty-note">No workouts yet today. Hit Start and go move.</div>';
}

let histMetric = 'steps';
const METRIC_FMT = {
  steps: v => fmtInt(v),
  distanceKm: v => v.toFixed(1) + ' km',
  calories: v => fmtInt(v) + ' kcal'
};
const METRIC_KEY = { steps: 'steps', distanceKm: 'dist', calories: 'kcal' };
function renderHistory() {
  const labels = [], vals = [];
  let total = 0;
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d), t = dayTotals(k);
    labels.push(i === 0 ? 'Tdy' : d.toLocaleDateString('en-IN', { weekday: 'narrow' }));
    const v = t[METRIC_KEY[histMetric]];
    vals.push(v); total += v;
  }
  drawBars($('#weekChart'), labels, vals.slice(-14), { height: 160, highlight: 13, gap: 6 });
  $('#chartTotal').innerHTML = `Last 14 days total: <b>${METRIC_FMT[histMetric](total)}</b>`;
  // day list (last 14)
  let html = '';
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = dayKey(d), t = dayTotals(k);
    html += `<div class="day-row"><span class="d">${i === 0 ? 'Today' : fmtDateLong(d)}</span>
      <span class="v">${fmtInt(t.steps)} <small>steps · ${t.dist.toFixed(1)} km · ${fmtInt(t.kcal)} kcal</small></span></div>`;
  }
  $('#dayList').innerHTML = html;
  // workouts
  const ws = DB.workouts.slice(0, 20);
  $('#workoutList').innerHTML = ws.length ? ws.map((w, i) => `
    <div class="wo-card">
      <div class="wo-top"><span class="wo-type">${(TYPE_LABEL[w.type] || w.type).toUpperCase()}</span><span class="wo-date">${w.date}</span></div>
      <div class="wo-stats"><span><b>${w.distKm.toFixed(2)}</b> km</span><span><b>${fmtDur(w.durSec)}</b></span><span><b>${fmtInt(w.steps)}</b> steps</span><span><b>${fmtInt(w.kcal)}</b> kcal</span></div>
      ${w.route && w.route.length > 1 ? `<canvas class="wo-route" data-i="${i}" style="width:100%;height:110px;margin-top:10px;border-radius:10px"></canvas>` : ''}
    </div>`).join('')
    : '<div class="empty-note">No workouts recorded yet.</div>';
  $$('#workoutList .wo-route').forEach(cv => {
    const w = ws[+cv.dataset.i];
    drawRoute(cv, w.route, { height: 110, emptyText: '' });
  });
}

function renderLog() {
  const k = dayKey();
  const list = DB.manual.filter(m => m.date === k);
  $('#logList').innerHTML = list.length ? list.map(m => `
    <div class="log-row"><div><div class="t">${TYPE_LABEL[m.type] || m.type}</div>
    <div class="s">${m.minutes} min · ${m.intensity} · ${fmtInt(m.kcal)} kcal</div></div>
    <button class="log-del" data-id="${m.id}" title="Delete">×</button></div>`).join('')
    : '<div class="empty-note">Nothing logged manually today.</div>';
  $$('#logList .log-del').forEach(b => b.onclick = () => {
    const m = DB.manual.find(x => x.id === b.dataset.id);
    DB.manual = DB.manual.filter(x => x.id !== b.dataset.id);
    if (m && m.date === dayKey()) {
      const rec = dayRec();
      rec.manualKcal = Math.max(0, rec.manualKcal - m.kcal);
      rec.manualMin = Math.max(0, rec.manualMin - m.minutes);
    }
    saveDB(); renderLog(); renderHome();
    toast('Entry removed.');
  });
}

function renderSettings() {
  $('#setGoal').value = DB.profile.goal;
  $('#setWeight').value = DB.profile.weight;
  $('#setHeight').value = DB.profile.height || '';
  $('#setSens').value = DB.profile.sensitivity;
}

/* ============================================================
   ONBOARDING
   ============================================================ */
let obSlide = 0;
function showOnboarding() {
  $('#onboarding').hidden = false;
  $('#app').hidden = true;
  setObSlide(0);
}
function setObSlide(i) {
  obSlide = clamp(i, 0, 2);
  document.querySelector('.ob-track').style.transform = `translateX(-${obSlide * 100}%)`;
  $$('.ob-dots span').forEach((d, j) => d.classList.toggle('on', j === obSlide));
  $('#obBack').disabled = obSlide === 0;
  $('#obNext').textContent = obSlide === 2 ? 'Start tracking →' : 'Continue';
}
function finishOnboarding() {
  DB.profile.goal = clamp(parseInt($('#obGoal').value) || 10000, 1000, 50000);
  DB.profile.weight = clamp(parseFloat($('#obWeight').value) || 70, 30, 200);
  DB.profile.sensitivity = $('#obSens').value;
  DB.onboarded = true;
  saveDBNow();
  $('#onboarding').hidden = true;
  $('#app').hidden = false;
  enterApp();
}
function enterApp() {
  renderSettings();
  goto('home');
  ensureMotion();
  updatePermUI();
}

/* ============================================================
   PWA
   ============================================================ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $('#installBtn');
  if (b) b.hidden = false;
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)));
}

/* ---------- midnight rollover ---------- */
setInterval(() => {
  const k = dayKey();
  if (!window._strideDay || window._strideDay !== k) {
    window._strideDay = k;
    dayRec(k);
    if (!$('#app').hidden) renderHome();
  }
}, 30000);

/* ============================================================
   WIRING + INIT
   ============================================================ */
function wire() {
  // tabs
  $$('#tabbar .tab').forEach(t => t.onclick = () => goto(t.dataset.screen));
  $$('[data-goto]').forEach(el => el.onclick = () => goto(el.dataset.goto));
  $('#btnStartWorkout').onclick = () => goto('workout');
  // sensor pill: tap to pause/resume counting
  $('#sensorPill').onclick = () => {
    if (!StepCounter.running) { ensureMotion(); return; }
    StepCounter.setPaused(!StepCounter.paused);
    toast(StepCounter.paused ? 'Step counting paused.' : 'Step counting resumed.');
  };
  // onboarding
  $('#obBack').onclick = () => setObSlide(obSlide - 1);
  $('#obNext').onclick = () => obSlide === 2 ? finishOnboarding() : setObSlide(obSlide + 1);
  $('#permMotion').onclick = async () => { toast('Starting motion sensors…'); await ensureMotion(); };
  $('#permLocation').onclick = async () => { toast('Requesting location…'); await ensureLocation(); };
  $('#permMotion2').onclick = async () => { await ensureMotion(); };
  $('#permLocation2').onclick = async () => { await ensureLocation(); };
  // workout
  $$('#wtypeChips .chip').forEach(c => c.onclick = () => {
    $$('#wtypeChips .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
  });
  $('#workoutStart').onclick = () => {
    const t = ($('#wtypeChips .chip.on') || {}).dataset.type || 'walk';
    Workout.start(t);
  };
  $('#btnPause').onclick = () => Workout.togglePause();
  $('#btnEnd').onclick = () => {
    if (Workout.elapsed < 10) { Workout.abort(); toast('Workout too short — discarded.'); }
    else Workout.end();
  };
  $('#btnSaveWorkout').onclick = () => Workout.save();
  $('#btnDiscardWorkout').onclick = () => Workout.discard();
  // history metric chips
  $$('#metricChips .chip').forEach(c => c.onclick = () => {
    $$('#metricChips .chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    histMetric = c.dataset.metric;
    renderHistory();
  });
  // log
  $('#logSave').onclick = () => {
    const type = $('#logType').value;
    const minutes = clamp(parseInt($('#logDur').value) || 0, 1, 600);
    const intensity = $('#logIntensity').value;
    const kcal = Math.round(metKcal(type, minutes, intensity));
    DB.manual.unshift({ id: 'm' + Date.now(), date: dayKey(), type, minutes, intensity, kcal });
    const rec = dayRec();
    rec.manualKcal += kcal; rec.manualMin += minutes;
    saveDB(); renderLog(); renderHome();
    toast(`${TYPE_LABEL[type]} logged: ${minutes} min, ~${fmtInt(kcal)} kcal`);
  };
  // settings
  const prof = () => DB.profile;
  $('#setGoal').onchange = e => { prof().goal = clamp(parseInt(e.target.value) || 10000, 1000, 50000); saveDB(); renderHome(); };
  $('#setWeight').onchange = e => { prof().weight = clamp(parseFloat(e.target.value) || 70, 30, 200); saveDB(); renderHome(); };
  $('#setHeight').onchange = e => { const v = parseInt(e.target.value); prof().height = v >= 120 && v <= 230 ? v : null; saveDB(); renderHome(); };
  $('#setSens').onchange = e => { prof().sensitivity = e.target.value; saveDB(); toast('Sensitivity updated.'); };
  $('#installBtn').onclick = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; }
    else toast('Use Chrome\'s menu → "Add to Home screen" / "Install app".');
  };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stride-backup-' + dayKey() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup downloaded.');
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || d.v !== 1 || !d.profile) throw new Error('bad file');
        DB = Object.assign({}, DEFAULTS, d);
        DB.profile = Object.assign({}, DEFAULTS.profile, d.profile);
        saveDBNow(); renderSettings(); renderHome(); renderHistory(); renderLog();
        toast('Backup restored.');
      } catch (err) { toast('That file is not a valid Stride backup.'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  $('#eraseBtn').onclick = () => {
    if (confirm('Erase ALL Stride data on this phone? This cannot be undone.')) {
      localStorage.removeItem(DB_KEY);
      location.reload();
    }
  };
  window.addEventListener('resize', () => {
    if ($('#screen-home').classList.contains('active')) renderHome();
    if ($('#screen-history').classList.contains('active')) renderHistory();
  });
}

function init() {
  loadDB();
  window._strideDay = dayKey();
  dayRec();
  wire();
  setTimeout(() => {
    $('#splash').classList.add('hide');
    setTimeout(() => $('#splash').remove(), 600);
    if (DB.onboarded) { $('#app').hidden = false; enterApp(); }
    else showOnboarding();
  }, 700);
}

// debug handle
window.__stride = { get DB() { return DB; }, StepCounter, Workout };
document.addEventListener('DOMContentLoaded', init);
