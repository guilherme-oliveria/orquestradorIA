import assert from 'node:assert/strict';
import test from 'node:test';
import { agents, publicAgents, registerAgent } from '../lib/agents.mjs';
import { roleInstructions } from '../lib/instructions.mjs';
import { createService } from '../lib/service.mjs';
import { createStore } from '../lib/store.mjs';

test('a new agent needs only a registry entry to take roles, messages, MCP identity and diagnostics', async t => {
  const store = createStore(':memory:');
  t.after(store.close);
  const { action } = createService(store, {});
  const role = agent => ({ agent, model: '', effort: 'default', login: 'qa-user' });
  const profile = { po: role('claude'), dev: role('claude'), qa: role('novo-agente') };
  await assert.rejects(action('create_project', { id: 'p', name: 'P', profile }), /agente para cada papel/);
  await assert.rejects(action('test_connection', {}, 'novo-agente'), /sessão do agente/);

  registerAgent('novo-agente', { label: 'Novo Agente', cli: { command: 'novo' }, mcp: { register: 'novo mcp add orq {node} {mcp} novo-agente' } });
  assert.equal(agents['novo-agente'], 'Novo Agente');
  const listed = publicAgents({ node: '/usr/bin/node', mcp: '/opt/orq dir/mcp.mjs' }).find(agent => agent.id === 'novo-agente');
  assert.deepEqual([listed.assignable, listed.limits, listed.register],
    [true, false, 'novo mcp add orq /usr/bin/node "/opt/orq dir/mcp.mjs" novo-agente']);
  assert.equal(publicAgents().find(agent => agent.id === 'opencode').assignable, false);

  await action('create_project', { id: 'p', name: 'P', profile });
  assert.equal((await action('test_connection', {}, 'novo-agente')).agent, 'novo-agente');
  assert.equal((await action('post', { project: 'p', to: 'novo-agente', text: 'oi' })).to, 'novo-agente');
  assert.ok((await action('workspace', {})).agents.some(agent => agent.id === 'novo-agente'));
  const own = await action('role_instructions', { project: 'p' }, 'novo-agente');
  assert.equal(own.role, 'qa');
  assert.match(own.text, /usando Novo Agente/);
  await assert.rejects(action('save_usage_limits', { provider: 'novo-agente', windows: {} }), /leitura de limites/);
  assert.throws(() => registerAgent('X', { label: 'x', cli: { command: 'x' } }), /minúsculas/);
});

test('role instructions follow whoever holds each role', () => {
  const role = (agent, login = '') => ({ agent, model: '', effort: 'default', login });
  const project = { id: 'dieta', name: 'Dieta+', profile: { po: role('claude'), dev: role('codex'), qa: role('claude', 'qa-user') },
    repos: [{ slug: 'time/api', kind: 'Backend', docs: ['docs/integracao.md'], checks: ['testes'] }] };
  const dev = roleInstructions(project, 'dev');
  assert.match(dev, /Você é o Dev .* usando Codex\./);
  assert.match(dev, /resolve comentário do QA \(Claude Code\)/);
  assert.match(dev, /time\/api · Backend · base develop · checks obrigatórios: testes · leia: docs\/integracao\.md/);
  const qa = roleInstructions(project, 'qa');
  assert.match(qa, /conta do GitHub usada é qa-user/);
  assert.match(qa, /QA: APROVADO <sha completo>/);
  project.profile = { po: role('codex'), dev: role('claude'), qa: role('codex', 'qa-user') };
  assert.match(roleInstructions(project, 'dev'), /usando Claude Code\.[\s\S]*comentário do QA \(Codex\)/);
  assert.match(roleInstructions(project, 'po'), /Você é o PO .* usando Codex\./);
  assert.throws(() => roleInstructions(project, 'admin'), /po, dev ou qa/);
});
