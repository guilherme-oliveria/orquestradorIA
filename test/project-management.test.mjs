import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

const profile = {
  po: { agent: 'claude', effort: 'default' },
  dev: { agent: 'codex', effort: 'default' },
  qa: { agent: 'claude', effort: 'default', login: 'qa' }
};

test('preserves separate threads for simultaneous reservations and keeps their history', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const { action } = createService(store);
  const project = 'projeto-teste';
  await action('create_project', { id: project, name: 'Projeto de teste', profile });
  await action('add_repo', { project, slug: 'org/api', kind: 'Backend' });
  for (const task of ['API-01', 'API-02']) await action('add_task', { project, task, title: task, repo: 'org/api' });
  const reservations = await Promise.all(['API-01', 'API-02'].map(task => action('claim', { project, task, role: 'dev' }, 'codex')));
  assert.notEqual(reservations[0].run.id, reservations[1].run.id);
  const args = { project, task: 'API-01', token: reservations[0].token, thread: 'https://example.com/session/1', message: 'Testes locais concluídos.' };
  await assert.rejects(action('update_run', args, 'claude'), /Reserva/);
  await action('update_run', args, 'codex');
  const cost = { ...args, amount: 0.15, currency: 'USD', kind: 'estimate', source: 'Resumo da sessão' };
  await assert.rejects(action('record_cost', cost, 'claude'), /Reserva/);
  await action('record_cost', cost, 'codex');
  await action('record_cost', { ...cost, amount: 0.25 }, 'codex');
  const records = (await action('workspace', {})).projects[0].costs;
  assert.equal(records.length, 1);
  assert.equal(records[0].agent, 'codex');
  assert.equal(records[0].micros, 250000);
  await action('release', args, 'codex');
  const [running, finished] = (await action('workspace', {})).projects[0].runs;
  assert.equal(running.task, 'API-02');
  assert.equal(running.status, 'active');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.thread, args.thread);
  assert.equal(finished.events.at(-1).message, args.message);
  assert.equal(JSON.stringify({ running, finished }).includes(reservations[0].token), false);
});

test('allows the PO to plan sprints and freezes a release only after validated merges', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const sha = 'b'.repeat(40);
  const { action } = createService(store, { readDevelop: async () => sha });
  const project = 'projeto-teste';
  await action('create_project', { id: project, name: 'Projeto de teste', profile });
  await assert.rejects(action('save_plan', { project, markdown: '# Plano' }, 'codex'), /PO/);
  const po = await action('start_planning_run', { project }, 'claude');
  const poArgs = { project, run: po.run.id, token: po.token };
  await assert.rejects(action('update_run', poArgs, 'codex'), /Reserva/);
  await action('update_run', { ...poArgs, message: 'Planejando entregas.' }, 'claude');
  const openRun = (await action('workspace', {})).projects[0].runs[0];
  assert.equal(openRun.events[0].message, 'Planejando entregas.');
  assert.equal(openRun.token, undefined);
  await action('release', poArgs, 'claude');
  await action('save_plan', { project, markdown: '# Plano' }, 'claude');
  const sprint = await action('save_sprint', { project, name: 'Sprint 1', goal: 'API', status: 'active' }, 'claude');
  await action('add_repo', { project, slug: 'org/api', kind: 'Backend' });
  await action('add_task', { project, task: 'API-01', title: 'API', repo: 'org/api', sprint: sprint.id }, 'claude');
  const release = { project, version: '1.0.0', sprint: sprint.id };
  await assert.rejects(action('cut_release', release), /API-01/);
  store.write(state => { state.projects[0].tasks[0].observation = { stage: 'merged', head: 'a'.repeat(40) }; });
  const cut = await action('cut_release', release);
  assert.deepEqual(cut.refs, [{ repo: 'org/api', sha }]);
  await action('assign_sprint', { project, task: 'API-01', sprint: '' });
  assert.equal((await action('workspace', {})).projects[0].releases[0].tasks[0].id, 'API-01');
});

test('serves the configured Git contract and keeps the project summary available', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const officialPath = 'docs/arquitetura/integracao.md';
  const project = 'projeto-teste';
  const api = 'org/api';
  const mobile = 'org/mobile';
  const draft = '# Como trabalhar nos dois repositórios';
  const contract = '# Contrato de integração';
  const { action } = createService(store, {
    readContext: async (data, onlyShared) => {
      const shared = data.officialPath
        ? [api, mobile].map(repo => ({ repo, path: data.officialPath, blob: 'contract', markdown: contract }))
        : [];
      return onlyShared ? shared : [...shared, { repo: mobile, path: 'AGENTS.md', markdown: '# Mobile' }];
    }
  });
  await action('create_project', { id: project, name: 'Projeto de teste', context: draft, profile });
  for (const [slug, kind] of [[api, 'Backend'], [mobile, 'Mobile']]) {
    await action('add_repo', { project, slug, kind });
  }
  await assert.rejects(action('official_repo', { project, repo: api, path: '../integracao.md' }), /caminho relativo/);
  await action('official_repo', { project, repo: api, path: officialPath });
  const audit = await action('context_audit', { project }, 'claude');
  assert.equal(audit.path, officialPath);
  assert.deepEqual(audit.copies.map(copy => copy.status), ['official', 'current']);
  const context = await action('context', { project }, 'codex');
  assert.equal(context.source, 'github');
  assert.equal(context.markdown, contract);
  assert.equal(context.projectContext, draft);
  assert.deepEqual(context.docs.map(doc => doc.path), ['AGENTS.md']);
});
