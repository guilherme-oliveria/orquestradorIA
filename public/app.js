const $ = selector => document.querySelector(selector);
const names = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', all: 'Todos', user: 'Você' };
const roles = { po: 'Produto · PO', dev: 'Desenvolvimento · Dev', qa: 'Qualidade · QA' };
const efforts = { default: 'Padrão', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };
const stages = {
  queue: ['Na fila', '', 0], blocked: ['Aguardando dependência', 'amber', 0], dev: ['Em desenvolvimento', 'lav', 1],
  draft: ['PR em rascunho', 'lav', 2], review: ['Em revisão', 'lav', 3], changes: ['Correções solicitadas', 'amber', 3],
  tests: ['Aguardando testes', 'teal', 4], merge: ['Aguardando seu merge', 'teal', 6], merged: ['Merge validado', 'teal', 7],
  'merged-unverified': ['Merge sem validação', 'red', 6], closed: ['PR fechado', '', 2], error: ['Falha na sincronização', 'red', 2]
};
const milestones = ['Fila', 'Dev', 'PR', 'Revisão', 'Testes', 'Aprovação', 'Merge'];
const views = {
  pipeline: ['▦', 'Pipeline'], planning: ['◫', 'Planejamento'], runs: ['▶', 'Execuções'], usage: ['◉', 'Custos e limites'],
  chat: ['◇', 'Chat do projeto'], repos: ['▣', 'Repositórios'], settings: ['⚙', 'Papéis e contexto']
};
const sprintStates = { planned: 'Planejada', active: 'Em andamento', done: 'Encerrada' };
const runStates = {
  active: ['Em execução', 'teal'], finished: ['Encerrada', ''], expired: ['Reserva expirada', 'amber'],
  superseded: ['PR atualizado', 'lav']
};
const defaultProfile = {
  po: { agent: 'claude', model: '', effort: 'default', login: '' },
  dev: { agent: 'claude', model: '', effort: 'default', login: '' },
  qa: { agent: 'codex', model: '', effort: 'high', login: '' }
};
const exampleRepos = [
  { slug: 'exemplo/atlas-api', kind: 'Backend', docs: ['docs/arquitetura/integracao.md'], checks: ['api-tests'] },
  { slug: 'exemplo/atlas-web', kind: 'Frontend', docs: ['docs/arquitetura/design.md'], checks: ['web-tests'] },
  { slug: 'exemplo/atlas-mobile', kind: 'Mobile', docs: ['docs/arquitetura/sincronizacao.md'], checks: ['mobile-tests'] }
];
const example = {
  id: 'demo', name: 'Projeto Atlas', profile: defaultProfile, repos: exampleRepos,
  context: '# Atlas\n\nBack, web e mobile compartilham o contrato versionado em docs/arquitetura/integracao.md.',
  messages: [
    { author: 'user', to: 'all', text: 'O contrato de autenticação da API é a referência para web e mobile.' },
    { author: 'claude', to: 'codex', task: 'API-04', text: 'PR pronto para revisão. Os testes cobrem renovação e expiração do token.' }
  ],
  tasks: [
    ['API-04', 'Validar renovação do token de acesso', 0, 'tests', [], 14],
    ['WEB-07', 'Integrar tela de login com a API', 1, 'merge', [], 21],
    ['MOB-05', 'Persistir a sessão no dispositivo', 2, 'review', [], 9],
    ['MOB-06', 'Sincronizar perfil com o backend', 2, 'queue', ['API-04'], null],
    ['WEB-06', 'Publicar componentes de autenticação', 1, 'merged', [], 18],
    ['API-03', 'Padronizar erros de autenticação', 0, 'changes', [], 11]
  ].map(([id, title, repo, stage, depends, pr]) => ({
    id, title, repo: exampleRepos[repo].slug, depends, pr, observation: { stage },
    profile: defaultProfile, description: 'Tarefa ilustrativa para mostrar a ligação entre repositórios e etapas.'
  }))
};

let workspace = [];
let current = 'demo';
let view = 'pipeline';
let modal;
let timer;
let search = '';
let filter = '';
let repoScope = 'current';
const connectionProviders = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini CLI', opencode: 'OpenCode' };
const cliResults = new Map();
const cliPending = new Set();
let mcpChecks = {};
let loadingChecks = false;
let usageLimits = {};
let queryingCodex = false;
let costScope = 'current';
const costKinds = { billed: 'Cobrado', estimate: 'Estimativa', allocated: 'Rateio' };
let syncBusy = false;
let contextBusy = false;
let contextAudit = null;

