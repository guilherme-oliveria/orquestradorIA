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

test('records a successful MCP test for the session agent only', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const { action } = createService(store);
  assert.deepEqual(await action('connections', {}), { mcp: {} });
  await assert.rejects(action('test_connection', {}), /sessão do agente/);
  await assert.rejects(action('test_cli', { provider: 'codex' }, 'claude'), /diagnóstico no painel/);
  await assert.rejects(action('test_cli', { provider: 'custom-command' }), /CLI da lista/);
  const result = await action('test_connection', {}, 'codex');
  assert.equal(result.agent, 'codex');
  assert.deepEqual(await action('connections', {}), { mcp: { codex: result.checkedAt } });
});

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

test('quick presets swap Dev and QA and the automatic mode picks the agent with more quota', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const { action } = createService(store, {});
  const project = 'preset';
  await action('create_project', { id: project, name: 'Preset', profile });
  await action('add_repo', { project, slug: 'time/api', kind: 'Backend' });
  await assert.rejects(action('quick_profile', { project, preset: 'swap' }, 'claude'), /painel/);
  const swapped = await action('quick_profile', { project, preset: 'swap' });
  assert.deepEqual([swapped.profile.dev.agent, swapped.profile.qa.agent, swapped.profile.qa.login], ['codex', 'claude', 'qa-user']);
  await action('quick_profile', { project, preset: 'auto' });
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await action('save_usage_limits', { provider: 'codex', windows: { fiveHours: { used: 90, resetsAt: future } } });
  await action('save_usage_limits', { provider: 'claude', windows: { fiveHours: { used: 20, resetsAt: future } } });
  const task = await action('add_task', { project, task: 'API-01', title: 'API', repo: 'time/api' });
  assert.deepEqual([task.dev, task.qa, task.profile.qa.login], ['claude', 'codex', 'qa-user']);
  assert.equal((await action('workspace', {})).projects[0].autoAssign, true);
});

test('open PRs to develop enter the pipeline on their own and the plan can be read from the repository', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const base = { baseRefName: 'develop', state: 'OPEN', headRefOid: head, author: { login: 'qa-user' },
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }], reviews: [],
    commits: [{ oid: head, committedDate: '2026-11-12T23:20:00Z' }] };
  const prs = {
    125: { ...base, number: 125, url: 'https://github.com/time/app/pull/125', title: 'MOB-UX-04 Desfazer o registro', headRefName: 'claude/project-thread-5tgkym',
      comments: [{ author: { login: 'qa-user' }, body: 'QA: CORRIGIR', createdAt: '2026-11-12T23:28:00Z' }] },
    126: { ...base, number: 126, url: 'https://github.com/time/app/pull/126', title: 'Ajusta textos', headRefName: 'feature/textos', comments: [] },
    127: { ...base, number: 127, url: 'https://github.com/time/app/pull/127', title: 'Bump lib', headRefName: 'dependabot/x', comments: [] }
  };
  const github = {
    listOpenPrs: async () => Object.values(prs).map(({ number, title, headRefName }) => ({ number, title, headRefName })),
    readPr: async (slug, number) => prs[number],
    readMarkdown: async (repo, path) => ({ repo, path, sha: head, markdown: '# Plano do repositório' })
  };
  const { action } = createService(store, github);
  const project = 'auto';
  await action('create_project', { id: project, name: 'Auto', profile });
  await action('add_repo', { project, slug: 'time/app', kind: 'Mobile' });
  await action('refresh', {});
  await action('refresh', {});
  const tasks = (await action('workspace', {})).projects[0].tasks;
  assert.deepEqual(tasks.map(task => [task.id, task.pr, task.observation.stage, task.imported]),
    [['MOB-UX-04', 125, 'changes', true], ['MOBILE-PR126', 126, 'review', true]]);
  assert.equal(tasks[0].title, 'Desfazer o registro');
  assert.equal(tasks[0].observation.corrections, 1);
  assert.equal((await action('planning', { project }, 'claude')).repoPlan, null);
  await assert.rejects(action('plan_source', { project, repo: 'time/outro', path: 'docs/plano.md' }), /repositório cadastrado/);
  await action('plan_source', { project, repo: 'time/app', path: 'docs/arquitetura/plano-de-execucao.md' });
  const planning = await action('planning', { project }, 'claude');
  assert.equal(planning.repoPlan.markdown, '# Plano do repositório');
  assert.equal(planning.planSource.path, 'docs/arquitetura/plano-de-execucao.md');
});
