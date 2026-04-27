/* ============================================================
   LEARNLOOP — main.js
   Complete app logic: state, daily runs, streaks, badges, UI

   Sprint 1 additions:
   • Free in-session navigation (prev / next / jump-to-index)
   • Interactive segmented progress bar (status-colored)
   • Headline detail modal (summary + whyItMatters)
   • Session persistence already covered by state.daily.{date,currentIndex,ids}
     — rollover snapshotting added so prior days can be revisited
   • Past Sessions screen (read-only history)
   • Report screen "Review headlines" action
   ============================================================ */

'use strict';

// ── Constants ──
const STATE_KEY      = 'll_state_v2';
const HEADLINES_KEY  = 'll_headlines_v2';   // bumped: data shape now includes summary + whyItMatters
const DAILY_SIZE     = 20;
const PER_TOPIC_MAX  = 3;

// ── App State ──
let state       = null;
let allHeadlines = [];
let dailySet    = [];
let sessionPts  = 0;

// ── History view local state ──
let historyView = 'list';   // 'list' | 'day'
let historyDate = null;     // 'YYYY-MM-DD'

// ── Detail modal local state ──
let currentDetailId      = null;
let currentDetailContext = 'browse';  // 'run' | 'browse' | 'saved' | 'history'

// ── Badge Definitions ──
const BADGE_DEFS = [
  { id: 'first',    label: 'First Step',      desc: 'Read your first headline',      emoji: '🌱' },
  { id: 'rookie',   label: 'Rookie Reader',   desc: 'Read 10 headlines total',        emoji: '📖' },
  { id: 'daily',    label: 'Daily Learner',   desc: 'Complete a full daily run',      emoji: '🎯' },
  { id: 'explorer', label: 'Topic Explorer',  desc: 'Read across 5 topics',           emoji: '🗺️' },
  { id: 'streak3',  label: 'On a Roll',       desc: '3-day reading streak',           emoji: '🔥' },
  { id: 'streak7',  label: 'Week Warrior',    desc: '7-day reading streak',           emoji: '⚡' },
  { id: 'century',  label: 'Century Club',    desc: 'Read 100 headlines',             emoji: '💯' },
  { id: 'bookworm', label: 'Bookworm',        desc: 'Save 10 headlines',              emoji: '🔖' },
  { id: 'speed',    label: 'Speed Reader',    desc: 'Read 20 headlines in one day',   emoji: '💨' },
  { id: 'month',    label: 'Monthly Master',  desc: '30-day streak',                  emoji: '🏆' },
  { id: 'power',    label: 'Power Reader',    desc: 'Read 500 headlines total',       emoji: '🚀' },
];

// ════════════════════════════════
//  INIT
// ════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  state = loadState();
  await loadHeadlines();
  rolloverPriorSessionIfNeeded();
  checkStreakReset();
  initTheme();
  initNav();
  initDetailModal();
  renderHome();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

// ════════════════════════════════
//  STATE MANAGEMENT
// ════════════════════════════════
function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Backfill new fields without disturbing existing ones
      if (!parsed.history) parsed.history = {};
      return parsed;
    }
  } catch (_) {}
  return makeDefaultState();
}

function makeDefaultState() {
  return {
    headlines:  {},           // id → { status, date }
    daily: {
      date:         null,
      ids:          [],
      currentIndex: 0,
      completed:    false,
    },
    history: {},              // 'YYYY-MM-DD' → snapshot
    stats: {
      totalRead:   0,
      totalPoints: 0,
      streak:      0,
      lastActive:  null,
      weeklyRead:  {},        // 'YYYY-Www' → count
      monthlyRead: {},        // 'YYYY-MM'  → count
      badges:      [],
    },
    theme: 'light',
  };
}

function persist() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// ════════════════════════════════
//  HEADLINE LOADING
// ════════════════════════════════
async function loadHeadlines() {
  // Try local cache first for offline support
  const cached = localStorage.getItem(HEADLINES_KEY);
  if (cached) {
    try { allHeadlines = JSON.parse(cached); return; } catch (_) {}
  }
  try {
    const resp = await fetch('./headlines.json');
    const data = await resp.json();
    allHeadlines = data.headlines;
    localStorage.setItem(HEADLINES_KEY, JSON.stringify(allHeadlines));
  } catch (err) {
    console.warn('Could not load headlines:', err);
    allHeadlines = [];
  }
}

