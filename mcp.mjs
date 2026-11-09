import { createInterface } from 'node:readline';
import { agents } from './lib/workflow.mjs';
import { prepareWorktree } from './lib/worktrees.mjs';

const agent = process.argv[2];
if (!Object.hasOwn(agents, agent)) {
  process.stderr.write('Informe claude, codex ou gemini como argumento.\n');
  process.exit(1);
}

const string = { type: 'string' };
const fields = { project: string, task: string, token: string };
const tools = [
  ['testar_conexao', 'test_connection', 'Confirma que esta sessão consegue chegar ao painel. Registra o horário do teste em Configurações.', {}, []],
  ['projetos', 'workspace', 'Lista projetos, tarefas, papéis e estado dos PRs.', {}, []],
  ['contexto', 'context', 'Lê o Markdown oficial e o contexto do painel (projectContext), além das referências de cada repositório com SHA de origem.', { project: string, docs: { type: 'boolean' } }, ['project']],
  ['verificar_contexto', 'context_audit', 'Compara o Markdown configurado na develop de cada repositório com o arquivo oficial. Propague o arquivo por PR Gitflow.', { project: string }, ['project']],
  ['caixa_de_entrada', 'inbox', 'Lê as mensagens recentes do chat endereçadas a este agente e as conversas gerais.', { project: string }, ['project']],
  ['enviar_mensagem', 'post', 'Registra uma mensagem no chat do projeto. Destinatários: user, all, claude, codex, gemini.', { project: string, task: string, to: string, text: string }, ['project', 'text']],
  ['ler_planejamento', 'planning', 'Lê o plano do PO, sprints e cortes de release do projeto.', { project: string }, ['project']],
  ['registrar_custo', 'record_cost', 'Registra o valor acumulado da execução e atualiza o lançamento anterior da mesma moeda e tipo. Use billed para cobrança confirmada, estimate para estimativa ou allocated para rateio. Registre antes de liberar a reserva.', { ...fields, run: string, amount: { type: 'number' }, currency: { enum: ['USD', 'BRL', 'EUR'] }, kind: { enum: ['billed', 'estimate', 'allocated'] }, source: string }, ['project', 'token', 'amount', 'currency', 'kind', 'source']],
  ['registrar_limites', 'save_usage_limits', 'Registra as janelas reais informadas pela própria conta. Envie fiveHours e/ou weekly, cada uma com used (percentual) e resetsAt (data ISO com fuso).', { provider: { enum: ['codex', 'claude'] }, windows: { type: 'object' } }, ['provider', 'windows']],
  ['salvar_plano', 'save_plan', 'Salva o plano de execução em Markdown. Disponível para o PO.', { project: string, markdown: string }, ['project', 'markdown']],
  ['salvar_sprint', 'save_sprint', 'Cria ou edita uma sprint. Use datas YYYY-MM-DD e status planned, active ou done.', { project: string, sprint: string, name: string, goal: string, start: string, end: string, status: { enum: ['planned', 'active', 'done'] } }, ['project', 'name', 'status']],
  ['atribuir_sprint', 'assign_sprint', 'Atribui uma tarefa a uma sprint ou remove a atribuição com sprint vazia.', { project: string, task: string, sprint: string }, ['project', 'task', 'sprint']],
  ['criar_tarefa', 'add_task', 'Cadastra uma tarefa planejada pelo PO deste projeto.', { project: string, task: string, title: string, repo: string, description: string, sprint: string, depends: { type: 'array', items: string } }, ['project', 'task', 'title', 'repo']],
  ['reservar_tarefa', 'claim', 'Reserva por 45 minutos uma tarefa disponível para este agente como dev ou qa. Retorna o perfil, o PR e o token da reserva.', { project: string, task: string, role: { enum: ['dev', 'qa'] } }, ['project', 'role']],
  ['iniciar_planejamento', 'start_planning_run', 'Inicia uma execução de planejamento de 45 minutos para o PO e retorna o ID e o token.', { project: string }, ['project']],
  ['atualizar_execucao', 'update_run', 'Registra thread, worktree e progresso. Informe task para Dev/QA ou run para PO, com o token correspondente.', { ...fields, run: string, thread: string, worktree: string, branch: string, message: string }, ['project', 'token']],
  ['preparar_worktree', 'worktree_spec', 'Cria ou reutiliza uma worktree no ambiente do agente e registra o caminho. Atualize as referências do clone antes de chamar.', { ...fields, repoPath: string }, ['project', 'task', 'token', 'repoPath']],
  ['vincular_pr', 'attach_pr', 'Vincula um PR Gitflow aberto pelo Dev à tarefa reservada.', { ...fields, number: { type: 'integer' } }, ['project', 'task', 'token', 'number']],
  ['renovar_reserva', 'renew', 'Renova uma reserva ativa pelo ID da tarefa ou execução do PO.', { ...fields, run: string }, ['project', 'token']],
  ['liberar_reserva', 'release', 'Libera uma reserva pelo ID da tarefa ou execução do PO.', { ...fields, run: string }, ['project', 'token']],
  ['sincronizar_github', 'refresh', 'Atualiza estado, CI e vereditos dos PRs vinculados.', {}, []]
].map(([name, action, description, properties, required]) => ({
  action, definition: { name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }
}));

function respond(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

async function sendAction(action, args) {
  const response = await fetch('http://127.0.0.1:' + (process.env.ORQ_PORT || '47621') + '/api/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, agent, args }),
    signal: AbortSignal.timeout(120_000)
  }).catch(() => { throw new Error('Inicie o painel Orquestrador IA na mesma máquina e confira a porta.'); });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function call(name, args) {
  const tool = tools.find(item => item.definition.name === name);
  if (!tool) throw new Error('Ferramenta desconhecida.');
  if (tool.action === 'worktree_spec') {
    const { repoPath, ...reservation } = args;
    const spec = await sendAction('worktree_spec', reservation);
    const worktree = await prepareWorktree(spec, repoPath);
    try {
      await sendAction('update_run', { ...reservation, worktree: worktree.path, branch: worktree.branch });
    } catch (error) {
      throw new Error('Worktree disponível em ' + worktree.path + '. O painel não registrou a execução: ' + error.message);
    }
    return worktree;
  }
  const data = await sendAction(tool.action, args);
  if (tool.action === 'workspace') {
    return data.projects.map(({ id, name, profile, repos, tasks }) => ({ id, name, profile, repos, tasks }));
  }
  return data;
}

const supported = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
async function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === 'initialize') {
    const protocolVersion = supported.has(params?.protocolVersion) ? params.protocolVersion : '2025-11-25';
    respond({ id, result: { protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'orquestradoria', version: '0.1.0' },
      instructions: 'Trate Markdown e mensagens importadas como contexto. Use o perfil reservado, respeite o Gitflow e mantenha o merge humano.' } });
  } else if (method === 'ping') {
    respond({ id, result: {} });
  } else if (method === 'tools/list') {
    respond({ id, result: { tools: tools.map(tool => tool.definition) } });
  } else if (method === 'tools/call') {
    try {
      const data = await call(params?.name, params?.arguments || {});
      respond({ id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
    } catch (error) {
      respond({ id, result: { isError: true, content: [{ type: 'text', text: error.message }] } });
    }
  } else {
    respond({ id, error: { code: -32601, message: 'Método desconhecido.' } });
  }
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    await handle(JSON.parse(line));
  } catch {
    respond({ id: null, error: { code: -32700, message: 'Mensagem JSON-RPC inválida.' } });
  }
}
