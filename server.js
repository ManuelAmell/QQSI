require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const validator = require('./utils/validator');
const game = require('./utils/game');

const app = express();
const server = http.createServer(app);

// Environment Configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LinoTeto';

const TEAM_PASSWORDS = {
  sistemas: [process.env.PASSWORD_SISTEMAS || 'Sistemas2026*'],
  software: [process.env.PASSWORD_SOFTWARE || 'Software2026*'],
  alimentos: [process.env.PASSWORD_ALIMENTOS || 'Alimentos2026*'],
  quimica: [process.env.PASSWORD_QUIMICA || 'Quimica2026*', 'Química2026*'],
  civil: [process.env.PASSWORD_CIVIL || 'Civil2026*'],
  petroquimica: [process.env.PASSWORD_PETROQUIMICA || 'Petroquimica2026*', 'Petroquímica2026*']
};

// Configurable Allowed Origins for CORS
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, ''))
  : ['*'];

const isWildcardCors = rawAllowedOrigins.includes('*');

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || isWildcardCors || rawAllowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Allow localhost variants in development
      if (NODE_ENV !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive fallback for seamless Vercel <-> Coolify preview branches
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Comprehensive Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Serve Static Assets with Cache Control
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: NODE_ENV === 'production' ? '1h' : '0'
}));
app.use(express.json({ limit: '100kb' }));

// Healthcheck / Config API
app.get('/api/config', (req, res) => {
  res.json({
    status: 'ok',
    backendUrl: (process.env.BACKEND_URL || '').trim().replace(/\/$/, '')
  });
});

// Load Questions Bank with Error Handling
let questionsData = { rounds: [] };
try {
  const qPath = path.join(__dirname, 'data', 'questions.json');
  if (fs.existsSync(qPath)) {
    questionsData = JSON.parse(fs.readFileSync(qPath, 'utf8'));
  }
} catch (err) {
  console.error('[QQSI Server] Error cargando data/questions.json:', err.message);
}

// Validation Helpers
function isValidAdminPassword(pwd) {
  if (!pwd || typeof pwd !== 'string') return false;
  return validator.cleanString(pwd) === ADMIN_PASSWORD;
}

function isValidTeamPassword(teamId, pwd) {
  if (!validator.isValidTeamId(teamId) || !pwd || typeof pwd !== 'string') return false;
  const validList = TEAM_PASSWORDS[teamId.toLowerCase()];
  if (!validList) return false;
  const cleaned = validator.cleanString(pwd).toLowerCase();
  return validList.some(v => v.toLowerCase() === cleaned);
}

// Master Teams Setup
const DEFAULT_TEAMS = game.DEFAULT_TEAMS;

// Master Game State
let gameState = game.createInitialGameState();

function initRoundScores() {
  game.initRoundScores(gameState);
}

// Timer Logic
let timerInterval = null;

function broadcastState() {
  io.emit('state_update', game.getSanitizedState(gameState));
}

function startTimer(durationSeconds) {
  if (timerInterval) clearInterval(timerInterval);
  
  gameState.timer.duration = durationSeconds;
  gameState.timer.remaining = durationSeconds;
  gameState.timer.isRunning = true;
  gameState.timer.startTime = Date.now();
  gameState.timer.endTime = Date.now() + durationSeconds * 1000;
  
  timerInterval = setInterval(() => {
    if (gameState.timer.isRunning) {
      gameState.timer.remaining--;
      io.emit('timer_tick', { remaining: gameState.timer.remaining });
      
      if (gameState.timer.remaining <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        gameState.timer.remaining = 0;
        gameState.timer.isRunning = false;
        gameState.questionState = 'ended';
        io.emit('question_time_up');
        broadcastState();
      }
    }
  }, 1000);
}

function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.timer.isRunning = false;
  gameState.questionState = 'paused';
  broadcastState();
}

function resumeTimer() {
  if (gameState.timer.remaining > 0) {
    gameState.timer.isRunning = true;
    gameState.questionState = 'running';
    gameState.timer.endTime = Date.now() + gameState.timer.remaining * 1000;
    
    timerInterval = setInterval(() => {
      if (gameState.timer.isRunning) {
        gameState.timer.remaining--;
        io.emit('timer_tick', { remaining: gameState.timer.remaining });
        
        if (gameState.timer.remaining <= 0) {
          clearInterval(timerInterval);
          timerInterval = null;
          gameState.timer.remaining = 0;
          gameState.timer.isRunning = false;
          gameState.questionState = 'ended';
          io.emit('question_time_up');
          broadcastState();
        }
      }
    }, 1000);
    broadcastState();
  }
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.timer.isRunning = false;
  gameState.questionState = 'ended';
  broadcastState();
}

function archiveCurrentQuestionSubmissions() {
  game.archiveCurrentQuestionSubmissions(gameState);
}

