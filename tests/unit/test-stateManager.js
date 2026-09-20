// Unit tests for StateManager using the minimal GJS harness
// Run with: gjs -m tests/unit/test-stateManager.js

import {assert, test, run} from './assert.js';
import {StateManager} from '../../lib/stateManager.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

test('initial state is idle with empty history', () => {
    const sm = new StateManager();
    assert.equal(sm.getState(), 'idle');
    assert.ok(sm.isIdle);
    assert.equal(sm.getPreviousState(), null);
    assert.deepEqual(sm.getHistory(), []);
});

test('valid transitions: idle -> listening -> processing -> idle', () => {
    const sm = new StateManager();
    sm.setState('listening');
    assert.ok(sm.isListening);
    sm.setState('processing');
    assert.ok(sm.isProcessing);
    sm.setState('idle');
    assert.ok(sm.isIdle);
    const hist = sm.getHistory();
    assert.equal(hist.length, 3);
    assert.deepEqual(hist.map(h => `${h.fromState}->${h.toState}`), ['idle->listening', 'listening->processing', 'processing->idle']);
});

test('invalid transitions throw', () => {
    const sm = new StateManager();
    assert.throws(() => sm.setState('processing'));
    sm.setState('listening');
    assert.throws(() => sm.setState('listening')); // same state ignored (no throw), but setState implementation returns; ensure not throwing
});

test('same-state set throws and is not added to history', () => {
    const sm = new StateManager();
    sm.setState('listening');
    const lenBefore = sm.getHistory().length;
    assert.throws(() => sm.setState('listening'));
    const lenAfter = sm.getHistory().length;
    assert.equal(lenBefore, 1);
    assert.equal(lenAfter, 1);
});

test('callbacks: onStateChanged/onStateEnter/onStateExit are invoked', () => {
    const sm = new StateManager();
    let changed = [];
    let entered = [];
    let exited = [];
    sm.onStateChanged((newS, prevS) => changed.push([newS, prevS]));
    sm.onStateEnter('listening', (prevS) => entered.push(prevS));
    sm.onStateExit('listening', (newS) => exited.push(newS));

    sm.setState('listening');
    sm.setState('processing');

    assert.deepEqual(changed.map(x => x[0]), ['listening', 'processing']);
    assert.deepEqual(entered, ['idle']);
    assert.deepEqual(exited, ['processing']);
});

test('getStatistics returns coherent values', async () => {
    const sm = new StateManager();
    sm.setState('listening');
    await sleep(10);
    sm.setState('processing');
    await sleep(10);
    sm.setState('idle');

    const stats = sm.getStatistics();
    assert.equal(stats.currentState, 'idle');
    assert.equal(stats.previousState, 'processing');
    assert.equal(stats.totalTransitions, 3);
    assert.ok(stats.timeInCurrentState >= 0);
    assert.ok('listening' in stats.stateFrequency && 'processing' in stats.stateFrequency && 'idle' in stats.stateFrequency);
    assert.ok(stats.activeCallbacks >= 0);
});

test('reset sets state to idle and clears history', () => {
    const sm = new StateManager();
    sm.setState('listening');
    sm.reset();
    assert.equal(sm.getState(), 'idle');
    assert.equal(sm.getPreviousState(), null);
    assert.deepEqual(sm.getHistory(), []);
});

run();