// ════════════════════════════════
//  DATE UTILITIES
// ════════════════════════════════
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(d1, d2) {
  const msPerDay = 864e5;
  return Math.round((new Date(d2) - new Date(d1)) / msPerDay);
}

function weekKey(d = new Date()) {
  const jan1   = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d - jan1) / 864e5 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateLabel(yyyymmdd) {
  if (!yyyymmdd) return '';
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dt  = new Date(y, m - 1, d);
  const tdy = todayStr();
  if (yyyymmdd === tdy) return 'Today';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (yyyymmdd === yest.toISOString().slice(0, 10)) return 'Yesterday';
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function topicClassOf(topic) {
  return 'topic-' + topic.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');
}

// ════════════════════════════════
//  DAILY SET GENERATION (seeded / deterministic)
// ════════════════════════════════
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function dateToSeed(str) {
  return str.replace(/-/g, '').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
}

function shuffleArr(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDailyIds() {
  const today = todayStr();
  if (state.daily.date === today && state.daily.ids.length > 0) {
    return state.daily.ids;
  }

  const byTopic = {};
  allHeadlines.forEach(h => {
    (byTopic[h.topic] = byTopic[h.topic] || []).push(h);
  });

  const rng = seededRng(dateToSeed(today));
  const selected = [];
  Object.values(byTopic).forEach(arr => {
    selected.push(...shuffleArr(arr, rng).slice(0, PER_TOPIC_MAX));
  });

  const ids = shuffleArr(selected, rng).slice(0, DAILY_SIZE).map(h => h.id);

  if (state.daily.date !== today) {
    state.daily = { date: today, ids, currentIndex: 0, completed: false };
    persist();
  } else {
    state.daily.ids = ids;
    persist();
  }
  return ids;
}

// ════════════════════════════════
//  SESSION HISTORY (snapshots)
// ════════════════════════════════
function snapshotSessionToHistory(daily) {
  if (!daily || !daily.date || !daily.ids || daily.ids.length === 0) return;

  let read = 0, saved = 0, skipped = 0, unread = 0;
  const statuses = {};
  const segments = daily.ids.map(id => {
    const hs = state.headlines[id];
    let s = 'unread';
    if (hs && hs.date === daily.date) s = hs.status;
    statuses[id] = s;
    if (s === 'read')         read++;
    else if (s === 'saved')   saved++;
    else if (s === 'skipped') skipped++;
    else                      unread++;
    return s;
  });

  state.history = state.history || {};
  state.history[daily.date] = {
    date: daily.date,
    ids: [...daily.ids],
    statuses,
    read, saved, skipped, unread,
    completed: !!daily.completed,
    segments,
  };
  persist();
}

// On launch: if state.daily is from a prior date and had any progress,
// snapshot it into history before today's set is built.
function rolloverPriorSessionIfNeeded() {
  const today = todayStr();
  const d = state.daily;
  if (!d || !d.date || d.date === today) return;

  const hasProgress = d.completed || (d.ids || []).some(id => {
    const hs = state.headlines[id];
    return hs && hs.date === d.date;
  });

  if (hasProgress && !state.history[d.date]) {
    snapshotSessionToHistory(d);
  }
}

// ════════════════════════════════
//  STREAK LOGIC
// ════════════════════════════════
function checkStreakReset() {
  const last = state.stats.lastActive;
  if (!last) return;
  if (daysBetween(last, todayStr()) > 1) {
    state.stats.streak = 0;
    persist();
  }
}

function touchStreak() {
  const today = todayStr();
  const last  = state.stats.lastActive;
  if (last === today) return;

  if (!last || daysBetween(last, today) > 1) {
    state.stats.streak = 1;
  } else {
    state.stats.streak++;
  }
  state.stats.lastActive = today;
  persist();
}

// ════════════════════════════════
//  MARKING HEADLINES
// ════════════════════════════════
function markHeadline(id, status) {
  const prev    = state.headlines[id];
  const wasRead = prev && prev.status === 'read';

  state.headlines[id] = { status, date: todayStr() };

  let newBadges = [];
  if (status === 'read' && !wasRead) {
    state.stats.totalRead++;
    state.stats.totalPoints++;
    sessionPts++;

    const wk = weekKey();
    const mo = monthKey();
    state.stats.weeklyRead[wk]  = (state.stats.weeklyRead[wk]  || 0) + 1;
    state.stats.monthlyRead[mo] = (state.stats.monthlyRead[mo] || 0) + 1;

    touchStreak();
    newBadges = awardBadges();
  } else if (status === 'saved' && !wasRead) {
    newBadges = awardBadges();
  }

  persist();
  updateStreakPill();
  return newBadges;
}

// ════════════════════════════════
//  BADGE SYSTEM
// ════════════════════════════════
function extraStats() {
  const today   = todayStr();
  const topicsR = new Set();
  let totalSaved = 0, todayRead = 0;

  Object.entries(state.headlines).forEach(([id, d]) => {
    const h = allHeadlines.find(x => x.id === id);
    if (d.status === 'saved') totalSaved++;
    if (d.status === 'read') {
      if (h) topicsR.add(h.topic);
      if (d.date === today) todayRead++;
    }
  });

  return { topicsRead: topicsR.size, totalSaved, todayRead, daily: state.daily };
}

function awardBadges() {
  const s    = state.stats;
  const ex   = extraStats();
  const earned = [];

  const checks = {
    first:    () => s.totalRead >= 1,
    rookie:   () => s.totalRead >= 10,
    daily:    () => ex.daily.completed,
    explorer: () => ex.topicsRead >= 5,
    streak3:  () => s.streak >= 3,
    streak7:  () => s.streak >= 7,
    century:  () => s.totalRead >= 100,
    bookworm: () => ex.totalSaved >= 10,
    speed:    () => ex.todayRead >= 20,
    month:    () => s.streak >= 30,
    power:    () => s.totalRead >= 500,
  };

  BADGE_DEFS.forEach(bd => {
    if (!s.badges.includes(bd.id) && checks[bd.id] && checks[bd.id]()) {
      s.badges.push(bd.id);
      earned.push(bd);
    }
  });

  return earned;
}

// ════════════════════════════════
//  THEME
// ════════════════════════════════
function initTheme() {
  applyTheme(state.theme || 'light');
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = state.theme === 'light' ? 'dark' : 'light';
    state.theme = next;
    persist();
    applyTheme(next);
  });
}