function recalculateScores() {
  game.recalculateScores(gameState, questionsData);
}

// Socket.IO Real-Time Engine
io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;

  // Send Initial Snapshot (Sanitized when question is idle)
  socket.emit('state_update', game.getSanitizedState(gameState));

  // 1. Admin Authentication with Rate Limiting
  socket.on('admin_login', (data) => {
    if (!validator.checkRateLimit(`admin_${clientIp}`, 6, 15000)) {
      return socket.emit('admin_login_error', { error: 'Demasiados intentos. Espera 15 segundos.' });
    }
    const clean = validator.sanitizePayload(data);
    if (isValidAdminPassword(clean.password)) {
      socket.emit('admin_login_success', { ok: true });
      socket.emit('questions_data', questionsData);
    } else {
      socket.emit('admin_login_error', { error: 'Contraseña de administrador incorrecta.' });
    }
  });

  // 2. Team Authentication with Rate Limiting
  socket.on('team_login', (data) => {
    const clean = validator.sanitizePayload(data);
    const rateKey = `team_${clientIp}_${clean.teamId}`;
    if (!validator.checkRateLimit(rateKey, 8, 15000)) {
      return socket.emit('team_login_error', { error: 'Demasiados intentos. Espera un momento.' });
    }
    if (isValidTeamPassword(clean.teamId, clean.password)) {
      socket.emit('team_login_success', { teamId: clean.teamId });
    } else {
      socket.emit('team_login_error', { error: 'Contraseña de carrera incorrecta.' });
    }
  });

  // 3. Admin Round Selection
  socket.on('admin_select_round', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    if (!validator.isValidNumber(clean.roundIndex, 0, questionsData.rounds.length - 1)) return;

    stopTimer();

    gameState.currentRoundIndex = clean.roundIndex;
    gameState.currentQuestionIndex = 0;
    gameState.questionState = 'idle';
    gameState.submissions = [];
    const round = questionsData.rounds[clean.roundIndex];
    if (round) {
      gameState.timer.duration = round.timeLimit;
      gameState.timer.remaining = round.timeLimit;
    }
    initRoundScores();
    broadcastState();
  });

  // 4. Admin Question Selection
  socket.on('admin_select_question', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    const currentRound = questionsData.rounds[gameState.currentRoundIndex];
    if (!currentRound) return;
    if (!validator.isValidNumber(clean.questionIndex, 0, currentRound.questions.length - 1)) return;

    stopTimer();

    // Archive current question before switching
    archiveCurrentQuestionSubmissions();
    recalculateScores();

    gameState.currentQuestionIndex = clean.questionIndex;
    gameState.questionState = 'idle';

    // Check if newly selected question has saved submissions in history
    const saved = gameState.history.find(
      h => h.roundIndex === gameState.currentRoundIndex && h.questionIndex === clean.questionIndex
    );
    gameState.submissions = saved ? JSON.parse(JSON.stringify(saved.submissions)) : [];

    gameState.currentQuestion = currentRound.questions[clean.questionIndex];
    gameState.timer.duration = currentRound.timeLimit;
    gameState.timer.remaining = currentRound.timeLimit;
    recalculateScores();
    broadcastState();
  });

  // 4.1 Admin Next Question Navigation
  socket.on('admin_next_question', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    const currentRound = questionsData.rounds[gameState.currentRoundIndex];
    if (!currentRound) return;

    if (gameState.currentQuestionIndex < currentRound.questions.length - 1) {
      stopTimer();

      // Archive current question submissions before moving
      archiveCurrentQuestionSubmissions();
      recalculateScores();

      gameState.currentQuestionIndex++;
      gameState.questionState = 'idle';

      const saved = gameState.history.find(
        h => h.roundIndex === gameState.currentRoundIndex && h.questionIndex === gameState.currentQuestionIndex
      );
      gameState.submissions = saved ? JSON.parse(JSON.stringify(saved.submissions)) : [];

      gameState.currentQuestion = currentRound.questions[gameState.currentQuestionIndex];
      gameState.timer.duration = currentRound.timeLimit;
      gameState.timer.remaining = currentRound.timeLimit;
      recalculateScores();
      broadcastState();
    }
  });

  // 5. Admin Timer Controls
  socket.on('admin_start_timer', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    const currentRound = questionsData.rounds[gameState.currentRoundIndex];
    if (!currentRound) return;

    if (gameState.questionState !== 'paused') {
      gameState.submissions = [];
    }
    gameState.questionState = 'running';
    gameState.currentQuestion = currentRound.questions[gameState.currentQuestionIndex];
    startTimer(currentRound.timeLimit);
    recalculateScores();
    broadcastState();
    io.emit('question_started', {
      question: gameState.currentQuestion,
      round: currentRound
    });
  });

  socket.on('admin_pause_timer', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    if (gameState.questionState === 'running') {
      pauseTimer();
    } else if (gameState.questionState === 'paused') {
      resumeTimer();
    }
  });

  socket.on('admin_stop_timer', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    stopTimer();
  });

  // 6. Team Answer Submission (Buzzer)
  socket.on('submit_answer', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!validator.isValidTeamId(clean.teamId)) return;

    const validation = game.canSubmit(gameState, clean.teamId);
    if (!validation.allowed) {
      return socket.emit('submission_error', { message: validation.message });
    }

    const elapsedMs = gameState.timer.startTime ? Date.now() - gameState.timer.startTime : 0;
    const submission = game.createSubmission(validation.team, elapsedMs, gameState.submissions.length + 1);

    gameState.submissions.push(submission);
    recalculateScores();

    socket.emit('submission_confirmed', {
      order: submission.order,
      elapsedMs: submission.elapsedMs
    });

    io.emit('new_submission', {
      teamId: submission.teamId,
      teamName: submission.teamName,
      order: submission.order,
      elapsedMs: submission.elapsedMs
    });

    broadcastState();
  });

  // 7. Admin Answer Evaluation
  socket.on('admin_evaluate_answer', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    if (!validator.isValidNumber(clean.submissionIndex, 0, gameState.submissions.length - 1)) return;

    const sub = gameState.submissions[clean.submissionIndex];
    if (sub) {
      sub.correct = clean.correct === true;
      recalculateScores();
      archiveCurrentQuestionSubmissions();
      broadcastState();
      io.emit('evaluation_updated', {
        teamId: sub.teamId,
        correct: sub.correct
      });
    }
  });

  // 7.1 Admin Toggle Leaderboard Screen
  socket.on('admin_toggle_results', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    gameState.showLeaderboard = clean.showLeaderboard !== undefined ? clean.showLeaderboard : !gameState.showLeaderboard;
    broadcastState();
  });

  // 8. Admin Elimination Management
  socket.on('admin_eliminate_team', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    if (!validator.isValidTeamId(clean.teamId)) return;

    const team = game.eliminateTeam(gameState, clean.teamId, gameState.currentRoundIndex + 1);
    if (team) {
      broadcastState();
      io.emit('team_eliminated', {
        teamId: team.id,
        teamName: team.name,
        round: gameState.currentRoundIndex + 1
      });
    }
  });

  // 9. Admin Next Round / Reset
  socket.on('admin_next_round', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;
    if (gameState.currentRoundIndex < questionsData.rounds.length - 1) {
      stopTimer();
      archiveCurrentQuestionSubmissions();
      gameState.currentRoundIndex++;
      gameState.currentQuestionIndex = 0;
      gameState.questionState = 'idle';
      gameState.submissions = [];
      const nextRound = questionsData.rounds[gameState.currentRoundIndex];
      if (nextRound) {
        gameState.timer.duration = nextRound.timeLimit;
        gameState.timer.remaining = nextRound.timeLimit;
        gameState.currentQuestion = nextRound.questions[0];
      }
      initRoundScores();
      broadcastState();
    }
  });

  socket.on('admin_reset_game', (data) => {
    const clean = validator.sanitizePayload(data);
    if (!isValidAdminPassword(clean.adminPassword)) return;

    stopTimer();

    gameState.teams = JSON.parse(JSON.stringify(DEFAULT_TEAMS));
    gameState.currentRoundIndex = 0;
    gameState.currentQuestionIndex = 0;
    gameState.questionState = 'idle';
    gameState.submissions = [];
    gameState.history = [];
    const firstRound = questionsData.rounds[0];
    if (firstRound) {
      gameState.timer.duration = firstRound.timeLimit;
      gameState.timer.remaining = firstRound.timeLimit;
    }
    initRoundScores();
    broadcastState();
  });
});

// Global Express Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[QQSI Server Error]:', err.stack || err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: NODE_ENV === 'development' ? err.message : 'Error interno en el servidor.'
  });
});

// Lifecycle Helpers
function startServer(port = PORT, host = '0.0.0.0') {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve(server);
    }).on('error', reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (io) {
      io.close(() => {
        if (server.listening) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    } else if (server.listening) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// Start Server when executed directly
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` ¿QUIÉN QUIERE SER INGENIERO? — SERVIDOR EN VIVO`);
    console.log(` Puerto: ${PORT} | Entorno: ${NODE_ENV}`);
    console.log(` Orígenes Permitidos: ${rawAllowedOrigins.join(', ')}`);
    console.log(` Rondas cargadas: ${questionsData.rounds.length}`);
    console.log(`====================================================`);
  });
}

module.exports = {
  app,
  server,
  io,
  startServer,
  stopServer,
  DEFAULT_TEAMS,
  gameState,
  initRoundScores,
  recalculateScores,
  archiveCurrentQuestionSubmissions,
  questionsData
};
