import { randomUUID } from 'node:crypto';
import { agents, branchPattern, evaluate, profileForNewTask, readyFor, shaPattern, slugPattern, swapDevQa, validatePr } from './workflow.mjs';
import { listOpenPrs, prHistoryLimit, readContext, readDevelop, readMarkdown, readPr, readPrHistory } from './github.mjs';
import { compareContext, contextPath, contextPathFor } from './context.mjs';
import { addEntry, findEntry as findEntryIn, listEntries, renderContextMarkdown, retireEntry } from './context-entries.mjs';
import { testCli } from './connections.mjs';
import { publicAgents } from './agents.mjs';
import { roleInstructions } from './instructions.mjs';
import { releaseScope, savePlan, saveSprint, sprintId } from './planning.mjs';
import { closeRun, findRun, finishRun, listRuns, publicRun, startRun, updateRun } from './runs.mjs';
import { readCodexLimits } from './codex-limits.mjs';
import { recordCost, saveClaudeUsage, saveLimits } from './usage.mjs';

export const roles = ['po', 'dev', 'qa'];
const efforts = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];
const leaseMs = 45 * 60_000;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function line(value, max, label, optional = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  requireValue((optional || result.length) && result.length <= max, label + ' inválido.');
  return result;
}

function list(value, max) {
  requireValue(Array.isArray(value) && value.length <= max, 'Lista inválida.');
  return [...new Set(value.map(item => line(item, 160, 'Item')))];
}

function isMarkdownPath(path) {
  return /^(?:[\w.-]+\/)*[\w.-]+\.md$/i.test(path) &&
    !path.split('/').some(part => part === '..' || part === '.');
}

function findProject(state, id) {
  const project = state.projects.find(item => item.id === id);
  requireValue(project, 'Projeto não encontrado.');
  return project;
}

function findTask(project, id) {
  const task = project.tasks.find(item => item.id === id);
  requireValue(task, 'Tarefa não encontrada.');
  return task;
}

function reservedTask(project, args, actor) {
  const task = findTask(project, args.task);
  requireValue(task.lease && task.lease.token === args.token && task[task.lease.role] === actor &&
    task.lease.expires > Date.now(), 'Reserva inválida ou expirada.');
  return task;
}

function reservedPlanningRun(project, args, actor) {
  const run = project.runs?.find(item => item.id === args.run && item.role === 'po');
  requireValue(run?.status === 'active' && run.agent === actor && run.token === args.token &&
    run.expires > Date.now(), 'Reserva de planejamento inválida ou expirada.');
  return run;
}

function profile(input) {
  requireValue(roles.every(role => Object.hasOwn(agents, input?.[role]?.agent)), 'Selecione um agente para cada papel.');
  requireValue(input.dev.agent !== input.qa.agent, 'Dev e QA precisam ser agentes diferentes.');
  return Object.fromEntries(roles.map(role => {
    const { agent, model, effort, login } = input[role];
    requireValue(efforts.includes(effort), 'Nível de esforço inválido.');
    const github = line(login, 39, 'Login GitHub', true);
    requireValue(!github || /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(github), 'Use o login GitHub sem @.');
    return [role, { agent, model: line(model, 100, 'Modelo', true), effort, login: github }];
  }));
}

function safeTask(task) {
  const { lease, ...rest } = task;
  return { ...rest, lease: lease?.expires > Date.now() ? { role: lease.role, expires: lease.expires } : null };
}