const project = () => workspace.find(item => item.id === current) || example;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const options = (values, selected) => Object.entries(values).map(([value, label]) =>
  '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
const btn = (label, action, style = '', attrs = '') =>
  '<button type="button" class="button ' + style + '" data-action="' + action + '" ' + attrs + '>' + label + '</button>';
const badge = (value, tone = '') => '<span class="badge ' + tone + '">' + esc(value) + '</span>';
const split = value => String(value || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
const time = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Exemplo';
const isDemo = () => project().id === 'demo';

async function api(action, args) {
  const response = await fetch('/api/action', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function load() {
  const response = await fetch('/api/workspace');
  if (!response.ok) throw new Error('Não foi possível carregar o workspace.');
  workspace = (await response.json()).projects;
}

function toast(message) {
  clearTimeout(timer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  timer = setTimeout(() => { $('#toast').hidden = true; }, 4800);
}

function stageFor(task, p) {
  if (task.syncError) return 'error';
  if (task.lease?.role === 'dev') return 'dev';
  const stage = task.observation?.stage || 'queue';
  if (stage === 'queue' && task.depends.some(id => !p.tasks.some(other => other.id === id &&
      !other.syncError && other.observation?.stage === 'merged'))) return 'blocked';
  return stage;
}

function agentsView(p) {
  const activeByAgent = new Map();
  const projects = p.id === 'demo' ? [p] : workspace;
  for (const owner of projects) {
    for (const run of owner.runs || []) {
      if (run.role !== 'po' || run.status !== 'active' || run.expires <= Date.now()) continue;
      const reservations = activeByAgent.get(run.agent) || [];
      reservations.push({ id: 'Planejamento', project: owner.name });
      activeByAgent.set(run.agent, reservations);
    }
    for (const task of owner.tasks) {
      if (!task.lease || task.lease.expires <= Date.now()) continue;
      const agent = task.profile[task.lease.role].agent;
      const reservations = activeByAgent.get(agent) || [];
      reservations.push({ id: task.id, project: owner.name });
      activeByAgent.set(agent, reservations);
    }
  }
  return Object.entries(p.profile).map(([role, config]) => {
    const active = activeByAgent.get(config.agent) || [];
    const status = active.length ? 'Ocupado' : role === 'po' ? 'Planejamento' : 'Livre';
    const detail = active.length === 1 ? active[0].id + ' · ' + active[0].project :
      active.length ? active.length + ' tarefas reservadas no painel' :
      role === 'po' ? 'Contexto e criação de tarefas' : 'Sem reserva ativa no painel';
    return '<article class="card agent ' + config.agent + '"><div class="role">' + roles[role] + '</div><h3>' +
      names[config.agent] + '</h3><dl class="agent-meta"><div><dt>Modelo</dt><dd>' + esc(config.model || 'Padrão da sessão') +
      '</dd></div><div><dt>Esforço</dt><dd>' + esc(efforts[config.effort]) + '</dd></div></dl><div class="agent-status">' +
      badge(status, active.length ? 'amber' : role === 'po' ? 'lav' : 'teal') + '<small>' + esc(detail) + '</small></div></article>';
  }).join('');
}

function rows(p) {
  return p.tasks.filter(task => (!filter || stageFor(task, p) === filter) &&
    (!search || [task.id, task.title, task.repo].some(value => value.toLowerCase().includes(search.toLowerCase()))))
    .map(task => {
      const [label, tone, index] = stages[stageFor(task, p)];
      const dots = milestones.map((name, i) => '<span class="rail-step ' +
        (i < index ? 'done' : i === index ? 'current' : '') + '" title="' + name + '"></span>').join('');
      return '<tr><td><button class="task-button" data-action="details" data-id="' + esc(task.id) +
        '"><span class="task-id">' + esc(task.id) + '</span>' + esc(task.title) + '</button><small>' + esc(task.repo) +
        (task.pr ? ' · PR #' + task.pr : '') + '</small></td><td><div class="rail" aria-label="' + label + '">' + dots +
        '</div></td><td>' + badge(label, tone) + '<small>' + names[task.profile.dev.agent] + ' → ' +
        names[task.profile.qa.agent] + '</small></td></tr>';
    }).join('');
}

function pipeline(p) {
  const counts = [
    ['Tarefas no projeto', p.tasks.length, '▦'],
    ['Em revisão / testes', p.tasks.filter(task => ['review', 'tests'].includes(stageFor(task, p))).length, '◈'],
    ['Aguardando merge', p.tasks.filter(task => stageFor(task, p) === 'merge').length, '⑂'],
    ['Repositórios', p.repos.length, '▣']
  ];
  const stats = counts.map(([label, number, icon]) => '<article class="card"><div class="stat-label">' + label +
    '<span class="stat-icon">' + icon + '</span></div><span class="stat-value">' + number + '</span></article>').join('');
  return '<div class="stats">' + stats + '</div><section><div class="section-head"><h2>Agentes e papéis</h2>' +
    btn('Configurar papéis, modelos e esforço', isDemo() ? 'settings' : 'config', 'ghost') +
    '</div><div class="agents">' + agentsView(p) + '</div></section>' +
    '<section class="panel"><div class="toolbar"><h2>Pipeline de tarefas</h2><form id="filter"><input name="search" type="search" aria-label="Buscar tarefa" placeholder="Buscar tarefa…" value="' +
    esc(search) + '"><select name="status" aria-label="Filtrar status">' +
    options({ '': 'Todos os status', ...Object.fromEntries(Object.entries(stages).map(([key, stage]) => [key, stage[0]])) }, filter) +
    '</select><button class="button" type="submit">Filtrar</button></form></div><div class="table-wrap"><table>' +
    '<thead><tr><th>Tarefa / repositório</th><th>Progresso</th><th>Status</th></tr></thead><tbody id="rows">' +
    (rows(p) || '<tr><td colspan="3" class="empty">Nenhuma tarefa encontrada.</td></tr>') +
    '</tbody></table></div><p class="legend">' + milestones.join(' → ') + '</p></section>';
}

function chat(p) {
  const messages = p.messages.slice(-100).map(message => '<article class="message"><strong>' +
    esc(names[message.author]) + '</strong> <span class="muted">→ ' + esc(names[message.to]) + '</span> ' +
    (message.task ? badge(message.task, 'lav') : '') + '<small>' + time(message.at) + '</small><p>' +
    esc(message.text) + '</p></article>').join('');
  return '<section class="panel chat"><div class="section-head"><h2>Conversa compartilhada</h2>' +
    badge('Caixa de entrada MCP', 'teal') + '</div><p class="muted">Os agentes leem e respondem quando a sessão ou o agendamento no Desktop consulta o projeto.</p>' +
    '<div class="messages" id="messages">' + (messages || '<p class="empty">As mensagens do projeto aparecem aqui.</p>') + '</div>' +
    (isDemo() ? '' : '<form class="compose" id="compose"><textarea name="text" aria-label="Mensagem" required maxlength="5000" placeholder="Escreva uma decisão, orientação ou pergunta…"></textarea><div class="actions"><select name="task" aria-label="Tarefa">' +
      options({ '': 'Sem tarefa', ...Object.fromEntries(p.tasks.map(task => [task.id, task.id])) }, '') +
      '</select><select name="to" aria-label="Destinatário">' + options({ all: 'Todos', claude: names.claude, codex: names.codex, gemini: names.gemini }, 'all') +
      '</select><button class="button primary" type="submit">Enviar mensagem</button></div></form>') + '</section>';
}

function repos(p) {
  const showAll = p.id !== 'demo' && repoScope === 'all';
  const projects = showAll ? workspace : [p];
  const cards = projects.flatMap(owner => owner.repos.map(repo =>
    '<article class="card"><div class="repo-tags">' + badge(repo.kind, 'lav') +
    '<span class="badge teal" title="' + esc(owner.id) + '">' + esc(owner.name) + '</span></div>' +
    '<div class="repo-list"><strong>' + esc(repo.slug) + '</strong><span>Base Gitflow · develop</span>' +
    '<span>CI · ' + esc(repo.checks.join(', ') || 'Todos os checks publicados') + '</span>' +
    repo.docs.map(path => '<code>' + esc(path) + '</code>').join('') +
    (owner.id === 'demo' ? '' : '<a href="https://github.com/' + esc(repo.slug) +
      '" target="_blank" rel="noopener noreferrer">Abrir no GitHub ↗</a>') + '</div></article>'
  ));
  const scope = p.id === 'demo' ? '' :
    '<label class="repo-scope">Exibir repositórios<select id="repo-scope">' +
    options({ current: 'Projeto atual', all: 'Todos os projetos' }, repoScope) + '</select></label>';
  const empty = showAll ? 'Nenhum repositório cadastrado nos projetos.' :
    'Cadastre o primeiro repositório do projeto e indique os Markdown de referência.';
  return scope + (cards.length ? '<div class="repos">' + cards.join('') + '</div>' :
    '<section class="panel empty">' + empty + '</section>');
}

function settings(p) {
  const audit = contextAudit?.project === p.id ? contextAudit.result : null;
  const statuses = {
    official: ['Fonte oficial', 'lav'], current: ['Atualizada', 'teal'], diverged: ['Divergente', 'amber'],
    missing: ['Arquivo ausente', 'amber'], unverified: ['Sem versão oficial para comparar', ''], error: ['Consulta falhou', 'red']
  };
  const copies = audit?.copies.map(copy => '<div class="copy-row"><span>' + esc(copy.repo) +
    (copy.status === 'error' ? '<small>' + esc(copy.error) + '</small>' : '') +
    '</span>' + badge(...statuses[copy.status]) + '</div>').join('') || '';
  const gitContext = isDemo() ? '' : '<section class="card compose"><div class="section-head"><h2>Contexto versionado</h2>' +
    btn('Definir fonte', 'official', 'ghost') + '</div><p class="subtitle"><code>docs/CONTEXTO-PROJETO.md</code> na <code>develop</code> de cada repositório.</p>' +
    '<p class="subtitle">Fonte oficial · ' + esc(p.officialRepo || 'A definir') + '</p><div class="repo-list">' + copies + '</div><div class="actions context-actions">' +
    btn('Baixar rascunho', 'download-draft', 'ghost', p.context ? '' : 'disabled') +
    btn(contextBusy ? 'Consultando…' : 'Verificar cópias', 'audit', '', !p.officialRepo || contextBusy ? 'disabled' : '') +
    (audit?.official ? btn('Baixar versão oficial', 'download-official') + btn('Copiar instruções para os PRs', 'propagate', 'primary') : '') +
    '</div></section>';
  return '<div class="agents">' + agentsView(p) + '</div><section class="card"><h2>Contexto compartilhado</h2><div class="pre muted">' +
    esc(p.context || 'Adicione objetivo, arquitetura, decisões e links do projeto.') +
    '</div></section>' + gitContext + '<section class="card compose"><div class="section-head"><h2>Configuração do Desktop</h2>' +
    (isDemo() ? '' : btn('Copiar instruções da sessão', 'copy')) +
    '</div><p class="subtitle">O perfil acompanha a tarefa como preferência. Escolha o modelo e o nível disponíveis na sessão do Desktop. Cadastre o conector MCP seguindo o README do projeto.</p></section>';
}

function connections() {
  const statuses = { ready: ['CLI acessível', 'teal'], missing: ['CLI fora do PATH', 'amber'], error: ['Falha ao executar o CLI', 'red'] };
  const auth = {
    'signed-in': 'Login local ativo', 'signed-out': 'Login necessário',
    unknown: 'Não foi possível verificar o login', unsupported: 'Teste de CLI verifica a versão'
  };
  const cards = Object.entries(connectionProviders).map(([provider, label]) => {
    const result = cliResults.get(provider);
    const checkedAt = mcpChecks[provider];
    const canTestMcp = provider !== 'opencode';
    const mcp = !canTestMcp ? badge('Integração MCP pendente', '') :
      checkedAt ? badge('MCP verificado', 'teal') + '<small>Último teste · ' + esc(time(checkedAt)) + '</small>' :
        badge('MCP aguardando teste', '');
    return '<article class="card connection-card"><h2>' + esc(label) + '</h2><div><h3>CLI</h3>' +
      (result ? badge(...statuses[result.status]) : badge('CLI aguardando teste')) +
      (result?.version ? '<small>Versão ' + esc(result.version) + '</small>' : '') +
      (result?.auth ? '<small>' + auth[result.auth] + '</small>' : '') + '</div><div><h3>MCP</h3>' + mcp +
      '</div><div class="actions">' +
      btn(cliPending.has(provider) ? 'Testando…' : 'Testar CLI', 'test-cli', '', 'data-id="' + provider + '"' +
        (cliPending.has(provider) ? ' disabled' : '')) +
      (canTestMcp ? btn('Copiar teste MCP', 'copy-mcp-test', 'ghost') : '') + '</div></article>';
  }).join('');
  return '<section class="card connection-guide"><p class="muted">O teste de CLI verifica a instalação no ambiente do painel. ' +
    'Para confirmar uma sessão Desktop ou CLI, copie o teste MCP, cole na sessão e depois atualize os resultados aqui. ' +
    'Esses testes verificam a configuração sem enviar uma solicitação direta ao modelo pelo painel.</p>' +
    btn(loadingChecks ? 'Atualizando…' : 'Atualizar testes MCP', 'refresh-mcp-tests', 'ghost', loadingChecks ? 'disabled' : '') +
    '</section><div class="connection-grid">' + cards + '</div>';
}

async function refreshMcpChecks() {
  if (loadingChecks) return;
  loadingChecks = true;
  render();
  try {
    mcpChecks = (await api('connections', {})).mcp;
  } catch (error) {
    toast(error.message);
  } finally {
    loadingChecks = false;
    if (view === 'connections') render();
  }
}

function planning(p) {
  const plan = p.plan;
  const editPlan = isDemo() ? '' : btn(plan ? 'Editar plano' : 'Criar plano', 'plan', 'ghost');
  const planCard = '<section class="card"><div class="section-head"><h2>Plano de execução do PO</h2>' + editPlan +
    '</div>' + (plan ? '<small>Atualizado por ' + esc(names[plan.author]) + ' · ' + esc(time(plan.updatedAt)) +
    '</small><div class="pre">' + esc(plan.markdown) + '</div>' : '<p class="muted">O plano em Markdown aparece aqui quando o PO ou o dono do projeto o publicar.</p>') +
    '</section>';
  const sprintCards = (p.sprints || []).map(sprint => {
    const tasks = p.tasks.filter(task => task.sprint === sprint.id);
    const done = tasks.filter(task => task.observation?.stage === 'merged').length;
    const taskButtons = tasks.map(task => btn(esc(task.id), 'details', 'ghost', 'data-id="' + esc(task.id) + '"')).join('');
    const dates = [sprint.start, sprint.end].filter(Boolean).map(date => date.split('-').reverse().join('/')).join(' → ');
    return '<article class="card"><div class="section-head"><h3>' + esc(sprint.name) + '</h3>' +
      badge(sprintStates[sprint.status], sprint.status === 'active' ? 'teal' : '') + '</div>' +
      (dates ? '<small>' + esc(dates) + '</small>' : '') + (sprint.goal ? '<p class="pre muted">' + esc(sprint.goal) + '</p>' : '') +
      '<p class="subtitle">' + done + ' de ' + tasks.length + ' com merge validado</p><div class="project-actions">' +
      taskButtons + '</div>' + btn('Editar sprint', 'sprint', 'ghost', 'data-id="' + esc(sprint.id) + '"') + '</article>';
  }).join('');
  const cuts = (p.releases || []).toReversed().map(release =>
    '<details class="card"><summary>v' + esc(release.version) + ' · ' + esc(release.sprintName) + ' · ' +
    release.tasks.length + ' tarefas</summary><small>Corte registrado em ' + esc(time(release.cutAt)) + '</small><div class="repo-list">' +
    release.refs.map(ref => '<div>' + esc(ref.repo) + ' · <code>' + esc(ref.sha) + '</code></div>').join('') +
    release.tasks.map(task => '<div>' + esc(task.id) + ' · ' + esc(task.repo) + (task.pr ? ' · PR #' + task.pr : '') + '</div>').join('') +
    '</div></details>'
  ).join('');
  return '<div class="project-sections">' + planCard + '<section><div class="section-head"><h2>Sprints</h2>' +
    (isDemo() ? '' : btn('Nova sprint', 'sprint', 'ghost')) + '</div>' +
    (sprintCards ? '<div class="repos">' + sprintCards + '</div>' : '<p class="panel empty">Nenhuma sprint cadastrada.</p>') +
    '</section><section><div class="section-head"><h2>Cortes de release</h2>' +
    (isDemo() ? '' : btn('Registrar corte', 'cut', 'ghost', p.sprints?.length ? '' : 'disabled')) + '</div>' +
    (cuts || '<p class="panel empty">O corte guarda os commits da develop quando todas as tarefas da sprint têm merge validado.</p>') +
    '</section></div>';
}

function runs(p) {
  const entries = p.runs || [];
  const cards = entries.map(run => {
    const [status, tone] = runStates[run.status];
    const title = p.tasks.find(task => task.id === run.task)?.title || run.task;
    const thread = run.thread && /^https:\/\//i.test(run.thread) ?
      '<a href="' + esc(run.thread) + '" target="_blank" rel="noopener noreferrer">Abrir thread ↗</a>' :
      esc(run.thread || 'Aguardando registro');
    const heading = run.task ? run.task + ' · ' + title : 'Plano de execução';
    return '<article class="card"><div class="section-head"><div><h3>' + esc(heading) +
      '</h3><small>' + esc(names[run.agent]) + ' · ' + esc(roles[run.role]) + (run.repo ? ' · ' + esc(run.repo) : '') +
      '</small></div>' + badge(status, tone) + '</div><div class="repo-list"><span>Início · ' + esc(time(run.startedAt)) +
      ' · Última atualização · ' + esc(time(run.updatedAt)) + '</span><span>Thread · ' + thread + '</span>' +
      (run.worktree ? '<span>Worktree · <code>' + esc(run.worktree) + '</code></span>' : '') +
      (run.branch ? '<span>Branch · <code>' + esc(run.branch) + '</code></span>' : '') +
      '</div>' + (run.events.length ? '<details class="run-events" open><summary>Progresso informado pelo agente</summary>' +
        run.events.toReversed().map(event => '<div class="copy-row"><small>' + esc(time(event.at)) + '</small><p class="pre">' +
          esc(event.message) + '</p></div>').join('') + '</details>' : '') + '</article>';
  }).join('');
  return '<div class="section-head"><p class="muted">Cada reserva tem seu próprio histórico. As atualizações chegam pelo MCP.</p>' +
    (isDemo() ? '' : btn('Atualizar execuções', 'refresh-runs', 'ghost')) + '</div><div class="project-sections">' +
    (cards || '<section class="panel empty">As execuções aparecem quando o PO inicia o planejamento ou quando Dev e QA reservam tarefas.</section>') + '</div>';
}

function resetCountdown(value) {
  const remaining = Date.parse(value) - Date.now();
  if (remaining <= 0) return 'Horário atingido · atualize a leitura';
  const minutes = Math.ceil(remaining / 60_000);
  return 'Faltam ' + (minutes >= 1440 ? Math.floor(minutes / 1440) + 'd ' : '') +
    Math.floor(minutes % 1440 / 60) + 'h ' + minutes % 60 + 'min';
}

const money = (micros, currency) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency, maximumFractionDigits: 6
}).format(micros / 1_000_000);

function usage(p) {
  const quotaCards = ['claude', 'codex'].map(provider => {
    const snapshot = usageLimits[provider];
    const windows = Object.entries({ fiveHours: 'Janela de 5 horas', weekly: 'Janela semanal' }).map(([key, label]) => {
      const window = snapshot?.windows[key];
      if (!window) return '<div class="quota-window"><h3>' + label + '</h3><small>Janela sem leitura</small></div>';
      const expired = Date.parse(window.resetsAt) <= Date.now();
      return '<div class="quota-window"><div class="section-head"><h3>' + label + '</h3>' +
        badge(expired ? 'Atualização necessária' : window.used + '% usado', expired ? 'amber' : 'teal') + '</div>' +
        '<progress value="' + window.used + '" max="100" aria-label="' + label + '"></progress><small>Reset · ' +
        esc(time(window.resetsAt)) + '</small><small data-reset="' + esc(window.resetsAt) + '">' +
        esc(resetCountdown(window.resetsAt)) + '</small></div>';
    }).join('');
    return '<article class="card"><div class="section-head"><h2>' + esc(connectionProviders[provider]) + '</h2>' +
      btn('Informar limites', 'limits', 'ghost', 'data-id="' + provider + '"') + '</div>' +
      (snapshot ? '<small>Origem · ' + esc(snapshot.source) + ' · Leitura ' + esc(time(snapshot.checkedAt)) + '</small>' : '') +
      windows + (provider === 'codex' ? btn(queryingCodex ? 'Consultando…' : 'Consultar Codex local', 'query-codex-limits', '',
        queryingCodex ? 'disabled' : '') : '<small>Coleta opcional pelo Claude Code · consulte o manual.</small>') + '</article>';
  }).join('');
  const projects = costScope === 'all' || isDemo() ? workspace : [p];
  const entries = projects.flatMap(owner => (owner.costs || []).filter(entry => !entry.voidedAt).map(entry => ({
    ...entry, project: owner.id, projectName: owner.name
  })));
  const totals = new Map();
  const grouped = new Map();
  for (const entry of entries) {
    const totalKey = JSON.stringify([entry.kind, entry.currency]);
    const key = JSON.stringify([entry.project, entry.agent, entry.role, entry.kind, entry.currency]);
    totals.set(totalKey, (totals.get(totalKey) || 0) + entry.micros);
    const previous = grouped.get(key);
    grouped.set(key, { ...entry, micros: (previous?.micros || 0) + entry.micros });
  }
  const summary = [...totals].map(([key, amount]) => {
    const [kind, currency] = JSON.parse(key);
    return '<article class="card"><small>' + costKinds[kind] + ' · ' + currency + '</small><strong class="stat-value">' +
      esc(money(amount, currency)) + '</strong></article>';
  }).join('');
  const rows = [...grouped.values()].map(entry => '<tr><td>' + esc(entry.projectName) + '<small>' + esc(entry.project) +
    '</small></td><td>' + esc(names[entry.agent]) + '</td><td>' + esc(roles[entry.role]) + '</td><td>' +
    costKinds[entry.kind] + '</td><td>' + esc(money(entry.micros, entry.currency)) + '</td></tr>').join('');
  const ledger = entries.toReversed().slice(0, 50).map(entry => '<div class="copy-row"><div><strong>' +
    esc(money(entry.micros, entry.currency)) + ' · ' + costKinds[entry.kind] + '</strong><small>' +
    esc(entry.projectName) + ' · ' + esc(names[entry.agent]) + ' · ' + esc(roles[entry.role]) + ' · ' +
    esc(entry.source) + '</small><small>' + esc(time(entry.at)) + '</small></div>' +
    btn('Cancelar lançamento', 'void-cost', 'ghost', 'data-id="' + esc(entry.id) + '" data-project="' + esc(entry.project) + '"') + '</div>').join('');
  return '<div class="project-sections"><section><div class="section-head"><h2>Limites da conta compartilhados entre projetos</h2>' +
    btn('Atualizar leituras', 'refresh-usage-limits', 'ghost') + '</div><div class="repos quota-cards">' + quotaCards +
    '</div></section><section><div class="section-head"><h2>Custos registrados</h2><label class="repo-scope">Exibir<select id="cost-scope">' +
    options({ current: 'Projeto atual', all: 'Todos os projetos' }, costScope) + '</select></label></div>' +
    '<p class="muted">Valores acumulados por execução, informados pelo agente ou pelo dono do projeto. Moedas e tipos de valor são apresentados separadamente.</p>' +
    (summary ? '<div class="repos cost-summary">' + summary + '</div>' : '') +
    '<div class="panel table-wrap"><table><thead><tr><th>Projeto</th><th>Agente</th><th>Papel</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5" class="empty">Nenhum custo registrado.</td></tr>') +
    '</tbody></table></div></section>' + (ledger ? '<details class="card"><summary>Lançamentos recentes</summary>' + ledger + '</details>' : '') + '</div>';
}

async function refreshUsageLimits() {
  try {
    usageLimits = await api('usage_limits', {});
    if (view === 'usage') render();
  } catch (error) { toast(error.message); }
}

function render() {
  const p = project();
  $('#projects').innerHTML = [...workspace, example].map(item =>
    '<button class="nav-item ' + (item.id === p.id ? 'active' : '') + '" data-action="select" data-id="' + esc(item.id) +
    '"><span class="nav-icon">◈</span><span>' + esc(item.name) + (item.id === 'demo' ? ' · demo' : '') + '</span></button>').join('');
  $('#nav').innerHTML = Object.entries(views).map(([key, [icon, label]]) =>
    '<button class="nav-item ' + (key === view ? 'active' : '') + '" data-action="navigate" data-id="' + key +
    '"><span class="nav-icon">' + icon + '</span><span>' + label + '</span></button>').join('');
  const showingConnections = view === 'connections';
  $('#connections-nav').classList.toggle('active', showingConnections);
  $('#breadcrumb').textContent = 'Workspace / ' + (showingConnections ? 'Configurações' : p.name);
  $('#sync').hidden = showingConnections;
  $('#sync').disabled = isDemo() || syncBusy;
  const info = {
    pipeline: ['Fluxo de entrega', 'Do planejamento à validação, com Gitflow e merge humano.', '+ Nova tarefa', 'task'],
    planning: ['Planejamento', 'Plano do PO, sprints e cortes de release deste projeto.', '', ''],
    runs: ['Execuções', 'Acompanhe tarefas paralelas, threads e worktrees dos agentes.', '', ''],
    usage: ['Custos e limites', 'Consumo por projeto, agente e papel, com os horários de reset informados pela conta.', '+ Registrar custo', 'cost'],
    chat: ['Chat do projeto', 'Decisões e handoffs entre pessoas e agentes.', '', ''],
    repos: ['Repositórios', 'Contexto de API, web e mobile, com referências por repositório.', '+ Repositório', 'repo'],
    settings: ['Papéis e contexto', 'Defina quem planeja, implementa e revisa as próximas tarefas.', 'Editar configuração', 'config'],
    connections: ['Conexões', 'Verifique seus CLIs e confirme o acesso dos agentes ao Orquestrador.', '', '']
  }[view];
  const action = isDemo() && !showingConnections ? btn('+ Criar meu projeto', 'project', 'primary') : info[3] ? btn(info[2], info[3], 'primary') : '';
  const body = { pipeline, planning, runs, usage, chat, repos, settings, connections }[view](p);
  $('#view').innerHTML = '<div class="heading"><div><p class="eyebrow">' + esc(showingConnections ? 'CONFIGURAÇÕES' : p.name.toUpperCase()) +
    '</p><h1>' + info[0] + '</h1><p class="subtitle">' + info[1] + '</p></div>' + action + '</div>' +
    (isDemo() && !showingConnections && view !== 'usage' ? '<p class="notice">Projeto de demonstração · Os dados abaixo são ilustrativos.</p>' : '') + body;
  if ($('#messages')) $('#messages').scrollTop = $('#messages').scrollHeight;
}

const textField = (label, name, value = '', extra = '') => '<label>' + label + '<input name="' + name + '" value="' + esc(value) + '" ' + extra + '></label>';
const area = (label, name, value = '', extra = '') => '<label>' + label + '<textarea name="' + name + '" ' + extra + '>' + esc(value) + '</textarea></label>';

function profileFields(profile) {
  return '<label>Perfis rápidos<select id="preset"><option value="">Personalizado</option><option value="claude">Claude PO e Dev · Codex QA</option>' +
    '<option value="codex">Codex PO e Dev · Claude QA</option><option value="original">Claude PO · Codex Dev · Claude QA</option></select></label>' +
    Object.entries(roles).map(([role, label]) => '<fieldset><legend>' + label + '</legend><div class="profile-fields"><label>Agente<select name="' +
      role + '-agent">' + options({ claude: names.claude, codex: names.codex, gemini: names.gemini }, profile[role].agent) +
      '</select></label>' + textField('Modelo preferido', role + '-model', profile[role].model, 'maxlength="100" placeholder="Padrão do Desktop"') +
      '<label>Nível de esforço<select name="' + role + '-effort">' + options(efforts, profile[role].effort) +
      '</select></label>' + textField('Login GitHub' + (role === 'qa' ? ' do QA' : ' (opcional)'), role + '-login', profile[role].login,
      'maxlength="39" placeholder="usuario"') + '</div></fieldset>').join('');
}

function showModal(type, title, fields, data = {}) {
  modal = { type, ...data };
  $('#modal').innerHTML = '<div class="modal-head"><h2>' + esc(title) +
    '</h2><button type="button" class="icon-button" data-action="close" aria-label="Fechar">×</button></div><div class="fields">' +
    fields + '</div><p class="modal-error" role="alert"></p><div class="actions">' + btn('Fechar', 'close', 'ghost') +
    (type === 'details' ? '' : '<button type="submit" class="button primary">Salvar</button>') + '</div>';
  if (!$('#dialog').open) $('#dialog').showModal();
}

function open(type, id) {
  const p = project();
  if (type === 'cost') showModal(type, 'Registrar custo · ' + p.name,
    textField('Valor', 'amount', '', 'required inputmode="decimal" placeholder="0,50"') +
    '<label>Moeda<select name="currency">' + options({ USD: 'USD', BRL: 'BRL', EUR: 'EUR' }, 'USD') + '</select></label>' +
    '<label>Tipo<select name="kind">' + options(costKinds, 'estimate') + '</select></label>' +
    '<label>Agente<select name="agent">' + options({ claude: names.claude, codex: names.codex, gemini: names.gemini }, p.profile.dev.agent) + '</select></label>' +
    '<label>Papel<select name="role">' + options(roles, 'dev') + '</select></label>' +
    textField('Origem do valor', 'source', '', 'required maxlength="160" placeholder="Resumo da sessão ou fatura"'));
  if (type === 'limits') {
    const snapshot = usageLimits[id];
    const dateValue = value => {
      if (!value) return '';
      const date = new Date(value);
      return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    showModal(type, 'Limites · ' + connectionProviders[id],
      '<p class="muted">Informe os valores e resets mostrados na sua conta. Preencha as janelas disponíveis.</p>' +
      Object.entries({ fiveHours: '5 horas', weekly: 'Semanal' }).map(([key, label]) =>
        textField('Uso ' + label + ' (%)', key + '-used', snapshot?.windows[key]?.used ?? '', 'type="number" min="0" max="100" step="0.1"') +
        textField('Reset ' + label, key + '-reset', dateValue(snapshot?.windows[key]?.resetsAt), 'type="datetime-local"')
      ).join(''), { provider: id });
  }
  const sprintOptions = Object.fromEntries((p.sprints || []).map(sprint => [sprint.id, sprint.name]));
  if (type === 'plan') showModal(type, 'Plano de execução do PO',
    area('Plano em Markdown', 'markdown', p.plan?.markdown, 'required maxlength="12000"'));
  if (type === 'sprint') {
    const sprint = p.sprints?.find(item => item.id === id);
    showModal(type, sprint ? 'Editar sprint' : 'Nova sprint',
      textField('Nome', 'name', sprint?.name, 'required maxlength="80"') +
      area('Objetivo', 'goal', sprint?.goal, 'maxlength="1500"') +
      '<label>Status<select name="status">' + options(sprintStates, sprint?.status || 'planned') + '</select></label>' +
      textField('Data inicial', 'start', sprint?.start, 'type="date"') +
      textField('Data final', 'end', sprint?.end, 'type="date"'), { sprint: id });
  }
  if (type === 'assign') {
    const task = p.tasks.find(item => item.id === id);
    showModal(type, 'Sprint · ' + task.id, '<label>Sprint<select name="sprint">' +
      options({ '': 'Sem sprint', ...sprintOptions }, task.sprint || '') + '</select></label>', { task: id });
  }
  if (type === 'cut') showModal(type, 'Registrar corte de release',
    textField('Versão', 'version', '', 'required maxlength="24" placeholder="1.0.0"') +
    '<label>Sprint<select name="sprint" required>' + options(sprintOptions, '') + '</select></label>' +
    '<p class="muted">A sprint precisa ter todas as tarefas com merge validado. O corte registra os commits da develop para revisão.</p>');
  if (type === 'project') showModal(type, 'Novo projeto',
    textField('Nome', 'name', '', 'required maxlength="80"') + textField('Identificador', 'id', '', 'required maxlength="48" placeholder="meu-projeto"') +
    area('Contexto em Markdown', 'context', '', 'maxlength="12000"') + profileFields(defaultProfile));
  if (type === 'config') showModal(type, 'Papéis, modelos e contexto',
    profileFields(p.profile) + area('Contexto em Markdown', 'context', p.context, 'maxlength="12000"'));
  if (type === 'official') {
    if (!p.repos.length) return toast('Cadastre um repositório para escolher a fonte oficial.');
    showModal(type, 'Fonte oficial de contexto',
      '<label>Repositório oficial<select name="repo">' + options(Object.fromEntries(p.repos.map(repo => [repo.slug, repo.slug])), p.officialRepo) +
      '</select></label><p class="muted">O arquivo docs/CONTEXTO-PROJETO.md desse repositório será a referência para as cópias de todos os outros.</p>');
  }
  if (type === 'repo') showModal(type, 'Adicionar repositório',
    textField('GitHub no formato dono/repositorio', 'slug', '', 'required maxlength="100" placeholder="time/minha-api"') +
    '<label>Área<select name="kind">' + options({ Backend: 'Backend', Frontend: 'Frontend', Mobile: 'Mobile', Infra: 'Infra', Outro: 'Outro' }, 'Backend') + '</select></label>' +
    area('Arquivos Markdown da develop, um por linha', 'docs', '', 'placeholder="docs/arquitetura/integracao.md"') +
    area('Checks obrigatórios, um por linha', 'checks', '', 'placeholder="api-tests"'));
  if (type === 'task') {
    if (!p.repos.length) return toast('Cadastre um repositório antes de criar tarefas.');
    showModal(type, 'Nova tarefa',
      textField('ID da tarefa', 'task', '', 'required maxlength="32" placeholder="API-01"') +
      textField('Título', 'title', '', 'required maxlength="120"') +
      '<label>Repositório<select name="repo">' + options(Object.fromEntries(p.repos.map(repo => [repo.slug, repo.slug])), '') + '</select></label>' +
      area('Escopo e critérios de aceite', 'description', '', 'maxlength="5000"') +
      textField('Dependências (IDs separados por vírgula)', 'depends', '', 'placeholder="API-01, WEB-02"') +
      (p.sprints?.length ? '<label>Sprint<select name="sprint">' + options({ '': 'Sem sprint', ...sprintOptions }, '') + '</select></label>' : ''));
  }
  if (type === 'details') {
    const task = p.tasks.find(item => item.id === id);
    const [status, tone] = stages[stageFor(task, p)];
    const details = '<div>' + badge(status, tone) + '<p class="pre">' + esc(task.description || 'Sem descrição.') +
      '</p><small>' + esc(task.repo) + ' · develop</small><small>Dependências · ' +
      esc(task.depends.join(', ') || 'Nenhuma') + '</small></div><div>' +
      Object.entries(task.profile).map(([role, config]) => '<p>' + esc(roles[role]) + ' · ' + esc(names[config.agent]) +
        ' · ' + esc(config.model || 'Modelo do Desktop') + ' · ' + esc(efforts[config.effort]) + '</p>').join('') +
      '</div>' + (task.observation?.head ? '<div class="repo-list"><code>' + esc(task.observation.head) + '</code><span>CI · ' +
        esc({ passed: 'Passou', failed: 'Falhou', pending: 'Pendente' }[task.observation.ci]) + ' · GitHub ' +
        esc(task.observation.mergeState || '—') + '</span></div>' : '') +
      (task.syncError ? '<p class="modal-error">' + esc(task.syncError) + '</p>' : '') +
      (task.observation?.url ? '<a href="' + esc(task.observation.url) + '" target="_blank" rel="noopener noreferrer">Abrir PR #' + task.pr + ' no GitHub ↗</a>' : '') +
      (task.sprint ? '<small>Sprint · ' + esc(sprintOptions[task.sprint]) + '</small>' : '') +
      (!isDemo() && p.sprints?.length ? btn('Definir sprint', 'assign', 'ghost', 'data-id="' + esc(task.id) + '"') : '') +
      (!isDemo() && !task.pr ? btn('Vincular PR', 'link', '', 'data-id="' + esc(task.id) + '"') : '');
    showModal(type, task.id + ' · ' + task.title, details);
  }
  if (type === 'link') showModal(type, 'Vincular PR · ' + id, textField('Número do PR no GitHub', 'number', '', 'type="number" min="1" required'), { task: id });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'select') {
    current = id; view = 'pipeline'; filter = ''; search = ''; render();
  } else if (action === 'navigate' || action === 'settings') {
    view = id || 'settings';
    if (view === 'connections') await refreshMcpChecks();
    else if (view === 'usage') { render(); await refreshUsageLimits(); }
    else render();
  } else if (action === 'close') $('#dialog').close();
  else if (action === 'refresh-usage-limits') await refreshUsageLimits();
  else if (action === 'query-codex-limits') {
    queryingCodex = true;
    render();
    try {
      usageLimits.codex = await api('refresh_codex_limits', {});
    } catch (error) { toast(error.message); }
    finally { queryingCodex = false; if (view === 'usage') render(); }
  } else if (action === 'void-cost') {
    button.disabled = true;
    try {
      await api('void_cost', { project: button.dataset.project, id });
      await load();
      if (view === 'usage') render();
    } catch (error) { toast(error.message); button.disabled = false; }
  }
  else if (action === 'refresh-runs') {
    try {
      await load();
      if (view === 'runs') render();
    } catch (error) { toast(error.message); }
  }
  else if (action === 'refresh-mcp-tests') await refreshMcpChecks();
  else if (action === 'test-cli') {
    cliPending.add(id);
    render();
    try {
      cliResults.set(id, await api('test_cli', { provider: id }));
    } catch (error) {
      toast(error.message);
    } finally {
      cliPending.delete(id);
      if (view === 'connections') render();
    }
  } else if (action === 'copy-mcp-test') {
    try {
      await navigator.clipboard.writeText('Use a ferramenta testar_conexao do MCP orquestradoria para confirmar a conexão com o painel.');
      toast('Cole o teste na sessão do agente e volte para atualizar os resultados.');
    } catch { toast('Na sessão do agente, peça para executar testar_conexao do MCP orquestradoria.'); }
  }
  else if (action === 'audit') {
    const auditProject = current;
    contextBusy = true;
    render();
    try {
      contextAudit = { project: auditProject, result: await api('context_audit', { project: auditProject }) };
    } catch (error) { toast(error.message); }
    finally { contextBusy = false; render(); }
  } else if (action === 'download-draft' || action === 'download-official') {
    const markdown = action === 'download-draft' ? project().context : contextAudit?.result.official?.markdown;
    if (markdown === undefined) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'CONTEXTO-PROJETO.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (action === 'propagate') {
    const audit = contextAudit?.result;
    const targets = audit?.copies.filter(copy => ['missing', 'diverged'].includes(copy.status)) || [];
    if (!targets.length) return toast('Nenhuma cópia desatualizada ou ausente na última consulta.');
    const source = audit.officialRepo + ' no commit ' + audit.official.sha;
    try {
      await navigator.clipboard.writeText(
        'Projeto ' + current + '. Propague o arquivo ' + audit.path + ' de ' + source + '. ' +
        'Confirme a versão oficial atual com o MCP verificar_contexto antes de alterar. ' +
        'Abra um PR Gitflow de feature/ ou bugfix/ para develop em cada repositório: ' +
        targets.map(item => item.repo).join(', ') + '. Preserve o conteúdo idêntico ao oficial. Deixe o merge com o dono.'
      );
      toast('Instruções dos PRs copiadas.');
    } catch { toast('O navegador não liberou a área de transferência.'); }
  }
  else if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(
        'Use o MCP orquestradoria para trabalhar no projeto ' + current + '. Leia contexto e caixa_de_entrada. ' +
        'Veja seu papel em projetos e consulte ler_planejamento. Como PO, use iniciar_planejamento, publique o plano com salvar_plano e organize as sprints. ' +
        'Como Dev ou QA, reserve uma tarefa com reservar_tarefa e confirme o perfil de modelo e esforço. Atualize as referências ' +
        'do clone antes de preparar_worktree. Registre a thread e o progresso com atualizar_execucao. ' +
        'Se a sessão fornecer custo acumulado, informe com registrar_custo antes de liberar a reserva e indique a origem e o tipo do valor. ' +
        'Como Dev, trabalhe em feature/ ou bugfix/ a partir de develop e ' +
        'vincule o PR com vincular_pr. Como QA, revise o SHA retornado e publique review formal ou veredito no PR ' +
        'com QA: APROVADO <sha> ou QA: CORRIGIR <sha> na primeira linha. Registre o resumo com enviar_mensagem. ' +
        'Se houver mensagem pendente do dono, responda no chat do projeto. O merge é humano.'
      );
      toast('Instruções copiadas.');
    } catch { toast('O navegador não liberou a área de transferência. Use as instruções do README.'); }
  }
  else if (action === 'sync') {
    syncBusy = true;
    button.disabled = true;
    try {
      await api('refresh', {});
      await load();
      toast('Consulta ao GitHub concluída. Confira o status em cada tarefa.');
    } catch (error) { toast(error.message); }
    finally { syncBusy = false; render(); }
  } else open(action, id);
});

