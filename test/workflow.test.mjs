import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate, validatePr, readyFor } from '../lib/workflow.mjs';

const head = 'a'.repeat(40);
const repo = { slug: 'time/api', base: 'develop', checks: ['test'] };
const task = { id: 'API-01', repo: repo.slug, dev: 'claude', qa: 'codex', depends: [] };
const pr = {
  number: 3, url: 'https://github.com/time/api/pull/3', baseRefName: 'develop',
  headRefName: 'feature/api-01', state: 'OPEN', headRefOid: head, author: { login: 'dev' },
  statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  reviews: [], comments: []
};
const verdict = (body, login = 'qa') => ({
  body, author: { login }, createdAt: '2026-11-06T10:00:00Z'
});

test('requires trusted QA approval on the current SHA and successful configured CI', () => {
  const evaluatePr = (changes) => evaluate({ ...pr, ...changes }, repo, 'qa').stage;
  assert.equal(evaluatePr({ comments: [verdict('QA: APROVADO ' + head, 'dev')] }), 'review');
  assert.equal(evaluatePr({ comments: [verdict('QA: APROVADO ' + 'b'.repeat(40))] }), 'review');
  assert.equal(evaluatePr({ comments: [verdict('QA: APROVADO ' + head)], statusCheckRollup: [] }), 'tests');
  assert.equal(evaluatePr({ comments: [verdict('QA: APROVADO ' + head)] }), 'merge');
  assert.equal(evaluatePr({ state: 'MERGED' }), 'merged-unverified');
  assert.equal(evaluatePr({ state: 'MERGED', comments: [verdict('QA: APROVADO ' + head)] }), 'merged');
});

test('a trusted correction takes precedence and returns work to Dev', () => {
  const fix = { ...verdict('QA: CORRIGIR ' + head), createdAt: '2026-11-06T11:00:00Z' };
  const observation = evaluate({ ...pr, comments: [verdict('QA: APROVADO ' + head), fix] }, repo, 'qa');
  assert.equal(observation.stage, 'changes');
  assert.equal(readyFor({ ...task, observation }, [], 'claude', 'dev'), true);
  assert.equal(readyFor({ ...task, observation }, [], 'codex', 'qa'), false);
});

test('cross-repository dependencies require a verified merge', () => {
  const frontend = { ...task, id: 'WEB-01', repo: 'time/web', depends: [task.id] };
  assert.equal(readyFor(frontend, [{ ...task, observation: { stage: 'merge' } }], 'claude', 'dev'), false);
  assert.equal(readyFor(frontend, [{ ...task, observation: { stage: 'merged' } }], 'claude', 'dev'), true);
});

test('the linked PR must belong to the task repository and follow Gitflow', () => {
  assert.doesNotThrow(() => validatePr(pr, repo, 3));
  assert.throws(() => validatePr({ ...pr, baseRefName: 'main' }, repo, 3));
  assert.throws(() => validatePr({ ...pr, url: 'https://github.com/time/web/pull/3' }, repo, 3));
});
