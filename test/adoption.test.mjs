import assert from 'node:assert/strict';
import test from 'node:test';
import { agentsSection, guessKind, hasSection, parseSlug, withSection } from '../lib/adoption.mjs';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

test('builds the AGENTS.md section and places it before the definition of done', () => {
  const project = { id: 'dieta-mais', name: 'Dieta+', repos: [{ slug: 'time/dieta-backend' }, { slug: 'time/dieta-mobile' }] };
  const section = agentsSection(project, 'time/dieta-mobile');
  assert.match(section, /^## Orquestrador IA/);
  assert.match(section, /projeto \*\*`dieta-mais`\*\* \(Dieta\+\).*junto com `dieta-backend`/);
  assert.match(section, /repo: "time\/dieta-mobile"/);
  const base = '# AGENTS.md\n\n## Fluxo\nx\n\n## Definição de pronto\ny\n';
  const updated = withSection(base, section);
  assert.ok(updated.indexOf('## Orquestrador IA') < updated.indexOf('## Definição de pronto'));
  assert.ok(updated.indexOf('## Fluxo') < updated.indexOf('## Orquestrador IA'));
  assert.equal(hasSection(updated, 'dieta-mais'), true);
  assert.equal(hasSection(updated, 'outro'), false);
  assert.equal(withSection(updated, section), updated);
  assert.match(withSection('', section), /^# AGENTS\.md[\s\S]*## Orquestrador IA/);
  assert.match(withSection('# X\n\ntexto', section), /texto\n\n## Orquestrador IA/);
  assert.equal(parseSlug('https://github.com/Time/Dieta-Mobile.git'), 'time/dieta-mobile');
  assert.equal(parseSlug('so-o-nome'), null);
  assert.deepEqual(['x/dieta-backend', 'x/app-kmp', 'x/site-web', 'x/docs'].map(guessKind), ['Backend', 'Mobile', 'Frontend', 'Outro']);
});

test('an agent registers a project and the panel adopts its repositories', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const sections = [];
  const github = {
    currentLogin: async () => 'dono',
    detectDocs: async slug => slug.endsWith('api') ? ['AGENTS.md', 'docs/arquitetura/integracao.md'] : [],
    ensureAgentsSection: async (slug, project) => {
      sections.push(slug + '@' + project.repos.length);
      if (slug.endsWith('web')) throw new Error('sem develop');
      return { status: 'pr-created', url: 'https://github.com/' + slug + '/pull/1', number: 1 };
    },
    readMarkdown: async () => ({ markdown: '- [ ] **API-01 Base.** x\n- [x] **API-02 Login.** y *Depende de:* API-01.' })
  };
  const { action } = createService(store, github);
  await assert.rejects(action('register_project', { id: 'Novo App', repos: ['time/api'] }, 'claude'), /identificador/);
  await assert.rejects(action('register_project', { id: 'novo-app', repos: ['invalido'] }, 'claude'), /Repositório inválido/);
  const result = await action('register_project', { id: 'novo-app', name: 'Novo App',
    repos: ['https://github.com/time/novo-api', 'time/novo-web'] }, 'claude');
  assert.equal(result.created, true);
  assert.deepEqual(result.repos.map(repo => [repo.slug, repo.kind, repo.added, repo.agents.status]),
    [['time/novo-api', 'Backend', true, 'pr-created'], ['time/novo-web', 'Frontend', true, 'error']]);
  assert.deepEqual(sections, ['time/novo-api@2', 'time/novo-web@2']);
  assert.equal(result.plan.created, 2);
  const project = (await action('workspace', {})).projects[0];
  assert.deepEqual([project.profile.po.agent, project.profile.dev.agent, project.profile.qa.agent, project.profile.qa.login, project.registeredBy],
    ['claude', 'claude', 'codex', 'dono', 'claude']);
  assert.deepEqual(project.repos[0].docs, ['AGENTS.md', 'docs/arquitetura/integracao.md']);
  assert.equal(project.repos[0].onboarding.status, 'pr-created');
  assert.equal(project.tasks.length, 2);

  // Repetir é seguro: não recria o projeto, só acrescenta o que falta. Quem não é PO não adota.
  const again = await action('register_project', { id: 'novo-app', repos: ['time/novo-api', 'time/novo-mobile'] }, 'codex');
  assert.deepEqual([again.created, again.repos.length, again.repos[2].added, again.plan.created], [false, 3, true, 0]);
  await assert.rejects(action('adopt_repos', { project: 'novo-app' }, 'codex'), /dono ou o PO/);
  assert.equal((await action('adopt_repos', { project: 'novo-app' })).repos.length, 3);
});
