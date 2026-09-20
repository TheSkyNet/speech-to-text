/* typeAsISpeakService.js
 *
 * Experimental service for "Type As I Speak" mode.
 * Listens to extension state and settings; intended to support incremental typing
 * in future iterations. For now, it provides a toggleable service scaffold
 * with proper lifecycle hooks and minimal, non-invasive behavior.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {log as loggerLog} from './logger.js';

function log(message) {
    loggerLog(message, 'TypeAsISpeakService');
}

/**
 * Type As I Speak service (scaffold)
 * - Reacts to setting: org.gnome.shell.extensions.speech-panel type-as-i-speak-enabled
 * - Subscribes to state changes to prepare for future incremental typing logic
 */
export class TypeAsISpeakService {
    /**
     * @param {Object} deps
     * @param {ISettingsManager} deps.settingsManager
     * @param {IStateManager} deps.stateManager
     * @param {ISpeechTranscriber} deps.speechTranscriber
     * @param {ITextInserter} deps.textInserter
     * @param {IAudioRecorder} deps.audioRecorder
     * @param {INotificationService} deps.notificationService
     */
    constructor({ settingsManager, stateManager, speechTranscriber, textInserter, audioRecorder, notificationService }) {
        this._settingsManager = settingsManager;
        this._stateManager = stateManager;
        this._speechTranscriber = speechTranscriber;
        this._textInserter = textInserter;
        this._audioRecorder = audioRecorder;
        this._notificationService = notificationService;

        this._enabled = false;
        this._settingsConnId = null;
        this._stateConnId = null;
        this._liveTimerId = null;
        this._liveIntervalMs = 800; // default; may be overridden by settings (ms)
        this._isTickRunning = false;
        this._lastTranscribedText = '';
        this._typedText = '';
        this._stats = {
            enabledToggles: 0,
            listeningSessions: 0,
            lastToggleTimestamp: null,
            lastSessionStart: null,
            ticks: 0,
            charactersTyped: 0,
        };
        this._notifiedFirstInsertion = false;
        this._currentAudioPath = null;

        log('Initializing TypeAsISpeakService');
        this._wireSettings();
        this._applyIntervalFromSettings();
        this._applyEnabledFromSettings();
    }

    _applyIntervalFromSettings(restart = false) {
        try {
            let ms;
            try {
                ms = this._settingsManager.getDouble('type-as-i-speak-interval-ms');
            } catch (_) {
                ms = this._settingsManager.getInt('type-as-i-speak-interval-ms');
            }
            // Clamp to sane bounds in case of out-of-range values
            if (typeof ms !== 'number' || isNaN(ms))
                ms = 800;
            if (ms < 0) ms = 0;
            if (ms > 100000) ms = 100000;
            const changed = (ms !== this._liveIntervalMs);
            this._liveIntervalMs = ms;
            log(`Configured live interval: ${this._liveIntervalMs}ms`);
            if (restart && changed)
                this._restartLiveTypingLoop();
        } catch (e) {
            log(`Could not read interval setting; keeping ${this._liveIntervalMs}ms. Error: ${e.message}`);
        }
    }

    get enabled() {
        return this._enabled;
    }

    getTypedText() {
        return this._typedText || '';
    }

    clearSession() {
        this._lastTranscribedText = '';
        this._typedText = '';
        this._notifiedFirstInsertion = false;
        this._currentAudioPath = null;
    }

    _wireSettings() {
        try {
            // React to setting changes (regular TAS)
            this._settingsConnId = this._settingsManager.connect('type-as-i-speak-enabled', () => {
                this._applyEnabledFromSettings('tas');
            });
            log('Connected to settings change: type-as-i-speak-enabled');

            // React to setting changes (stream TAS)
            this._settingsManager.connect('type-as-i-speak-stream-enabled', () => {
                this._applyEnabledFromSettings('stream');
            });
            log('Connected to settings change: type-as-i-speak-stream-enabled');

            // Interval changes
            this._settingsManager.connect('type-as-i-speak-interval-ms', () => {
                this._applyIntervalFromSettings(true);
            });
            log('Connected to settings change: type-as-i-speak-interval-ms');
        } catch (e) {
            log(`Failed to connect settings: ${e.message}`);
        }
    }

