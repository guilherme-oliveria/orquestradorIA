const $ = selector => document.querySelector(selector);
const names = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', all: 'Todos', user: 'Você' };
const roles = { po: 'Produto · PO', dev: 'Desenvolvimento · Dev', qa: 'Qualidade · QA' };
const efforts = { default: 'Padrão', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };
const stages = {
  queue: ['Na fila', '', 0], blocked: ['Aguardando dependência', 'amber', 0], dev: ['Em desenvolvimento', 'lav', 1],
  draft: ['PR em rascunho', 'lav', 2], review: ['Em revisão', 'lav', 3], changes: ['Correções solicitadas', 'amber', 3],
  tests: ['Rodando testes', 'teal', 4], merge: ['Aprovado, esperando seu merge', 'teal', 6], merged: ['Merge feito', 'teal', 7],
  'merged-unverified': ['Merge sem validação', 'red', 6], closed: ['Cancelado', '', 2], error: ['Falha na sincronização', 'red', 2]
};
const historyStages = {
  'github-open': ['Aberto no GitHub', 'lav'], 'github-draft': ['Rascunho no GitHub', 'lav'],
  'github-merged': ['Merge no GitHub', 'teal'], 'github-closed': ['Fechado no GitHub', '']
};
const milestones = ['Fila', 'Desenvolvimento', 'PR', 'Revisão', 'Testes', 'Aprovação', 'Seu merge'];
const views = {
  pipeline: ['▦', 'Pipeline'], context: ['◆', 'Contexto'], planning: ['◫', 'Planejamento'], runs: ['▶', 'Execuções'],
  usage: ['◉', 'Custos e limites'], chat: ['◇', 'Chat do projeto'], repos: ['▣', 'Repositórios'], settings: ['⚙', 'Papéis e contexto']
};
const entryTypes = { decision: 'Decisão', contract: 'Contrato', note: 'Nota' };
const entryTones = { decision: 'lav', contract: 'teal', note: 'amber' };
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

let workspace = [];
let current;
let view = 'overview';
const overviewFilter = { project: '', repo: '', agent: '', stage: '' };
let modal;
let timer;
let search = '';
let filter = '';
const prHistories = new Map();
const repoPlans = new Map();
const historyPageSize = 25;
let historyRowsShown = historyPageSize;
let repoScope = 'current';
// Agentes vêm do registro do servidor (lib/agents.mjs) junto com o workspace.
let agentList = [];
const connectionProviders = {};
const assignable = () => Object.fromEntries(agentList.filter(agent => agent.assignable).map(agent => [agent.id, agent.label]));
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
let entryRepo = '';
let entryType = '';
let showEnded = false;

