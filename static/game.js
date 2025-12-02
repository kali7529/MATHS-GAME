// game.js - Improved Stability Version

const LEVELS = [
  { min: 1, max: 10, time: 10, scoreTo: 4 },
  { min: 10, max: 50, time: 13, scoreTo: 9 },
  { min: 50, max: 150, time: 15, scoreTo: 19 },
  { min: 150, max: 500, time: 18, scoreTo: 29 },
  { min: 500, max: 2000, time: 22, scoreTo: 9999 }
];
const MAX_LEADERBOARD = 10;

// State
let state = {
  playerName: '',
  score: 0,
  currentLevel: 0,
  running: false,
  processingAnswer: false, // Prevents double clicking
  timerId: null,
  endTime: 0,
  question: null
};

// DOM Elements
const els = {
  nameInput: document.getElementById('nameInput'),
  startBtn: document.getElementById('startBtn'),
  leaderboard: document.getElementById('leaderboard'),
  levelPill: document.getElementById('levelPill'),
  scoreVal: document.getElementById('scoreVal'),
  questionText: document.getElementById('questionText'),
  optionsWrap: document.getElementById('optionsWrap'),
  timerFill: document.getElementById('timerFill'),
  timerNum: document.getElementById('timerNum'),
  overlay: document.getElementById('overlay'),
  overScore: document.getElementById('overScore'),
  overLevel: document.getElementById('overLevel'),
  playAgain: document.getElementById('playAgain'),
  closeOver: document.getElementById('closeOver'),
  levelupNotify: document.getElementById('levelupNotify'),
  resetBoard: document.getElementById('resetBoard'),
  demoBtn: document.getElementById('demoBtn'),
  themeToggle: document.getElementById('themeToggle')
};

// Audio Init (Lazy load)
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = new AudioContext();

function ensureAudio() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.log(e));
  }
}

function playSound(type) {
  if (!audioCtx) return;
  ensureAudio();

  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'levelup') {
      o.type = 'triangle';
      o.frequency.setValueAtTime(440, now);
      o.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      g.gain.setValueAtTime(0.1, now);
      g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      o.start(now);
      o.stop(now + 0.3);
    } else if (type === 'wrong') {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(150, now);
      o.frequency.linearRampToValueAtTime(100, now + 0.2);
      g.gain.setValueAtTime(0.1, now);
      g.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      o.start(now);
      o.stop(now + 0.2);
    }
  } catch (e) { /* ignore audio errors */ }
}

// --- Logic ---

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error('Network err');
    const data = await res.json();
    renderLeaderboard(data);
  } catch (e) {
    console.warn("Leaderboard fetch failed:", e);
    renderLeaderboard([]);
  }
}

function renderLeaderboard(data) {
  // Safety check if data is not array
  const list = Array.isArray(data) ? data.slice(0, MAX_LEADERBOARD) : [];

  els.leaderboard.innerHTML = list.length
    ? list.map((r, i) => `
        <div class="top-item">
          <div style="font-weight:700">${i + 1}. ${escapeHtml(r.name)}</div>
          <div style="color:var(--muted)">${r.score}</div>
        </div>`).join('')
    : '<div style="color:var(--muted); font-style:italic;">No scores yet</div>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
}

function updateUI() {
  els.levelPill.textContent = `Level ${state.currentLevel + 1}`;
  els.scoreVal.textContent = state.score;
}

function getLevelIndex(score) {
  for (let i = 0; i < LEVELS.length; i++) {
    if (score <= LEVELS[i].scoreTo) return i;
  }
  return LEVELS.length - 1;
}

// --- Question Generator ---