function addTask(project, args, limits) {
  const taskProfile = profileForNewTask(project, limits);
  const id = line(args.task, 32, 'ID da tarefa').toUpperCase();
  requireValue(/^[A-Z0-9][A-Z0-9_-]+$/.test(id), 'Use um ID como API-01.');
  requireValue(!project.tasks.some(task => task.id === id), 'Já existe uma tarefa com esse ID.');
  requireValue(project.repos.some(repo => repo.slug === args.repo), 'Cadastre o repositório antes de criar a tarefa.');
  requireValue(project.profile.qa.login, 'Configure o login GitHub do QA nos papéis do projeto.');
  const depends = list(args.depends || [], 30).map(value => value.toUpperCase());
  requireValue(depends.every(value => project.tasks.some(task => task.id === value)), 'Cadastre as tarefas das quais esta depende.');
  requireValue(project.tasks.length < 500, 'Limite de 500 tarefas por projeto.');
  const task = {
    id, title: line(args.title, 120, 'Título'), description: line(args.description, 5000, 'Descrição', true),
    repo: args.repo, depends, sprint: sprintId(project, args.sprint),
    profile: taskProfile, dev: taskProfile.dev.agent, qa: taskProfile.qa.agent,
    pr: null, observation: null, lease: null, created: new Date().toISOString()
  };
  project.tasks.push(task);
  return safeTask(task);
}

// ID do card a partir do título do PR ("MOB-UX-04 Desfazer..." -> MOB-UX-04); sem ID no título, usa a área e o número.
function importedTaskId(project, repo, pr) {
  const fromTitle = pr.title?.trim().match(/^([A-Z][A-Z0-9]{1,7}(?:-[A-Z0-9]{1,8}){1,3})(?=[\s:·-]|$)/)?.[1];
  const fallback = (repo.kind.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'REPO') + '-PR' + pr.number;
  return [fromTitle, fallback, fallback + '-' + project.tasks.length].find(id => id && !project.tasks.some(task => task.id === id));
}