const project = () => workspace.find(item => item.id === current);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const options = (values, selected) => Object.entries(values).map(([value, label]) =>
  '<option value="' + esc(value) + '"' + (selected === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
const btn = (label, action, style = '', attrs = '') =>
  '<button type="button" class="button ' + style + '" data-action="' + action + '" ' + attrs + '>' + label + '</button>';
const badge = (value, tone = '') => '<span class="badge ' + tone + '">' + esc(value) + '</span>';
const split = value => String(value || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
const time = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data indisponível';
const defaultContextPath = 'docs/CONTEXTO-PROJETO.md';

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
  const data = await response.json();
  workspace = data.projects;
  agentList = data.agents || [];
  for (const agent of agentList) {
    names[agent.id] = agent.label;
    connectionProviders[agent.id] = agent.short;
  }
  if (!project()) current = workspace[0]?.id;
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
  for (const owner of workspace) {
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

const matchesSearch = (...values) => values.some(value => value.toLowerCase().includes(search.trim().toLowerCase()));

async function loadPrHistory(id) {
  if (prHistories.get(id)?.loading) return;
  const loading = { ...prHistories.get(id), loading: true };
  prHistories.set(id, loading);
  let result;
  try {
    result = await api('pr_history', { project: id });
  } catch (error) {
    result = { ...loading, loading: false, error: error.message };
  }
  if (prHistories.get(id) !== loading) return;
  prHistories.set(id, result);
  if (view === 'pipeline' && current === id) render();
}

function historyRows(p) {
  const state = prHistories.get(p.id);
  const linked = new Set(p.tasks.filter(task => task.pr).map(task => task.repo + '#' + task.pr));
  const repos = state?.history || [];
  const prs = repos.flatMap(({ repo, prs }) => prs.filter(pr => !linked.has(repo + '#' + pr.number)).map(pr => ({
    ...pr, repo, status: 'github-' + (pr.state === 'OPEN' && pr.isDraft ? 'draft' : pr.state.toLowerCase())
  })));
  const filtered = prs.filter(pr => (!filter || filter === pr.status) &&
    matchesSearch('PR #' + pr.number, pr.title, pr.repo, pr.headRefName, pr.baseRefName))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const rows = filtered.slice(0, historyRowsShown).map(pr => {
    const [label, tone] = historyStages[pr.status];
    return '<tr><td><a href="https://github.com/' + esc(pr.repo) + '/pull/' + esc(pr.number) +
      '" target="_blank" rel="noopener noreferrer" class="task-button"><span class="task-id">PR #' + esc(pr.number) +
      '</span>' + esc(pr.title) + '</a><small>' + esc(pr.repo) + '</small></td><td><small>' + esc(pr.headRefName) +
      ' → ' + esc(pr.baseRefName) + '</small><small>Atualizado em ' + esc(time(pr.updatedAt)) +
      '</small></td><td>' + badge(label, tone) + '<small>Histórico do GitHub</small></td></tr>';
  }).join('');
  const errors = repos.filter(repo => repo.error).map(repo => esc(repo.repo) + ' · ' + esc(repo.error));
  if (state?.error) errors.push(esc(state.error));
  const limit = repos.some(repo => repo.prs.length === state.limit) ?
    ' · até ' + state.limit + ' PRs recentes por repositório' : '';
  const footer = state?.loading ? 'Consultando PRs no GitHub…' :
    'Histórico do GitHub · ' + Math.min(historyRowsShown, filtered.length) + ' de ' + filtered.length + ' PRs encontrados' + limit;
  return { rows, footer, errors, hasMore: filtered.length > historyRowsShown };
}

const correctionsLabel = count => count ? count + (count === 1 ? ' correção' : ' correções') : '';

function taskRow(task, p) {
  const stage = stageFor(task, p);
  const [label, tone, index] = stages[stage];
  const dots = milestones.map((name, i) => '<span class="rail-step ' +
    (stage === 'closed' ? '' : i < index ? 'done' : i === index ? 'current' : '') + '" title="' + name + '"></span>').join('');
  const corrections = correctionsLabel(task.observation?.corrections);
  return '<tr><td><button class="task-button" data-action="details" data-id="' + esc(task.id) + '" data-project="' + esc(p.id) +
    '"><span class="task-id">' + esc(task.id) + '</span>' + esc(task.title) + '</button><small>' + esc(task.repo) +
    (task.pr ? ' · PR #' + task.pr : '') + '</small></td><td><div class="rail" aria-label="' + label + '">' + dots +
    '</div>' + (corrections ? '<div class="corrections"><span>' + corrections + '</span></div>' : '') +
    '</td><td><strong class="stage-text ' + tone + '">' + esc(label) + '</strong><small>' + names[task.profile.dev.agent] +
    ' desenvolve, ' + names[task.profile.qa.agent] + ' revisa</small></td></tr>';
}

function rows(p) {
  return p.tasks.filter(task => (!filter || stageFor(task, p) === filter) &&
    matchesSearch(task.id, task.title, task.repo, task.pr ? '#' + task.pr : ''))
    .map(task => taskRow(task, p)).join('');
}

function activeReservations() {
  const byAgent = new Map();
  for (const owner of workspace) {
    for (const run of owner.runs || []) {
      if (run.role !== 'po' || run.status !== 'active' || run.expires <= Date.now()) continue;
      byAgent.set(run.agent, [...(byAgent.get(run.agent) || []), 'Planejamento · ' + owner.name]);
    }
    for (const task of owner.tasks) {
      if (!task.lease || task.lease.expires <= Date.now()) continue;
      const agent = task.profile[task.lease.role].agent;
      byAgent.set(agent, [...(byAgent.get(agent) || []), task.id + ' · ' + owner.name]);
    }
  }
  return byAgent;
}

function overview() {
  const busy = activeReservations();
  const all = workspace.flatMap(p => p.tasks.map(task => ({ task, p, stage: stageFor(task, p) })));
  const waiting = all.filter(item => item.stage === 'merge').length;
  const summary = (waiting ? waiting + (waiting === 1 ? ' PR esperando' : ' PRs esperando') + ' seu merge' : 'Nenhum PR esperando seu merge') + '. ' +
    (busy.size ? busy.size + (busy.size === 1 ? ' agente trabalhando' : ' agentes trabalhando') : 'Nenhum agente trabalhando') + '.';
  const agentIds = [...new Set(workspace.flatMap(p => Object.values(p.profile).map(config => config.agent)))];
  const agentCards = agentIds.map(agent => {
    const work = busy.get(agent) || [];
    const roleList = [...new Set(workspace.flatMap(p => Object.entries(p.profile)
      .filter(([, config]) => config.agent === agent).map(([role]) => roles[role].split(' · ')[1])))].join(', ');
    const quota = Object.entries({ fiveHours: 'janela de 5 horas', weekly: 'semana' }).map(([key, label]) => {
      const window = usageLimits[agent]?.windows?.[key];
      if (!window || Date.parse(window.resetsAt) <= Date.now()) return '';
      return '<div class="quota-line"><progress value="' + window.used + '" max="100" aria-label="' + label + '"></progress><small>' +
        window.used + '% da ' + label + ' usada</small></div>';
    }).join('');
    return '<article class="card agent ' + agent + '"><div class="role">' + esc(roleList) + '</div><h3>' + esc(names[agent]) +
      '</h3><div class="agent-state">' + (work.length ? 'Ocupado' : 'Livre') + '</div><small>' +
      esc(work.join(' · ') || 'Sem reserva ativa') + '</small>' + (quota || '<small>Sem leitura de cota</small>') + '</article>';
  }).join('');
  const f = overviewFilter;
  const repoOptions = Object.fromEntries(workspace.filter(p => !f.project || p.id === f.project)
    .flatMap(p => p.repos.map(repo => [repo.slug, repo.slug])));
  const filters = '<div class="toolbar entry-filters">' +
    '<label class="repo-scope">Projeto<select data-overview="project">' + options({ '': 'Todos', ...Object.fromEntries(workspace.map(p => [p.id, p.name])) }, f.project) + '</select></label>' +
    '<label class="repo-scope">Repositório<select data-overview="repo">' + options({ '': 'Todos', ...repoOptions }, f.repo) + '</select></label>' +
    '<label class="repo-scope">Agente<select data-overview="agent">' + options({ '': 'Todos', ...Object.fromEntries(agentIds.map(id => [id, names[id]])) }, f.agent) + '</select></label>' +
    '<label class="repo-scope">Etapa<select data-overview="stage">' + options({ '': 'Todas', ...Object.fromEntries(Object.entries(stages).map(([key, stage]) => [key, stage[0]])) }, f.stage) + '</select></label></div>';
  const head = '<thead><tr><th>Card / repositório</th><th><div class="rail-labels">' + milestones.map(name => '<span>' + name + '</span>').join('') +
    '</div></th><th>Status</th></tr></thead>';
  const blocks = workspace.filter(p => !f.project || p.id === f.project).map(p => {
    const tasks = p.tasks.filter(task => (!f.repo || task.repo === f.repo) && (!f.stage || stageFor(task, p) === f.stage) &&
      (!f.agent || task.profile.dev.agent === f.agent || task.profile.qa.agent === f.agent));
    const { dev, qa } = p.profile;
    const preset = '<label class="repo-scope">Próximos cards<select data-preset="' + esc(p.id) + '">' + options({
      auto: 'Automático, pela configuração e pela cota',
      keep: names[dev.agent] + ' desenvolve, ' + names[qa.agent] + ' revisa',
      swap: names[qa.agent] + ' desenvolve, ' + names[dev.agent] + ' revisa'
    }, p.autoAssign ? 'auto' : 'keep') + '</select></label>';
    return '<section class="panel overview-project"><div class="toolbar"><div><h2>' + esc(p.name) + '</h2><small>' +
      esc(p.repos.map(repo => repo.kind + ' · ' + repo.slug).join('   ') || 'Sem repositórios') + '</small></div>' + preset +
      btn('Abrir projeto', 'select', 'ghost', 'data-id="' + esc(p.id) + '"') + '</div><div class="table-wrap"><table>' + head + '<tbody>' +
      (tasks.toReversed().map(task => taskRow(task, p)).join('') || '<tr><td colspan="3" class="empty">Nenhum card neste filtro.</td></tr>') +
      '</tbody></table></div></section>';
  }).join('');
  return '<p class="overview-summary">' + summary + '</p><div class="agents">' + agentCards + '</div><section class="panel">' + filters +
    '</section><div class="project-sections overview-list">' + blocks + '</div>';
}

function pipeline(p) {
  if (p.repos.length && !prHistories.has(p.id)) void loadPrHistory(p.id);
  const history = historyRows(p);
  const tableRows = rows(p) + history.rows;
  const counts = [
    ['Tarefas no projeto', p.tasks.length, '▦'],
    ['Em revisão / testes', p.tasks.filter(task => ['review', 'tests'].includes(stageFor(task, p))).length, '◈'],
    ['Aguardando merge', p.tasks.filter(task => stageFor(task, p) === 'merge').length, '⑂'],
    ['Repositórios', p.repos.length, '▣']
  ];
  const stats = counts.map(([label, number, icon]) => '<article class="card"><div class="stat-label">' + label +
    '<span class="stat-icon">' + icon + '</span></div><span class="stat-value">' + number + '</span></article>').join('');
  return '<div class="stats">' + stats + '</div><section><div class="section-head"><h2>Agentes e papéis</h2>' +
    btn('Configurar papéis, modelos e esforço', 'config', 'ghost') +
    '</div><div class="agents">' + agentsView(p) + '</div></section>' +
    '<section class="panel"><div class="toolbar"><h2>Pipeline de tarefas</h2><form id="filter"><input name="search" type="search" aria-label="Buscar tarefa ou PR" placeholder="Buscar tarefa ou PR…" value="' +
    esc(search) + '"><select name="status" aria-label="Filtrar status">' +
    options({ '': 'Todos os status', ...Object.fromEntries(Object.entries({ ...stages, ...historyStages }).map(([key, stage]) => [key, stage[0]])) }, filter) +
    '</select><button class="button" type="submit">Filtrar</button></form></div><div class="table-wrap"><table>' +
    '<thead><tr><th>Tarefa / repositório</th><th>Progresso</th><th>Status</th></tr></thead><tbody id="rows">' +
    (tableRows || '<tr><td colspan="3" class="empty">' +
      (prHistories.get(p.id)?.loading ? 'Consultando PRs no GitHub…' : 'Nenhuma tarefa ou PR encontrado.') + '</td></tr>') +
    '</tbody></table></div><div class="legend">' + milestones.join(' → ') +
    (p.repos.length ? '<div>' + history.footer + ' ' +
      (history.hasMore ? btn('Mostrar mais PRs', 'more-prs', 'ghost') : '') + '</div>' : '') +
    history.errors.map(error => '<div>' + error + '</div>').join('') + '</div></section>';
}

function contextView(p) {
  const entries = (p.contextEntries || []).filter(entry => (showEnded || entry.status === 'active') &&
    (!entryType || entry.type === entryType) && (!entryRepo || !entry.repos.length || entry.repos.includes(entryRepo)));
  const filters = '<div class="toolbar entry-filters"><label class="repo-scope">Repositório<select id="entry-repo">' +
    options({ '': 'Todos', ...Object.fromEntries(p.repos.map(repo => [repo.slug, repo.slug])) }, entryRepo) + '</select></label>' +
    '<label class="repo-scope">Tipo<select id="entry-type">' + options({ '': 'Todos', ...entryTypes }, entryType) + '</select></label>' +
    '<label class="repo-scope"><input type="checkbox" id="entry-ended"' + (showEnded ? ' checked' : '') + '> Mostrar encerradas</label>' +
    btn('Baixar Markdown', 'download-context', 'ghost') + '</div>';
  const cards = entries.toReversed().map(entry => {
    const ended = entry.status !== 'active';
    return '<article class="card entry' + (ended ? ' ended' : '') + '"><div class="section-head"><div>' +
      badge(entryTypes[entry.type], entryTones[entry.type]) + ' <span class="task-id">' + esc(entry.id) + '</span><h3>' + esc(entry.title) + '</h3></div>' +
      badge(ended ? (entry.status === 'superseded' ? 'Substituída' : 'Encerrada') : 'Ativa', ended ? '' : 'teal') + '</div>' +
      '<small>' + esc(entry.repos.join(', ') || 'Todos os repositórios') + ' · ' + esc(names[entry.author] || entry.author) + ' · ' + esc(time(entry.at)) +
      (entry.supersedes ? ' · substitui ' + esc(entry.supersedes) : '') + (ended ? ' · encerrada em ' + esc(time(entry.endedAt)) : '') + '</small>' +
      '<p class="pre">' + esc(entry.body) + '</p>' + (ended ? '' : '<div class="actions context-actions">' +
        btn('Substituir', 'supersede', 'ghost', 'data-id="' + esc(entry.id) + '"') + btn('Encerrar', 'retire-entry', 'ghost', 'data-id="' + esc(entry.id) + '"') + '</div>') +
      '</article>';
  }).join('');
  return '<section class="panel">' + filters + '</section><p class="muted entry-help">Os agentes leem estas entradas com <code>contexto</code> e <code>listar_contexto</code> e registram com <code>registrar_decisao</code>, <code>registrar_contrato</code> e <code>registrar_nota</code>. O Markdown gerado é a versão para <code>' +
    esc(p.officialPath || defaultContextPath) + '</code> nos repositórios; confira as cópias em Papéis e contexto.</p><div class="project-sections">' +
    (cards || '<section class="panel empty">Nenhuma entrada de contexto. Registre a primeira decisão ou contrato.</section>') + '</div>';
}

function chat(p) {
  const messages = p.messages.slice(-100).map(message => '<article class="message"><strong>' +
    esc(names[message.author]) + '</strong> <span class="muted">→ ' + esc(names[message.to]) + '</span> ' +
    (message.task ? badge(message.task, 'lav') : '') + '<small>' + time(message.at) + '</small><p>' +
    esc(message.text) + '</p></article>').join('');
  return '<section class="panel chat"><div class="section-head"><h2>Conversa compartilhada</h2>' +
    badge('Caixa de entrada MCP', 'teal') + '</div><p class="muted">Use os comentários dos PRs para revisão e testes. Use este chat para coordenar repositórios ou fazer handoff com links dos PRs. Os agentes consultam o chat pelo MCP na sessão ou no agendamento.</p>' +
    '<div class="messages" id="messages">' + (messages || '<p class="empty">As mensagens do projeto aparecem aqui.</p>') + '</div>' +
    '<form class="compose" id="compose"><textarea name="text" aria-label="Mensagem" required maxlength="5000" placeholder="Escreva uma decisão, orientação ou pergunta…"></textarea><div class="actions"><select name="task" aria-label="Tarefa">' +
      options({ '': 'Sem tarefa', ...Object.fromEntries(p.tasks.map(task => [task.id, task.id])) }, '') +
      '</select><select name="to" aria-label="Destinatário">' + options({ all: 'Todos', ...assignable() }, 'all') +
      '</select><button class="button primary" type="submit">Enviar mensagem</button></div></form></section>';
}

function repos(p) {
  const showAll = repoScope === 'all';
  const projects = showAll ? workspace : [p];
  const cards = projects.flatMap(owner => owner.repos.map(repo =>
    '<article class="card"><div class="repo-tags">' + badge(repo.kind, 'lav') +
    '<span class="badge teal" title="' + esc(owner.id) + '">' + esc(owner.name) + '</span></div>' +
    '<div class="repo-list"><strong>' + esc(repo.slug) + '</strong><span>Base Gitflow · develop</span>' +
    '<span>CI · ' + esc(repo.checks.join(', ') || 'Todos os checks publicados') + '</span>' +
    repo.docs.map(path => '<code>' + esc(path) + '</code>').join('') +
    '<a href="https://github.com/' + esc(repo.slug) +
      '" target="_blank" rel="noopener noreferrer">Abrir no GitHub ↗</a></div></article>'
  ));
  const scope = '<label class="repo-scope">Exibir repositórios<select id="repo-scope">' +
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
  const gitContext = '<section class="card compose"><div class="section-head"><h2>Contexto versionado</h2>' +
    btn('Definir fonte', 'official', 'ghost') + '</div><p class="subtitle"><code>' + esc(p.officialPath || defaultContextPath) + '</code> na <code>develop</code> de cada repositório.</p>' +
    '<p class="subtitle">Fonte oficial · ' + esc(p.officialRepo || 'A definir') + '</p>' +
    (audit?.generatedMatches === false ? '<p class="subtitle">' + badge('Oficial atrás do painel', 'amber') + ' O arquivo oficial difere do Markdown gerado pelas entradas atuais da aba Contexto.</p>' :
      audit?.generatedMatches ? '<p class="subtitle">' + badge('Oficial igual ao painel', 'teal') + '</p>' : '') +
    '<div class="repo-list">' + copies + '</div><div class="actions context-actions">' +
    btn('Baixar Markdown gerado', 'download-context', 'ghost') +
    btn(contextBusy ? 'Consultando…' : 'Verificar cópias', 'audit', '', !p.officialRepo || contextBusy ? 'disabled' : '') +
    (audit?.official ? btn('Baixar versão oficial', 'download-official') + btn('Copiar instruções para os PRs', 'propagate', 'primary') : '') +
    '</div></section>';
  return '<div class="agents">' + agentsView(p) + '</div><section class="card"><h2>Resumo do projeto</h2><div class="pre muted">' +
    esc(p.context || 'Adicione objetivo, arquitetura e links do projeto.') +
    '</div><small>Decisões, contratos e notas ficam na aba Contexto e entram no Markdown gerado junto com este resumo.</small></section>' + gitContext + '<section class="card compose"><div class="section-head"><h2>Instruções por papel</h2></div>' +
    '<p class="subtitle">Texto gerado a partir dos papéis, repositórios e regras deste projeto. Cole na sessão ou no agendamento do agente que ocupa cada papel; ao trocar os papéis, copie de novo. O agente também obtém o mesmo texto com <code>instrucoes_do_papel</code>.</p>' +
    '<div class="actions context-actions">' + Object.entries(roles).map(([role, label]) =>
      btn('Copiar instruções do ' + label.split(' · ')[1] + ' · ' + esc(names[p.profile[role].agent]), 'copy-role', role === 'po' ? '' : 'ghost', 'data-id="' + role + '"')).join('') +
    '</div></section>';
}

function connections() {
  const statuses = { ready: ['CLI acessível', 'teal'], missing: ['CLI fora do PATH', 'amber'], error: ['Falha ao executar o CLI', 'red'] };
  const auth = {
    'signed-in': 'Login local ativo', 'signed-out': 'Login necessário',
    unknown: 'Não foi possível verificar o login', unsupported: 'Teste de CLI verifica a versão'
  };
  const cards = agentList.map(agent => {
    const provider = agent.id;
    const label = agent.short;
    const result = cliResults.get(provider);
    const checkedAt = mcpChecks[provider];
    const canTestMcp = agent.assignable;
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
      (canTestMcp ? btn('Copiar teste MCP', 'copy-mcp-test', 'ghost') : '') + '</div>' +
      (agent.register ? '<div><h3>Registrar o MCP no CLI</h3><code class="register">' + esc(agent.register) + '</code>' +
        btn('Copiar comando', 'copy-register', 'ghost', 'data-id="' + provider + '"') + '</div>' : '') + '</article>';
  }).join('');
  return '<section class="card connection-guide"><p class="muted">O teste de CLI verifica a instalação no ambiente do painel. ' +
    'Para confirmar uma sessão Desktop ou CLI, copie o teste MCP, cole na sessão e depois atualize os resultados aqui. ' +
    'Esses testes verificam a configuração sem enviar uma solicitação direta ao modelo pelo painel. O comando de registro usa o Node e o mcp.mjs deste ambiente; nos Desktops do Windows com o painel no WSL, use wsl.exe como no manual.</p>' +
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

async function loadRepoPlan(id) {
  const loading = { loading: true };
  repoPlans.set(id, loading);
  let result;
  try {
    result = { plan: (await api('planning', { project: id })).repoPlan };
  } catch (error) {
    result = { plan: { error: error.message } };
  }
  if (repoPlans.get(id) !== loading) return;
  repoPlans.set(id, result);
  if (view === 'planning' && current === id) render();
}

function repoPlanCard(p) {
  const source = p.planSource;
  if (source && !repoPlans.has(p.id)) void loadRepoPlan(p.id);
  const state = repoPlans.get(p.id);
  const body = !source ? '<p class="muted">Aponte para o Markdown do plano que o PO mantém no repositório (ex.: <code>docs/arquitetura/plano-de-execucao.md</code>). O painel lê a versão da <code>develop</code>.</p>' :
    !state || state.loading ? '<p class="muted">Lendo o plano no GitHub…</p>' :
    state.plan?.error ? '<p class="modal-error">' + esc(state.plan.error) + '</p>' :
    '<small>' + esc(source.repo) + ' · <code>' + esc(source.path) + '</code> · develop em <code>' + esc(state.plan.sha.slice(0, 7)) +
      '</code></small><div class="pre plan-doc">' + esc(state.plan.markdown) + '</div>';
  return '<section class="card"><div class="section-head"><h2>Plano no repositório</h2><div class="actions">' +
    (source ? btn('Recarregar', 'reload-plan', 'ghost') : '') + btn(source ? 'Trocar arquivo' : 'Definir arquivo', 'plansource', 'ghost') +
    '</div></div>' + body + '</section>';
}

function planning(p) {
  const plan = p.plan;
  const editPlan = btn(plan ? 'Editar plano' : 'Criar plano', 'plan', 'ghost');
  const planCard = '<section class="card"><div class="section-head"><h2>Plano de execução do PO</h2>' + editPlan +
    '</div>' + (plan ? '<small>Atualizado por ' + esc(names[plan.author]) + ' · ' + esc(time(plan.updatedAt)) +
    '</small><div class="pre">' + esc(plan.markdown) + '</div>' : '<p class="muted">Plano publicado pelo PO com a ferramenta salvar_plano do MCP, ou escrito aqui por você. Fica vazio quando o PO mantém o plano só no repositório.</p>') +
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
  return '<div class="project-sections">' + repoPlanCard(p) + planCard + '<section><div class="section-head"><h2>Sprints</h2>' +
    btn('Nova sprint', 'sprint', 'ghost') + '</div>' +
    (sprintCards ? '<div class="repos">' + sprintCards + '</div>' : '<p class="panel empty">Nenhuma sprint cadastrada.</p>') +
    '</section><section><div class="section-head"><h2>Cortes de release</h2>' +
    btn('Registrar corte', 'cut', 'ghost', p.sprints?.length ? '' : 'disabled') + '</div>' +
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
    btn('Atualizar execuções', 'refresh-runs', 'ghost') + '</div><div class="project-sections">' +
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
  const quotaCards = agentList.filter(agent => agent.limits).map(agent => agent.id).map(provider => {
    const snapshot = usageLimits[provider];
    const estimate = snapshot?.sessionEstimate;
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
      (snapshot?.checkedAt ? '<small>Origem · ' + esc(snapshot.source) + ' · Leitura ' + esc(time(snapshot.checkedAt)) + '</small>' : '') +
      windows + (provider === 'codex' ? btn(queryingCodex ? 'Consultando…' : 'Consultar Codex local', 'query-codex-limits', '',
        queryingCodex ? 'disabled' : '') : provider !== 'claude' ? '' : '<div class="quota-window"><h3>Estimativa da sessão do Claude Code</h3>' +
        (estimate ? '<strong>' + esc(money(estimate.micros, 'USD')) + '</strong><small>Leitura em ' + esc(time(estimate.checkedAt)) + '</small>' :
          '<small>Aguardando leitura da statusline do Claude Code.</small>') +
        '<small>Estimativa da última sessão recebida, separada dos custos por projeto.</small></div>') + '</article>';
  }).join('');
  const projects = costScope === 'all' ? workspace : [p];
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
  $('#projects').innerHTML = workspace.map(item =>
    '<button class="nav-item ' + (item.id === current && !['overview', 'connections'].includes(view) ? 'active' : '') + '" data-action="select" data-id="' + esc(item.id) +
    '"><span class="nav-icon">◈</span><span>' + esc(item.name) + '</span></button>').join('');
  $('#nav').innerHTML = p ? Object.entries(views).map(([key, [icon, label]]) =>
    '<button class="nav-item ' + (key === view ? 'active' : '') + '" data-action="navigate" data-id="' + key +
    '"><span class="nav-icon">' + icon + '</span><span>' + label + '</span></button>').join('') : '';
  const showingConnections = view === 'connections';
  const showingOverview = view === 'overview';
  $('#connections-nav').classList.toggle('active', showingConnections);
  $('#overview-nav').classList.toggle('active', showingOverview);
  $('#breadcrumb').textContent = 'Workspace' + (showingConnections ? ' / Configurações' : showingOverview ? ' / Visão geral' : p ? ' / ' + p.name : '');
  $('#sync').hidden = showingConnections || !p;
  $('#sync').disabled = syncBusy;
  if (!p && !showingConnections) {
    $('#view').innerHTML = '<div class="heading"><div><p class="eyebrow">WORKSPACE</p><h1>Projetos</h1>' +
      '<p class="subtitle">Cadastre um projeto para reunir seus repositórios e o contexto dos agentes.</p></div>' +
      btn('+ Criar projeto', 'project', 'primary') + '</div><section class="panel empty">Nenhum projeto cadastrado.</section>';
    return;
  }
  const info = {
    pipeline: ['Fluxo de entrega', 'Do planejamento à validação, com Gitflow e merge humano.', '+ Nova tarefa', 'task'],
    context: ['Contexto compartilhado', 'Decisões, contratos e notas que os agentes leem pelo MCP em todos os repositórios.', '+ Nova entrada', 'entry'],
    planning: ['Planejamento', 'Plano do PO, sprints e cortes de release deste projeto.', '', ''],
    runs: ['Execuções', 'Acompanhe tarefas paralelas, threads e worktrees dos agentes.', '', ''],
    usage: ['Custos e limites', 'Consumo por projeto, agente e papel, com os horários de reset informados pela conta.', '+ Registrar custo', 'cost'],
    chat: ['Chat do projeto', 'Decisões e handoffs entre pessoas e agentes.', '', ''],
    repos: ['Repositórios', 'Contexto de API, web e mobile, com referências por repositório.', '+ Repositório', 'repo'],
    settings: ['Papéis e contexto', 'Defina quem planeja, implementa e revisa as próximas tarefas.', 'Editar configuração', 'config'],
    connections: ['Conexões', 'Verifique seus CLIs e confirme o acesso dos agentes ao Orquestrador.', '', ''],
    overview: ['Visão geral', 'Todos os projetos, repositórios, cards e PRs, com a etapa de cada um.', '', '']
  }[view];
  const action = info[3] ? btn(info[2], info[3], 'primary') : '';
  const body = { pipeline, context: contextView, planning, runs, usage, chat, repos, settings, connections, overview }[view](p);
  $('#view').innerHTML = '<div class="heading"><div><p class="eyebrow">' + esc(showingConnections ? 'CONFIGURAÇÕES' : showingOverview ? 'WORKSPACE' : p.name.toUpperCase()) +
    '</p><h1>' + info[0] + '</h1><p class="subtitle">' + info[1] + '</p></div>' + action + '</div>' +
    body;
  if ($('#messages')) $('#messages').scrollTop = $('#messages').scrollHeight;
}

const textField = (label, name, value = '', extra = '') => '<label>' + label + '<input name="' + name + '" value="' + esc(value) + '" ' + extra + '></label>';
const area = (label, name, value = '', extra = '') => '<label>' + label + '<textarea name="' + name + '" ' + extra + '>' + esc(value) + '</textarea></label>';

function profileFields(profile) {
  return '<label>Perfis rápidos<select id="preset"><option value="">Personalizado</option><option value="claude">Claude PO e Dev · Codex QA</option>' +
    '<option value="codex">Codex PO e Dev · Claude QA</option><option value="original">Claude PO · Codex Dev · Claude QA</option></select></label>' +
    Object.entries(roles).map(([role, label]) => '<fieldset><legend>' + label + '</legend><div class="profile-fields"><label>Agente<select name="' +
      role + '-agent">' + options(assignable(), profile[role].agent) +
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
  if (type === 'project') return showModal(type, 'Novo projeto',
    textField('Nome', 'name', '', 'required maxlength="80"') + textField('Identificador', 'id', '', 'required maxlength="48" placeholder="meu-projeto"') +
    area('Contexto em Markdown', 'context', '', 'maxlength="12000"') + profileFields(defaultProfile));
  const p = project();
  if (type === 'cost') showModal(type, 'Registrar custo · ' + p.name,
    textField('Valor', 'amount', '', 'required inputmode="decimal" placeholder="0,50"') +
    '<label>Moeda<select name="currency">' + options({ USD: 'USD', BRL: 'BRL', EUR: 'EUR' }, 'USD') + '</select></label>' +
    '<label>Tipo<select name="kind">' + options(costKinds, 'estimate') + '</select></label>' +
    '<label>Agente<select name="agent">' + options(assignable(), p.profile.dev.agent) + '</select></label>' +
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
  if (type === 'config') showModal(type, 'Papéis, modelos e contexto',
    profileFields(p.profile) + area('Contexto em Markdown', 'context', p.context, 'maxlength="12000"'));
  if (type === 'plansource') {
    if (!p.repos.length) return toast('Cadastre um repositório para escolher o arquivo do plano.');
    showModal(type, 'Plano no repositório',
      '<label>Repositório<select name="repo">' + options(Object.fromEntries(p.repos.map(repo => [repo.slug, repo.slug])), p.planSource?.repo) +
      '</select></label>' + textField('Caminho do Markdown no Git', 'path', p.planSource?.path || 'docs/arquitetura/plano-de-execucao.md', 'required maxlength="160"') +
      '<p class="muted">O painel mostra o conteúdo desse arquivo na develop. Os agentes recebem o mesmo texto em ler_planejamento.</p>');
  }
  if (type === 'official') {
    if (!p.repos.length) return toast('Cadastre um repositório para escolher a fonte oficial.');
    showModal(type, 'Fonte oficial de contexto',
      '<label>Repositório oficial<select name="repo">' + options(Object.fromEntries(p.repos.map(repo => [repo.slug, repo.slug])), p.officialRepo) +
      '</select></label>' + textField('Caminho do Markdown no Git', 'path', p.officialPath || defaultContextPath, 'required maxlength="160"') +
      '<p class="muted">O Orquestrador compara esse mesmo caminho na develop de todos os repositórios do projeto.</p>');
  }
  if (type === 'repo') showModal(type, 'Adicionar repositório',
    textField('GitHub no formato dono/repositorio', 'slug', '', 'required maxlength="100" placeholder="time/minha-api"') +
    '<label>Área<select name="kind">' + options({ Backend: 'Backend', Frontend: 'Frontend', Mobile: 'Mobile', Infra: 'Infra', Outro: 'Outro' }, 'Backend') + '</select></label>' +
    area('Arquivos Markdown da develop, um por linha', 'docs', '', 'placeholder="docs/arquitetura/integracao.md"') +
    area('Checks obrigatórios, um por linha', 'checks', '', 'placeholder="api-tests"'));
  if (type === 'entry') {
    if (!p.repos.length) return toast('Cadastre um repositório antes de registrar contexto.');
    const previous = id ? p.contextEntries?.find(entry => entry.id === id) : null;
    showModal(type, previous ? 'Substituir ' + previous.id + ' · ' + previous.title : 'Nova entrada de contexto',
      '<label>Tipo<select name="type"' + (previous ? ' disabled' : '') + '>' + options(entryTypes, previous?.type || 'decision') + '</select></label>' +
      textField('Título', 'title', previous?.title, 'required maxlength="120"') +
      '<fieldset><legend>Repositórios (nenhum marcado = todos)</legend><div class="checks">' +
      p.repos.map(repo => '<label class="check"><input type="checkbox" name="repos" value="' + esc(repo.slug) + '"' +
        (previous?.repos.includes(repo.slug) ? ' checked' : '') + '>' + esc(repo.slug) + '</label>').join('') + '</div></fieldset>' +
      area('Conteúdo em Markdown', 'body', previous?.body, 'required maxlength="8000"'),
      { supersedes: previous?.id || null, entryType: previous?.type || null });
  }
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
    const lastEvent = (p.runs || []).find(run => run.task === task.id && run.events.length)?.events.at(-1);
    const details ='<div>' + badge(status, tone) + '<p class="pre">' + esc(task.description || 'Sem descrição.') +
      '</p><small>' + esc(task.repo) + ' · develop</small><small>Dependências · ' +
      esc(task.depends.join(', ') || 'Nenhuma') + '</small></div><div>' +
      Object.entries(task.profile).map(([role, config]) => '<p>' + esc(roles[role]) + ' · ' + esc(names[config.agent]) +
        ' · ' + esc(config.model || 'Modelo do Desktop') + ' · ' + esc(efforts[config.effort]) + '</p>').join('') +
      '</div>' + (task.observation?.head ? '<div class="repo-list"><code>' + esc(task.observation.head) + '</code><span>CI · ' +
        esc({ passed: 'Passou', failed: 'Falhou', pending: 'Pendente' }[task.observation.ci]) + ' · GitHub ' +
        esc(task.observation.mergeState || '—') + '</span></div>' : '') +
      (task.observation?.corrections ? '<small>' + correctionsLabel(task.observation.corrections) + ' pedidas pelo QA neste PR</small>' : '') +
      (task.observation?.pending ? '<div><h3>Pendências da revisão</h3><p class="pre">' + esc(task.observation.pending) + '</p></div>' : '') +
      (lastEvent ? '<small>Último registro do agente · ' + esc(time(lastEvent.at)) + ' · ' + esc(lastEvent.message) + '</small>' : '') +
      (task.syncError ? '<p class="modal-error">' + esc(task.syncError) + '</p>' : '') +
      (task.observation?.url ? '<a href="' + esc(task.observation.url) + '" target="_blank" rel="noopener noreferrer">Abrir PR #' + task.pr + ' no GitHub ↗</a>' : '') +
      (task.sprint ? '<small>Sprint · ' + esc(sprintOptions[task.sprint]) + '</small>' : '') +
      (p.sprints?.length ? btn('Definir sprint', 'assign', 'ghost', 'data-id="' + esc(task.id) + '"') : '') +
      (!task.pr ? btn('Vincular PR', 'link', '', 'data-id="' + esc(task.id) + '"') : '');
    showModal(type, task.id + ' · ' + task.title, details);
  }
  if (type === 'link') showModal(type, 'Vincular PR · ' + id, textField('Número do PR no GitHub', 'number', '', 'type="number" min="1" required'), { task: id });
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (button.dataset.project && workspace.some(item => item.id === button.dataset.project)) current = button.dataset.project;
  if (action === 'select') {
    current = id; view = 'pipeline'; filter = ''; search = ''; historyRowsShown = historyPageSize; render();
  } else if (action === 'navigate' || action === 'settings') {
    view = id || 'settings';
    if (view === 'connections') await refreshMcpChecks();
    else if (view === 'usage' || view === 'overview') {
      render();
      const shown = view;
      try { usageLimits = await api('usage_limits', {}); } catch (error) { toast(error.message); }
      if (view === shown) render();
    }
    else render();
  } else if (action === 'more-prs') {
    historyRowsShown += historyPageSize;
    render();
  } else if (action === 'close') $('#dialog').close();
  else if (action === 'supersede') open('entry', id);
  else if (action === 'reload-plan') { repoPlans.delete(current); render(); }
  else if (action === 'retire-entry') {
    if (!confirm('Encerrar a entrada ' + id + '? Ela some do Markdown gerado e dos agentes.')) return;
    button.disabled = true;
    try {
      await api('retire_context_entry', { project: current, id });
      await load();
      render();
    } catch (error) { toast(error.message); button.disabled = false; }
  }
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
  } else if (action === 'download-context' || action === 'download-official') {
    let markdown = contextAudit?.result.official?.markdown;
    let filename = contextAudit?.result.path.split('/').at(-1);
    if (action === 'download-context') {
      try {
        const generated = await api('context_markdown', { project: current });
        markdown = generated.markdown;
        filename = generated.path.split('/').at(-1);
      } catch (error) { return toast(error.message); }
    }
    if (markdown === undefined) return;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (action === 'propagate') {
    const audit = contextAudit?.result;
    const targets = audit?.copies.filter(copy => ['missing', 'diverged'].includes(copy.status)) || [];
    const stale = audit?.generatedMatches === false;
    if (!targets.length && !stale) return toast('Nenhuma cópia desatualizada ou ausente na última consulta.');
    const source = audit.officialRepo + ' no commit ' + audit.official.sha;
    try {
      await navigator.clipboard.writeText(
        'Projeto ' + current + '. ' +
        (stale ? 'O arquivo ' + audit.path + ' no repositório oficial ' + audit.officialRepo + ' está atrás do painel: gere o conteúdo com o MCP markdown_contexto e atualize o arquivo por PR Gitflow (feature/ ou bugfix/ para develop). ' : '') +
        (targets.length ? 'Propague o arquivo ' + audit.path + ' de ' + source + ' por PR Gitflow para develop em cada repositório: ' +
          targets.map(item => item.repo).join(', ') + '. Preserve o conteúdo idêntico ao oficial. ' : '') +
        'Confirme a versão oficial atual com o MCP verificar_contexto antes de alterar. Deixe o merge com o dono.'
      );
      toast('Instruções dos PRs copiadas.');
    } catch { toast('O navegador não liberou a área de transferência.'); }
  }
  else if (action === 'copy-role' || action === 'copy-register') {
    try {
      const text = action === 'copy-register' ? agentList.find(agent => agent.id === id).register :
        (await api('role_instructions', { project: current, role: id })).text;
      await navigator.clipboard.writeText(text);
      toast(action === 'copy-register' ? 'Comando copiado. Rode no terminal do ambiente do painel.' : 'Instruções copiadas. Cole na sessão ou no agendamento do agente.');
    } catch (error) { toast(error.message || 'O navegador não liberou a área de transferência.'); }
  }
  else if (action === 'sync') {
    syncBusy = true;
    button.disabled = true;
    try {
      await api('refresh', {});
      await load();
      if (view === 'pipeline' && project()?.repos.length) await loadPrHistory(current);
      toast('Consulta ao GitHub concluída. Confira o pipeline.');
    } catch (error) { toast(error.message); }
    finally { syncBusy = false; render(); }
  } else open(action, id);
});

document.addEventListener('change', async event => {
  if (event.target.dataset.overview) {
    overviewFilter[event.target.dataset.overview] = event.target.value;
    if (event.target.dataset.overview === 'project') overviewFilter.repo = '';
    render();
    return;
  }
  if (event.target.dataset.preset) {
    const target = event.target.dataset.preset;
    try {
      await api('quick_profile', { project: target, preset: event.target.value });
      await load();
      toast('Preset dos próximos cards atualizado.');
    } catch (error) { toast(error.message); }
    render();
    return;
  }
  if (['entry-repo', 'entry-type', 'entry-ended'].includes(event.target.id)) {
    if (event.target.id === 'entry-repo') entryRepo = event.target.value;
    else if (event.target.id === 'entry-type') entryType = event.target.value;
    else showEnded = event.target.checked;
    render();
    $('#' + event.target.id)?.focus({ preventScroll: true });
    return;
  }
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
    search = values.search; filter = values.status; historyRowsShown = historyPageSize; render(); return;
  }
  const submit = form.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    if (formId === 'compose') await api('post', { ...values, project: current });
    else {
      const actions = {
        project: 'create_project', config: 'settings', repo: 'add_repo', task: 'add_task', link: 'attach_pr', official: 'official_repo',
        entry: 'add_context_entry', plansource: 'plan_source',
        plan: 'save_plan', sprint: 'save_sprint', assign: 'assign_sprint', cut: 'cut_release',
        cost: 'record_cost', limits: 'save_usage_limits'
      };
      const args = { ...values, project: current };
      if (modal.type === 'project' || modal.type === 'config') args.profile = Object.fromEntries(Object.keys(roles).map(role => [
        role, Object.fromEntries(['agent', 'model', 'effort', 'login'].map(key => [key, values[role + '-' + key]]))
      ]));
      if (modal.type === 'repo') { args.docs = split(values.docs); args.checks = split(values.checks); }
      if (modal.type === 'task') args.depends = split(values.depends);
      if (modal.type === 'entry') {
        args.type = values.type || modal.entryType;
        args.repos = [...form.querySelectorAll('input[name=repos]:checked')].map(input => input.value);
        if (modal.supersedes) args.supersedes = modal.supersedes;
      }
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
      if (modal.type === 'repo') prHistories.delete(args.project);
      if (['repo', 'official'].includes(modal.type)) contextAudit = null;
      if (modal.type === 'plansource') repoPlans.delete(args.project);
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
  usageLimits = await api('usage_limits', {});
} catch (error) { toast(error.message); }
render();
setInterval(async () => {
  if (syncBusy || queryingCodex || $('#dialog').open || document.activeElement?.matches('input, select, textarea')) return;
  try {
    const visibleData = () => ['usage', 'overview'].includes(view) ? { workspace, usageLimits } :
      ['pipeline', 'settings'].includes(view) || (view === 'repos' && repoScope === 'all') ? workspace : project();
    const previous = JSON.stringify(visibleData());
    await load();
    if (['usage', 'overview'].includes(view)) usageLimits = await api('usage_limits', {});
    if (JSON.stringify(visibleData()) !== previous) render();
  } catch { /* The next refresh can recover from a server restart. */ }
}, 7000);
setInterval(() => {
  for (const node of document.querySelectorAll('[data-reset]')) node.textContent = resetCountdown(node.dataset.reset);
}, 30_000);
