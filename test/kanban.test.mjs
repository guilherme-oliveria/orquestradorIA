import assert from 'node:assert/strict';
import test from 'node:test';
import { parseActionPlan } from '../lib/plan-import.mjs';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

const head = 'a'.repeat(40);
const plan = `# App — plano de ação

## Fase 1 — Fundação
- [x] **MOB-01 Dependências e estrutura.** Ktor e Koin no catálogo.
  - [x] Correção incremental: não é tarefa.
- [ ] **MOB-18b Ações na notificação.** Botões na notificação. *Depende de:* MOB-01, BE-12.

## Fase 2 — Dieta
- [ ] **MOB-20 Lista de compras**
  Depende de: MOB-18b
  Pronto quando: teste de domínio verde.
- [ ] Item sem ID fica de fora
- [ ] **MOB-20 Duplicada.** ignorada
`;

test('parses the action plan format with phases, done marks and dependencies', () => {
  const tasks = parseActionPlan(plan);
  assert.deepEqual(tasks.map(task => [task.id, task.done, task.group, task.title]), [
    ['MOB-01', true, 'Fase 1 — Fundação', 'Dependências e estrutura'],
    ['MOB-18B', false, 'Fase 1 — Fundação', 'Ações na notificação'],
    ['MOB-20', false, 'Fase 2 — Dieta', 'Lista de compras']
  ]);
  assert.deepEqual(tasks[1].depends, ['MOB-01', 'BE-12']);
  assert.deepEqual(tasks[2].depends, ['MOB-18B']);
  assert.match(tasks[2].description, /Pronto quando: teste de domínio verde/);
});

test('the board is fed by the plan, moved by hand without a PR and by the PR once it exists', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  let open = [];
  const pr = { number: 9, url: 'https://github.com/time/app/pull/9', title: 'MOB-18b Ações na notificação', baseRefName: 'develop',
    headRefName: 'claude/thread-x', state: 'OPEN', headRefOid: head, author: { login: 'qa-user' }, reviews: [], comments: [],
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }], commits: [{ oid: head, committedDate: '2026-11-12T10:00:00Z' }] };
  const github = {
    readMarkdown: async repo => { if (repo === 'time/api') throw new Error('GitHub retornou 404.'); return { markdown: plan }; },
    listOpenPrs: async repo => repo === 'time/app' ? open : [],
    readPr: async () => pr
  };
  const role = agent => ({ agent, model: '', effort: 'default', login: 'qa-user' });
  const { action } = createService(store, github);
  const project = 'quadro';
  await action('create_project', { id: project, name: 'Quadro', profile: { po: role('claude'), dev: role('codex'), qa: role('claude') } });
  await action('add_repo', { project, slug: 'time/app', kind: 'Mobile' });
  await action('add_repo', { project, slug: 'time/api', kind: 'Backend' });
  await assert.rejects(action('import_plan', { project }, 'codex'), /dono ou o PO/);
  const summary = await action('import_plan', { project }, 'claude');
  assert.deepEqual([summary.created, summary.repos.map(repo => [repo.repo, repo.found, repo.error])],
    [3, [['time/app', 3, null], ['time/api', 0, 'GitHub retornou 404.']]]);
  assert.equal((await action('import_plan', { project })).created, 0);
  const tasks = async () => Object.fromEntries((await action('workspace', {})).projects[0].tasks.map(task => [task.id, task]));
  let board = await tasks();
  assert.deepEqual([board['MOB-01'].status, board['MOB-18B'].status, board['MOB-18B'].depends, board['MOB-20'].group],
    ['done', 'todo', ['MOB-01'], 'Fase 2 — Dieta']);

  // Dependência concluída pelo plano libera a tarefa; a que depende de tarefa aberta continua bloqueada.
  assert.equal((await action('claim', { project, role: 'dev', task: 'MOB-20' }, 'codex')), null);
  await action('move_task', { project, task: 'mob-20', status: 'doing' });
  await assert.rejects(action('move_task', { project, task: 'MOB-20', status: 'merge' }), /Coluna inválida/);
  await assert.rejects(action('move_task', { project, task: 'MOB-20', status: 'done' }, 'gemini'), /agentes do projeto/);
  assert.equal((await action('move_task', { project, task: 'MOB-20', status: 'review' }, 'codex')).movedBy, 'codex');

  // O PR com o ID no título vincula ao card do plano em vez de criar outro.
  open = [{ number: 9, title: pr.title, headRefName: pr.headRefName }];
  await action('refresh', {});
  board = await tasks();
  assert.equal(Object.keys(board).length, 3);
  assert.deepEqual([board['MOB-18B'].pr, board['MOB-18B'].observation.stage], [9, 'review']);
  await assert.rejects(action('move_task', { project, task: 'MOB-18B', status: 'done' }), /anda sozinho/);
});
