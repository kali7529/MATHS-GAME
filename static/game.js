// Improved + defensive JS for math quiz

const LEVELS = [
  { min: 1, max: 10, time: 10, scoreTo: 4 },
  { min: 10, max: 50, time: 13, scoreTo: 9 },
  { min: 50, max: 150, time: 15, scoreTo: 19 },
  { min: 150, max: 500, time: 18, scoreTo: 29 },
  { min: 500, max: 2000, time: 22, scoreTo: 9999 }
];
const MAX_LEADERBOARD = 10;

let playerName = '', score = 0, currentLevel = 0, currentQuestion = null, timerId = null, timeLeft = 0, running = false;

const nameInput = document.getElementById('nameInput');
const startBtn = document.getElementById('startBtn');
const leaderboardEl = document.getElementById('leaderboard');
const levelPill = document.getElementById('levelPill');
const scoreVal = document.getElementById('scoreVal');
const questionText = document.getElementById('questionText');
const optionsWrap = document.getElementById('optionsWrap');
const timerFill = document.getElementById('timerFill');
const timerNum = document.getElementById('timerNum');
const overlay = document.getElementById('overlay');
const overScore = document.getElementById('overScore');
const overLevel = document.getElementById('overLevel');
const playAgain = document.getElementById('playAgain');
const closeOver = document.getElementById('closeOver');
const levelupNotify = document.getElementById('levelupNotify');
const resetBoard = document.getElementById('resetBoard');
const demoBtn = document.getElementById('demoBtn');
const themeToggle = document.getElementById('themeToggle');

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playLevelUpSound() {
  try {
    const notes = [523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.value = 0.09;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.35);
    }, i * 100));
  } catch (e) { }
}

function showLevelUpNotification() {
  levelupNotify.classList.add('show');
  setTimeout(() => levelupNotify.classList.remove('show'), 1500);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

async function fetchLeaderboard() {
  try {
    const r = await fetch('/api/leaderboard');
    if (!r.ok) throw new Error('fetch leaderboard failed');
    const data = await r.json();
    renderLeaderboard(data);
    return data;
  } catch (e) {
    console.error(e);
    renderLeaderboard([]);
    return [];
  }
}

function renderLeaderboard(data) {
  const list = (data || []).slice(0, MAX_LEADERBOARD);
  leaderboardEl.innerHTML = list.map((r, i) => `<div class="top-item"><div style="font-weight:700">${i + 1}. ${escapeHtml(r.name)}</div><div style="color:var(--muted)">${r.score}</div></div>`).join('') || '<div style="color:var(--muted)">No scores yet</div>';
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }

function computeLevelFromScore(sc) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (sc <= LEVELS[i].scoreTo) return i;
  }
  return LEVELS.length - 1;
}

function updateUI() {
  levelPill.textContent = `Level ${currentLevel + 1}`;
  scoreVal.textContent = score;
}

function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

// safer division pair generator
function makeDivisionPair(min, max) {
  // choose small divisor to keep numbers reasonable
  const possibleDivisors = [];
  for (let d = 1; d <= Math.min(20, Math.floor(max / 1)); d++) {
    possibleDivisors.push(d);
  }
  const b = possibleDivisors[randInt(0, possibleDivisors.length - 1)];
  const maxMult = Math.max(1, Math.floor(max / b));
  const mult = randInt(Math.max(1, min), maxMult);
  return [b * mult, b];
}

function generateQuestion() {
  const cfg = LEVELS[currentLevel];
  let a, b, op, answer;
  const ops = ['+', '-', '*', '/'];
  op = ops[randInt(0, ops.length - 1)];

  if (op === '/') {
    [a, b] = makeDivisionPair(cfg.min, cfg.max);
    answer = Math.floor(a / b);
  } else {
    a = randInt(cfg.min, cfg.max);
    b = randInt(cfg.min, cfg.max);
    if (op === '+') answer = a + b;
    else if (op === '-') answer = a - b;
    else answer = a * b;
  }

  const text = `${a} ${op} ${b}`;
  const opts = new Set([answer]);
  const spread = clamp(Math.floor((cfg.max - cfg.min) / 6), 6, 200);

  while (opts.size < 4) {
    let delta = randInt(-spread, spread);
    if (delta === 0) delta = randInt(1, 5);
    let w = answer + delta;
    if (currentLevel < 2) w = Math.max(0, w);
    opts.add(w);
  }

  const options = Array.from(opts);
  // shuffle
  for (let i = options.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { text, answer, options };
}

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function startTimer(seconds) {
  stopTimer();
  timeLeft = seconds;
  updateTimerVisual();
  const step = 100; // ms
  timerId = setInterval(() => {
    timeLeft -= step / 1000;
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateTimerVisual();
      timesUp();
    } else updateTimerVisual();
  }, step);
}

function updateTimerVisual() {
  const cfg = LEVELS[currentLevel];
  const pct = clamp(timeLeft / cfg.time, 0, 1);
  timerFill.style.width = (pct * 100) + '%';
  timerNum.textContent = Math.ceil(timeLeft) + 's';
}