export function createService(store, github = { readPr, readContext, readDevelop, readPrHistory, listOpenPrs, readMarkdown }) {
  let refreshing;
  // PRs abertos para a develop entram no pipeline sozinhos, sem depender de o agente criar a tarefa e vincular o PR.
  async function importOpenPrs() {
    if (!github.listOpenPrs) return;
    for (const project of store.read().projects) {
      if (!project.profile.qa.login) continue;
      for (const repo of project.repos) {
        let open;
        try { open = await github.listOpenPrs(repo.slug); } catch { continue; }
        for (const item of open.filter(pr => branchPattern.test(pr.headRefName) &&
            !project.tasks.some(task => task.repo === repo.slug && task.pr === pr.number))) {
          let pr;
          try {
            pr = await github.readPr(repo.slug, item.number);
            validatePr(pr, repo, item.number);
          } catch { continue; }
          store.write(state => {
            const current = findProject(state, project.id);
            if (current.tasks.length >= 500 || current.tasks.some(task => task.repo === repo.slug && task.pr === item.number)) return;
            const id = importedTaskId(current, repo, item);
            const title = (item.title || 'PR #' + item.number).replace(new RegExp('^' + id + '[\\s:·-]*'), '').slice(0, 120) || 'PR #' + item.number;
            current.tasks.push({
              id, title, description: 'Card criado automaticamente a partir do PR #' + item.number + ' aberto no GitHub.',
              repo: repo.slug, depends: [], sprint: null, profile: current.profile, dev: current.profile.dev.agent,
              qa: current.profile.qa.agent, pr: item.number, observation: evaluate(pr, repo, current.profile.qa.login),
              lease: null, imported: true, syncedAt: Date.now(), syncError: null, created: new Date().toISOString()
            });
          });
        }
      }
    }
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      await importOpenPrs();
      for (const project of store.read().projects) {
        for (const task of project.tasks.filter(item => item.pr && item.observation?.stage !== 'merged')) {
          const repo = project.repos.find(item => item.slug === task.repo);
          let observation;
          let syncError;
          try {
            const pr = await github.readPr(repo.slug, task.pr);
            validatePr(pr, repo, task.pr);
            observation = evaluate(pr, repo, task.profile.qa.login);
          } catch (error) {
            syncError = error.message;
          }
          store.write(state => {
            const currentProject = findProject(state, project.id);
            const current = findTask(currentProject, task.id);
            if (current.pr !== task.pr || current.syncedAt !== task.syncedAt) return;
            current.syncError = syncError || null;
            current.syncedAt = Date.now();
            if (observation) {
              if (current.observation?.stage !== observation.stage || current.observation?.head !== observation.head) {
                finishRun(currentProject, current, 'superseded');
              }
              current.observation = observation;
            }
          });
        }
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function action(name, args, actor = 'user') {
    const isUser = actor === 'user';
    if (name === 'usage_limits') {
      requireValue(isUser, 'Consulte os limites pelo painel.');
      return store.read().limits || {};
    }
    if (name === 'refresh_codex_limits') {
      requireValue(isUser, 'Inicie a consulta pelo painel.');
      const windows = await readCodexLimits();
      return store.write(state => saveLimits(state, 'codex', windows, 'Codex local'));
    }
    if (name === 'save_usage_limits') {
      requireValue(isUser || actor === args.provider, 'Informe os limites da conta do próprio agente.');
      return store.write(state => saveLimits(state, args.provider, args.windows, isUser ? 'Manual' : 'Sessão MCP'));
    }
    if (name === 'import_claude_limits') {
      requireValue(isUser, 'Use o coletor local do Claude Code.');
      return store.write(state => saveClaudeUsage(state, args));
    }
    if (name === 'connections') {
      requireValue(isUser, 'Abra Configurações no painel.');
      return { mcp: store.read().mcpChecks || {} };
    }
    if (name === 'test_cli') {
      requireValue(isUser, 'Inicie o diagnóstico no painel.');
      return testCli(args.provider);
    }
    if (name === 'test_connection') {
      requireValue(Object.hasOwn(agents, actor), 'Execute o teste na sessão do agente pelo MCP.');
      return store.write(state => {
        const checkedAt = new Date().toISOString();
        state.mcpChecks ||= {};
        state.mcpChecks[actor] = checkedAt;
        return { agent: actor, checkedAt };
      });
    }
    if (name === 'workspace') {
      return { agents: publicAgents(), projects: store.read().projects.map(project => ({
        ...project, tasks: project.tasks.map(safeTask), runs: listRuns(project)
      })) };
    }
    if (name === 'role_instructions') {
      const project = findProject(store.read(), args.project);
      const role = args.role || roles.find(item => project.profile[item].agent === actor);
      requireValue(roles.includes(role), 'Informe o papel: po, dev ou qa.');
      return { project: project.id, role, agent: project.profile[role].agent, text: roleInstructions(project, role) };
    }
    if (name === 'pr_history') {
      requireValue(isUser, 'Consulte o histórico de PRs no painel.');
      const project = findProject(store.read(), args.project);
      const history = await Promise.all(project.repos.map(async ({ slug }) => {
        try {
          return { repo: slug, prs: await github.readPrHistory(slug) };
        } catch (error) {
          return { repo: slug, prs: [], error: error.message };
        }
      }));
      return { history, limit: prHistoryLimit };
    }
    if (name === 'refresh') {
      await refresh();
      return { synced: true };
    }
    if (name === 'create_project') {
      requireValue(isUser, 'Use o painel para criar projetos.');
      return store.write(state => {
        const id = line(args.id, 48, 'Identificador').toLowerCase();
        requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), 'Use um identificador como meu-projeto.');
        requireValue(!state.projects.some(project => project.id === id), 'Identificador já cadastrado.');
        const project = {
          id, name: line(args.name, 80, 'Nome'), context: line(args.context, 12_000, 'Contexto', true),
          profile: profile(args.profile), repos: [], tasks: [], messages: []
        };
        state.projects.push(project);
        return project;
      });
    }
    if (name === 'context_entries') {
      const project = findProject(store.read(), args.project);
      return listEntries(project, { repo: args.repo, type: args.type, all: args.all === true });
    }
    if (name === 'context_markdown') {
      const project = findProject(store.read(), args.project);
      return { path: contextPathFor(project), markdown: renderContextMarkdown(project) };
    }
    if (name === 'context' || name === 'context_audit') {
      const project = findProject(store.read(), args.project);
      const docs = await github.readContext(project, name === 'context_audit' || args.docs === false);
      const generatedMarkdown = renderContextMarkdown(project);
      const shared = compareContext(project, docs);
      shared.generatedMatches = shared.official ? shared.official.markdown.trim() === generatedMarkdown.trim() : null;
      if (name === 'context_audit') return { ...shared, draft: project.context, generatedMarkdown };
      return { project: project.name, markdown: shared.official?.markdown ?? generatedMarkdown,
        source: shared.official ? 'github' : 'draft', projectContext: project.context, generatedMarkdown,
        entries: listEntries(project, { repo: args.repo }), repos: project.repos,
        profile: project.profile, shared, docs: docs.filter(doc => !project.officialRepo || doc.path !== shared.path) };
    }
    if (name === 'planning') {
      const project = findProject(store.read(), args.project);
      let repoPlan = null;
      if (project.planSource && github.readMarkdown) {
        try {
          repoPlan = await github.readMarkdown(project.planSource.repo, project.planSource.path);
        } catch (error) {
          repoPlan = { ...project.planSource, error: error.message };
        }
      }
      return { plan: project.plan || null, planSource: project.planSource || null, repoPlan,
        sprints: project.sprints || [], releases: project.releases || [] };
    }
    if (name === 'worktree_spec') {
      const project = findProject(store.read(), args.project);
      const task = reservedTask(project, args, actor);
      const run = findRun(project, task);
      requireValue(run, 'Reserve novamente para preparar uma worktree.');
      const { role } = task.lease;
      const branch = task.pr ? task.observation?.branch : 'feature/' + project.id + '-' + task.id.toLowerCase();
      requireValue(role !== 'dev' || branch, 'Sincronize o PR antes de preparar a worktree de correção.');
      return { role, branch, repo: task.repo, project: project.id, task: task.id, run: run.id, head: task.observation?.head };
    }
    if (name === 'cut_release') {
      requireValue(isUser, 'Registre o corte de release pelo painel.');
      const scope = releaseScope(findProject(store.read(), args.project), args);
      const repos = [...new Set(scope.tasks.map(task => task.repo))];
      const refs = await Promise.all(repos.map(async repo => {
        const sha = await github.readDevelop(repo);
        requireValue(shaPattern.test(sha), 'Não foi possível confirmar a develop de ' + repo + '.');
        return { repo, sha };
      }));
      return store.write(state => {
        const project = findProject(state, args.project);
        const currentScope = releaseScope(project, args);
        requireValue(JSON.stringify(scope) === JSON.stringify(currentScope), 'A sprint mudou durante a consulta. Tente novamente.');
        const release = { ...scope, refs, cutAt: new Date().toISOString() };
        (project.releases ||= []).push(release);
        return release;
      });
    }
    if (name === 'attach_pr') {
      const project = findProject(store.read(), args.project);
      const task = findTask(project, args.task);
      const number = Number(args.number);
      requireValue(Number.isSafeInteger(number) && number > 0, 'Informe o número do PR.');
      requireValue(!task.pr || task.pr === number, 'Esta tarefa já está vinculada a outro PR.');
      requireValue(isUser || (task.dev === actor && task.lease?.role === 'dev' &&
        task.lease.expires > Date.now() && task.lease.token === args.token), 'Reserve a tarefa como Dev antes de vincular um PR.');
      const repo = project.repos.find(item => item.slug === task.repo);
      const pr = await github.readPr(repo.slug, number);
      validatePr(pr, repo, number);
      return store.write(state => {
        const currentProject = findProject(state, args.project);
        const current = findTask(currentProject, args.task);
        requireValue(!current.pr || current.pr === number, 'A tarefa já recebeu outro PR.');
        requireValue(!current.pr || current.syncedAt === task.syncedAt, 'O PR foi sincronizado durante a consulta. Tente novamente.');
        requireValue(isUser || (current.lease?.token === args.token && current.lease.expires > Date.now()), 'A reserva expirou.');
        requireValue(!currentProject.tasks.some(item => item !== current && item.repo === task.repo && item.pr === number),
          'Este PR já está vinculado a outra tarefa.');
        current.pr = number;
        current.observation = evaluate(pr, repo, task.profile.qa.login);
        current.syncedAt = Date.now();
        current.syncError = null;
        finishRun(currentProject, current);
        return safeTask(current);
      });
    }
    if (name === 'claim') await refresh();
    return store.write(state => {
      const project = findProject(state, args.project);
      const isPlanner = isUser || project.profile.po.agent === actor;
      switch (name) {
        case 'record_cost': {
          if (isUser) {
            requireValue(Object.hasOwn(agents, args.agent) && roles.includes(args.role), 'Selecione agente e papel.');
            return recordCost(project, args, { agent: args.agent, role: args.role });
          }
          const run = args.run ? reservedPlanningRun(project, args, actor) : findRun(project, reservedTask(project, args, actor));
          requireValue(run, 'Reserve novamente para lançar o custo da execução.');
          return recordCost(project, args, { agent: run.agent, role: run.role, run: run.id, task: run.task });
        }
        case 'void_cost': {
          requireValue(isUser, 'Corrija os lançamentos pelo painel.');
          const entry = project.costs?.find(item => item.id === args.id);
          requireValue(entry, 'Lançamento não encontrado.');
          entry.voidedAt ||= new Date().toISOString();
          return { saved: true };
        }
        case 'start_planning_run': {
          requireValue(!isUser && isPlanner, 'Somente o PO pode iniciar uma execução de planejamento.');
          const run = startRun(project, actor, 'po', Date.now() + leaseMs);
          run.token = randomUUID();
          return { run: publicRun(run), token: run.token };
        }
        case 'save_plan':
          requireValue(isPlanner, 'Somente o PO pode atualizar o plano pelo conector.');
          return savePlan(project, args, actor);
        case 'save_sprint':
          requireValue(isPlanner, 'Somente o PO pode editar sprints pelo conector.');
          return saveSprint(project, args);
        case 'assign_sprint': {
          requireValue(isPlanner, 'Somente o PO pode organizar tarefas em sprints pelo conector.');
          const task = findTask(project, args.task);
          task.sprint = sprintId(project, args.sprint);
          return safeTask(task);
        }
        case 'settings':
          requireValue(isUser, 'Use o painel para alterar a configuração.');
          project.profile = profile(args.profile);
          project.context = line(args.context, 12_000, 'Contexto', true);
          return { saved: true };
        case 'plan_source': {
          requireValue(isUser, 'Use o painel para escolher o arquivo do plano.');
          if (!args.repo) {
            delete project.planSource;
            return { saved: true };
          }
          requireValue(project.repos.some(repo => repo.slug === args.repo), 'Selecione um repositório cadastrado.');
          const planPath = line(args.path, 160, 'Caminho');
          requireValue(isMarkdownPath(planPath), 'Informe um caminho relativo de arquivo .md.');
          project.planSource = { repo: args.repo, path: planPath };
          return { saved: true };
        }
        case 'official_repo':
          requireValue(isUser, 'Use o painel para escolher a fonte oficial.');
          requireValue(project.repos.some(repo => repo.slug === args.repo), 'Selecione um repositório cadastrado.');
          const path = args.path === undefined ? project.officialPath || contextPath : line(args.path, 160, 'Caminho');
          requireValue(isMarkdownPath(path), 'Informe um caminho relativo de arquivo .md.');
          project.officialRepo = args.repo;
          project.officialPath = path;
          return { saved: true };
        case 'add_repo': {
          requireValue(isUser, 'Use o painel para cadastrar repositórios.');
          const slug = line(args.slug, 100, 'Repositório').toLowerCase();
          requireValue(slugPattern.test(slug), 'Use o formato dono/repositorio.');
          requireValue(!project.repos.some(repo => repo.slug === slug), 'Repositório já cadastrado.');
          requireValue(project.repos.length < 12, 'Limite de 12 repositórios por projeto.');
          const docs = list(args.docs || [], 5);
          requireValue(docs.every(isMarkdownPath), 'Informe caminhos relativos de arquivos .md.');
          const repo = { slug, base: 'develop', kind: line(args.kind, 25, 'Área'), docs, checks: list(args.checks || [], 15) };
          project.repos.push(repo);
          return repo;
        }
        case 'add_task':
          requireValue(isPlanner, 'Somente o PO do projeto pode criar tarefas pelo conector.');
          return addTask(project, args, state.limits);
        case 'quick_profile':
          requireValue(isUser, 'Use o painel para trocar o preset de papéis.');
          requireValue(['keep', 'swap', 'auto'].includes(args.preset), 'Preset inválido.');
          if (args.preset === 'swap') project.profile = swapDevQa(project.profile);
          project.autoAssign = args.preset === 'auto';
          return { profile: project.profile, autoAssign: project.autoAssign };
        case 'add_context_entry': {
          const writer = isUser || [project.profile.po.agent, project.profile.dev.agent].includes(actor);
          requireValue(writer || args.type === 'note', 'Decisões e contratos são registrados pelo PO e o Dev; o QA registra notas.');
          return addEntry(project, args, actor);
        }
        case 'retire_context_entry': {
          const entry = findEntryIn(project, args.id);
          requireValue(isPlanner || entry.author === actor, 'Somente o autor ou o PO encerram uma entrada de contexto.');
          return retireEntry(project, args.id, actor);
        }
        case 'post': {
          const to = args.to || 'all';
          requireValue(to === 'all' || to === 'user' || Object.hasOwn(agents, to), 'Destinatário inválido.');
          if (args.task) findTask(project, args.task);
          const message = { id: randomUUID(), author: actor, to, text: line(args.text, 5000, 'Mensagem'),
            task: args.task || null, at: new Date().toISOString() };
          project.messages.push(message);
          return message;
        }
        case 'inbox':
          return project.messages.filter(message => message.to === actor || message.to === 'all' || message.author === actor).slice(-30);
        case 'claim': {
          requireValue(!isUser && ['dev', 'qa'].includes(args.role), 'Informe o papel dev ou qa no conector.');
          const candidates = project.tasks.filter(task => (!args.task || task.id === args.task) &&
            readyFor(task, project.tasks, actor, args.role));
          const task = candidates.find(item => item.observation?.stage === 'changes') || candidates[0];
          if (!task) return null;
          if (task.lease) finishRun(project, task, 'expired');
          task.lease = { role: args.role, token: randomUUID(), expires: Date.now() + leaseMs };
          const run = startRun(project, actor, args.role, task.lease.expires, task);
          task.lease.runId = run.id;
          return { ...safeTask(task), token: task.lease.token, run };
        }
        case 'update_run': {
          if (args.run) {
            const run = reservedPlanningRun(project, args, actor);
            return publicRun(updateRun(run, { thread: args.thread, message: args.message }, Date.now() + leaseMs));
          }
          const task = reservedTask(project, args, actor);
          task.lease.expires = Date.now() + leaseMs;
          return updateRun(findRun(project, task), args, task.lease.expires);
        }
        case 'renew':
        case 'release': {
          if (args.run) {
            const run = reservedPlanningRun(project, args, actor);
            if (name === 'release') closeRun(run);
            else updateRun(run, {}, Date.now() + leaseMs);
            return publicRun(run);
          }
          const task = reservedTask(project, args, actor);
          if (name === 'release') finishRun(project, task);
          else {
            task.lease.expires = Date.now() + leaseMs;
            const run = findRun(project, task);
            if (run) updateRun(run, {}, task.lease.expires);
          }
          return safeTask(task);
        }
        default:
          throw new Error('Operação desconhecida.');
      }
    });
  }
  return { action, refresh };
}