function applyTheme(t) {
  document.body.className = `theme-${t}`;
  document.getElementById('theme-toggle').textContent = t === 'light' ? '🌙' : '☀️';
  document.getElementById('meta-theme').content = t === 'light' ? '#FAF8F4' : '#0F0E0D';
}

// ════════════════════════════════
//  NAVIGATION
// ════════════════════════════════
let currentScreen = 'home';

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.screen;
      if (s === 'run') { startOrResume(); return; }
      navigateTo(s);
    });
  });

  document.getElementById('run-today-btn').addEventListener('click', startOrResume);
  document.getElementById('run-exit').addEventListener('click', () => navigateTo('home'));
  document.getElementById('report-home').addEventListener('click', () => navigateTo('home'));
  document.getElementById('report-view-saved').addEventListener('click', () => navigateTo('saved'));
  document.getElementById('report-review').addEventListener('click', () => {
    historyDate = state.daily.date || todayStr();
    historyView = 'day';
    navigateTo('history');
  });

  document.getElementById('btn-read').addEventListener('click', () => handleAction('read'));
  document.getElementById('btn-skip').addEventListener('click', () => handleAction('skipped'));
  document.getElementById('btn-save').addEventListener('click', () => handleAction('saved'));

  // Run-mode in-session nav
  document.getElementById('prev-btn').addEventListener('click', goPrev);
  document.getElementById('next-btn').addEventListener('click', goNext);

  // History entry point + history back
  document.getElementById('open-history-btn').addEventListener('click', () => {
    historyView = 'list';
    historyDate = null;
    navigateTo('history');
  });
  document.getElementById('history-back').addEventListener('click', () => {
    historyView = 'list';
    historyDate = null;
    renderHistory();
  });
}

function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-screen="${screen}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  currentScreen = screen;

  if (screen === 'home')    renderHome();
  if (screen === 'stats')   renderStats();
  if (screen === 'saved')   renderSaved();
  if (screen === 'browse')  renderBrowse();
  if (screen === 'history') renderHistory();
}

