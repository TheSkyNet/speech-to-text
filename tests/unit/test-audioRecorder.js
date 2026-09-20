// Unit tests for AudioRecorder command construction.
// Run with: gjs -m tests/unit/test-audioRecorder.js

import {assert, test, run} from './assert.js';
import {AudioRecorder} from '../../lib/audioRecorder.js';

function createRecorder() {
    return new AudioRecorder({}, {enabled: false});
}

const baseSettings = {
    recorder: 'arecord',
    format: 'S16_LE',
    sampleRate: 16000,
    channels: 1,
    maxDuration: 30,
};

test('arecord uses the configured maximum duration for normal recordings', () => {
    const command = createRecorder()._buildRecordingCommand('/tmp/recording.wav', baseSettings);

    assert.deepEqual(command, [
        'arecord', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav',
        '-d', '30', '/tmp/recording.wav',
    ]);
});

test('arecord omits the duration limit for continuous recordings', () => {
    const command = createRecorder()._buildRecordingCommand('/tmp/recording.wav', {
        ...baseSettings,
        unlimited: true,
    });

    assert.deepEqual(command, [
        'arecord', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav',
        '/tmp/recording.wav',
    ]);
});

test('ffmpeg omits the duration limit for continuous recordings', () => {
    const command = createRecorder()._buildRecordingCommand('/tmp/recording.wav', {
        ...baseSettings,
        recorder: 'ffmpeg',
        unlimited: true,
    });

    assert.deepEqual(command, [
        'ffmpeg', '-f', 'alsa', '-i', 'default', '-ar', '16000', '-ac', '1',
        '-sample_fmt', 's16', '-y', '/tmp/recording.wav',
    ]);
});

test('stopRecording waits for the recorder to finish flushing the audio file', async () => {
    const recorder = createRecorder();
    recorder._isRecording = true;

    let finishRecording;
    recorder._recordingCompletion = new Promise(resolve => {
        finishRecording = resolve;
    });

    let stopped = false;
    const stopPromise = recorder.stopRecording().then(() => {
        stopped = true;
    });

    await Promise.resolve();
    assert.equal(stopped, false);

    finishRecording();
    await stopPromise;
    assert.equal(stopped, true);
});

run();