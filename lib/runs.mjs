import { randomUUID } from 'node:crypto';

export function startRun(project, agent, role, expires, task = null) {
  const runs = project.runs ||= [];
  const now = new Date().toISOString();
  const run = {
    id: randomUUID(), task: task?.id || null, repo: task?.repo || null, agent, role, status: 'active',
    startedAt: now, updatedAt: now, expires, events: []
  };
  runs.push(run);
  return run;
}

export function findRun(project, task) {
  return project.runs?.find(run => run.id === task.lease?.runId);
}

export function finishRun(project, task, status = 'finished') {
  const run = findRun(project, task);
  if (run) closeRun(run, status);
  task.lease = null;
}

export function closeRun(run, status = 'finished') {
  run.status = status;
  run.endedAt = new Date().toISOString();
  delete run.token;
}

export function publicRun({ token, ...run }) {
  return run;
}

export function listRuns(project) {
  const now = Date.now();
  return (project.runs || []).toReversed().map(run => {
    const entry = publicRun(run);
    if (entry.status === 'active' && entry.expires <= now) entry.status = 'expired';
    return entry;
  });
}

export function updateRun(run, args, expires) {
  if (!run) throw new Error('Libere esta reserva antiga e reserve novamente para registrar a execução.');
  for (const [key, max] of [['thread', 300], ['worktree', 800], ['branch', 150], ['message', 1500]]) {
    const value = args[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Informe um valor válido para ' + key + '.');
    if (key === 'message') {
      run.events = [...run.events.slice(-29), { at: new Date().toISOString(), message: value.trim() }];
    } else {
      run[key] = value.trim();
    }
  }
  run.expires = expires;
  run.updatedAt = new Date().toISOString();
  return run;
}