// ════════════════════════════════
//  HOME
// ════════════════════════════════
function renderHome() {
  const d    = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  document.getElementById('today-date').textContent = d.toLocaleDateString('en-US', opts);

  document.getElementById('home-points').textContent = state.stats.totalPoints;
  document.getElementById('home-streak').textContent = state.stats.streak;

  const today    = todayStr();
  const todayR   = Object.values(state.headlines).filter(h => h.status === 'read' && h.date === today).length;
  document.getElementById('home-today').textContent = todayR;

  updateStreakPill();

  const topics   = [...new Set(allHeadlines.map(h => h.topic))];
  const el = document.getElementById('topic-chips');
  el.innerHTML   = topics.map(t => `<span class="topic-chip">${t}</span>`).join('');

  const runBtn   = document.getElementById('run-today-btn');
  const hintEl   = document.getElementById('run-hint');
  const daily    = state.daily;

  if (daily.completed && daily.date === today) {
    runBtn.innerHTML = '<span class="run-btn-icon">✅</span><span class="run-btn-text">Day Complete</span>';
    runBtn.disabled  = true;
    hintEl.textContent = 'Come back tomorrow for a fresh set!';
  } else if (daily.date === today && daily.currentIndex > 0) {
    runBtn.innerHTML = '<span class="run-btn-icon">▶</span><span class="run-btn-text">Resume Run</span>';
    runBtn.disabled  = false;
    hintEl.textContent = `Resume from headline ${daily.currentIndex + 1} / ${daily.ids.length}`;
  } else {
    runBtn.innerHTML = '<span class="run-btn-icon">▶</span><span class="run-btn-text">Run Today</span>';
    runBtn.disabled  = false;
    hintEl.textContent = '20 curated headlines · ~15 min';
  }

  renderHomeBadges();
}

function renderHomeBadges() {
  const earned = state.stats.badges;
  const el     = document.getElementById('home-badges-preview');
  if (earned.length === 0) {
    el.innerHTML = '<span class="badge-empty-msg">Complete your first run to earn badges 🏆</span>';
    return;
  }
  el.innerHTML = earned
    .map(id => {
      const bd = BADGE_DEFS.find(b => b.id === id);
      return bd ? `<span class="home-badge-chip">${bd.emoji} ${bd.label}</span>` : '';
    })
    .join('');
}

function updateStreakPill() {
  document.getElementById('streak-count').textContent = state.stats.streak;
}

// ════════════════════════════════
//  RUN MODE
// ════════════════════════════════
function startOrResume() {
  buildDailyIds();
  dailySet    = state.daily.ids.map(id => allHeadlines.find(h => h.id === id)).filter(Boolean);
  sessionPts  = 0;

  // Safety: if currentIndex was somehow past the set, clamp.
  if (state.daily.currentIndex < 0) state.daily.currentIndex = 0;
  if (state.daily.currentIndex >= dailySet.length && !state.daily.completed) {
    state.daily.currentIndex = dailySet.length - 1;
    persist();
  }

  navigateTo('run');
  renderCard();
}

function renderCard() {
  const idx   = state.daily.currentIndex;
  const total = dailySet.length;
  const pct   = total > 0 ? Math.round((idx / total) * 100) : 0;

  // Run-mode end of set → finish + report
  if (idx >= total) { finishRun(); return; }

  // Progress text + segments + nav button states
  document.getElementById('progress-text').textContent = `${idx + 1} of ${total}`;
  document.getElementById('run-points-live').textContent = `+${sessionPts} pts`;
  renderProgressSegments();

  document.getElementById('prev-btn').disabled = idx <= 0;
  document.getElementById('next-btn').disabled = idx >= total - 1;

  const h      = dailySet[idx];
  if (!h)      { finishRun(); return; }
  const status = state.headlines[h.id]?.status || 'unread';
  const tCls   = topicClassOf(h.topic);

  document.getElementById('card-stage').innerHTML = `
    <div class="headline-card animate-in tappable" id="current-card" data-id="${h.id}">
      <div class="card-meta">
        <span class="card-topic ${tCls}">${h.topic}</span>
        <span class="card-date">${h.date}</span>
      </div>
      <h2 class="card-title">${h.title}</h2>
      ${h.teaser ? `<p class="card-teaser">${h.teaser}</p>` : ''}
      ${status !== 'unread'
        ? `<div class="card-status has-status"><span class="status-label">${statusLabel(status)}</span></div>`
        : '<div class="card-status"></div>'}
      <p class="card-tap-hint">Tap card to read summary</p>
    </div>
  `;

  // Tap card opens detail modal
  const cardEl = document.getElementById('current-card');
  if (cardEl) {
    cardEl.addEventListener('click', () => openDetail(h.id, 'run'));
  }

  // Reflect active state on action buttons
  document.getElementById('btn-read').classList.toggle('active-btn', status === 'read');
  document.getElementById('btn-save').classList.toggle('active-btn', status === 'saved');
}

