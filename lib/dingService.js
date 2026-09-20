/* dingService.js
 * 
 * Simple sound effect service to play a short "ding" sound.
 * Respects a GSettings boolean key 'sounds-enabled' (enabled by default) to allow users to mute sounds.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {log as loggerLog} from './logger.js';

function log(message) {
    loggerLog(message, 'DingService');
}

const FEEDBACK_DINGS = {
    recording: 1,
    processing: 2,
    complete: 3,
    error: 4,
};

export class DingService {
    constructor(settingsManager) {
        this._settingsManager = settingsManager;
        this._queuedDings = 0;
        this._dingTimerId = null;
        this._dingIntervalMs = 280;
        log('DingService initialized');
    }

    /**
    * Whether sound effects are enabled in settings
    * @returns {boolean}
    */
    get enabled() {
        try {
            return this._settingsManager.getBoolean('sounds-enabled');
        } catch (_e) {
            return false;
        }
    }

    /**
     * Play the sound pattern for a recording event.
     * One sound means recording has begun; two means processing; three means
     * the transcription is complete; four means an error occurred.
     *
     * @param {string} feedback
     */
    playFeedback(feedback) {
        const dingCount = FEEDBACK_DINGS[feedback];
        if (!dingCount) {
            log(`Unknown sound feedback: ${feedback}`);
            return;
        }

        if (!this.enabled) {
            log('Sound effects disabled; skipping ding');
            return;
        }

        this._queuedDings += dingCount;
        if (!this._dingTimerId) {
            this._playNextDing();
        }
    }

    /**
     * Play a short ding sound. Kept for callers that only need acknowledgement.
     */
    playDing() {
        this.playFeedback('recording');
    }

    /**
     * Play the next queued sound and schedule the following one if needed.
     * @private
     */
    _playNextDing() {
        if (this._queuedDings === 0) {
            this._dingTimerId = null;
            return;
        }

        this._queuedDings--;

        this._playOneDing();

        if (this._queuedDings > 0) {
            this._scheduleNextDing();
        } else {
            this._dingTimerId = null;
        }
    }

    /**
     * Schedule the next ding without overlapping the current sound.
     * @private
     */
    _scheduleNextDing() {
        this._dingTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._dingIntervalMs, () => {
            this._dingTimerId = null;
            this._playNextDing();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Play one sound using the first available audio backend.
     * @private
     */
    _playOneDing() {
        if (this._trySpawn(['canberra-gtk-play', '-i', 'bell'])) {
            log('Played ding via canberra-gtk-play');
            return;
        }

        const bellOga = '/usr/share/sounds/freedesktop/stereo/bell.oga';
        if (GLib.file_test(bellOga, GLib.FileTest.EXISTS) && this._trySpawn(['paplay', bellOga])) {
            log('Played ding via paplay bell.oga');
            return;
        }

        // ALSA fallback commonly present on Ubuntu (alsa-utils)
        const alsaWav = '/usr/share/sounds/alsa/Front_Center.wav';
        if (GLib.file_test(alsaWav, GLib.FileTest.EXISTS) && this._trySpawn(['aplay', alsaWav])) {
            log('Played ding via aplay Front_Center.wav');
            return;
        }

        // As a last resort, try the terminal bell (may be inaudible in many environments)
        if (this._trySpawn(['sh', '-c', "printf '\\a' > /dev/tty 2>/dev/null || true"])) {
            log('Attempted terminal bell');
            return;
        }

        log('No available method to play ding sound');
    }

    destroy() {
        if (this._dingTimerId) {
            GLib.source_remove(this._dingTimerId);
            this._dingTimerId = null;
        }
        this._queuedDings = 0;
    }

    /**
    * Try to spawn a subprocess. Returns true on successful spawn, false if spawning fails.
    * @param {string[]} argv
    * @returns {boolean}
    */
    _trySpawn(argv) {
        try {
            // Spawn and immediately return; we do not need to wait
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return true;
        } catch (e) {
            log(`Spawn failed for ${argv[0]}: ${e.message}`);
            return false;
        }
    }
}
