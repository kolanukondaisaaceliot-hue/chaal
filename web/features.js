'use strict';
/* ============================================================
   STRIDE v1.1 — feature pack
   Streaks & achievements · shareable workout cards · voice coach ·
   custom workout types · native step-service wiring · Health Connect UI
   Loaded after app.js; hooks into its globals without edits.
   ============================================================ */
(function () {

/* ---------- DB migration for new keys ---------- */
function migrateDB() {
  DB.streaks = Object.assign({ current: 0, longest: 0 }, DB.streaks || {});
  DB.achievements = DB.achievements || {};
  DB.stats = Object.assign({ totalWorkouts: 0, totalDistKm: 0 }, DB.stats || {});
  DB.voice = Object.assign({ enabled: false, mode: 'distance', distKm: 1, timeMin: 5 }, DB.voice || {});
  DB.customTypes = Array.isArray(DB.customTypes) ? DB.customTypes : [];
  if (typeof DB.healthSync === 'undefined') DB.healthSync = false;
}

/* ============================================================
   STREAKS
   ============================================================ */
function updateStreaks() {
  const goal = DB.profile.goal || 10000;
  let cur = 0;
  const d = new Date();
  d.setDate(d.getDate() - 1); // start from yesterday (today may be incomplete)
  for (let i = 0; i < 365; i++) {
    const k = dayKey(d);
    const s = (DB.days[k] || { steps: 0 }).steps;
    if (s >= goal) { cur++; d.setDate(d.getDate() - 1); }
    else break;
  }
  if (dayTotals().steps >= goal) cur++; // today already hit
  DB.streaks.current = cur;
  DB.streaks.longest = Math.max(DB.streaks.longest || 0, cur);
}

/* ============================================================
   ACHIEVEMENTS
   ============================================================ */
function bestDaySteps() {
  let m = 0;
  for (const k in DB.days) m = Math.max(m, DB.days[k].steps || 0);
  return m;
}
function stepsLast7() {
  let t = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    t += dayTotals(dayKey(d)).steps;
  }
  return t;
}
function weekTypeSet() {
  const set = new Set(), now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  DB.workouts.forEach(w => {
    const wd = new Date(w.date + 'T12:00:00');
    if (wd >= weekStart) set.add(w.type);
  });
  return set;
}
const ACH = [
  { id: 'first-steps', icon: '👣', name: 'First Steps', desc: 'Reach 1,000 steps in a day', check: () => bestDaySteps() >= 1000 },
  { id: 'goal-crusher', icon: '🎯', name: 'Goal Crusher', desc: 'Hit your daily step goal', check: () => bestDaySteps() >= (DB.profile.goal || 10000) },
  { id: 'streak-7', icon: '🔥', name: 'On Fire', desc: '7-day goal streak', check: () => DB.streaks.longest >= 7 },
  { id: 'streak-30', icon: '🔥', name: 'Unstoppable', desc: '30-day goal streak', check: () => DB.streaks.longest >= 30 },
  { id: 'first-workout', icon: '🏁', name: 'Off the Couch', desc: 'Complete your first workout', check: () => DB.stats.totalWorkouts >= 1 },
  { id: 'workout-10', icon: '💪', name: 'Getting Serious', desc: 'Complete 10 workouts', check: () => DB.stats.totalWorkouts >= 10 },
  { id: 'workout-50', icon: '🏆', name: 'Athlete', desc: 'Complete 50 workouts', check: () => DB.stats.totalWorkouts >= 50 },
  { id: 'marathon', icon: '🏃', name: 'Marathoner', desc: 'Cover 42.2 km across workouts', check: () => DB.stats.totalDistKm >= 42.2 },
  { id: 'early-bird', icon: '🌅', name: 'Early Bird', desc: 'Work out before 7 AM', check: () => DB._flags && DB._flags.earlyBird },
  { id: 'night-owl', icon: '🌙', name: 'Night Owl', desc: 'Work out after 10 PM', check: () => DB._flags && DB._flags.nightOwl },
  { id: 'triple-crown', icon: '👑', name: 'Triple Crown', desc: 'Walk, run and ride in one week', check: () => { const s = weekTypeSet(); return s.has('walk') && s.has('run') && s.has('cycle'); } },
  { id: 'big-week', icon: '📊', name: 'Big Week', desc: '50,000 steps in 7 days', check: () => stepsLast7() >= 50000 },
];
function checkAchievements() {
  let changed = false;
  ACH.forEach(a => {
    if (!DB.achievements[a.id]) {
      try {
        if (a.check()) {
          DB.achievements[a.id] = dayKey();
          changed = true;
          setTimeout(() => toast('🏆 Achievement unlocked: ' + a.name + '!'), 600);
        }
      } catch (e) {}
    }
  });
  if (changed) saveDB();
}
function paintStreakBar() {
  const bar = $('#streakBar'); if (!bar) return;
  bar.hidden = false;
  $('#streakN').textContent = DB.streaks.current || 0;
  const unlocked = Object.keys(DB.achievements).length;
  $('#achN').textContent = unlocked;
  $('#achTotal').textContent = ACH.length;
}
function renderAchGrid() {
  const g = $('#achGrid'); if (!g) return;
  g.innerHTML = ACH.map(a => {
    const un = DB.achievements[a.id];
    return `<div class="ach ${un ? 'un' : 'lock'}">
      <div class="ach-ico">${a.icon}</div>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${un ? 'Earned ' + a.desc.charAt(0).toLowerCase() + a.desc.slice(1) : a.desc}</div>
      ${un ? `<div class="ach-date">${DB.achievements[a.id]}</div>` : ''}
    </div>`;
  }).join('');
}

/* ============================================================
   SHAREABLE WORKOUT CARDS — 1080x1350 PNG, Web Share API w/ download fallback
   ============================================================ */
function drawShareCard(cv, w) {
  const W = 1080, H = 1350;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b0f15'); bg.addColorStop(1, '#07090d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // dotted texture
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let x = 30; x < W; x += 44) for (let y = 30; y < H; y += 44) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
  // lime glow top
  const glow = ctx.createRadialGradient(W / 2, -60, 40, W / 2, -60, 620);
  glow.addColorStop(0, 'rgba(200,245,66,.22)'); glow.addColorStop(1, 'rgba(200,245,66,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 620);
  const cx = c => { ctx.textAlign = 'center'; };
  // brand
  ctx.fillStyle = '#c8f542';
  ctx.font = '900 44px -apple-system, Segoe UI, Roboto, sans-serif';
  cx(); ctx.fillText('C H A A L', W / 2, 110);
  // type + date
  ctx.fillStyle = '#f2f5f7';
  ctx.font = '800 84px -apple-system, Segoe UI, Roboto, sans-serif';
  const label = (TYPE_LABEL[w.type] || w.type).toUpperCase();
  ctx.fillText(label, W / 2, 220);
  ctx.fillStyle = '#8b98a8';
  ctx.font = '500 38px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(w.date, W / 2, 280);
  // route mini-map
  const pts = w.route || [];
  if (pts.length > 1) {
    const mw = 880, mh = 420, mx = (W - mw) / 2, my = 340;
    let minLat = 1e9, maxLat = -1e9, minLng = 1e9, maxLng = -1e9;
    pts.forEach(p => { minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]); minLng = Math.min(minLng, p[1]); maxLng = Math.max(maxLng, p[1]); });
    const pad = 40, kx = (mw - pad * 2) / Math.max(maxLng - minLng, 1e-7), ky = (mh - pad * 2) / Math.max(maxLat - minLat, 1e-7);
    const k = Math.min(kx, ky), ox = mx + (mw - (maxLng - minLng) * k) / 2, oy = my + (mh - (maxLat - minLat) * k) / 2;
    const X = lng => ox + (lng - minLng) * k, Y = lat => oy + (maxLat - lat) * k;
    const grad = ctx.createLinearGradient(mx, my, mx + mw, my + mh);
    grad.addColorStop(0, '#c8f542'); grad.addColorStop(1, '#3fe0c5');
    ctx.strokeStyle = grad; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(200,245,66,.5)'; ctx.shadowBlur = 24;
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(X(p[1]), Y(p[0])) : ctx.moveTo(X(p[1]), Y(p[0])));
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  // stats grid
  const stats = [
    [(w.distKm || 0).toFixed(2), 'KM'],
    [fmtDur(w.durSec || 0), 'TIME'],
    [fmtInt(w.steps || 0), 'STEPS'],
    [fmtInt(w.kcal || 0), 'KCAL'],
  ];
  const gy = pts.length > 1 ? 860 : 480;
  ctx.textAlign = 'center';
  stats.forEach((s, i) => {
    const x = W / 2 + (i % 2 === 0 ? -240 : 240), y = gy + Math.floor(i / 2) * 220;
    ctx.fillStyle = '#c8f542';
    ctx.font = '800 76px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(String(s[0]), x, y);
    ctx.fillStyle = '#5b6776';
    ctx.font = '700 30px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(s[1], x, y + 52);
  });
  // footer
  ctx.fillStyle = '#5b6776';
  ctx.font = '500 32px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('Tracked privately with Chaal · no cloud, no ads', W / 2, H - 90);
  return cv;
}
function shareWorkout(w) {
  if (!w) return;
  try {
    const cv = document.createElement('canvas');
    drawShareCard(cv, w);
    cv.toBlob(async blob => {
      if (!blob) { toast('Could not create the card.'); return; }
      const file = new File([blob], 'chaal-workout-' + w.date + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'My Chaal workout' }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chaal-workout-' + w.date + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Card downloaded — share it anywhere 📤');
    }, 'image/png');
  } catch (e) { toast('Sharing is not available here.'); }
}