function renderProgressSegments() {
  const segWrap = document.getElementById('progress-segments');
  if (!segWrap) return;
  const idx   = state.daily.currentIndex;
  const total = dailySet.length;

  let html = '';
  for (let i = 0; i < total; i++) {
    const id  = state.daily.ids[i];
    const hs  = state.headlines[id];
    const status = (hs && hs.date === state.daily.date) ? hs.status : 'unread';
    const cls = ['prog-seg', status, i === idx ? 'current' : ''].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-idx="${i}" aria-label="Go to headline ${i + 1}"></button>`;
  }
  segWrap.innerHTML = html;

  segWrap.querySelectorAll('.prog-seg').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (!Number.isNaN(i)) goToIndex(i);
    });
  });
}

function statusLabel(s) {
  return { read: '✅ Marked as Read', saved: '🔖 Saved', skipped: '⏭ Skipped' }[s] || '';
}

// ── Free in-session navigation (does NOT change status) ──
function goToIndex(i) {
  const total = dailySet.length;
  if (i < 0 || i >= total) return;
  state.daily.currentIndex = i;
  persist();
  renderCard();
}

function goPrev() {
  if (state.daily.currentIndex > 0) goToIndex(state.daily.currentIndex - 1);
}

function goNext() {
  if (state.daily.currentIndex < dailySet.length - 1) goToIndex(state.daily.currentIndex + 1);
}

// ── Action buttons: mark + advance (preserves original UX) ──
function handleAction(action) {
  const idx = state.daily.currentIndex;
  if (idx >= dailySet.length) return;

  const h = dailySet[idx];
  if (!h) return;

  const newBadges = markHeadline(h.id, action);

  // Flash feedback on card
  const card = document.getElementById('current-card');
  if (card) {
    const cls = { read: 'flash-read', saved: 'flash-saved', skipped: 'flash-skip' }[action];
    if (cls) card.classList.add(cls);
  }

  // Advance after short delay (or finish if at last)
  setTimeout(() => {
    const total = dailySet.length;
    if (idx + 1 >= total) {
      finishRun();
    } else {
      state.daily.currentIndex = idx + 1;
      persist();
      renderCard();
    }
    document.getElementById('run-points-live').textContent = `+${sessionPts} pts`;
    if (newBadges.length > 0) showToast(`${newBadges[0].emoji} ${newBadges[0].label} unlocked!`);
  }, 280);
}

function finishRun() {
  state.daily.completed = true;
  const finalBadges = awardBadges();
  snapshotSessionToHistory(state.daily);    // record today's session for review
  persist();
  showReport(finalBadges);
  navigateTo('report');
}

// ════════════════════════════════
//  REPORT
// ════════════════════════════════
function showReport(newBadges) {
  const ids = state.daily.ids;
  let read = 0, saved = 0, skipped = 0;

  ids.forEach(id => {
    const s = state.headlines[id]?.status;
    if (s === 'read')    read++;
    if (s === 'saved')   saved++;
    if (s === 'skipped') skipped++;
  });

  document.getElementById('report-read').textContent    = read;
  document.getElementById('report-saved').textContent   = saved;
  document.getElementById('report-skipped').textContent = skipped;
  document.getElementById('report-points-earned').textContent = sessionPts;
  document.getElementById('report-streak').textContent  = state.stats.streak;

  const msgs = [
    'You\'re building a powerful habit.',
    'Consistent learners go further.',
    'Knowledge compounds every day.',
    'Another day, another edge.',
    'Keep the momentum going!',
    'Small steps. Big results.',
  ];
  document.getElementById('report-message').textContent = msgs[Math.floor(Math.random() * msgs.length)];

  const nbWrap = document.getElementById('new-badges');
  const nbList = document.getElementById('new-badges-list');
  if (newBadges.length > 0) {
    nbList.innerHTML = newBadges.map(b => `<span class="badge-chip">${b.emoji} ${b.label}</span>`).join('');
    nbWrap.style.display = 'block';
  } else {
    nbWrap.style.display = 'none';
  }
}

// ════════════════════════════════
//  BROWSE
// ════════════════════════════════
let browseActive = null;

function renderBrowse() {
  const topics = [...new Set(allHeadlines.map(h => h.topic))];
  if (!browseActive) browseActive = topics[0];

  const tabsEl = document.getElementById('topic-tabs');
  tabsEl.innerHTML = topics.map(t => `
    <button class="topic-tab ${t === browseActive ? 'active' : ''}" data-topic="${t}">${t}</button>
  `).join('');

  tabsEl.querySelectorAll('.topic-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      browseActive = btn.dataset.topic;
      renderBrowse();
    });
  });

  const filtered = allHeadlines.filter(h => h.topic === browseActive);
  const listEl   = document.getElementById('browse-list');
  const tCls     = topicClassOf(browseActive);

  listEl.innerHTML = filtered.map(h => {
    const hs  = state.headlines[h.id];
    const st  = hs?.status || 'unread';
    return `
      <div class="headline-item tappable ${st}" data-id="${h.id}">
        <div class="item-meta">
          <span class="item-topic ${tCls}">${h.topic}</span>
          <span class="item-date">${h.date}</span>
          <span class="item-status ${st}">${statusIcon(st)}</span>
        </div>
        <p class="item-title">${h.title}</p>
        ${h.teaser ? `<p class="item-teaser">${h.teaser}</p>` : ''}
        <div class="item-actions">
          <button class="mini-btn" data-act="read" data-id="${h.id}">✅ Read</button>
          <button class="mini-btn" data-act="save" data-id="${h.id}">🔖 Save</button>
          <button class="mini-btn" data-act="open" data-id="${h.id}">📖 Read more</button>
        </div>
      </div>`;
  }).join('');

  // Tap card body opens detail; mini-buttons handle their own actions
  listEl.querySelectorAll('.headline-item.tappable').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.mini-btn')) return;
      openDetail(item.dataset.id, 'browse');
    });
  });
  listEl.querySelectorAll('.mini-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'read')   { markHeadline(id, 'read');  renderBrowse(); renderHome(); }
      if (act === 'save')   { markHeadline(id, 'saved'); renderBrowse(); renderHome(); }
      if (act === 'open')   { openDetail(id, 'browse'); }
    });
  });
}

function statusIcon(s) {
  return { read: '✅ Read', saved: '🔖 Saved', skipped: '⏭ Skipped', unread: '· Unread' }[s] || '· Unread';
}

// Kept as global for legacy inline-onclick callers (no longer used in markup)
window.qMark = function(id, status) {
  markHeadline(id, status);
  renderBrowse();
  renderHome();
};

// ════════════════════════════════
//  SAVED
// ════════════════════════════════
function renderSaved() {
  const savedEntries = Object.entries(state.headlines)
    .filter(([, v]) => v.status === 'saved');

  document.getElementById('saved-count').textContent = savedEntries.length;

  const listEl  = document.getElementById('saved-list');
  const emptyEl = document.getElementById('saved-empty');

  if (savedEntries.length === 0) {
    listEl.innerHTML        = '';
    emptyEl.style.display   = 'flex';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = savedEntries.map(([id]) => {
    const h = allHeadlines.find(x => x.id === id);
    if (!h) return '';
    const tCls = topicClassOf(h.topic);
    return `
      <div class="headline-item tappable saved" data-id="${id}">
        <div class="item-meta">
          <span class="item-topic ${tCls}">${h.topic}</span>
          <span class="item-date">${h.date}</span>
          <span class="item-status saved">🔖 Saved</span>
        </div>
        <p class="item-title">${h.title}</p>
        ${h.teaser ? `<p class="item-teaser">${h.teaser}</p>` : ''}
        <div class="item-actions">
          <button class="mini-btn" data-act="read"   data-id="${id}">✅ Mark Read</button>
          <button class="mini-btn" data-act="open"   data-id="${id}">📖 Read more</button>
          <button class="mini-btn" data-act="remove" data-id="${id}">✕ Remove</button>
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.headline-item.tappable').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.mini-btn')) return;
      openDetail(item.dataset.id, 'saved');
    });
  });
  listEl.querySelectorAll('.mini-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'read')   { markHeadline(id, 'read'); renderSaved(); renderHome(); }
      if (act === 'open')   { openDetail(id, 'saved'); }
      if (act === 'remove') { delete state.headlines[id]; persist(); renderSaved(); renderHome(); }
    });
  });
}

