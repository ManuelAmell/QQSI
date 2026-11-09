const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { server, startServer, stopServer } = require('../../server');

function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tiempo de espera agotado esperando evento "${eventName}"`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Test de Integración Socket.IO (E2E en Puerto Efímero)', () => {
  let serverUrl;
  let adminSocket;
  let teamSistemasSocket;
  let teamAlimentosSocket;
  let teamCivilSocket;
  const adminPassword = process.env.ADMIN_PASSWORD || 'LinoTeto';

  before(async () => {
    // Iniciar servidor en puerto efímero (PORT 0 le indica al SO asignar uno libre)
    await startServer(0, '127.0.0.1');
    const port = server.address().port;
    serverUrl = `http://127.0.0.1:${port}`;

    // Conectar sockets cliente
    adminSocket = io(serverUrl, { reconnection: false, forceNew: true });
    teamSistemasSocket = io(serverUrl, { reconnection: false, forceNew: true });
    teamAlimentosSocket = io(serverUrl, { reconnection: false, forceNew: true });
    teamCivilSocket = io(serverUrl, { reconnection: false, forceNew: true });

    await Promise.all([
      waitForEvent(adminSocket, 'connect'),
      waitForEvent(teamSistemasSocket, 'connect'),
      waitForEvent(teamAlimentosSocket, 'connect'),
      waitForEvent(teamCivilSocket, 'connect')
    ]);
  });

  after(async () => {
    if (adminSocket && adminSocket.connected) adminSocket.disconnect();
    if (teamSistemasSocket && teamSistemasSocket.connected) teamSistemasSocket.disconnect();
    if (teamAlimentosSocket && teamAlimentosSocket.connected) teamAlimentosSocket.disconnect();
    if (teamCivilSocket && teamCivilSocket.connected) teamCivilSocket.disconnect();
    await stopServer();
  });

  it('permite autenticacion de administrador y recibe snapshot de estado inicial', async () => {
    const loginPromise = waitForEvent(adminSocket, 'admin_login_success');
    adminSocket.emit('admin_login', { password: adminPassword });
    const loginRes = await loginPromise;
    assert.equal(loginRes.ok, true);
  });

  it('recorre una pregunta completa con transferencia de bono +5 por fallo del 1er equipo', async () => {
    // 1. Iniciar pregunta / temporizador
    const questionStartedPromise = waitForEvent(adminSocket, 'question_started');
    adminSocket.emit('admin_start_timer', { adminPassword });
    const startedData = await questionStartedPromise;
    assert.notEqual(startedData.question, null);

    // 2. Entrega de Sistemas (1er lugar de pulsador)
    const subConf1Promise = waitForEvent(teamSistemasSocket, 'submission_confirmed');
    teamSistemasSocket.emit('submit_answer', { teamId: 'sistemas' });
    const sub1 = await subConf1Promise;
    assert.equal(sub1.order, 1);

    // 3. Entrega de Alimentos (2do lugar de pulsador)
    const subConf2Promise = waitForEvent(teamAlimentosSocket, 'submission_confirmed');
    teamAlimentosSocket.emit('submit_answer', { teamId: 'alimentos' });
    const sub2 = await subConf2Promise;
    assert.equal(sub2.order, 2);

    // 4. Juez evalúa: Sistemas (1º) INCORRECTO -> 0 pts
    const eval1Promise = waitForEvent(adminSocket, 'evaluation_updated');
    adminSocket.emit('admin_evaluate_answer', {
      adminPassword,
      submissionIndex: 0,
      correct: false
    });
    const eval1 = await eval1Promise;
    assert.equal(eval1.teamId, 'sistemas');
    assert.equal(eval1.correct, false);

    // 5. Juez evalúa: Alimentos (2º) CORRECTO -> debe recibir 10 base + 5 bono transferido = 15 pts!
    const stateUpdatePromise = waitForEvent(adminSocket, 'state_update');
    adminSocket.emit('admin_evaluate_answer', {
      adminPassword,
      submissionIndex: 1,
      correct: true
    });
    const state = await stateUpdatePromise;

    const subSis = state.submissions.find(s => s.teamId === 'sistemas');
    const subAli = state.submissions.find(s => s.teamId === 'alimentos');

    assert.equal(subSis.correct, false);
    assert.equal(subSis.totalPoints, 0);

    assert.equal(subAli.correct, true);
    assert.equal(subAli.basePoints, 10);
    assert.equal(subAli.bonusPoints, 5); // Transferencia confirmada
    assert.equal(subAli.totalPoints, 15);
    assert.equal(state.roundScores['alimentos'], 15);
  });

  it('permite eliminacion manual de un equipo y bloquea entregas posteriores del equipo eliminado', async () => {
    // 1. Eliminar Civil
    const eliminatedPromise = waitForEvent(adminSocket, 'team_eliminated');
    adminSocket.emit('admin_eliminate_team', {
      adminPassword,
      teamId: 'civil'
    });
    const eliminatedData = await eliminatedPromise;
    assert.equal(eliminatedData.teamId, 'civil');

    // 2. Civil intenta pulsar y recibe submission_error
    const errorPromise = waitForEvent(teamCivilSocket, 'submission_error');
    teamCivilSocket.emit('submit_answer', { teamId: 'civil' });
    const err = await errorPromise;
    assert.equal(err.message, 'El equipo está eliminado o no es válido.');
  });

  it.skip('BUG 3: timerInterval no se cancela al cambiar de ronda o pregunta mientras corre el cronometro', () => {
    // Si el moderador cambia de ronda sin pausar/detener, el setInterval original sigue activo
    // causando colisiones de eventos de tiempo en rondas futuras.
    assert.fail('Demostración de fuga de intervalo en server.js');
  });
});