/* ============================================================
   VOICE COACH — spoken updates during workouts (speechSynthesis)
   ============================================================ */
const Voice = {
  _lastDistMark: 0, _lastTimeMark: 0,
  reset() { this._lastDistMark = 0; this._lastTimeMark = 0; },
  speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  },
  fmtPaceSpoken(minPerKm) {
    if (!isFinite(minPerKm) || minPerKm <= 0 || minPerKm > 60) return null;
    const m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
    return m + ' minutes ' + s + ' seconds per kilometre';
  },
  announce(distKm, elapsedSec, pace) {
    const mins = Math.floor(elapsedSec / 60);
    let t = 'Distance ' + distKm.toFixed(1) + ' kilometres. Time ' + mins + ' minutes.';
    const p = this.fmtPaceSpoken(pace);
    if (p) t += ' Pace ' + p + '.';
    this.speak(t);
  },
  // called every few seconds from the workout loop
  maybeAnnounce() {
    if (!DB.voice.enabled || Workout.state !== 'active') return;
    const L = Workout._live || { dist: 0 };
    const dist = L.dist || 0, t = Workout.elapsed || 0;
    if (DB.voice.mode === 'distance') {
      const mark = Math.floor(dist / DB.voice.distKm);
      if (mark > this._lastDistMark) { this._lastDistMark = mark; this.announce(dist, t, Workout.curPace); }
    } else {
      const mark = Math.floor(t / (DB.voice.timeMin * 60));
      if (mark > this._lastTimeMark) { this._lastTimeMark = mark; this.announce(dist, t, Workout.curPace); }
    }
  }
};