// Kept as global for legacy callers
window.unsave = function(id) {
  delete state.headlines[id];
  persist();
  renderSaved();
};

// ════════════════════════════════
//  STATS
// ════════════════════════════════
function renderStats() {
  const s  = state.stats;
  const ex = extraStats();

  document.getElementById('stats-total').textContent       = s.totalRead;
  document.getElementById('stats-points').textContent      = s.totalPoints;
  document.getElementById('stats-streak').textContent      = s.streak;
  document.getElementById('stats-weekly').textContent      = s.weeklyRead[weekKey()]   || 0;
  document.getElementById('stats-monthly').textContent     = s.monthlyRead[monthKey()] || 0;
  document.getElementById('stats-saved-count').textContent = ex.totalSaved;

  updateStreakPill();

  const grid = document.getElementById('badge-grid');
  grid.innerHTML = BADGE_DEFS.map(bd => {
    const earned = s.badges.includes(bd.id);
    return `
      <div class="badge-item ${earned ? 'earned' : 'locked'}">
        <span class="badge-emoji">${bd.emoji}</span>
        <span class="badge-label">${bd.label}</span>
        <span class="badge-desc">${bd.desc}</span>
        ${earned
          ? '<span class="badge-earned-mark">✓</span>'
          : '<span class="badge-lock">🔒</span>'}
      </div>`;
  }).join('');
}

