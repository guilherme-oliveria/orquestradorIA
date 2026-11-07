import { randomUUID } from 'node:crypto';
import { agents, evaluate, readyFor, slugPattern, validatePr } from './workflow.mjs';
import { readContext, readPr } from './github.mjs';
import { compareContext, contextPath } from './context.mjs';

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

function addTask(project, args) {
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
    repo: args.repo, depends, profile: project.profile, dev: project.profile.dev.agent, qa: project.profile.qa.agent,
    pr: null, observation: null, lease: null, created: new Date().toISOString()
  };
  project.tasks.push(task);
  return safeTask(task);
}

export function createService(store, github = { readPr, readContext }) {
  let refreshing;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
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
            const current = findTask(findProject(state, project.id), task.id);
            if (current.pr !== task.pr || current.syncedAt !== task.syncedAt) return;
            current.syncError = syncError || null;
            current.syncedAt = Date.now();
            if (observation) {
              if (current.observation?.stage !== observation.stage || current.observation?.head !== observation.head) {
                current.lease = null;
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
    if (name === 'workspace') {
      return { projects: store.read().projects.map(project => ({
        ...project, tasks: project.tasks.map(safeTask)
      })) };
    }
    if (name === 'refresh') {
      await refresh();
      return { synced: true };
    }
    if (name === 'create_project') {
      requireValue(isUser, 'Use o painel para criar projetos.');
      return store.write(state => {
        const id = line(args.id, 48, 'Identificador').toLowerCase();
        requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id !== 'demo', 'Use um identificador como meu-projeto.');
        requireValue(!state.projects.some(project => project.id === id), 'Identificador já cadastrado.');
        const project = {
          id, name: line(args.name, 80, 'Nome'), context: line(args.context, 12_000, 'Contexto', true),
          profile: profile(args.profile), repos: [], tasks: [], messages: []
        };
        state.projects.push(project);
        return project;
      });
    }
    if (name === 'context' || name === 'context_audit') {
      const project = findProject(store.read(), args.project);
      const docs = await github.readContext(project, name === 'context_audit' || args.docs === false);
      const shared = compareContext(project, docs);
      if (name === 'context_audit') return { ...shared, draft: project.context };
      return { project: project.name, markdown: shared.official?.markdown ?? project.context,
        source: shared.official ? 'github' : 'draft', repos: project.repos, profile: project.profile,
        shared, docs: docs.filter(doc => !project.officialRepo || doc.path !== contextPath) };
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
        current.lease = null;
        return safeTask(current);
      });
    }
    if (name === 'claim') await refresh();
    return store.write(state => {
      const project = findProject(state, args.project);
      switch (name) {
        case 'settings':
          requireValue(isUser, 'Use o painel para alterar a configuração.');
          project.profile = profile(args.profile);
          project.context = line(args.context, 12_000, 'Contexto', true);
          return { saved: true };
        case 'official_repo':
          requireValue(isUser, 'Use o painel para escolher a fonte oficial.');
          requireValue(project.repos.some(repo => repo.slug === args.repo), 'Selecione um repositório cadastrado.');
          project.officialRepo = args.repo;
          return { saved: true };
        case 'add_repo': {
          requireValue(isUser, 'Use o painel para cadastrar repositórios.');
          const slug = line(args.slug, 100, 'Repositório').toLowerCase();
          requireValue(slugPattern.test(slug), 'Use o formato dono/repositorio.');
          requireValue(!project.repos.some(repo => repo.slug === slug), 'Repositório já cadastrado.');
          requireValue(project.repos.length < 12, 'Limite de 12 repositórios por projeto.');
          const docs = list(args.docs || [], 5);
          requireValue(docs.every(path => /^(?:[\w.-]+\/)*[\w.-]+\.md$/i.test(path) &&
            !path.split('/').some(part => part === '..' || part === '.')), 'Informe caminhos relativos de arquivos .md.');
          const repo = { slug, base: 'develop', kind: line(args.kind, 25, 'Área'), docs, checks: list(args.checks || [], 15) };
          project.repos.push(repo);
          return repo;
        }
        case 'add_task':
          requireValue(isUser || project.profile.po.agent === actor, 'Somente o PO do projeto pode criar tarefas pelo conector.');
          return addTask(project, args);
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
          task.lease = { role: args.role, token: randomUUID(), expires: Date.now() + leaseMs };
          return { ...safeTask(task), token: task.lease.token };
        }
        case 'renew':
        case 'release': {
          const task = findTask(project, args.task);
          requireValue(task.lease && task.lease.token === args.token && task[task.lease.role] === actor &&
            task.lease.expires > Date.now(), 'Reserva inválida ou expirada.');
          if (name === 'release') task.lease = null;
          else task.lease.expires = Date.now() + leaseMs;
          return safeTask(task);
        }
        default:
          throw new Error('Operação desconhecida.');
      }
    });
  }
  return { action, refresh };
}
