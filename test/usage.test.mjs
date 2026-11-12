import assert from 'node:assert/strict';
import test from 'node:test';
import { recordCost, reportedWindow, saveLimits } from '../lib/usage.mjs';

test('keeps currencies and cost kinds separate and updates a cumulative run without duplicating it', () => {
  const project = {};
  const args = { amount: 0.000004, currency: 'USD', kind: 'estimate', source: 'Sessão CLI' };
  const attribution = { run: 'run-1', agent: 'claude', role: 'dev' };
  recordCost(project, args, attribution);
  recordCost(project, { ...args, amount: 0.05 }, attribution);
  assert.equal(project.costs.length, 1);
  assert.equal(project.costs[0].micros, 50_000);
  recordCost(project, { ...args, currency: 'BRL', kind: 'billed', amount: '1,20' }, attribution);
  assert.equal(project.costs.length, 2);
  assert.equal(project.costs[1].micros, 1_200_000);
  assert.throws(() => recordCost(project, { ...args, amount: -1 }, attribution));
  assert.throws(() => recordCost(project, { ...args, amount: 'NaN' }, attribution));
});

test('records only reported quota windows with real reset times', () => {
  const state = {};
  const window = reportedWindow(53, 1794033713);
  saveLimits(state, 'codex', { fiveHours: window }, 'Codex local');
  assert.equal(state.limits.codex.windows.fiveHours.used, 53);
  assert.equal(state.limits.codex.windows.weekly, undefined);
  assert.equal(reportedWindow(130, 123), null);
  assert.throws(() => saveLimits(state, 'claude', { weekly: { used: 10, resetsAt: 'amanhã' } }, 'Manual'));
});
