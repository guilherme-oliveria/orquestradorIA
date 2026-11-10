export const entryTypes = { decision: 'Decisão', contract: 'Contrato', note: 'Nota' };
const prefixes = { decision: 'DEC', contract: 'CON', note: 'NOT' };
const sections = { decision: 'Decisões', contract: 'Contratos', note: 'Notas' };
const limits = { title: 120, body: 8000, active: 300 };

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, max, label) {
  const result = typeof value === 'string' ? value.trim() : '';
  requireValue(result.length && result.length <= max, label + ' inválido (até ' + max + ' caracteres).');
  return result;
}

export const isActive = entry => entry.status === 'active';
export const appliesTo = (entry, repo) => !repo || !entry.repos.length || entry.repos.includes(repo);

export function findEntry(project, id) {
  const entry = (project.contextEntries || []).find(item => item.id === id);
  requireValue(entry, 'Entrada de contexto não encontrada.');
  return entry;
}

export function addEntry(project, args, actor) {
  requireValue(Object.hasOwn(entryTypes, args.type), 'Informe o tipo: decision, contract ou note.');
  const title = text(args.title, limits.title, 'Título');
  const body = text(args.body, limits.body, 'Conteúdo');
  requireValue(args.repos === undefined || Array.isArray(args.repos), 'Informe os repositórios como lista.');
  const repos = [...new Set((args.repos || []).map(item => String(item).trim().toLowerCase()).filter(Boolean))];
  requireValue(repos.every(slug => project.repos.some(repo => repo.slug === slug)), 'Informe apenas repositórios cadastrados no projeto.');
  const entries = project.contextEntries ||= [];
  requireValue(entries.filter(isActive).length < limits.active, 'Limite de ' + limits.active + ' entradas ativas por projeto.');
  const now = new Date().toISOString();
  let supersedes = null;
  if (args.supersedes) {
    const previous = findEntry(project, args.supersedes);
    requireValue(isActive(previous), 'A entrada ' + previous.id + ' já foi encerrada.');
    requireValue(previous.type === args.type, 'Substitua uma entrada pelo mesmo tipo (' + entryTypes[previous.type] + ').');
    previous.status = 'superseded';
    previous.endedAt = now;
    previous.endedBy = actor;
    supersedes = previous.id;
  }
  const seq = (project.contextSeq ||= {});
  seq[args.type] = (seq[args.type] || 0) + 1;
  const entry = {
    id: prefixes[args.type] + '-' + String(seq[args.type]).padStart(2, '0'), type: args.type, title, body, repos,
    author: actor, at: now, status: 'active', supersedes, endedAt: null, endedBy: null
  };
  entries.push(entry);
  return entry;
}

export function retireEntry(project, id, actor) {
  const entry = findEntry(project, id);
  requireValue(isActive(entry), 'A entrada ' + entry.id + ' já foi encerrada.');
  entry.status = 'retired';
  entry.endedAt = new Date().toISOString();
  entry.endedBy = actor;
  return entry;
}

export function listEntries(project, { repo, type, all } = {}) {
  return (project.contextEntries || []).filter(entry => (all || isActive(entry)) &&
    (!type || entry.type === type) && appliesTo(entry, repo));
}

export function renderContextMarkdown(project, entries = listEntries(project)) {
  const lines = ['# Contexto do projeto ' + project.name, '',
    '> Gerado pelo Orquestrador IA a partir do painel. Não edite à mão: registre decisões, contratos e notas pelo painel ou pelo MCP e gere o arquivo de novo.', ''];
  if (project.context) lines.push('## Resumo', '', project.context.trim(), '');
  for (const [type, label] of Object.entries(sections)) {
    const items = entries.filter(entry => entry.type === type);
    if (!items.length) continue;
    lines.push('## ' + label, '');
    for (const entry of items) {
      const scope = entry.repos.length ? entry.repos.join(', ') : 'todos os repositórios';
      lines.push('### ' + entry.id + ' · ' + entry.title, '', '_Vale para: ' + scope + ' · registrada por ' + entry.author +
        ' em ' + entry.at.slice(0, 10) + (entry.supersedes ? ' · substitui ' + entry.supersedes : '') + '_', '', entry.body.trim(), '');
    }
  }
  return lines.join('\n');
}
