import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQuestionType, buildKnowledgeAnswer } from '../aiAssistant.js';

test('classifies live score questions correctly', () => {
  assert.equal(classifyQuestionType('What is the current score?'), 'live');
  assert.equal(classifyQuestionType('What are the tournament rules?'), 'rules');
});

test('builds a helpful answer from knowledge content', () => {
  const answer = buildKnowledgeAnswer('How does the tournament work?', [
    { title: 'Tournament Rules', content: 'The tournament follows a one-on-one knockout format with match rules, venue timings, and player check-in.' },
  ]);

  assert.match(answer.text, /knockout|match rules|check-in/i);
  assert.equal(answer.sources.length, 1);
});
