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

test('counts QA correction rounds across commits and exposes the pending request', async () => {
  const { profileForNewTask, swapDevQa } = await import('../lib/workflow.mjs');
  const old = 'c'.repeat(40);
  const rounds = [
    { ...verdict('QA: CORRIGIR ' + old + '\n- falta teste'), createdAt: '2026-11-06T09:00:00Z' },
    { ...verdict('QA: CORRIGIR ' + head + '\n- ajustar erro 422'), createdAt: '2026-11-06T12:00:00Z' },
    { ...verdict('QA: CORRIGIR ' + head, 'dev'), createdAt: '2026-11-06T12:30:00Z' }
  ];
  const changes = evaluate({ ...pr, comments: rounds }, repo, 'qa');
  assert.equal(changes.stage, 'changes');
  assert.equal(changes.corrections, 2);
  assert.match(changes.pending, /ajustar erro 422/);
  const approved = evaluate({ ...pr, comments: [...rounds,
    { ...verdict('QA: APROVADO ' + head), createdAt: '2026-11-06T13:00:00Z' }] }, repo, 'qa');
  assert.equal(approved.stage, 'merge');
  assert.equal(approved.corrections, 2);
  assert.equal(approved.pending, null);

  const profile = { po: { agent: 'claude' }, dev: { agent: 'claude', model: 'a', login: '' }, qa: { agent: 'codex', model: 'b', login: 'qa' } };
  const swapped = swapDevQa(profile);
  assert.deepEqual([swapped.dev.agent, swapped.dev.model, swapped.qa.agent, swapped.qa.login], ['codex', 'b', 'claude', 'qa']);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const limits = { claude: { windows: { fiveHours: { used: 80, resetsAt: future } } }, codex: { windows: { fiveHours: { used: 10, resetsAt: future } } } };
  assert.equal(profileForNewTask({ profile }, limits).dev.agent, 'claude');
  assert.equal(profileForNewTask({ profile, autoAssign: true }, limits).dev.agent, 'codex');
  assert.equal(profileForNewTask({ profile, autoAssign: true }, { claude: limits.claude }).dev.agent, 'claude');
});

test('accepts the SHA-less QA protocol while no commit follows the comment, and agent branches', () => {
  const at = minute => '2026-11-12T23:' + minute + ':00Z';
  const withCommit = (minute, comments) => evaluate({ ...pr, headRefName: 'claude/project-thread-5tgkym',
    commits: [{ oid: head, committedDate: at(minute) }], comments }, repo, 'qa');
  const say = (body, minute, login = 'qa') => ({ body, author: { login }, createdAt: at(minute) });
  validatePr({ ...pr, headRefName: 'claude/project-thread-5tgkym' }, repo, 3);
  assert.throws(() => validatePr({ ...pr, headRefName: 'dependabot/gradle/x' }, repo, 3), /feature\/ ou bugfix\//);
  assert.equal(withCommit('20', [say('QA: CORRIGIR\n- teste falhando', '28')]).stage, 'changes');
  const ready = withCommit('20', [say('QA: CORRIGIR', '28'), say('QA: PRONTO PARA REVISAR', '29', 'dev')]);
  assert.deepEqual([ready.stage, ready.corrections, ready.pending], ['review', 1, null]);
  assert.equal(withCommit('20', [say('QA: CORRIGIR', '28'), say('QA: PRONTO PARA REVISAR', '29', 'outro')]).stage, 'changes');
  assert.equal(withCommit('20', [say('QA: APROVADO', '30')]).stage, 'merge');
  assert.equal(withCommit('31', [say('QA: APROVADO', '30')]).stage, 'review');
  assert.equal(evaluate({ ...pr, comments: [say('QA: APROVADO', '30')] }, repo, 'qa').stage, 'review');
  assert.equal(withCommit('20', [say('QA: APROVADOS todos', '30')]).stage, 'review');
});
