// Registro único dos agentes. Para adicionar um agente, acrescente uma entrada aqui (ou chame registerAgent):
// papéis, validações do serviço, identidade do MCP, diagnóstico de CLI e as listas do painel derivam deste arquivo.
import { fileURLToPath } from 'node:url';

const definitions = {
  claude: {
    label: 'Claude Code', short: 'Claude',
    cli: { command: 'claude', auth: { args: ['auth', 'status', '--json'], format: 'json-loggedIn' } },
    mcp: { register: 'claude mcp add --scope user --transport stdio orquestradoria -- {node} {mcp} claude' },
    limits: true
  },
  codex: {
    label: 'Codex', short: 'Codex',
    cli: { command: 'codex', auth: { args: ['login', 'status'], format: 'exit-code' } },
    mcp: { register: 'codex mcp add orquestradoria -- {node} {mcp} codex' },
    limits: true
  },
  gemini: {
    label: 'Gemini CLI', short: 'Gemini CLI',
    cli: { command: 'gemini' },
    mcp: { register: 'gemini mcp add orquestradoria {node} {mcp} gemini' }
  },
  // Só diagnóstico de CLI: sem `mcp`, o agente não recebe papéis nem identidade no conector.
  opencode: { label: 'OpenCode', short: 'OpenCode', cli: { command: 'opencode' } }
};

export const registry = {};
// id -> rótulo dos agentes que podem assumir papéis e falar pelo MCP.
export const agents = {};

export function registerAgent(id, definition) {
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(id)) throw new Error('Use um id de agente em minúsculas, como meu-agente.');
  if (!definition?.label || !/^[\w.-]+$/.test(definition.cli?.command || '')) throw new Error('Informe label e cli.command do agente.');
  registry[id] = Object.freeze({ short: definition.label, ...definition });
  if (definition.mcp) agents[id] = definition.label;
  else delete agents[id];
  return registry[id];
}

for (const [id, definition] of Object.entries(definitions)) registerAgent(id, definition);

export const hasLimits = id => registry[id]?.limits === true;

const quote = value => /[\s"']/.test(value) ? '"' + value.replaceAll('"', '\\"') + '"' : value;

// Lista enviada ao painel: nada aqui é executado pelo navegador.
export function publicAgents(paths = { node: process.execPath, mcp: fileURLToPath(new URL('../mcp.mjs', import.meta.url)) }) {
  return Object.entries(registry).map(([id, agent]) => ({
    id, label: agent.label, short: agent.short, assignable: Boolean(agent.mcp), limits: agent.limits === true,
    command: agent.cli.command, authCheck: Boolean(agent.cli.auth),
    register: agent.mcp?.register.replace('{node}', quote(paths.node)).replace('{mcp}', quote(paths.mcp)) || null
  }));
}
