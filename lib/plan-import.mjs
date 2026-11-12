// Lê o plano de ação em Markdown (formato do guia) e devolve as tarefas:
//   - [ ] **MOB-18b Ações na notificação.** descrição... *Depende de:* MOB-18, BE-12.
// Também aceita "Depende de:", "Faz:" e "Pronto quando:" em linhas recuadas abaixo da tarefa.
const idPattern = /[A-Z][A-Z0-9]{1,7}(?:-[A-Za-z0-9]{1,8}){1,3}/;
const taskLine = new RegExp('^- \\[( |x|X)\\] \\*\\*(' + idPattern.source + ')[\\s:·—-]+(.+?)\\*\\*\\s*(.*)$');

export const normalizeId = id => id.toUpperCase();

export function parseActionPlan(markdown) {
  const tasks = [];
  let group = '';
  let current = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = raw.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      group = heading[1].replace(/[*_`]/g, '').slice(0, 80);
      current = null;
      continue;
    }
    const match = raw.match(taskLine);
    if (match) {
      current = {
        id: normalizeId(match[2]), done: match[1] !== ' ', group,
        title: match[3].trim().replace(/[.:]$/, '').slice(0, 120), lines: [match[4].trim()]
      };
      tasks.push(current);
    } else if (current && /^\s{2,}\S/.test(raw)) {
      current.lines.push(raw.trim());
    } else if (raw.trim() === '' || /^- /.test(raw)) {
      current = null;
    }
  }
  const seen = new Set();
  return tasks.filter(task => !seen.has(task.id) && seen.add(task.id)).map(({ lines, ...task }) => {
    const text = lines.filter(Boolean).join('\n');
    const depends = [...(text.match(/\*?Depende de:\*?\s*([^\n]*)/i)?.[1] || '').matchAll(new RegExp(idPattern.source, 'g'))]
      .map(found => normalizeId(found[0])).filter(id => id !== task.id);
    return { ...task, description: text.slice(0, 5000), depends: [...new Set(depends)] };
  });
}
