import { randomUUID } from 'node:crypto';
import { shaPattern } from './workflow.mjs';

function text(value, max, label) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length > max) throw new Error(label + ' ultrapassa o limite de caracteres.');
  return result;
}

export function savePlan(project, args, actor) {
  const markdown = text(args.markdown, 12_000, 'Plano');
  if (!markdown) throw new Error('Informe o plano de execução em Markdown.');
  project.plan = { markdown, author: actor, updatedAt: new Date().toISOString() };
  return project.plan;
}

function sprintDate(value) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Informe uma data válida.');
  }
  return value;
}

export function saveSprint(project, args) {
  const sprints = project.sprints ||= [];
  const existing = args.sprint ? sprints.find(item => item.id === args.sprint) : null;
  if (args.sprint && !existing) throw new Error('Sprint não encontrada.');
  const name = text(args.name, 80, 'Nome');
  if (!name || !['planned', 'active', 'done'].includes(args.status)) throw new Error('Informe o nome e o status da sprint.');
  const start = sprintDate(args.start);
  const end = sprintDate(args.end);
  if (start && end && start > end) throw new Error('A data final deve ser igual ou posterior à data inicial.');
  if (!existing && sprints.length >= 100) throw new Error('Limite de 100 sprints por projeto.');
  const sprint = { id: existing?.id || randomUUID(), name, goal: text(args.goal, 1500, 'Objetivo'), status: args.status, start, end };
  if (existing) Object.assign(existing, sprint);
  else sprints.push(sprint);
  return sprint;
}

export function sprintId(project, id) {
  if (!id) return null;
  if (!project.sprints?.some(sprint => sprint.id === id)) throw new Error('Selecione uma sprint do projeto.');
  return id;
}

export function releaseScope(project, args) {
  const version = String(args.version || '').trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 24) {
    throw new Error('Use uma versão no formato X.Y.Z.');
  }
  if (project.releases?.some(release => release.version === version)) throw new Error('Já existe um corte para esta versão.');
  const sprint = project.sprints?.find(item => item.id === args.sprint);
  if (!sprint) throw new Error('Selecione a sprint da release.');
  const tasks = project.tasks.filter(task => task.sprint === sprint.id);
  if (!tasks.length) throw new Error('A sprint precisa ter tarefas.');
  const pending = tasks.filter(task => task.observation?.stage !== 'merged' || !shaPattern.test(task.observation.head));
  if (pending.length) throw new Error('Aguardando merge validado de ' + pending.map(task => task.id).join(', ') + '.');
  return {
    version, sprint: sprint.id, sprintName: sprint.name,
    tasks: tasks.map(task => ({ id: task.id, repo: task.repo, pr: task.pr, head: task.observation.head }))
  };
}
