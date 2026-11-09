const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const validator = require('../../utils/validator');

describe('utils/validator.js', () => {
  describe('cleanString', () => {
    it('elimina caracteres de control y recorta espacios', () => {
      const input = '  Hola\x00\x1F Mundo\x7F  ';
      const result = validator.cleanString(input);
      assert.equal(result, 'Hola Mundo');
    });

    it('respeta el limite maximo de longitud', () => {
      const longStr = 'a'.repeat(200);
      const result = validator.cleanString(longStr, 50);
      assert.equal(result.length, 50);
    });

    it('retorna string vacio si la entrada no es string', () => {
      assert.equal(validator.cleanString(null), '');
      assert.equal(validator.cleanString(undefined), '');
      assert.equal(validator.cleanString(123), '');
      assert.equal(validator.cleanString({}), '');
    });
  });

  describe('isValidTeamId', () => {
    it('acepta los 6 equipos validos de la competencia', () => {
      const valid = ['sistemas', 'software', 'alimentos', 'quimica', 'civil', 'petroquimica'];
      for (const id of valid) {
        assert.equal(validator.isValidTeamId(id), true, `Equipo ${id} deberia ser valido`);
        assert.equal(validator.isValidTeamId(id.toUpperCase()), true, `Equipo ${id} en mayusculas deberia ser valido`);
      }
    });

    it('rechaza IDs invalidos o vacios', () => {
      assert.equal(validator.isValidTeamId('invalido'), false);
      assert.equal(validator.isValidTeamId(''), false);
      assert.equal(validator.isValidTeamId(null), false);
      assert.equal(validator.isValidTeamId(undefined), false);
    });
  });

  describe('isValidNumber', () => {
    it('valida numeros dentro del rango especificado', () => {
      assert.equal(validator.isValidNumber(5, 0, 10), true);
      assert.equal(validator.isValidNumber(0, 0, 10), true);
      assert.equal(validator.isValidNumber(10, 0, 10), true);
    });

    it('rechaza numeros fuera de rango o tipos no numericos', () => {
      assert.equal(validator.isValidNumber(-1, 0, 10), false);
      assert.equal(validator.isValidNumber(11, 0, 10), false);
      assert.equal(validator.isValidNumber(NaN, 0, 10), false);
      assert.equal(validator.isValidNumber(Infinity, 0, 10), false);
      assert.equal(validator.isValidNumber('5', 0, 10), false);
      assert.equal(validator.isValidNumber(null, 0, 10), false);
    });
  });

  describe('sanitizePayload', () => {
    it('limpia strings y preserva numeros y booleanos recursivamente en el objeto', () => {
      const raw = {
        name: '  Equipo\x00 Uno  ',
        score: 15,
        isActive: true,
        tags: ['a', 'b\x1F']
      };
      const clean = validator.sanitizePayload(raw);
      assert.deepEqual(clean, {
        name: 'Equipo Uno',
        score: 15,
        isActive: true,
        tags: ['a', 'b\x1F']
      });
    });

    it('retorna objeto vacio si el payload no es objeto valido', () => {
      assert.deepEqual(validator.sanitizePayload(null), {});
      assert.deepEqual(validator.sanitizePayload(undefined), {});
      assert.deepEqual(validator.sanitizePayload('texto'), {});
    });
  });

  describe('checkRateLimit', () => {
    it('permite solicitudes dentro del limite y bloquea al exceder', () => {
      const key = `test_rate_${Date.now()}`;
      assert.equal(validator.checkRateLimit(key, 3, 1000), true);
      assert.equal(validator.checkRateLimit(key, 3, 1000), true);
      assert.equal(validator.checkRateLimit(key, 3, 1000), true);
      assert.equal(validator.checkRateLimit(key, 3, 1000), false);
    });
  });
});