    _applyEnabledFromSettings(trigger) {
        let tasEnabled = false;
        try {
            tasEnabled = this._settingsManager.getBoolean('type-as-i-speak-enabled');
        } catch (e) {
            // ignore if not available yet
        }

        // Maintain mutual exclusivity only when TAS was toggled on via prefs
        try {
            if (trigger === 'tas' && tasEnabled) {
                // Turn off streaming mode if it was on
                this._settingsManager.setBoolean('type-as-i-speak-stream-enabled', false);
            }
        } catch (e) {
            log(`Exclusivity adjust failed: ${e.message}`);
        }

        const newEnabled = !!tasEnabled;
        if (newEnabled === this._enabled)
            return;

        this._enabled = newEnabled;
        this._stats.enabledToggles++;
        this._stats.lastToggleTimestamp = Date.now();

        if (this._enabled) {
            this._start();
            // If user enabled while already recording, begin immediately
            try {
                if (this._stateManager?.isListening) {
                    this.clearSession();
                    this._startLiveTypingLoop();
                    this._processIncrement().catch(e => log(`Initial incremental typing failed: ${e.message}`));
                }
            } catch (e) {
                log(`Error while enabling live typing mid-recording: ${e.message}`);
            }
            if (this._notificationService?.enabled) {
                this._notificationService.notifyInfo('Type As I Speak', 'Experimental mode enabled');
            }
        } else {
            this._stop();
            if (this._notificationService?.enabled) {
                this._notificationService.notifyInfo('Type As I Speak', 'Experimental mode disabled');
            }
        }
    }

    _start() {
        // Subscribe to state changes so we know when recording starts/stops
        if (!this._stateConnId) {
            this._stateConnId = this._stateManager.onStateChanged((newState, prev) => this._onStateChanged(newState, prev));
            log('Subscribed to StateManager changes');
        }
        log('TypeAsISpeakService started');
    }

    _stop() {
        this._stopLiveTypingLoop();
        if (this._stateConnId) {
            this._stateManager.removeCallback(this._stateConnId);
            this._stateConnId = null;
            log('Unsubscribed from StateManager changes');
        }
        this.clearSession();
        log('TypeAsISpeakService stopped');
    }

    _onStateChanged(newState, previousState) {
        if (!this._enabled)
            return;

        log(`State changed: ${previousState} -> ${newState}`);
        switch (newState) {
            case 'listening':
                this._stats.listeningSessions++;
                this._stats.lastSessionStart = Date.now();
                this.clearSession();
                this._startLiveTypingLoop();
                // Kick an immediate first pass so users see typing without waiting full cadence
                this._processIncrement().catch(e => log(`Initial incremental typing failed: ${e.message}`));
                break;
            case 'processing':
                // Pause loop while processing; final insertion handled by UI will use our typed prefix
                this._stopLiveTypingLoop();
                break;
            case 'idle':
                // Cleanup session data
                this._stopLiveTypingLoop();
                this.clearSession();
                break;
        }
    }