/* ============================================================
   CUSTOM WORKOUT TYPES
   ============================================================ */
const DEFAULT_TYPES = [
  { id: 'walk', label: 'Walk', icon: '🚶', gps: true, met: 3.5 },
  { id: 'run', label: 'Run', icon: '🏃', gps: true, met: 9.8 },
  { id: 'cycle', label: 'Ride', icon: '🚴', gps: true, met: 7.5 },
  { id: 'gym', label: 'Gym', icon: '🏋️', gps: false, met: 6.0 },
];
const CUSTOM_ICONS = ['🏋️', '🧘', '🏊', '🚴', '🏃', '🤸', '🥋', '🧗', '⛹️', '🏸', '⚽', '💃', '🚶', '🏌️'];
function allTypes() { return DEFAULT_TYPES.concat(DB.customTypes); }
function typeMeta(id) {
  const t = allTypes().find(x => x.id === id);
  return t || { id, label: TYPE_LABEL[id] || id, icon: '🏅', gps: id !== 'gym', met: MET[id] || 4.5 };
}
function metFor(id) { return typeMeta(id).met; }
function patchTypes() {
  // extend global lookups + gps rule for custom types
  DB.customTypes.forEach(t => { TYPE_LABEL[t.id] = t.label; MET[t.id] = t.met; });
  const origUsesGps = Workout.usesGps.bind(Workout);
  Workout.usesGps = function () {
    const c = DB.customTypes.find(x => x.id === this.type);
    return c ? !!c.gps : origUsesGps();
  };
}
function renderTypeChips() {
  const box = $('#wtypeChips'); if (!box) return;
  box.innerHTML = allTypes().map((t, i) =>
    `<button class="chip ${i === 0 ? 'on' : ''}" data-type="${t.id}">${t.icon} ${t.label}</button>`).join('');
  Array.from(box.querySelectorAll('.chip')).forEach(c => c.onclick = () => {
    Array.from(box.querySelectorAll('.chip')).forEach(x => x.classList.remove('on'));
    c.classList.add('on');
  });
}
function renderCustomTypeList() {
  const box = $('#customTypeList'); if (!box) return;
  if (!DB.customTypes.length) { box.innerHTML = '<div class="empty-note">No custom types yet.</div>'; return; }
  box.innerHTML = DB.customTypes.map(t => `
    <div class="type-row"><span>${t.icon} <b>${t.label}</b> <small>${t.gps ? '· GPS' : '· no GPS'} · ${t.met} MET</small></span>
    <button class="log-del" data-id="${t.id}" title="Delete">×</button></div>`).join('');
  Array.from(box.querySelectorAll('.log-del')).forEach(b => b.onclick = () => {
    DB.customTypes = DB.customTypes.filter(x => x.id !== b.dataset.id);
    delete TYPE_LABEL[b.dataset.id]; delete MET[b.dataset.id];
    saveDB(); renderCustomTypeList(); renderTypeChips();
    toast('Workout type removed.');
  });
}

