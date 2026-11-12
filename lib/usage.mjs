import { randomUUID } from 'node:crypto';
import { hasLimits } from './agents.mjs';

const currencies = new Set(['USD', 'BRL', 'EUR']);
const kinds = new Set(['billed', 'estimate', 'allocated']);

export function recordCost(project, args, attribution) {
  const amount = String(args.amount ?? '').trim().replace(',', '.');
  if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(amount) || !currencies.has(args.currency) || !kinds.has(args.kind)) {
    throw new Error('Informe valor, moeda e tipo de custo válidos.');
  }
  const records = project.costs ||= [];
  const existing = attribution.run && records.find(item => item.run === attribution.run &&
    item.currency === args.currency && item.kind === args.kind);
  if (existing?.voidedAt) throw new Error('O lançamento desta execução foi cancelado pelo dono do projeto.');
  if (!existing && records.length >= 2500) throw new Error('Limite de 2.500 lançamentos de custo por projeto.');
  const source = typeof args.source === 'string' ? args.source.trim() : '';
  if (!source || source.length > 160) throw new Error('Informe a origem do valor em até 160 caracteres.');
  const entry = {
    id: existing?.id || randomUUID(), ...attribution, micros: Math.round(Number(amount) * 1_000_000),
    currency: args.currency, kind: args.kind, source, at: new Date().toISOString()
  };
  if (existing) Object.assign(existing, entry);
  else records.push(entry);
  return entry;
}

function quotaWindow(input) {
  const used = input?.used;
  const resetsAt = input?.resetsAt;
  if (!Number.isFinite(used) || used < 0 || used > 100 || typeof resetsAt !== 'string' ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(resetsAt) || !Number.isFinite(Date.parse(resetsAt))) {
    throw new Error('Informe um percentual de 0 a 100 e um horário de reset com fuso.');
  }
  return { used, resetsAt: new Date(resetsAt).toISOString() };
}

export function saveLimits(state, provider, windows, source) {
  if (!hasLimits(provider)) throw new Error('Selecione um agente com leitura de limites.');
  const entries = Object.entries(windows || {});
  if (!entries.length || entries.some(([key]) => !['fiveHours', 'weekly'].includes(key))) {
    throw new Error('Informe a janela de 5 horas ou semanal.');
  }
  const snapshot = { ...state.limits?.[provider], source, checkedAt: new Date().toISOString(),
    windows: Object.fromEntries(entries.map(([key, value]) => [key, quotaWindow(value)])) };
  (state.limits ||= {})[provider] = snapshot;
  return snapshot;
}

export function reportedWindow(used, resetSeconds) {
  if (!Number.isFinite(used) || used < 0 || used > 100 || !Number.isFinite(resetSeconds)) return null;
  const date = new Date(resetSeconds * 1000);
  return Number.isFinite(date.valueOf()) ? { used, resetsAt: date.toISOString() } : null;
}

export function saveClaudeUsage(state, { windows, sessionCostUsd }) {
  const hasWindows = Object.keys(windows || {}).length > 0;
  if (sessionCostUsd !== undefined && (!Number.isFinite(sessionCostUsd) || sessionCostUsd < 0 || sessionCostUsd >= 10_000_000)) {
    throw new Error('Estimativa de sessão inválida.');
  }
  if (!hasWindows && sessionCostUsd === undefined) throw new Error('Nenhuma leitura do Claude Code recebida.');
  const snapshot = hasWindows ? saveLimits(state, 'claude', windows, 'Claude Code statusline') :
    ((state.limits ||= {}).claude ||= { windows: {} });
  if (sessionCostUsd !== undefined) {
    snapshot.sessionEstimate = { micros: Math.round(sessionCostUsd * 1_000_000), checkedAt: new Date().toISOString() };
  }
  return snapshot;
}
