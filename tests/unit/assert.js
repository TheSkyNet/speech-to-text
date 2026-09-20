// Minimal assert and test runner utilities for GJS (ES modules)
// Usage in tests:
//   import {test, run, assert} from './assert.js';
//   test('does thing', () => { assert.equal(1, 1); });
//   run();

import GLib from 'gi://GLib';

export const assert = {
    equal(actual, expected, message = 'Expected values to be equal') {
        if (actual !== expected) {
            throw new Error(`${message}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
        }
    },
    deepEqual(actual, expected, message = 'Expected values to be deeply equal') {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a !== e) {
            throw new Error(`${message}:\n actual=${a}\nexpected=${e}`);
        }
    },
    ok(value, message = 'Expected value to be truthy') {
        if (!value) throw new Error(message);
    },
    throws(fn, message = 'Expected function to throw') {
        let threw = false;
        try { fn(); } catch (_e) { threw = true; }
        if (!threw) throw new Error(message);
    },
};

const _tests = [];

export function test(name, fn) {
    _tests.push({name, fn});
}

export async function run() {
    let passed = 0;
    let failed = 0;
    for (const {name, fn} of _tests) {
        try {
            const maybePromise = fn();
            if (maybePromise && typeof maybePromise.then === 'function') {
                await maybePromise;
            }
            print(`[PASS] ${name}`);
            passed += 1;
        } catch (e) {
            printerr(`[FAIL] ${name}: ${e.message}`);
            if (e.stack) printerr(e.stack);
            failed += 1;
        }
    }
    const total = passed + failed;
    const summary = `[RESULT] ${passed}/${total} tests passed`;
    if (failed === 0) {
        print(summary);
        // 0 = success
        try { imports.system.exit(0); } catch (_) { GLib.exit(0); }
    } else {
        printerr(summary);
        try { imports.system.exit(1); } catch (_) { GLib.exit(1); }
    }
}
