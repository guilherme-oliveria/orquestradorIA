import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

const head = 'a'.repeat(40);
const newHead = 'b'.repeat(40);
const profile = {
  po: { agent: 'claude', model: 'modelo-po', effort: 'high' },
  dev: { agent: 'claude', model: 'modelo-dev', effort: 'medium' },
  qa: { agent: 'codex', model: 'modelo-qa', effort: 'xhigh', login: 'qa-user' }
};

test('coordinates two repos, concurrent claims, chat and commit-specific QA', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  let pr = {
    number: 3, url: 'https://github.com/time/api/pull/3', baseRefName: 'develop',
    headRefName: 'feature/api-01', state: 'OPEN', headRefOid: head, author: { login: 'dev-user' },
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    reviews: [], comments: []
  };
  const github = {
    readPr: async () => pr,
    readContext: async project => project.repos.map(repo => ({ repo: repo.slug, markdown: '# Contrato' }))
  };
  const { action } = createService(store, github);
  const project = 'teste';
  await action('create_project', { id: project, name: 'Teste', profile });
  await action('add_repo', { project, slug: 'time/api', kind: 'Backend', checks: ['test'] });
  await action('add_repo', { project, slug: 'time/web', kind: 'Frontend' });
  assert.equal((await action('context', { project }, 'codex')).docs.length, 2);
  await action('add_task', { project, task: 'API-01', title: 'API', repo: 'time/api' }, 'claude');
  await action('add_task', { project, task: 'WEB-01', title: 'Web', repo: 'time/web', depends: ['API-01'] }, 'claude');
  const [dev, duplicate] = await Promise.all([
    action('claim', { project, role: 'dev' }, 'claude'),
    action('claim', { project, role: 'dev' }, 'claude')
  ]);
  assert.equal(dev.id, 'API-01');
  assert.equal(dev.profile.dev.model, 'modelo-dev');
  assert.equal(duplicate, null);
  const api = { project, task: dev.id, number: 3 };
  await assert.rejects(action('attach_pr', { ...api, token: 'bad' }, 'claude'), /Reserve/);
  await action('attach_pr', { ...api, token: dev.token }, 'claude');
  const qa = await action('claim', { project, role: 'qa' }, 'codex');
  assert.equal(qa.observation.head, head);
  await action('post', { project, task: qa.id, to: 'claude', text: 'Revisão concluída' }, 'codex');
  assert.equal((await action('inbox', { project }, 'claude'))[0].author, 'codex');
  pr = { ...pr, comments: [{ author: { login: 'qa-user' }, body: 'QA: APROVADO ' + head }] };
  await action('refresh', {});
  assert.equal((await action('workspace', {})).projects[0].tasks[0].observation.stage, 'merge');
  assert.equal(await action('claim', { project, role: 'dev' }, 'claude'), null);
  pr = { ...pr, headRefOid: newHead };
  assert.equal((await action('claim', { project, role: 'qa' }, 'codex')).observation.head, newHead);
  pr = { ...pr, state: 'MERGED', comments: [{ author: { login: 'qa-user' }, body: 'QA: APROVADO ' + newHead }] };
  assert.equal((await action('claim', { project, role: 'dev' }, 'claude')).id, 'WEB-01');
});