/* ============================================================
   NATIVE STEP-SERVICE WIRING (APK) — show the foreground
   service's hardware count in the web UI instead of web sensors
   ============================================================ */
const NativeSteps = {
  timer: null,
  get active() { return !!(window.StrideNative && window.__strideNative); },
  start() {
    if (this.timer) return;
    const poll = () => {
      try {
        const n = StrideNative.getSteps();
        if (typeof n === 'number' && n >= 0) {
          const rec = dayRec();
          if (n > rec.steps) {
            rec.steps = n; saveDB();
            if ($('#screen-home') && $('#screen-home').classList.contains('active')) paintHomeNumbers();
          }
        }
      } catch (e) {}
    };
    poll();
    this.timer = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
    setPill('live', 'Native');
  }
};

/* ============================================================
   HEALTH CONNECT UI (native bridge provided by the APK)
   ============================================================ */
function hcAvailable() {
  try { return NativeSteps.active && typeof StrideNative.getHealthStatus === 'function'; }
  catch (e) { return false; }
}
function refreshHC() {
  const st = $('#hcStatus'), btn = $('#hcBtn');
  if (!st || !btn) return;
  if (!hcAvailable()) {
    st.textContent = 'Available in the Chaal Android app.';
    st.classList.remove('ok'); btn.hidden = true;
    return;
  }
  btn.hidden = false;
  let s = 'off';
  try { s = StrideNative.getHealthStatus(); } catch (e) {}
  const label = {
    unavailable: 'Health Connect is not installed on this phone.',
    disabled: 'Sync is off.',
    needs_permission: 'Waiting for Health Connect permission.',
    ready: 'Connected — steps & workouts sync to Health Connect.'
  }[s] || s;
  st.textContent = label;
  st.classList.toggle('ok', s === 'ready');
  btn.textContent = (s === 'ready' || s === 'needs_permission') ? 'Disconnect' : 'Connect Health Connect';
  btn.onclick = () => {
    try {
      if (s === 'ready' || s === 'needs_permission') {
        StrideNative.setHealthSync(false); DB.healthSync = false; saveDB();
        toast('Health Connect sync turned off.');
      } else {
        StrideNative.setHealthSync(true); DB.healthSync = true; saveDB();
        toast('Connecting to Health Connect…');
      }
    } catch (e) { toast('Could not reach Health Connect.'); }
    setTimeout(refreshHC, 2500);
  };
}

