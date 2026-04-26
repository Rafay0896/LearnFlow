/* ============================================================
   LEARNLOOP — main.js
   Complete app logic: state, daily runs, streaks, badges, UI
   ============================================================ */

'use strict';

// ── Constants ──
const STATE_KEY      = 'll_state_v2';
const HEADLINES_KEY  = 'll_headlines_v1';
const DAILY_SIZE     = 20;
const PER_TOPIC_MAX  = 3;

// ── App State ──
let state       = null;
let allHeadlines = [];
let dailySet    = [];
let sessionPts  = 0;

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
  checkStreakReset();
  initTheme();
  initNav();
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
    if (raw) return JSON.parse(raw);
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
  // Return cached if same day
  if (state.daily.date === today && state.daily.ids.length > 0) {
    return state.daily.ids;
  }

  // Group by topic
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

  // Only reset progress if it's a new day
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
  document.getElementById('run-back').addEventListener('click', () => navigateTo('home'));
  document.getElementById('report-home').addEventListener('click', () => navigateTo('home'));
  document.getElementById('report-view-saved').addEventListener('click', () => navigateTo('saved'));
  document.getElementById('btn-read').addEventListener('click',  () => handleAction('read'));
  document.getElementById('btn-skip').addEventListener('click',  () => handleAction('skipped'));
  document.getElementById('btn-save').addEventListener('click',  () => handleAction('saved'));
}

function navigateTo(screen) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');

  // Update nav highlights
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-screen="${screen}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  currentScreen = screen;

  // Screen-specific renders
  if (screen === 'home')   renderHome();
  if (screen === 'stats')  renderStats();
  if (screen === 'saved')  renderSaved();
  if (screen === 'browse') renderBrowse();
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

  // Topic chips
  const topics   = [...new Set(allHeadlines.map(h => h.topic))];
  const el = document.getElementById('topic-chips');
  el.innerHTML   = topics.map(t => `<span class="topic-chip">${t}</span>`).join('');

  // Run button state
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

  // Badge preview
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
  document.getElementById('streak-count').textContent  = state.stats.streak;
}

// ════════════════════════════════
//  RUN MODE
// ════════════════════════════════
function startOrResume() {
  buildDailyIds();
  dailySet    = state.daily.ids.map(id => allHeadlines.find(h => h.id === id)).filter(Boolean);
  sessionPts  = 0;
  navigateTo('run');
  renderCard();
}

function renderCard() {
  const idx   = state.daily.currentIndex;
  const total = dailySet.length;
  const pct   = total > 0 ? Math.round((idx / total) * 100) : 0;

  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${idx} / ${total}`;
  document.getElementById('run-points-live').textContent = `+${sessionPts} pts`;

  if (idx >= total) { finishRun(); return; }

  const h      = dailySet[idx];
  if (!h)      { finishRun(); return; }
  const status = state.headlines[h.id]?.status || 'unread';
  const topicClass = 'topic-' + h.topic.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');

  document.getElementById('card-stage').innerHTML = `
    <div class="headline-card animate-in" id="current-card">
      <div class="card-meta">
        <span class="card-topic ${topicClass}">${h.topic}</span>
        <span class="card-date">${h.date}</span>
      </div>
      <h2 class="card-title">${h.title}</h2>
      ${h.teaser ? `<p class="card-teaser">${h.teaser}</p>` : ''}
      ${status !== 'unread' ? `<div class="card-status has-status"><span class="status-label">${statusLabel(status)}</span></div>` : '<div class="card-status"></div>'}
    </div>
    <p class="card-counter">${idx + 1} of ${total}</p>
  `;

  // Reflect active state on buttons
  document.getElementById('btn-read').classList.toggle('active-btn',  status === 'read');
  document.getElementById('btn-save').classList.toggle('active-btn',  status === 'saved');
}

function statusLabel(s) {
  return { read: '✅ Marked as Read', saved: '🔖 Saved', skipped: '⏭ Skipped' }[s] || '';
}

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
    card.classList.add(cls);
  }

  // Advance after short delay
  setTimeout(() => {
    state.daily.currentIndex++;
    persist();
    renderCard();

    // Live points update
    document.getElementById('run-points-live').textContent = `+${sessionPts} pts`;

    if (newBadges.length > 0) showToast(`${newBadges[0].emoji} ${newBadges[0].label} unlocked!`);
  }, 280);
}

function finishRun() {
  state.daily.completed = true;
  const finalBadges = awardBadges();
  persist();
  showReport(finalBadges);
  navigateTo('report');
}

// ════════════════════════════════
//  REPORT
// ════════════════════════════════
function showReport(newBadges) {
  const ids         = state.daily.ids;
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

  // New badges
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

  // Tabs
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

  // Headline list
  const filtered = allHeadlines.filter(h => h.topic === browseActive);
  const listEl   = document.getElementById('browse-list');
  const topicCls = 'topic-' + browseActive.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');

  listEl.innerHTML = filtered.map(h => {
    const hs  = state.headlines[h.id];
    const st  = hs?.status || 'unread';
    return `
      <div class="headline-item ${st}">
        <div class="item-meta">
          <span class="item-topic ${topicCls}">${h.topic}</span>
          <span class="item-date">${h.date}</span>
          <span class="item-status ${st}">${statusIcon(st)}</span>
        </div>
        <p class="item-title">${h.title}</p>
        ${h.teaser ? `<p class="item-teaser">${h.teaser}</p>` : ''}
        <div class="item-actions">
          <button class="mini-btn" onclick="qMark('${h.id}','read')">✅ Read</button>
          <button class="mini-btn" onclick="qMark('${h.id}','saved')">🔖 Save</button>
        </div>
      </div>`;
  }).join('');
}

function statusIcon(s) {
  return { read: '✅ Read', saved: '🔖 Saved', skipped: '⏭ Skipped', unread: '· Unread' }[s] || '· Unread';
}

// Global for inline onclick handlers
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
    const topicCls = 'topic-' + h.topic.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');
    return `
      <div class="headline-item saved">
        <div class="item-meta">
          <span class="item-topic ${topicCls}">${h.topic}</span>
          <span class="item-date">${h.date}</span>
          <span class="item-status saved">🔖 Saved</span>
        </div>
        <p class="item-title">${h.title}</p>
        ${h.teaser ? `<p class="item-teaser">${h.teaser}</p>` : ''}
        <div class="item-actions">
          <button class="mini-btn" onclick="qMark('${id}','read')">✅ Mark Read</button>
          <button class="mini-btn" onclick="unsave('${id}')">✕ Remove</button>
        </div>
      </div>`;
  }).join('');
}

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

  document.getElementById('stats-total').textContent    = s.totalRead;
  document.getElementById('stats-points').textContent   = s.totalPoints;
  document.getElementById('stats-streak').textContent   = s.streak;
  document.getElementById('stats-weekly').textContent   = s.weeklyRead[weekKey()]   || 0;
  document.getElementById('stats-monthly').textContent  = s.monthlyRead[monthKey()] || 0;
  document.getElementById('stats-saved-count').textContent = ex.totalSaved;

  updateStreakPill();

  // Badge grid
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
