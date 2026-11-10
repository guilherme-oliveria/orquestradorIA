import assert from 'node:assert/strict';
import test from 'node:test';
import { addEntry, listEntries, renderContextMarkdown, retireEntry } from '../lib/context-entries.mjs';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

const profile = {
  po: { agent: 'claude', model: '', effort: 'default', login: '' },
  dev: { agent: 'codex', model: '', effort: 'default', login: '' },
  qa: { agent: 'claude', model: '', effort: 'high', login: 'qa-user' }
};

test('registers, supersedes, filters by repository and renders the shared Markdown', () => {
  const project = { name: 'Dieta', context: 'Resumo do produto', repos: [{ slug: 'time/api' }, { slug: 'time/mobile' }] };
  const contract = addEntry(project, { type: 'contract', title: 'Login', body: 'POST /login', repos: ['time/api', 'time/mobile'] }, 'codex');
  assert.equal(contract.id, 'CON-01');
  assert.throws(() => addEntry(project, { type: 'note', title: 'x', body: 'y', repos: ['time/web'] }), /cadastrados/);
  assert.throws(() => addEntry(project, { type: 'decision', title: 'x', body: '' }), /Conteúdo/);
  const decision = addEntry(project, { type: 'decision', title: 'Banco', body: 'Postgres', repos: ['time/api'] }, 'claude');
  assert.throws(() => addEntry(project, { type: 'note', title: 'x', body: 'y', supersedes: decision.id }), /mesmo tipo/);
  const newer = addEntry(project, { type: 'decision', title: 'Banco', body: 'Postgres 17', repos: ['time/api'], supersedes: decision.id }, 'claude');
  assert.equal(newer.id, 'DEC-02');
  assert.equal(newer.supersedes, 'DEC-01');
  assert.equal(listEntries(project, { all: true }).find(entry => entry.id === 'DEC-01').status, 'superseded');
  assert.deepEqual(listEntries(project, { repo: 'time/mobile' }).map(entry => entry.id), ['CON-01']);
  assert.deepEqual(listEntries(project, { repo: 'time/api' }).map(entry => entry.id), ['CON-01', 'DEC-02']);
  retireEntry(project, 'CON-01', 'user');
  assert.throws(() => retireEntry(project, 'CON-01', 'user'), /já foi encerrada/);
  const markdown = renderContextMarkdown(project);
  assert.match(markdown, /## Resumo\n\nResumo do produto/);
  assert.match(markdown, /## Decisões\n\n### DEC-02 · Banco\n\n_Vale para: time\/api · registrada por claude em \d{4}-\d{2}-\d{2} · substitui DEC-01_\n\nPostgres 17/);
  assert.doesNotMatch(markdown, /CON-01/);
});

test('agents write by role and read entries from the other agent through the MCP context', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const github = {
    readContext: async project => project.repos.map(repo => ({
      repo: repo.slug, path: 'docs/CONTEXTO-PROJETO.md', sha: 'c'.repeat(40), blob: 'blob', markdown: '# antigo'
    }))
  };
  const { action } = createService(store, github);
  const project = 'dieta';
  await action('create_project', { id: project, name: 'Dieta', context: 'Resumo', profile });
  await action('add_repo', { project, slug: 'time/api', kind: 'Backend' });
  await action('add_repo', { project, slug: 'time/mobile', kind: 'Mobile' });
  await action('official_repo', { project, repo: 'time/api' });
  const contract = await action('add_context_entry', { project, type: 'contract', title: 'Login', body: 'POST /login', repos: ['time/api', 'time/mobile'] }, 'codex');
  assert.equal(contract.author, 'codex');
  await assert.rejects(action('add_context_entry', { project, type: 'decision', title: 'x', body: 'y' }, 'gemini'), /PO e o Dev/);
  await assert.rejects(action('retire_context_entry', { project, id: contract.id }, 'gemini'), /autor ou o PO/);
  const note = await action('add_context_entry', { project, type: 'note', title: 'QA', body: 'Cobertura ok' }, 'gemini');
  assert.equal(note.id, 'NOT-01');
  const mobile = await action('context_entries', { project, repo: 'time/mobile' }, 'claude');
  assert.deepEqual(mobile.map(entry => entry.id), ['CON-01', 'NOT-01']);
  const context = await action('context', { project, repo: 'time/mobile', docs: false }, 'claude');
  assert.deepEqual(context.entries.map(entry => entry.id), ['CON-01', 'NOT-01']);
  assert.match(context.generatedMarkdown, /### CON-01 · Login/);
  assert.equal(context.shared.generatedMatches, false);
  const generated = await action('context_markdown', { project });
  assert.equal(generated.path, 'docs/CONTEXTO-PROJETO.md');
  assert.equal(generated.markdown, context.generatedMarkdown);
  await action('retire_context_entry', { project, id: contract.id }, 'claude');
  assert.deepEqual((await action('context_entries', { project }, 'codex')).map(entry => entry.id), ['NOT-01']);
  assert.equal((await action('workspace', {})).projects[0].contextEntries.length, 2);
});