/* ============================================================
   HOOKS into app.js + INIT
   ============================================================ */
let stepCheckN = 0;
function hookIntoApp() {
  // achievements on steps (throttled), workouts, day changes
  const _onStep = onStepCounted;
  onStepCounted = function () {
    _onStep();
    if (++stepCheckN % 200 === 0) checkAchievements();
  };
  const _save = Workout.save.bind(Workout);
  Workout.save = function () {
    const hr = this.elapsed / 3600, h = new Date().getHours();
    DB._flags = DB._flags || {};
    if (h < 7) DB._flags.earlyBird = true;
    if (h >= 22) DB._flags.nightOwl = true;
    const w = this._summary;
    DB.stats.totalWorkouts++;
    DB.stats.totalDistKm += (w && w.distKm) || 0;
    _save();
    // push to Health Connect in the native app
    try {
      if (NativeSteps.active && DB.healthSync && typeof StrideNative.logWorkout === 'function' && w) {
        StrideNative.logWorkout(JSON.stringify({
          type: this.type, durSec: w.durSec, distKm: w.distKm, steps: w.steps, kcal: w.kcal,
          date: dayKey(), endTime: Date.now()
        }));
      }
    } catch (e) {}
    if (DB.voice.enabled) Voice.speak('Workout complete. Well done.');
    checkAchievements();
    paintStreakBar(); renderAchGrid();
  };
  const _start = Workout.start.bind(Workout);
  Workout.start = function (t) {
    Voice.reset();
    _start(t);
    if (DB.voice.enabled) Voice.speak(typeMeta(this.type).label + ' workout started.');
  };
  const _pause = Workout.pause.bind(Workout);
  Workout.pause = function (a) { _pause(a); if (DB.voice.enabled && !a) Voice.speak('Workout paused.'); };
  const _resume = Workout.resume.bind(Workout);
  Workout.resume = function () { _resume(); if (DB.voice.enabled) Voice.speak('Workout resumed.'); };
  const _end = Workout.end.bind(Workout);
  Workout.end = function () { _end(); if (DB.voice.enabled) Voice.speak('Workout finished.'); };
  const _abort = Workout.abort.bind(Workout);
  Workout.abort = function () { _abort(); try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} };
  // voice announcements on a light interval
  setInterval(() => Voice.maybeAnnounce(), 4000);
  // day-change watcher: streaks + achievements
  let lastDay = dayKey();
  setInterval(() => {
    const k = dayKey();
    if (k !== lastDay) {
      lastDay = k; updateStreaks(); checkAchievements();
      paintStreakBar(); renderAchGrid();
      if ($('#screen-home').classList.contains('active')) renderHome();
    }
  }, 30000);
  // home/history extras
  const _rh = renderHome;
  renderHome = function () { _rh(); paintStreakBar(); };
  const _rhi = renderHistory;
  renderHistory = function () { _rhi(); renderAchGrid(); injectShareButtons(); };
  // native step service instead of web sensors inside the APK
  if (NativeSteps.active) {
    const _em = ensureMotion;
    ensureMotion = async function () { NativeSteps.start(); updatePermUI(); return true; };
  }
}
function injectShareButtons() {
  // share button on each history workout card
  const cards = document.querySelectorAll('#workoutList .wo-card');
  cards.forEach((card, i) => {
    if (card.querySelector('.share-btn')) return;
    const w = DB.workouts[i]; if (!w) return;
    const top = card.querySelector('.wo-top'); if (!top) return;
    const b = document.createElement('button');
    b.className = 'share-btn'; b.title = 'Share workout card'; b.textContent = '⤴';
    b.onclick = ev => { ev.stopPropagation(); shareWorkout(w); };
    top.appendChild(b);
  });
}
function wireFeaturesUI() {
  // summary sheet share button
  const sb = $('#btnShareWorkout');
  if (sb) sb.onclick = () => { if (Workout._summary) shareWorkout(Object.assign({ date: dayKey(), type: Workout.type }, Workout._summary)); };
  // voice settings
  const ve = $('#voiceEnabled');
  if (ve) {
    ve.checked = !!DB.voice.enabled;
    const vs = $('#voiceStatus');
    const paintVoice = () => { if (vs) { vs.textContent = ve.checked ? '✓ On' : 'Off'; vs.classList.toggle('ok', ve.checked); } };
    paintVoice();
    ve.onchange = () => { DB.voice.enabled = ve.checked; saveDB(); paintVoice(); toast(ve.checked ? 'Voice coach on 🔊' : 'Voice coach off.'); };
  }
  const vm = $('#voiceMode');
  if (vm) {
    vm.value = DB.voice.mode;
    vm.onchange = () => { DB.voice.mode = vm.value; $('#voiceDistRow').hidden = vm.value !== 'distance'; $('#voiceTimeRow').hidden = vm.value !== 'time'; saveDB(); };
    vm.dispatchEvent(new Event('change'));
  }
  const vd = $('#voiceDist'), vt = $('#voiceTime');
  if (vd) { vd.value = DB.voice.distKm; vd.onchange = () => { DB.voice.distKm = parseFloat(vd.value) || 1; saveDB(); }; }
  if (vt) { vt.value = DB.voice.timeMin; vt.onchange = () => { DB.voice.timeMin = parseInt(vt.value) || 5; saveDB(); }; }
  const vtest = $('#voiceTest');
  if (vtest) vtest.onclick = () => Voice.speak('Chaal voice coach. You are doing great, keep moving.');
  // custom types
  renderCustomTypeList();
  const addBtn = $('#addTypeBtn');
  if (addBtn) addBtn.onclick = () => {
    const label = ($('#newTypeName').value || '').trim();
    if (!label) { toast('Give the workout a name first.'); return; }
    const id = 'c_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36);
    const icon = $('#newTypeIcon').value || '🏅';
    const gps = $('#newTypeGps').checked;
    const met = parseFloat($('#newTypeMet').value) || 4.5;
    DB.customTypes.push({ id, label, icon, gps, met });
    TYPE_LABEL[id] = label; MET[id] = met;
    $('#newTypeName').value = '';
    saveDB(); renderCustomTypeList(); renderTypeChips();
    toast(label + ' added to your workout types.');
  };
  refreshHC();
}
function initFeatures() {
  migrateDB();
  patchTypes();
  renderTypeChips();
  hookIntoApp();
  wireFeaturesUI();
  updateStreaks();
  checkAchievements();
  paintStreakBar(); renderAchGrid();
}
// expose for debugging
window.__strideFeatures = { updateStreaks, checkAchievements, shareWorkout, Voice, allTypes, ACH };
document.addEventListener('DOMContentLoaded', initFeatures);

})(); // end features IIFE