function generateQuestion() {
  const cfg = LEVELS[state.currentLevel];
  const ops = ['+', '-', '*', '/'];
  const op = ops[randInt(0, 3)];
  let a, b, ans;

  if (op === '/') {
    // Generate clean division (integer result)
    // Avoid division by 1 often as it's too easy, unless low level
    const minDiv = cfg.min > 1 ? 2 : 1;
    const maxDiv = Math.max(minDiv, Math.floor(Math.sqrt(cfg.max))); // Keep divisors reasonable
    b = randInt(minDiv, maxDiv);
    ans = randInt(cfg.min, Math.floor(cfg.max / b));
    a = ans * b;
    // Recalculate ans just to be safe
    ans = a / b;
  } else {
    a = randInt(cfg.min, cfg.max);
    b = randInt(cfg.min, cfg.max);
    if (op === '+') ans = a + b;
    else if (op === '-') ans = a - b;
    else ans = a * b;
  }

  // Generate wrong options
  const opts = new Set([ans]);
  const range = Math.max(5, Math.floor(ans * 0.5)); // Spread based on answer magnitude

  // Safety counter to prevent infinite loops if we can't find numbers
  let safety = 0;
  while (opts.size < 4 && safety < 100) {
    safety++;
    let offset = randInt(-range, range);
    if (offset === 0) offset = 1;

    let wrong = ans + offset;
    // Don't show negative numbers in early levels
    if (state.currentLevel < 2 && wrong < 0) wrong = Math.abs(wrong);

    opts.add(wrong);
  }

  // Convert set to array and shuffle
  const optionsArr = Array.from(opts);
  for (let i = optionsArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionsArr[i], optionsArr[j]] = [optionsArr[j], optionsArr[i]];
  }

  return { text: `${a} ${op} ${b}`, answer: ans, options: optionsArr };
}

// --- Timer System ---

function startTimer() {
  stopTimer();
  const cfg = LEVELS[state.currentLevel];
  const durationMs = cfg.time * 1000;
  state.endTime = Date.now() + durationMs;

  updateTimerVisual(durationMs, durationMs); // Init state

  state.timerId = setInterval(() => {
    const remaining = state.endTime - Date.now();
    if (remaining <= 0) {
      stopTimer();
      updateTimerVisual(0, durationMs);
      onTimesUp();
    } else {
      updateTimerVisual(remaining, durationMs);
    }
  }, 100);
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function updateTimerVisual(remainMs, totalMs) {
  const pct = Math.max(0, (remainMs / totalMs) * 100);
  const sec = Math.ceil(remainMs / 1000);
  els.timerFill.style.width = `${pct}%`;
  els.timerNum.textContent = `${sec}s`;
}

// --- Game Flow ---

function startGame() {
  state.score = 0;
  state.currentLevel = 0;
  state.running = true;
  state.processingAnswer = false;

  updateUI();
  nextQuestion();
}

function nextQuestion() {
  if (!state.running) return;
  state.processingAnswer = false;

  // Guard against errors in generator
  try {
    state.question = generateQuestion();
  } catch (e) {
    console.error("Gen error", e);
    // Fallback simple question
    state.question = { text: "1 + 1", answer: 2, options: [1, 2, 3, 4] };
  }

  // Render
  els.questionText.textContent = `Q: ${state.question.text}`;
  els.optionsWrap.innerHTML = '';

  state.question.options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'opt';
    btn.textContent = opt;
    btn.onclick = () => onAnswer(opt, btn);
    els.optionsWrap.appendChild(btn);
  });

  startTimer();
}

function onAnswer(choice, btnEl) {
  // Prevent double clicks or clicks after timeout
  if (!state.running || state.processingAnswer) return;

  state.processingAnswer = true; // Lock input
  stopTimer();

  const correct = (Number(choice) === state.question.answer);

  // Disable all buttons immediately to prevent spam
  const allBtns = els.optionsWrap.querySelectorAll('.opt');
  allBtns.forEach(b => b.disabled = true);

  if (correct) {
    btnEl.classList.add('correct');
    state.score++;

    const prevLevel = state.currentLevel;
    state.currentLevel = getLevelIndex(state.score);
    updateUI();

    if (state.currentLevel > prevLevel) {
      playSound('levelup');
      showLevelUp();
    }

    // Short delay before next question
    setTimeout(nextQuestion, 500);
  } else {
    // Highlight wrong answer and the correct one
    playSound('wrong');
    btnEl.classList.add('wrong');
    allBtns.forEach(b => {
      if (Number(b.textContent) === state.question.answer) b.classList.add('correct');
    });
    setTimeout(gameOver, 1000);
  }
}

