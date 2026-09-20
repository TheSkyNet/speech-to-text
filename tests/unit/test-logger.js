// Unit tests for logger gating and level behavior without forcing file writes
// Run with: gjs -m tests/unit/test-logger.js

import {assert, test, run} from './assert.js';
import * as Logger from '../../lib/logger.js';

// Minimal mock SettingsManager for logger.init()
class MockSettingsManager {
    constructor(initial = false) {
        this._values = new Map([['debug-mode', initial]]);
        this._nextId = 1;
        this._handlers = new Map(); // signalName -> Map(id, cb)
    }
    getBoolean(key) { return !!this._values.get(key); }
    setBoolean(key, val) {
        this._values.set(key, !!val);
        // emit signal if connected
        const group = this._handlers.get(String(key));
        if (group) for (const cb of group.values()) try { cb(); } catch (_e) {}
    }
    connect(signalName, cb) {
        const name = String(signalName);
        const id = this._nextId++;
        if (!this._handlers.has(name)) this._handlers.set(name, new Map());
        this._handlers.get(name).set(id, cb);
        return id;
    }
    disconnect(id) {
        for (const group of this._handlers.values()) {
            if (group.delete(id)) return;
        }
    }
}

test('isEnabled() is false by default (no debug, no test window)', () => {
    // Reset logger state by re-initializing with mock debug=false
    Logger.init(new MockSettingsManager(false));
    // Default level becomes INFO, but threshold becomes WARN when not in debug/test
    assert.equal(Logger.isEnabled(), false);
});

test('enableTestLogging temporarily enables INFO-level emission', () => {
    Logger.init(new MockSettingsManager(false));
    Logger.setLevel('INFO');
    Logger.enableTestLogging(100);
    assert.equal(Logger.isEnabled(), true);
});

test('setLevel(DEBUG) + test window allows INFO emission', () => {
    Logger.init(new MockSettingsManager(false));
    Logger.setLevel('DEBUG');
    Logger.enableTestLogging(100);
    assert.equal(Logger.isEnabled(), true);
});

test('init() with debug-mode=true sets level DEBUG and enables INFO emission', () => {
    const settings = new MockSettingsManager(true);
    Logger.init(settings);
    assert.equal(Logger.getLevel(), 'DEBUG');
    assert.equal(Logger.isEnabled(), true);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

test('changing debug-mode via settings adjusts level dynamically', async () => {
    const settings = new MockSettingsManager(true);
    Logger.init(settings);
    // Ensure any prior test-logging window has expired
    await sleep(150);
    settings.setBoolean('debug-mode', false);
    // In non-debug, threshold becomes WARN so INFO disabled
    assert.equal(Logger.isEnabled(), false);
    settings.setBoolean('debug-mode', true);
    assert.equal(Logger.isEnabled(), true);
});

run();
