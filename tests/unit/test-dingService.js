// Unit tests for accessible sound feedback.
// Run with: gjs -m tests/unit/test-dingService.js

import {assert, test, run} from './assert.js';
import {DingService} from '../../lib/dingService.js';

function createDingService(enabled = true) {
    const service = new DingService({
        getBoolean() {
            return enabled;
        },
    });
    const sounds = [];
    service._trySpawn = argv => {
        sounds.push(argv);
        return true;
    };
    service._scheduleNextDing = () => {};
    return {service, sounds};
}

test('recording feedback starts with one sound', () => {
    const {service, sounds} = createDingService();

    service.playFeedback('recording');

    assert.equal(sounds.length, 1);
    assert.equal(service._queuedDings, 0);
});

test('processing feedback queues two separate sounds', () => {
    const {service, sounds} = createDingService();

    service.playFeedback('processing');
    assert.equal(sounds.length, 1);
    assert.equal(service._queuedDings, 1);

    service._playNextDing();
    assert.equal(sounds.length, 2);
    assert.equal(service._queuedDings, 0);
});

test('disabled sound feedback never spawns a sound', () => {
    const {service, sounds} = createDingService(false);

    service.playFeedback('complete');

    assert.equal(sounds.length, 0);
    assert.equal(service._queuedDings, 0);
});

test('unknown feedback patterns do not create a sound', () => {
    const {service, sounds} = createDingService();

    service.playFeedback('unknown');

    assert.equal(sounds.length, 0);
    assert.equal(service._queuedDings, 0);
});

run();