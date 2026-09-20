/* typeAsIStreamService.js
 *
 * New streaming service for "Type As You Stream" mode.
 * Streams microphone audio directly to whisper.cpp streaming binary and
 * inserts transcribed text live as you speak. No audio file is recorded.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import {log as loggerLog, debug as loggerDebug} from './logger.js';
import {WhisperStreamer} from './whisperStreamer.js';

function log(message) {
    loggerLog(message, 'TypeAsIStreamService');
}
function debug(message) {
    loggerDebug(message, 'TypeAsIStreamService');
}

export class TypeAsIStreamService {
    /**
     * @param {Object} deps
     * @param {ISettingsManager} deps.settingsManager
     * @param {IStateManager} deps.stateManager
     * @param {ITextInserter} deps.textInserter
     * @param {INotificationService} deps.notificationService
     * @param {IDingService} deps.dingService
     */
    constructor({ settingsManager, stateManager, textInserter, notificationService, dingService = null }) {
        this._settingsManager = settingsManager;
        this._stateManager = stateManager;
        this._textInserter = textInserter;
        this._notificationService = notificationService;
        this._dingService = dingService;

        this._streamer = new WhisperStreamer(settingsManager, notificationService);
        this._partialUnsub = null;
        this._errorUnsub = null;
        this._exitUnsub = null;
        this._lastText = '';
        this._typedSoFar = '';
        this._enabledSetting = false;
        this._connectedSettingId = null;
        this._stats = { started: 0, stopped: 0, chars: 0 };
        this._userStopping = false;
        this._sessionId = null;
        this._sessionStart = 0;

        // Micro-batching / coalescing to reduce jank
        this._pendingBuffer = '';
        this._flushPromise = Promise.resolve();
        this._recentSegments = new Map();
        this._flushTimerId = null;
        this._MIN_CHUNK = 1;      // type the first stable character immediately
        this._FLUSH_DELAY = 10;   // minimal debounce for partials
        this._MAX_CHUNK = 220;    // cap per insertion
        this._STABILIZE_MS = 0;   // do not hold speech behind a stabilization window
        this._lastPartialTs = 0;

        // Settings connections
        this._tuningConnIds = [];
        try {
            this._connectedSettingId = this._settingsManager.connect('type-as-i-speak-stream-enabled', () => {
                this._applyEnabledFromSettings();
            });
            // Tuning keys for smoother experience
            this._tuningConnIds.push(
                this._settingsManager.connect('stream-min-chunk', () => this._loadTuningFromSettings()),
                this._settingsManager.connect('stream-flush-delay', () => this._loadTuningFromSettings()),
                this._settingsManager.connect('stream-max-chunk', () => this._loadTuningFromSettings()),
                this._settingsManager.connect('stream-stabilize-ms', () => this._loadTuningFromSettings()),
            );
        } catch (e) {
            log(`Failed to connect settings: ${e.message}`);
        }
        this._applyEnabledFromSettings();
        this._loadTuningFromSettings();
    }

    get isActive() {
        return this._streamer?.isRunning || false;
    }

    isAvailable() {
        return this._streamer?.isAvailable?.() || false;
    }

    get typedText() {
        return this._typedSoFar || '';
    }

    _applyEnabledFromSettings() {
        let val = false;
        try { val = this._settingsManager.getBoolean('type-as-i-speak-stream-enabled'); } catch (_) { val = false; }
        this._enabledSetting = !!val;
        log(`Stream setting: ${this._enabledSetting}`);
        // Do not auto-start; start() is controlled by hotkey via UI
    }

    async start() {
        if (!this._enabledSetting) {
            const msg = 'Stream mode disabled in Preferences';
            log(msg);
            if (this._notificationService?.enabled)
                this._notificationService.notifyInfo('Type As You Stream', msg);
            return;
        }
        if (this.isActive) {
            log('Stream already active');
            return;
        }
        this._lastText = '';
        this._typedSoFar = '';
        this._pendingBuffer = '';
        this._flushPromise = Promise.resolve();
        this._recentSegments.clear();
        if (this._flushTimerId) { try { GLib.source_remove(this._flushTimerId); } catch (_) {} this._flushTimerId = null; }

        // Subscribe to partial updates
        this._partialUnsub = this._streamer.onPartial((text) => {
            this._handlePartial(text).catch(e => log(`Partial handling error: ${e.message}`));
        });
        this._errorUnsub = this._streamer.onError((msg) => {
            log(`Streamer error: ${msg}`);
        });
        // Do not restart a native audio process automatically. A broken SDL
        // or audio backend must not create a restart loop or destabilize the
        // GNOME Shell session.
        this._exitUnsub = this._streamer.onExit(({ unexpected }) => {
            if (unexpected && !this._userStopping && this._enabledSetting) {
                const msg = 'Whisper stream stopped. Stream mode remains selected; click Start to try again.';
                log(msg);
                try {
                    if (this._stateManager.isListening)
                        this._stateManager.setState('idle');
                } catch (e) {
                    log(`Could not recover idle state: ${e.message}`);
                }
                this._notificationService?.notifyImportant?.('Type As You Stream stopped', msg);
            }
        });

        // Set state and start streaming. Roll back the visible state if the
        // executable or model cannot be started, otherwise the next click is
        // incorrectly treated as a stop.
        try {
            this._stateManager.setState('listening');
            await this._streamer.start();
        } catch (e) {
            try {
                if (this._stateManager.isListening)
                    this._stateManager.setState('idle');
            } catch (stateError) {
                log(`State rollback failed: ${stateError.message}`);
            }
            if (this._partialUnsub) { this._partialUnsub(); this._partialUnsub = null; }
            if (this._errorUnsub) { this._errorUnsub(); this._errorUnsub = null; }
            if (this._exitUnsub) { this._exitUnsub(); this._exitUnsub = null; }
            throw e;
        }
        this._stats.started++;
        if (this._notificationService?.enabled) {
            this._notificationService.notifyInfo('🎤 Type As You Stream', 'Listening… (press the hotkey again to stop)');
        }
        this._dingService?.playFeedback('recording');
    }

    async stop() {
        if (!this.isActive) {
            log('Stream not active');
            // Still flush any pending buffer just in case
            this._flushPending(true).catch(() => {});
            try {
                if (this._stateManager.isListening)
                    this._stateManager.setState('idle');
            } catch (e) {
                log(`Idle state recovery failed: ${e.message}`);
            }
            return;
        }
        this._userStopping = true;
        try {
            // Flush before stopping to avoid losing last words
            await this._flushPending(true);
            await this._streamer.stop();
        } catch (e) {
            log(`Stop error: ${e.message}`);
        }

        if (this._partialUnsub) { try { this._partialUnsub(); } catch (_) {} this._partialUnsub = null; }
        if (this._errorUnsub) { try { this._errorUnsub(); } catch (_) {} this._errorUnsub = null; }
        if (this._exitUnsub) { try { this._exitUnsub(); } catch (_) {} this._exitUnsub = null; }
        if (this._flushTimerId) { try { GLib.source_remove(this._flushTimerId); } catch (_) {} this._flushTimerId = null; }
        this._stats.stopped++;
        try {
            this._stateManager.setState('idle');
        } catch (e) { log(`State set failed: ${e.message}`); }

        // Detailed stop stats
        log(`Stopped stream. Stats: started=${this._stats.started}, stopped=${this._stats.stopped}, charsTyped=${this._stats.chars}, pendingBufferLen=${(this._pendingBuffer||'').length}`);

        if (this._notificationService?.enabled) {
            this._notificationService.notifyInfo('Type As You Stream', 'Stopped');
        }
        this._dingService?.playFeedback('complete');
        this._userStopping = false;
    }

    async _handlePartial(newText) {
        if (!newText) return;

        newText = newText.replace(/\s+/g, ' ').trim();
        if (!newText) return;

        // whisper-stream can print the same completed segment more than once
        // while it redraws its console status line. Do not type it twice.
        const now = Date.now();
        const seenAt = this._recentSegments.get(newText);
        if (seenAt && now - seenAt < 15000)
            return;
        this._recentSegments.set(newText, now);
        for (const [segment, timestamp] of this._recentSegments) {
            if (now - timestamp > 15000)
                this._recentSegments.delete(segment);
        }

        // Compute new suffix relative to last seen text
        const suffix = this._computeSuffix(this._lastText, newText);
        this._lastText = newText;
        if (!suffix || suffix.trim().length === 0) return;

        // Smart spacing: if last typed does not end with space and suffix starts with alnum, prepend space
        let add = suffix;
        const needSpace = /\S$/.test(this._typedSoFar || '') && /^[A-Za-z0-9]/.test(add);
        if (needSpace && !/^\s/.test(add)) add = ' ' + add;

        // Accumulate into pending buffer
        this._pendingBuffer += add;

        // Flush heuristics: flush immediately on sentence end or when buffer is big enough
        const endsSentence = /[\.!?]\s*$/.test(this._pendingBuffer);
        const endsWithSpace = /\s$/.test(this._pendingBuffer);
        if (endsSentence || this._pendingBuffer.length >= this._MIN_CHUNK) {
            // If ends with whole word or space, flush immediately; else debounce with stabilization
            if (endsSentence || endsWithSpace) {
                await this._flushPending(false);
            } else {
                // Reset existing timer to honor stabilization window on fresh partial
                if (this._flushTimerId) { try { GLib.source_remove(this._flushTimerId); } catch (_) {} this._flushTimerId = null; }
                const delay = Math.max(this._FLUSH_DELAY, this._STABILIZE_MS);
                this._ensureFlushTimer(delay);
            }
        } else {
            // Not enough content yet; schedule with stabilization
            if (this._flushTimerId) { try { GLib.source_remove(this._flushTimerId); } catch (_) {} this._flushTimerId = null; }
            const delay = Math.max(this._FLUSH_DELAY, this._STABILIZE_MS);
            this._ensureFlushTimer(delay);
        }
    }

    _computeSuffix(prev, next) {
        if (!prev) return next;
        if (next.startsWith(prev)) return next.slice(prev.length);

        // A changed tail is normally Whisper revising an unfinished phrase.
        // Never type the divergent tail: it would duplicate words already
        // inserted from the previous revision.
        const prevWords = prev.split(/\s+/);
        const nextWords = next.split(/\s+/);
        let common = 0;
        while (common < prevWords.length &&
               common < nextWords.length &&
               prevWords[common] === nextWords[common])
            common++;
        if (common > 0)
            return '';

        // No shared words means this is a new completed stream segment.
        return next;
    }

    _loadTuningFromSettings() {
        try {
            let minChunk = 1;
            let flushDelay = 10;
            let maxChunk = 220;
            let stabilize = 0;
            try { minChunk = this._settingsManager.getInt('stream-min-chunk'); } catch (_) {}
            try { flushDelay = this._settingsManager.getInt('stream-flush-delay'); } catch (_) {}
            try { maxChunk = this._settingsManager.getInt('stream-max-chunk'); } catch (_) {}
            try { stabilize = this._settingsManager.getInt('stream-stabilize-ms'); } catch (_) {}
            // Clamp bounds defensively
            if (!(minChunk >= 1 && minChunk <= 20)) minChunk = 1;
            if (!(flushDelay >= 0 && flushDelay <= 250)) flushDelay = 10;
            if (!(maxChunk >= 40 && maxChunk <= 400)) maxChunk = 220;
            if (!(stabilize >= 0 && stabilize <= 400)) stabilize = 0;
            this._MIN_CHUNK = minChunk;
            this._FLUSH_DELAY = flushDelay;
            this._MAX_CHUNK = maxChunk;
            this._STABILIZE_MS = stabilize;
            debug(`Tuning: min=${this._MIN_CHUNK}, delay=${this._FLUSH_DELAY}ms, max=${this._MAX_CHUNK}, stabilize=${this._STABILIZE_MS}ms`);
            // If a timer exists, let it finish; we will re-arm on next partial arrival
        } catch (e) {
            log(`Failed to load tuning settings: ${e.message}`);
        }
    }

    _ensureFlushTimer(delayMs) {
        if (this._flushTimerId) return;
        const d = Math.max(5, Math.floor(typeof delayMs === 'number' ? delayMs : this._FLUSH_DELAY));
        this._flushTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, d, () => {
            this._flushPending(false).catch(e => log(`Flush error: ${e.message}`));
            this._flushTimerId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    async _flushPending(force) {
        this._flushPromise = this._flushPromise.then(async () => {
            if (!this._pendingBuffer || this._pendingBuffer.length === 0) return;
            const text = this._pendingBuffer;
            if (!force && text.length < this._MIN_CHUNK && !/[\s\.!?,]$/.test(text)) {
                this._ensureFlushTimer();
                return;
            }
            const chunk = text.length > this._MAX_CHUNK ? text.slice(0, this._MAX_CHUNK) : text;
            try {
                await this._textInserter.insertText(chunk, {silent: true});
                this._typedSoFar += chunk;
                this._stats.chars += chunk.length;
                this._pendingBuffer = this._pendingBuffer.slice(chunk.length);
            } catch (e) {
                log(`Insert failed: ${e.message}`);
            }
        });
        return this._flushPromise;
    }

    destroy() {
        try { this.stop(); } catch (_) {}
        if (this._connectedSettingId) {
            try { this._settingsManager.disconnect(this._connectedSettingId); } catch (_) {}
            this._connectedSettingId = null;
        }
        if (Array.isArray(this._tuningConnIds)) {
            for (const id of this._tuningConnIds) {
                try { this._settingsManager.disconnect(id); } catch (_) {}
            }
            this._tuningConnIds = [];
        }
    }
}