// ════════════════════════════════
//  HISTORY (past sessions, read-only)
// ════════════════════════════════
function renderHistory() {
  const titleEl   = document.getElementById('history-title');
  const backEl    = document.getElementById('history-back');
  const contentEl = document.getElementById('history-content');
  const emptyEl   = document.getElementById('history-empty');

  // Always include today's in-progress session if it exists with any progress
  ensureTodaySnapshotForReview();

  if (historyView === 'day' && historyDate && state.history[historyDate]) {
    backEl.style.display = '';
    titleEl.textContent  = formatDateLabel(historyDate);
    emptyEl.style.display = 'none';
    contentEl.innerHTML  = renderHistoryDayHTML(state.history[historyDate]);
    bindHistoryDayItems(contentEl);
    return;
  }

  // List view
  backEl.style.display = 'none';
  titleEl.textContent  = 'Past Sessions';

  const days = Object.values(state.history)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (days.length === 0) {
    contentEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.innerHTML = `
    <div class="history-list">
      ${days.map(d => `
        <button class="history-day-card" data-date="${d.date}">
          <div class="history-day-date">${formatDateLabel(d.date)}</div>
          <div class="history-day-stats">
            <span class="stat-read">✅ <strong>${d.read}</strong> read</span>
            <span class="stat-saved">🔖 <strong>${d.saved}</strong> saved</span>
            <span>⏭ <strong>${d.skipped}</strong> skipped</span>
            ${d.unread > 0 ? `<span>· <strong>${d.unread}</strong> unread</span>` : ''}
          </div>
          <div class="history-day-meta">
            <div class="history-day-progress-mini">
              ${d.segments.map(s => `<span class="seg ${s}"></span>`).join('')}
            </div>
            <span class="history-day-arrow">›</span>
          </div>
        </button>
      `).join('')}
    </div>
  `;

  contentEl.querySelectorAll('.history-day-card').forEach(btn => {
    btn.addEventListener('click', () => {
      historyDate = btn.dataset.date;
      historyView = 'day';
      renderHistory();
    });
  });
}

// If today's session has any progress and isn't yet snapshotted (or is stale),
// refresh today's history entry so it appears in the list.
function ensureTodaySnapshotForReview() {
  const today = todayStr();
  const d = state.daily;
  if (!d || d.date !== today || !d.ids || d.ids.length === 0) return;
  const hasProgress = d.completed || d.ids.some(id => {
    const hs = state.headlines[id];
    return hs && hs.date === today;
  });
  if (hasProgress) snapshotSessionToHistory(d);
}

function renderHistoryDayHTML(snap) {
  const items = snap.ids.map(id => {
    const h  = allHeadlines.find(x => x.id === id);
    if (!h) return '';
    const st = snap.statuses[id] || 'unread';
    const tCls = topicClassOf(h.topic);
    return `
      <div class="headline-item tappable ${st}" data-id="${id}">
        <div class="item-meta">
          <span class="item-topic ${tCls}">${h.topic}</span>
          <span class="item-date">${h.date}</span>
          <span class="item-status ${st}">${statusIcon(st)}</span>
        </div>
        <p class="item-title">${h.title}</p>
        ${h.teaser ? `<p class="item-teaser">${h.teaser}</p>` : ''}
      </div>`;
  }).join('');

  const status = snap.completed ? 'Completed' : 'Incomplete';
  return `
    <div class="screen-header" style="padding-top:0">
      <span class="count-pill">${status} · ${snap.read}/${snap.ids.length} read</span>
    </div>
    <div class="headline-list">${items}</div>
  `;
}

function bindHistoryDayItems(container) {
  container.querySelectorAll('.headline-item.tappable').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id, 'history'));
  });
}