function presentQuestion() {
  try {
    currentQuestion = generateQuestion();
    questionText.textContent = 'Q: ' + currentQuestion.text;
    optionsWrap.innerHTML = '';
    currentQuestion.options.forEach(opt => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = opt;
      b.disabled = false;
      b.addEventListener('click', () => { if (!running) return; handleAnswer(opt, b); });
      optionsWrap.appendChild(b);
    });
    startTimer(LEVELS[currentLevel].time);
  } catch (err) {
    console.error('presentQuestion error', err);
    // fallback to safe state
    resetGame();
  }
}

function handleAnswer(choice, el) {
  if (!running) return;
  running = false;
  stopTimer();
  // disable all options immediately
  Array.from(optionsWrap.children).forEach(x => x.disabled = true);
  const correct = Number(choice) === Number(currentQuestion.answer);

  if (correct) {
    el.classList.add('correct');
    score += 1;
    const prev = currentLevel;
    currentLevel = computeLevelFromScore(score);
    updateUI();

    if (currentLevel > prev) {
      try { audioCtx.resume(); } catch (e) { }
      playLevelUpSound();
      showLevelUpNotification();
    }

    // small delay then next question
    setTimeout(() => {
      running = true;
      presentQuestion();
    }, 600);
  } else {
    el.classList.add('wrong');
    Array.from(optionsWrap.children).forEach(b => {
      if (Number(b.textContent) === currentQuestion.answer) b.classList.add('correct');
    });
    setTimeout(gameOver, 900);
  }
}

function timesUp() {
  stopTimer();
  running = false;
  Array.from(optionsWrap.children).forEach(b => {
    if (Number(b.textContent) === currentQuestion.answer) b.classList.add('correct');
    else b.classList.add('wrong');
    b.disabled = true;
  });
  setTimeout(gameOver, 900);
}

async function gameOver() {
  running = false;
  stopTimer();
  overScore.textContent = score;
  overLevel.textContent = currentLevel + 1;
  overlay.classList.add('show');
  try {
    await saveScoreToServer({ name: playerName || 'UNKNOWN', score, level: currentLevel + 1 });
    await fetchLeaderboard();
  } catch (e) { console.error(e); }
}

async function saveScoreToServer(entry) {
  try {
    const r = await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    if (!r.ok) throw new Error('save failed');
    return await r.json();
  } catch (e) {
    console.error(e);
    throw e;
  }
}

function beginGame() {
  score = 0;
  currentLevel = 0;
  running = true;
  updateUI();
  presentQuestion();
}

function resetGame() {
  score = 0;
  currentLevel = 0;
  running = false;
  updateUI();
  questionText.textContent = 'Press Play to start';
  optionsWrap.innerHTML = '';
  timerFill.style.width = '100%';
  timerNum.textContent = '--s';
  stopTimer();
}

// UI bindings
startBtn.addEventListener('click', () => {
  const val = nameInput.value.trim().toUpperCase();
  if (!val) { nameInput.focus(); return; }
  playerName = val.slice(0, 12);
  nameInput.value = playerName;
  beginGame();
});

nameInput.addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 \-]/g, '');
});

demoBtn.addEventListener('click', () => {
  currentLevel = 0;
  score = 0;
  updateUI();
  running = false;
  currentQuestion = generateQuestion();
  questionText.textContent = 'Demo: ' + currentQuestion.text;
  optionsWrap.innerHTML = '';
  currentQuestion.options.forEach(opt => {
    const b = document.createElement('div');
    b.className = 'opt';
    b.textContent = opt;
    optionsWrap.appendChild(b);
  });
  timerFill.style.width = '100%';
  timerNum.textContent = '--s';
});

resetBoard.addEventListener('click', async () => {
  if (!confirm('Reset leaderboard?')) return;
  try {
    const r = await fetch('/api/leaderboard/reset', { method: 'POST' });
    if (!r.ok) throw new Error('reset failed');
    await fetchLeaderboard();
    alert('Leaderboard cleared.');
  } catch (e) {
    console.error(e);
    alert('Failed to reset.');
  }
});

themeToggle.addEventListener('click', () => {
  const body = document.body;
  if (body.getAttribute('data-theme') === 'dark') {
    body.setAttribute('data-theme', 'light');
    themeToggle.textContent = 'Toggle Dark';
  } else {
    body.setAttribute('data-theme', 'dark');
    themeToggle.textContent = 'Toggle Light';
  }
});

playAgain.addEventListener('click', () => {
  overlay.classList.remove('show');
  resetGame();
  beginGame();
});
closeOver.addEventListener('click', () => overlay.classList.remove('show'));

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === nameInput) startBtn.click();
});

document.addEventListener('click', () => { if (audioCtx.state === 'suspended') audioCtx.resume(); }, { once: true });

// startup
fetchLeaderboard();
updateUI();