document.addEventListener('change', event => {
  if (event.target.id === 'cost-scope') {
    costScope = event.target.value;
    render();
    $('#cost-scope').focus({ preventScroll: true });
    return;
  }
  if (event.target.id === 'repo-scope') {
    repoScope = event.target.value;
    render();
    $('#repo-scope').focus({ preventScroll: true });
    return;
  }
  if (event.target.id !== 'preset' || !event.target.value) return;
  const preset = event.target.value;
  const form = $('#modal');
  const previous = Object.fromEntries(Object.keys(roles).map(role => [
    form.elements[role + '-agent'].value,
    { login: form.elements[role + '-login'].value, model: form.elements[role + '-model'].value,
      effort: form.elements[role + '-effort'].value }
  ]));
  const next = preset === 'original' ? ['claude', 'codex', 'claude'] : [preset, preset, preset === 'claude' ? 'codex' : 'claude'];
  Object.keys(roles).forEach((role, index) => {
    const agent = next[index];
    form.elements[role + '-agent'].value = agent;
    form.elements[role + '-login'].value = previous[agent]?.login || '';
    form.elements[role + '-model'].value = previous[agent]?.model || '';
    form.elements[role + '-effort'].value = previous[agent]?.effort || 'default';
  });
});

document.addEventListener('submit', async event => {
  const form = event.target;
  const formId = form.getAttribute('id');
  if (!['modal', 'filter', 'compose'].includes(formId)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (formId === 'filter') {
    search = values.search; filter = values.status; render(); return;
  }
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    if (formId === 'compose') await api('post', { ...values, project: current });
    else {
      const actions = {
        project: 'create_project', config: 'settings', repo: 'add_repo', task: 'add_task', link: 'attach_pr', official: 'official_repo',
        plan: 'save_plan', sprint: 'save_sprint', assign: 'assign_sprint', cut: 'cut_release',
        cost: 'record_cost', limits: 'save_usage_limits'
      };
      const args = { ...values, project: current };
      if (modal.type === 'project' || modal.type === 'config') args.profile = Object.fromEntries(Object.keys(roles).map(role => [
        role, Object.fromEntries(['agent', 'model', 'effort', 'login'].map(key => [key, values[role + '-' + key]]))
      ]));
      if (modal.type === 'repo') { args.docs = split(values.docs); args.checks = split(values.checks); }
      if (modal.type === 'task') args.depends = split(values.depends);
      if (modal.type === 'link') args.task = modal.task;
      if (modal.type === 'assign') args.task = modal.task;
      if (modal.type === 'sprint') args.sprint = modal.sprint;
      if (modal.type === 'limits') {
        args.provider = modal.provider;
        args.windows = {};
        for (const key of ['fiveHours', 'weekly']) {
          const used = values[key + '-used'];
          const reset = values[key + '-reset'];
          if (!used && !reset) continue;
          if (!used || !reset) throw new Error('Preencha o percentual e o reset da janela.');
          args.windows[key] = { used: Number(used), resetsAt: new Date(reset).toISOString() };
        }
      }
      const result = await api(actions[modal.type], args);
      if (modal.type === 'project') { current = result.id; view = 'pipeline'; search = ''; filter = ''; }
      if (['repo', 'official'].includes(modal.type)) contextAudit = null;
      $('#dialog').close();
      toast('Alteração salva.');
    }
    await load();
    if (modal?.type === 'limits' && formId === 'modal') usageLimits = await api('usage_limits', {});
    render();
  } catch (error) {
    if (formId === 'modal' && $('#dialog').open) $('.modal-error').textContent = error.message;
    else toast(error.message);
  } finally { submit.disabled = false; }
});

try {
  await load();
  if (workspace.length) current = workspace[0].id;
} catch (error) { toast(error.message); }
render();
setInterval(async () => {
  if ((isDemo() && view !== 'usage') || syncBusy || queryingCodex || $('#dialog').open || document.activeElement?.matches('input, select, textarea')) return;
  try {
    const visibleData = () => view === 'usage' ? { workspace, usageLimits } :
      ['pipeline', 'settings'].includes(view) || (view === 'repos' && repoScope === 'all') ? workspace : project();
    const previous = JSON.stringify(visibleData());
    await load();
    if (view === 'usage') usageLimits = await api('usage_limits', {});
    if (JSON.stringify(visibleData()) !== previous) render();
  } catch { /* The next refresh can recover from a server restart. */ }
}, 7000);
setInterval(() => {
  for (const node of document.querySelectorAll('[data-reset]')) node.textContent = resetCountdown(node.dataset.reset);
}, 30_000);
