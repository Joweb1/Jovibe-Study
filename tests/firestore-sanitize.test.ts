import assert from 'node:assert/strict';
import test from 'node:test';
import { stripUndefinedDeep } from '../src/utils/validation.ts';

test('stripUndefinedDeep removes undefined keys recursively from segment entry payloads', () => {
  const entries = [
    {
      id: 'ent_1',
      kind: 'lesson',
      unitId: 'u1',
      unitTitle: 'Introduction',
      markdown: 'Lesson body',
      question: 'What is X?',
      score: undefined,
      decision: undefined,
      visualPrompt: undefined,
      visualCaption: undefined,
      timestampMs: 1700000000000,
    },
    {
      id: 'ent_2',
      kind: 'evaluation',
      unitId: 'u1',
      unitTitle: 'Introduction',
      markdown: 'Great answer',
      question: undefined,
      score: 9,
      decision: 'advance',
      timestampMs: 1700000000001,
    },
  ];

  const cleaned = stripUndefinedDeep(entries);
  assert.equal(cleaned.length, 2);
  assert.equal('score' in cleaned[0], false);
  assert.equal('decision' in cleaned[0], false);
  assert.equal('visualPrompt' in cleaned[0], false);
  assert.equal('visualCaption' in cleaned[0], false);
  assert.equal(cleaned[0].question, 'What is X?');
  assert.equal('question' in cleaned[1], false);
  assert.equal(cleaned[1].score, 9);
});

test('stripUndefinedDeep removes undefined array items and preserves null, primitives, and class instances', () => {
  class FakeFieldValue {
    readonly marker = 'serverTimestamp';
  }
  const sentinel = new FakeFieldValue();
  const created = new Date('2026-01-01T00:00:00Z');

  const cleaned = stripUndefinedDeep({
    keepNull: null,
    keepZero: 0,
    keepFalse: false,
    keepEmpty: '',
    dropMe: undefined,
    nested: { a: 1, b: undefined },
    list: ['ok', undefined, { x: undefined, y: 2 }],
    sentinel,
    created,
  });

  assert.equal(cleaned.keepNull, null);
  assert.equal(cleaned.keepZero, 0);
  assert.equal(cleaned.keepFalse, false);
  assert.equal(cleaned.keepEmpty, '');
  assert.equal('dropMe' in cleaned, false);
  assert.deepEqual(cleaned.nested, { a: 1 });
  assert.deepEqual(cleaned.list, ['ok', { y: 2 }]);
  assert.equal(cleaned.sentinel, sentinel);
  assert.equal(cleaned.created, created);
});
