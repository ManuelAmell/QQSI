const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../../utils/game');
const server = require('../../server');

describe('utils/game.js (Motor Puro del Concurso)', () => {
  let gameState;
  const mockQuestionsData = {
    rounds: [
      { id: 'facil', timeLimit: 120, questions: [{ id: 'q1' }, { id: 'q2' }] }
    ]
  };

  beforeEach(() => {
    gameState = game.createInitialGameState();
  });

  describe('DEFAULT_TEAMS y Estado Inicial', () => {
    it('inicia con exactamente 6 carreras universitarias activas y 0 puntos', () => {
      assert.equal(gameState.teams.length, 6);
      const ids = gameState.teams.map(t => t.id);
      assert.deepEqual(ids, ['sistemas', 'software', 'alimentos', 'quimica', 'civil', 'petroquimica']);

      for (const team of gameState.teams) {
        assert.equal(team.score, 0);
        assert.equal(team.eliminated, false);
        assert.equal(team.eliminatedInRound, null);
      }
    });

    it('initRoundScores reinicia a 0 solo los puntajes de equipos no eliminados', () => {
      gameState.teams[0].score = 25;
      gameState.teams[1].score = 15;
      gameState.teams[1].eliminated = true;
      gameState.teams[1].eliminatedInRound = 1;

      game.initRoundScores(gameState);

      assert.equal(gameState.teams[0].score, 0);
      assert.equal(gameState.roundScores['sistemas'], 0);
      assert.equal(gameState.teams[1].score, 15);
      assert.equal(gameState.roundScores['software'], undefined);
    });
  });

  describe('Reglas de Puntuación Base y Bonos de Velocidad (calculateSubmissionScores)', () => {
    it('otorga 10 puntos base solo si la respuesta es correcta', () => {
      const submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: false, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 3, correct: null, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      game.calculateSubmissionScores(submissions);

      assert.equal(submissions[0].basePoints, 10);
      assert.equal(submissions[1].basePoints, 0);
      assert.equal(submissions[2].basePoints, 0);
    });

    it('asigna bonos de velocidad +5, +3, +1 segun orden de acierto', () => {
      const submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 3, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'quimica', order: 4, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      game.calculateSubmissionScores(submissions);

      assert.equal(submissions[0].bonusPoints, 5);
      assert.equal(submissions[0].totalPoints, 15);

      assert.equal(submissions[1].bonusPoints, 3);
      assert.equal(submissions[1].totalPoints, 13);

      assert.equal(submissions[2].bonusPoints, 1);
      assert.equal(submissions[2].totalPoints, 11);

      assert.equal(submissions[3].bonusPoints, 0);
      assert.equal(submissions[3].totalPoints, 10);
    });

    it('transfiere el bono de velocidad +5 al siguiente equipo si el primero falla', () => {
      const submissions = [
        { teamId: 'sistemas', order: 1, correct: false, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'quimica', order: 3, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      game.calculateSubmissionScores(submissions);

      assert.equal(submissions[0].basePoints, 0);
      assert.equal(submissions[0].bonusPoints, 0);
      assert.equal(submissions[0].totalPoints, 0);

      assert.equal(submissions[1].basePoints, 10);
      assert.equal(submissions[1].bonusPoints, 5);
      assert.equal(submissions[1].totalPoints, 15);

      assert.equal(submissions[2].basePoints, 10);
      assert.equal(submissions[2].bonusPoints, 3);
      assert.equal(submissions[2].totalPoints, 13);
    });

    it('reordena dinamicamente los bonos cuando el moderador califica fuera de orden', () => {
      const submissions = [
        { teamId: 'sistemas', order: 1, correct: null, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      game.calculateSubmissionScores(submissions);
      assert.equal(submissions[1].bonusPoints, 5);
      assert.equal(submissions[1].totalPoints, 15);

      submissions[0].correct = true;
      game.calculateSubmissionScores(submissions);

      assert.equal(submissions[0].bonusPoints, 5);
      assert.equal(submissions[0].totalPoints, 15);
      assert.equal(submissions[1].bonusPoints, 3);
      assert.equal(submissions[1].totalPoints, 13);
    });
  });

  describe('Acumulación de Ronda e Historial (recalculateScores)', () => {
    it('acumula los puntos de preguntas archivadas en la misma ronda', () => {
      gameState.history = [
        {
          roundIndex: 0,
          questionIndex: 0,
          submissions: [
            { teamId: 'sistemas', totalPoints: 15 },
            { teamId: 'alimentos', totalPoints: 13 }
          ]
        }
      ];

      gameState.currentQuestionIndex = 1;
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      game.recalculateScores(gameState, mockQuestionsData);

      assert.equal(gameState.roundScores['sistemas'], 30);
      assert.equal(gameState.teams.find(t => t.id === 'sistemas').score, 30);
      assert.equal(gameState.roundScores['alimentos'], 13);
      assert.equal(gameState.teams.find(t => t.id === 'alimentos').score, 13);
    });

    it('archiveCurrentQuestionSubmissions guarda las entregas y actualiza si ya existe', () => {
      gameState.currentRoundIndex = 0;
      gameState.currentQuestionIndex = 0;
      gameState.submissions = [
        { teamId: 'sistemas', totalPoints: 15 }
      ];

      game.archiveCurrentQuestionSubmissions(gameState);
      assert.equal(gameState.history.length, 1);
      assert.equal(gameState.history[0].submissions[0].totalPoints, 15);

      gameState.submissions[0].totalPoints = 10;
      game.archiveCurrentQuestionSubmissions(gameState);
      assert.equal(gameState.history.length, 1);
      assert.equal(gameState.history[0].submissions[0].totalPoints, 10);
    });
  });

  describe('Validación y Creación de Entregas (canSubmit / createSubmission)', () => {
    it('rechaza entregas si la pregunta no está en estado running', () => {
      gameState.questionState = 'idle';
      const check = game.canSubmit(gameState, 'sistemas');
      assert.equal(check.allowed, false);
      assert.equal(check.message, 'La pregunta no está activa.');
    });

    it('rechaza entregas si el equipo está eliminado', () => {
      gameState.questionState = 'running';
      gameState.teams[0].eliminated = true;
      const check = game.canSubmit(gameState, 'sistemas');
      assert.equal(check.allowed, false);
      assert.equal(check.message, 'El equipo está eliminado o no es válido.');
    });

    it('rechaza entregas duplicadas del mismo equipo en la misma pregunta', () => {
      gameState.questionState = 'running';
      gameState.submissions.push({ teamId: 'sistemas' });
      const check = game.canSubmit(gameState, 'sistemas');
      assert.equal(check.allowed, false);
      assert.equal(check.message, 'Tu equipo ya entregó la respuesta.');
    });

    it('permite entrega valida y createSubmission genera el formato correcto', () => {
      gameState.questionState = 'running';
      const check = game.canSubmit(gameState, 'sistemas');
      assert.equal(check.allowed, true);

      const sub = game.createSubmission(check.team, 4200, 1);
      assert.equal(sub.teamId, 'sistemas');
      assert.equal(sub.teamName, 'Sistemas');
      assert.equal(sub.elapsedMs, 4200);
      assert.equal(sub.order, 1);
      assert.equal(sub.correct, null);
      assert.equal(sub.basePoints, 0);
      assert.equal(sub.bonusPoints, 0);
      assert.equal(sub.totalPoints, 0);
    });
  });

  describe('Eliminación Manual de Equipos', () => {
    it('eliminateTeam marca al equipo como eliminado y registra eliminatedInRound', () => {
      const eliminated = game.eliminateTeam(gameState, 'civil', 1);
      assert.notEqual(eliminated, null);
      assert.equal(eliminated.eliminated, true);
      assert.equal(eliminated.eliminatedInRound, 1);

      const teamInState = gameState.teams.find(t => t.id === 'civil');
      assert.equal(teamInState.eliminated, true);
      assert.equal(teamInState.eliminatedInRound, 1);

      game.initRoundScores(gameState);
      assert.equal(gameState.roundScores['civil'], undefined);
    });

    it('retorna null si el teamId a eliminar no existe', () => {
      assert.equal(game.eliminateTeam(gameState, 'no_existe', 1), null);
    });
  });

  describe('Privacidad de Estado en Pantalla (getSanitizedState)', () => {
    it('oculta currentQuestion (null) cuando el estado es idle', () => {
      gameState.questionState = 'idle';
      gameState.currentQuestion = { statement: 'Pregunta secreta' };
      const sanitized = game.getSanitizedState(gameState);
      assert.equal(sanitized.currentQuestion, null);
      // El estado interno no se muta
      assert.notEqual(gameState.currentQuestion, null);
    });

    it('revela currentQuestion cuando el estado es running', () => {
      gameState.questionState = 'running';
      gameState.currentQuestion = { statement: 'Pregunta visible' };
      const sanitized = game.getSanitizedState(gameState);
      assert.deepEqual(sanitized.currentQuestion, { statement: 'Pregunta visible' });
    });
  });

  describe('Bugs Demostrados en la Lógica Actual (Marcados con skip/todo)', () => {
    it.skip('BUG 1: recalculateScores() falla silenciosamente si questionsData.rounds esta vacio o index fuera de rango', () => {
      gameState.currentRoundIndex = 999;
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];
      game.recalculateScores(gameState, mockQuestionsData);
      assert.equal(gameState.submissions[0].totalPoints, 0);
    });

    it.skip('BUG 2: archiveCurrentQuestionSubmissions() no borra historial previo si la pregunta se reinicia sin entregas', () => {
      gameState.history = [{ roundIndex: 0, questionIndex: 0, submissions: [{ teamId: 'sistemas', totalPoints: 15 }] }];
      gameState.submissions = [];
      game.archiveCurrentQuestionSubmissions(gameState);
      assert.equal(gameState.history[0].submissions.length, 1);
    });
  });
});