function onTimesUp() {
  if (!state.running) return;
  state.running = false;
  state.processingAnswer = true;

  // Show correct answer
  const allBtns = els.optionsWrap.querySelectorAll('.opt');
  allBtns.forEach(b => {
    b.disabled = true;
    if (Number(b.textContent) === state.question.answer) b.classList.add('correct');
    else b.classList.add('wrong');
  });

  setTimeout(gameOver, 1000);
}

function showLevelUp() {
  els.levelupNotify.classList.add('show');
  setTimeout(() => els.levelupNotify.classList.remove('show'), 1500);
}

async function gameOver() {
  state.running = false;
  stopTimer();

  els.overScore.textContent = state.score;
  els.overLevel.textContent = state.currentLevel + 1;
  els.overlay.classList.add('show');

  // Submit score
  if (state.score > 0) {
    try {
      await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: state.playerName,
          score: state.score,
          level: state.currentLevel + 1
        })
      });
      fetchLeaderboard(); // Refresh list
    } catch (e) {
      console.error("Save score failed", e);
    }
  }
}

// --- Event Listeners ---

els.startBtn.addEventListener('click', () => {
  ensureAudio();
  const name = els.nameInput.value.replace(/[^A-Za-z0-9 \-]/g, '').trim().toUpperCase();
  if (!name) {
    els.nameInput.focus();
    els.nameInput.style.borderColor = "var(--danger)";
    return;
  }
  els.nameInput.style.borderColor = "";
  state.playerName = name.slice(0, 12);
  els.nameInput.value = state.playerName; // Update UI with sanitized
  startGame();
});

// Allow pressing Enter in name field
els.nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.startBtn.click();
});

els.playAgain.addEventListener('click', () => {
  els.overlay.classList.remove('show');
  startGame();
});

els.closeOver.addEventListener('click', () => {
  els.overlay.classList.remove('show');
  els.questionText.textContent = "Press Play to start";
  els.optionsWrap.innerHTML = "";
  els.timerFill.style.width = "100%";
  els.timerNum.textContent = "--s";
});

els.resetBoard.addEventListener('click', async () => {
  if (!confirm("Are you sure you want to clear the leaderboard?")) return;
  await fetch('/api/leaderboard/reset', { method: 'POST' });
  fetchLeaderboard();
});

els.themeToggle.addEventListener('click', () => {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
});

// Demo mode
els.demoBtn.addEventListener('click', () => {
  state.currentLevel = 0; // Reset difficulty for demo
  state.question = generateQuestion();
  els.questionText.textContent = "Demo: " + state.question.text;
  els.optionsWrap.innerHTML = '';
  state.question.options.forEach(opt => {
    const d = document.createElement('div');
    d.className = 'opt';
    d.textContent = opt;
    els.optionsWrap.appendChild(d);
  });
});
els.resetBoard.addEventListener('click', async () => {
  // Ask for password instead of just confirming
  const password = prompt("Enter password to clear leaderboard:");

  // If user clicked Cancel or typed nothing, stop
  if (!password) return;

  try {
    const r = await fetch('/api/leaderboard/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }) // Send password to server
    });

    const data = await r.json();

    if (data.ok) {
      await fetchLeaderboard();
      alert('Leaderboard cleared successfully.');
    } else {
      // Show the error message from python (e.g. "Incorrect password")
      alert(data.error || 'Failed to reset.');
    }
  } catch (e) {
    console.error(e);
    alert('Network error.');
  }
});
// Init
fetchLeaderboard();
