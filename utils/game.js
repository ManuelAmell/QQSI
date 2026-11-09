/**
 * Pure Game Logic Engine for QQSI (¿Quién quiere ser Ingeniero?)
 *
 * Encapsulates game state management, round scoring, speed bonus reallocation,
 * submission validation, and team elimination without network/socket dependencies.
 */

const BASE_POINTS = 10;
const SPEED_BONUSES = [5, 3, 1];

const DEFAULT_TEAMS = [
  { id: 'sistemas', name: 'Ingeniería de Sistemas', shortName: 'Sistemas', color: '#0284c7', eliminated: false, score: 0, eliminatedInRound: null },
  { id: 'software', name: 'Ingeniería de Software', shortName: 'Software', color: '#06b6d4', eliminated: false, score: 0, eliminatedInRound: null },
  { id: 'alimentos', name: 'Ingeniería de Alimentos', shortName: 'Alimentos', color: '#16a34a', eliminated: false, score: 0, eliminatedInRound: null },
  { id: 'quimica', name: 'Ingeniería Química', shortName: 'Química', color: '#9333ea', eliminated: false, score: 0, eliminatedInRound: null },
  { id: 'civil', name: 'Ingeniería Civil', shortName: 'Civil', color: '#ea580c', eliminated: false, score: 0, eliminatedInRound: null },
  { id: 'petroquimica', name: 'Téc. Procesos Petroquímicos', shortName: 'Petroquímica', color: '#0d9488', eliminated: false, score: 0, eliminatedInRound: null }
];

function createInitialGameState() {
  const state = {
    teams: JSON.parse(JSON.stringify(DEFAULT_TEAMS)),
    currentRoundIndex: 0,
    currentQuestionIndex: 0,
    questionState: 'idle', // 'idle' | 'running' | 'paused' | 'ended' | 'evaluated'
    timer: {
      duration: 120,
      remaining: 120,
      isRunning: false,
      startTime: null,
      endTime: null
    },
    currentQuestion: null,
    submissions: [],
    roundScores: {},
    history: [],
    roundSummary: null
  };
  initRoundScores(state);
  return state;
}

function initRoundScores(gameState) {
  gameState.roundScores = {};
  gameState.teams.forEach(t => {
    if (!t.eliminated) {
      gameState.roundScores[t.id] = 0;
      t.score = 0;
    }
  });
}

function calculateSubmissionScores(submissions) {
  const correctSubmissions = submissions.filter(s => s.correct === true);

  submissions.forEach(sub => {
    if (sub.correct === true) {
      sub.basePoints = BASE_POINTS;
      const rankIdx = correctSubmissions.indexOf(sub);
      sub.bonusPoints = (rankIdx >= 0 && rankIdx < SPEED_BONUSES.length) ? SPEED_BONUSES[rankIdx] : 0;
      sub.totalPoints = sub.basePoints + sub.bonusPoints;
    } else {
      sub.basePoints = 0;
      sub.bonusPoints = 0;
      sub.totalPoints = 0;
    }
  });

  return submissions;
}

function recalculateScores(gameState, questionsData) {
  if (questionsData && questionsData.rounds) {
    const currentRound = questionsData.rounds[gameState.currentRoundIndex];
    if (!currentRound) return;
  }

  calculateSubmissionScores(gameState.submissions);

  const roundPointsByTeam = {};
  gameState.teams.forEach(t => {
    if (!t.eliminated) roundPointsByTeam[t.id] = 0;
  });

  // 1. Accumulate points from previous questions in this round
  gameState.history.forEach(item => {
    if (item.roundIndex === gameState.currentRoundIndex && item.questionIndex !== gameState.currentQuestionIndex) {
      item.submissions.forEach(sub => {
        if (sub.totalPoints && roundPointsByTeam[sub.teamId] !== undefined) {
          roundPointsByTeam[sub.teamId] += sub.totalPoints;
        }
      });
    }
  });

  // 2. Accumulate points from the current active question
  gameState.submissions.forEach(sub => {
    if (sub.totalPoints && roundPointsByTeam[sub.teamId] !== undefined) {
      roundPointsByTeam[sub.teamId] += sub.totalPoints;
    }
  });

  gameState.roundScores = roundPointsByTeam;
  gameState.teams.forEach(t => {
    if (roundPointsByTeam[t.id] !== undefined) {
      t.score = roundPointsByTeam[t.id];
    }
  });
}

function archiveCurrentQuestionSubmissions(gameState) {
  if (!gameState.submissions || gameState.submissions.length === 0) return;

  const existingIdx = gameState.history.findIndex(
    h => h.roundIndex === gameState.currentRoundIndex && h.questionIndex === gameState.currentQuestionIndex
  );

  const historyEntry = {
    roundIndex: gameState.currentRoundIndex,
    questionIndex: gameState.currentQuestionIndex,
    submissions: JSON.parse(JSON.stringify(gameState.submissions))
  };

  if (existingIdx >= 0) {
    gameState.history[existingIdx] = historyEntry;
  } else {
    gameState.history.push(historyEntry);
  }
}

function canSubmit(gameState, teamId) {
  if (gameState.questionState !== 'running') {
    return { allowed: false, message: 'La pregunta no está activa.' };
  }

  const team = gameState.teams.find(t => t.id === teamId);
  if (!team || team.eliminated) {
    return { allowed: false, message: 'El equipo está eliminado o no es válido.' };
  }

  const alreadySubmitted = gameState.submissions.some(s => s.teamId === teamId);
  if (alreadySubmitted) {
    return { allowed: false, message: 'Tu equipo ya entregó la respuesta.' };
  }

  return { allowed: true, team };
}

function createSubmission(team, elapsedMs, order) {
  return {
    teamId: team.id,
    teamName: team.shortName || team.name,
    submittedAt: Date.now(),
    elapsedMs: Math.max(0, elapsedMs),
    correct: null,
    basePoints: 0,
    bonusPoints: 0,
    totalPoints: 0,
    order
  };
}

function eliminateTeam(gameState, teamId, roundNumber) {
  const team = gameState.teams.find(t => t.id === teamId);
  if (team) {
    team.eliminated = true;
    team.eliminatedInRound = roundNumber;
    return team;
  }
  return null;
}

function getSanitizedState(gameState) {
  const payload = JSON.parse(JSON.stringify(gameState));
  if (payload.questionState === 'idle') {
    payload.currentQuestion = null;
  }
  return payload;
}

module.exports = {
  BASE_POINTS,
  SPEED_BONUSES,
  DEFAULT_TEAMS,
  createInitialGameState,
  initRoundScores,
  calculateSubmissionScores,
  recalculateScores,
  archiveCurrentQuestionSubmissions,
  canSubmit,
  createSubmission,
  eliminateTeam,
  getSanitizedState
};