    _startLiveTypingLoop() {
        if (this._liveTimerId) {
            log('Live typing loop already active');
            return;
        }
        // GLib timers are integer-millisecond timers on this GNOME build;
        // retain the fractional preference but use the closest safe value.
        const timerInterval = Math.max(1, Math.round(this._liveIntervalMs));
        this._liveTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timerInterval, () => {
            this._processIncrement().catch(e => log(`Incremental typing error: ${e.message}`));
            return GLib.SOURCE_CONTINUE; // continue loop
        });
        log(`Live typing loop started (every ${this._liveIntervalMs}ms; timer=${timerInterval}ms)`);
    }

    _stopLiveTypingLoop() {
        if (this._liveTimerId) {
            GLib.source_remove(this._liveTimerId);
            this._liveTimerId = null;
            log('Live typing loop stopped');
        }
        this._isTickRunning = false;
    }

    _restartLiveTypingLoop() {
        const wasRunning = !!this._liveTimerId;
        if (wasRunning)
            this._stopLiveTypingLoop();
        if (this._enabled && this._stateManager?.isListening)
            this._startLiveTypingLoop();
        log(`Live typing loop ${wasRunning ? 're' : ''}started with interval ${this._liveIntervalMs}ms (if listening)`);
    }

    async _processIncrement() {
        if (this._isTickRunning)
            return;
        if (!this._audioRecorder?.isRecording)
            return;
        const audioPath = this._audioRecorder.outputPath;
        if (!audioPath)
            return;

        this._isTickRunning = true;
        this._stats.ticks++;
        let snapshotPath = null;
        try {
            // Create a stable snapshot of the currently recording WAV to avoid reading a growing file
            try {
                const tmpDir = GLib.get_tmp_dir();
                snapshotPath = GLib.build_filenamev([tmpDir, `speech-panel-snapshot-${Date.now()}.wav`]);
                const src = Gio.File.new_for_path(audioPath);
                const dst = Gio.File.new_for_path(snapshotPath);
                // If file too small (< 4KB), skip this tick (likely header-only)
                const info = src.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                const size = info.get_size();
                if (!size || size < 2048) {
                    log('Snapshot skipped: recording file too small yet');
                    return;
                }
                // Copy with overwrite flag to ensure fresh snapshot
                src.copy(dst, Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch (copyErr) {
                log(`Snapshot copy failed: ${copyErr.message}`);
                return; // skip this tick if we cannot snapshot cleanly
            }

            // Transcribe the snapshot (stable file)
            const newText = await this._speechTranscriber.transcribe(snapshotPath);
            if (!newText || newText.length === 0)
                return;

            const suffix = this._computeNewSuffix(this._lastTranscribedText, newText);
            if (!suffix || suffix.trim().length === 0) {
                this._lastTranscribedText = newText; // still advance baseline
                return;
            }

            // Throttle extremely large suffixes
            const maxChunk = 160; // characters per insertion
            const chunk = suffix.length > maxChunk ? suffix.slice(0, maxChunk) : suffix;

            // Insert only the new part
            try {
                await this._textInserter.insertText(chunk, {silent: true});
                this._typedText += chunk;
                this._stats.charactersTyped += chunk.length;
                log(`Inserted incremental text (${chunk.length} chars)`);
                if (!this._notifiedFirstInsertion && this._notificationService?.enabled) {
                    this._notificationService.notifyInfo('Type As I Speak', `Typing… (${chunk.length} chars)`);
                    this._notifiedFirstInsertion = true;
                }
            } catch (e) {
                log(`Text insertion failed: ${e.message}`);
            }

            this._lastTranscribedText = newText;
        } catch (e) {
            log(`Transcription tick failed: ${e.message}`);
        } finally {
            // Clean up snapshot
            if (snapshotPath) {
                try {
                    const f = Gio.File.new_for_path(snapshotPath);
                    if (f.query_exists(null))
                        f.delete(null);
                } catch (delErr) {
                    log(`Snapshot cleanup failed: ${delErr.message}`);
                }
            }
            this._isTickRunning = false;
        }
    }

    _computeNewSuffix(oldText, newText) {
        if (!oldText)
            return newText;
        if (newText.startsWith(oldText))
            return newText.slice(oldText.length);

        // Whisper revises the unfinished tail while the recording grows. Do
        // not type a revised tail again: only accept a genuinely extended
        // transcript, otherwise live mode produces repeated words.
        if (oldText.startsWith(newText))
            return '';

        // A revision is safe only when the unchanged prefix reaches a word
        // boundary. The revised unfinished word must wait for a later pass.
        const minLen = Math.min(oldText.length, newText.length);
        let i = 0;
        for (; i < minLen; i++) {
            if (oldText[i] !== newText[i])
                break;
        }
        if (i === 0 || (i < oldText.length && !/\s/.test(oldText[i - 1])))
            return '';
        return newText.slice(i);
    }

    getStatistics() {
        return {
            enabled: this._enabled,
            ...this._stats,
        };
    }

    destroy() {
        log('Destroying TypeAsISpeakService...');
        this._stop();
        if (this._settingsConnId) {
            try { this._settingsManager.disconnect(this._settingsConnId); } catch (e) { log(`Settings disconnect failed: ${e.message}`); }
            this._settingsConnId = null;
        }
        log('TypeAsISpeakService destroyed');
    }
}