// ════════════════════════════════
//  DETAIL MODAL
// ════════════════════════════════
function initDetailModal() {
  const overlay = document.getElementById('detail-modal');
  const closeBtn = document.getElementById('detail-close');

  closeBtn.addEventListener('click', closeDetail);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.getAttribute('aria-hidden') === 'false') closeDetail();
  });
}

function openDetail(id, context = 'browse') {
  const h = allHeadlines.find(x => x.id === id);
  if (!h) return;

  currentDetailId      = id;
  currentDetailContext = context;

  const hs    = state.headlines[id];
  const status = hs?.status || 'unread';

  document.getElementById('detail-topic').textContent = h.topic;
  document.getElementById('detail-topic').className   = 'detail-topic ' + topicClassOf(h.topic);
  document.getElementById('detail-date').textContent  = h.date;

  const statusEl = document.getElementById('detail-status');
  if (status === 'unread') {
    statusEl.textContent = '';
    statusEl.className   = 'detail-status';
  } else {
    statusEl.textContent = statusIcon(status);
    statusEl.className   = 'detail-status ' + status;
  }

  document.getElementById('detail-title').textContent  = h.title;
  document.getElementById('detail-teaser').textContent = h.teaser || '';

  // Summary section
  const summaryWrap = document.getElementById('detail-summary-wrap');
  const summaryEl   = document.getElementById('detail-summary');
  if (h.summary) {
    summaryEl.textContent = h.summary;
    summaryWrap.hidden = false;
  } else {
    summaryWrap.hidden = true;
  }

  // Why-it-matters section
  const whyWrap = document.getElementById('detail-why-wrap');
  const whyEl   = document.getElementById('detail-why');
  if (h.whyItMatters) {
    whyEl.textContent = h.whyItMatters;
    whyWrap.hidden = false;
  } else {
    whyWrap.hidden = true;
  }

  // Action buttons — context-dependent (history is read-only)
  renderDetailActions(h, status, context);

  document.getElementById('detail-modal').setAttribute('aria-hidden', 'false');
}

function renderDetailActions(h, status, context) {
  const wrap = document.getElementById('detail-actions');
  if (context === 'history') {
    wrap.innerHTML = '';
    return;
  }

  const buttons = [];
  if (status !== 'read') {
    buttons.push(`<button class="mini-btn" data-act="read">✅ Mark Read</button>`);
  }
  if (status !== 'saved') {
    buttons.push(`<button class="mini-btn" data-act="save">🔖 Save</button>`);
  } else {
    buttons.push(`<button class="mini-btn" data-act="unsave">✕ Unsave</button>`);
  }

  wrap.innerHTML = buttons.join('');
  wrap.querySelectorAll('.mini-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'read')   { markHeadline(h.id, 'read'); }
      if (act === 'save')   { markHeadline(h.id, 'saved'); }
      if (act === 'unsave') { delete state.headlines[h.id]; persist(); }
      // Refresh the originating screen
      if (currentDetailContext === 'run')    { renderCard(); }
      if (currentDetailContext === 'browse') { renderBrowse(); }
      if (currentDetailContext === 'saved')  { renderSaved(); }
      renderHome();
      // Re-open with fresh status
      openDetail(h.id, currentDetailContext);
    });
  });
}

function closeDetail() {
  document.getElementById('detail-modal').setAttribute('aria-hidden', 'true');
  currentDetailId = null;
}

// ════════════════════════════════
//  TOAST
// ════════════════════════════════
function showToast(msg, duration = 3000) {
  const container = document.getElementById('toast-container');
  const el        = document.createElement('div');
  el.className    = 'toast';
  el.textContent  = msg;
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('show'));
  });

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, duration);
}
