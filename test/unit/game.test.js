const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const server = require('../../server');

describe('Caracterización de Reglas de Juego (server.js actual)', () => {
  let gameState;

  beforeEach(() => {
    // Restaurar gameState a un estado base antes de cada test
    gameState = server.gameState;
    gameState.teams = JSON.parse(JSON.stringify(server.DEFAULT_TEAMS));
    gameState.currentRoundIndex = 0;
    gameState.currentQuestionIndex = 0;
    gameState.questionState = 'idle';
    gameState.submissions = [];
    gameState.history = [];
    server.initRoundScores();
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

      server.initRoundScores();

      assert.equal(gameState.teams[0].score, 0);
      assert.equal(gameState.roundScores['sistemas'], 0);
      // El equipo eliminado conserva su score previo y no está en roundScores
      assert.equal(gameState.teams[1].score, 15);
      assert.equal(gameState.roundScores['software'], undefined);
    });
  });

  describe('Reglas de Puntuación Base y Bonos de Velocidad', () => {
    it('otorga 10 puntos base solo si la respuesta es correcta', () => {
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: false, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 3, correct: null, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      server.recalculateScores();

      assert.equal(gameState.submissions[0].basePoints, 10);
      assert.equal(gameState.submissions[1].basePoints, 0);
      assert.equal(gameState.submissions[2].basePoints, 0);
    });

    it('asigna bonos de velocidad +5, +3, +1 segun orden de acierto', () => {
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 3, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'quimica', order: 4, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      server.recalculateScores();

      // 1er acierto: 10 + 5 = 15
      assert.equal(gameState.submissions[0].bonusPoints, 5);
      assert.equal(gameState.submissions[0].totalPoints, 15);

      // 2do acierto: 10 + 3 = 13
      assert.equal(gameState.submissions[1].bonusPoints, 3);
      assert.equal(gameState.submissions[1].totalPoints, 13);

      // 3er acierto: 10 + 1 = 11
      assert.equal(gameState.submissions[2].bonusPoints, 1);
      assert.equal(gameState.submissions[2].totalPoints, 11);

      // 4to acierto: 10 + 0 = 10
      assert.equal(gameState.submissions[3].bonusPoints, 0);
      assert.equal(gameState.submissions[3].totalPoints, 10);
    });

    it('transfiere el bono de velocidad +5 al siguiente equipo si el primero falla', () => {
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: false, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'alimentos', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'quimica', order: 3, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      server.recalculateScores();

      // Sistemas fallo: 0 base, 0 bono, 0 total
      assert.equal(gameState.submissions[0].basePoints, 0);
      assert.equal(gameState.submissions[0].bonusPoints, 0);
      assert.equal(gameState.submissions[0].totalPoints, 0);

      // Alimentos fue el 1er acierto -> recibe el bono transferido de +5
      assert.equal(gameState.submissions[1].basePoints, 10);
      assert.equal(gameState.submissions[1].bonusPoints, 5);
      assert.equal(gameState.submissions[1].totalPoints, 15);

      // Quimica fue el 2do acierto -> recibe +3
      assert.equal(gameState.submissions[2].basePoints, 10);
      assert.equal(gameState.submissions[2].bonusPoints, 3);
      assert.equal(gameState.submissions[2].totalPoints, 13);
    });

    it('reordena dinamicamente los bonos cuando el moderador califica fuera de orden', () => {
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: null, basePoints: 0, bonusPoints: 0, totalPoints: 0 },
        { teamId: 'software', order: 2, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      // Al evaluar solo al segundo equipo, temporalmente tiene el 1er acierto
      server.recalculateScores();
      assert.equal(gameState.submissions[1].bonusPoints, 5);
      assert.equal(gameState.submissions[1].totalPoints, 15);

      // Ahora el juez aprueba al primer equipo
      gameState.submissions[0].correct = true;
      server.recalculateScores();

      // Sistemas pasa a 1er acierto (+5) y Software pasa a 2do acierto (+3)
      assert.equal(gameState.submissions[0].bonusPoints, 5);
      assert.equal(gameState.submissions[0].totalPoints, 15);
      assert.equal(gameState.submissions[1].bonusPoints, 3);
      assert.equal(gameState.submissions[1].totalPoints, 13);
    });
  });

  describe('Acumulación de Ronda e Historial', () => {
    it('acumula los puntos de preguntas archivadas en la misma ronda', () => {
      // Pregunta 0 archivada
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

      // Pregunta 1 activa
      gameState.currentQuestionIndex = 1;
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];

      server.recalculateScores();

      // Sistemas: 15 (historial) + 15 (activa) = 30
      assert.equal(gameState.roundScores['sistemas'], 30);
      assert.equal(gameState.teams.find(t => t.id === 'sistemas').score, 30);

      // Alimentos: 13 (historial) + 0 (activa) = 13
      assert.equal(gameState.roundScores['alimentos'], 13);
      assert.equal(gameState.teams.find(t => t.id === 'alimentos').score, 13);
    });

    it('archiveCurrentQuestionSubmissions guarda las entregas y actualiza si ya existe', () => {
      gameState.currentRoundIndex = 0;
      gameState.currentQuestionIndex = 0;
      gameState.submissions = [
        { teamId: 'sistemas', totalPoints: 15 }
      ];

      server.archiveCurrentQuestionSubmissions();
      assert.equal(gameState.history.length, 1);
      assert.equal(gameState.history[0].submissions[0].totalPoints, 15);

      // Actualizar la misma pregunta
      gameState.submissions[0].totalPoints = 10;
      server.archiveCurrentQuestionSubmissions();
      assert.equal(gameState.history.length, 1);
      assert.equal(gameState.history[0].submissions[0].totalPoints, 10);
    });
  });

  describe('Eliminación de Equipos', () => {
    it('marca al equipo como eliminado y registra eliminatedInRound', () => {
      const team = gameState.teams.find(t => t.id === 'civil');
      team.eliminated = true;
      team.eliminatedInRound = 1;

      assert.equal(team.eliminated, true);
      assert.equal(team.eliminatedInRound, 1);

      // initRoundScores no lo agrega a roundScores
      server.initRoundScores();
      assert.equal(gameState.roundScores['civil'], undefined);
    });
  });

  describe('Bugs Demostrados en la Lógica Actual (Marcados con skip/todo)', () => {
    it.skip('BUG 1: recalculateScores() falla silenciosamente si questionsData.rounds esta vacio o index fuera de rango', () => {
      // Demostración del bug en server.js:
      // const currentRound = questionsData.rounds[gameState.currentRoundIndex];
      // if (!currentRound) return;
      // Aborta sin calcular nada aunque submissions tenga datos válidos.
      gameState.currentRoundIndex = 999;
      gameState.submissions = [
        { teamId: 'sistemas', order: 1, correct: true, basePoints: 0, bonusPoints: 0, totalPoints: 0 }
      ];
      server.recalculateScores();
      // Debido al bug, totalPoints sigue en 0 en lugar de 15:
      assert.equal(gameState.submissions[0].totalPoints, 0);
    });

    it.skip('BUG 2: archiveCurrentQuestionSubmissions() no borra historial previo si la pregunta se reinicia sin entregas', () => {
      // Demostración del bug:
      // if (!gameState.submissions || gameState.submissions.length === 0) return;
      // Deja intacto el historial anterior causando "entregas fantasma" si se reinicia la pregunta.
      gameState.history = [{ roundIndex: 0, questionIndex: 0, submissions: [{ teamId: 'sistemas', totalPoints: 15 }] }];
      gameState.submissions = [];
      server.archiveCurrentQuestionSubmissions();
      // El historial viejo no se limpia:
      assert.equal(gameState.history[0].submissions.length, 1);
    });
  });
});
