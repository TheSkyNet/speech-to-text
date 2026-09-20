/* logService.js
 *
 * Application-wide activity logging and lightweight telemetry for Speech Panel.
 * Observes StateManager transitions and provides structured logs and metrics.
 * Designed following SOLID principles: single responsibility and explicit deps.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {log as loggerLog, debug as loggerDebug, warn as loggerWarn, error as loggerError} from './logger.js';

function log(msg) { loggerLog(msg, 'LogService'); }
function debug(msg) { loggerDebug(msg, 'LogService'); }
function warn(msg) { loggerWarn(msg, 'LogService'); }
function err(msg) { loggerError(msg, 'LogService'); }

export class LogService {
    /**
     * @param {ISettingsManager} settingsManager
     * @param {IStateManager} stateManager
     */
    constructor(settingsManager, stateManager) {
        this._settingsManager = settingsManager;
        this._stateManager = stateManager;
        this._stateCbId = null;
        this._metrics = {
            sessions: 0,
            processingRuns: 0,
            lastSessionStart: 0,
            lastSessionEnd: 0,
            totalListeningMs: 0,
            totalProcessingMs: 0,
            lastError: '',
        };
        this._lastTimestamps = { listening: 0, processing: 0 };
        this._context = { services: null, ui: null };
        this._sessionUuid = null;

        this._wire();
        log('LogService initialized');
    }

    _wire() {
        try {
            this._stateCbId = this._stateManager.onStateChanged((state, prev) => this._onStateChanged(state, prev));
            debug('Subscribed to StateManager changes');
        } catch (e) {
            err(`Failed to subscribe to StateManager: ${e.message}`);
        }
    }

    attachContext(services, uiIndicator = null) {
        this._context.services = services || null;
        this._context.ui = uiIndicator || null;
        debug('Context attached');
    }

    _onStateChanged(newState, previousState) {
        const ts = Date.now();
        debug(`State: ${previousState} -> ${newState}`);
        // Session boundaries
        if (newState === 'listening') {
            this._metrics.sessions++;
            this._metrics.lastSessionStart = ts;
            this._sessionUuid = this._genSessionId();
            this._lastTimestamps.listening = ts;
            this._emitEvent('session', 'start', { sessionId: this._sessionUuid });
        }
        if (previousState === 'listening' && newState !== 'listening') {
            const start = this._lastTimestamps.listening || ts;
            this._metrics.totalListeningMs += Math.max(0, ts - start);
            this._metrics.lastSessionEnd = ts;
        }
        if (newState === 'processing') {
            this._metrics.processingRuns++;
            this._lastTimestamps.processing = ts;
        }
        if (previousState === 'processing' && newState !== 'processing') {
            const start = this._lastTimestamps.processing || ts;
            this._metrics.totalProcessingMs += Math.max(0, ts - start);
        }
        // Structured line
        this._emitEvent('state', 'transition', { previous: previousState, next: newState });
    }

    record(scope, action, data = null) {
        this._emitEvent(scope, action, data);
    }

    recordError(message, data = null) {
        this._metrics.lastError = String(message || '');
        this._emitEvent('error', 'runtime', { message, ...(data || {}) });
    }

    getMetrics() {
        // Return a shallow copy to avoid external mutation
        return { ...this._metrics };
    }

    getStatusSnapshot() {
        // Lightweight snapshot of app state for debugging
        const now = Date.now();
        const services = this._context.services ? Object.keys(this._context.services) : [];
        let state = 'unknown';
        try { state = this._stateManager.getState(); } catch (_) {}
        return {
            sessionId: this._sessionUuid,
            state,
            services,
            metrics: this.getMetrics(),
            now,
        };
    }

    exportLogToDesktop(extraLines = []) {
        try {
            const desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
            const filePath = GLib.build_filenamev([desktopDir, 'speech-panel-activity.log']);
            const file = Gio.File.new_for_path(filePath);
            let stream;
            try { stream = file.append_to(Gio.FileCreateFlags.NONE, null); } catch (_) { stream = file.create(Gio.FileCreateFlags.NONE, null); }
            const dataStream = new Gio.DataOutputStream({ base_stream: stream });
            const header = `\n=== Activity Snapshot @ ${new Date().toISOString()} ===\n`;
            dataStream.put_string(header, null);
            const snap = this.getStatusSnapshot();
            dataStream.put_string(JSON.stringify(snap, null, 2) + '\n', null);
            for (const line of extraLines) dataStream.put_string(String(line) + '\n', null);
            dataStream.close(null);
            log(`Exported activity snapshot to ${filePath}`);
            return filePath;
        } catch (e) {
            err(`Export snapshot failed: ${e.message}`);
            return null;
        }
    }

    destroy() {
        if (this._stateCbId) {
            try { this._stateManager.removeCallback(this._stateCbId); } catch (_) {}
            this._stateCbId = null;
        }
        debug('LogService destroyed');
    }

    _emitEvent(scope, action, data) {
        const payload = {
            ts: new Date().toISOString(),
            session: this._sessionUuid,
            scope: String(scope || ''),
            action: String(action || ''),
            ...((data && typeof data === 'object') ? data : { value: data })
        };
        // Emit as JSON at INFO level for easy grepping
        loggerLog(JSON.stringify(payload), 'AppEvent');
    }

    _genSessionId() {
        // Simple random base36 id
        try { return Math.random().toString(36).slice(2, 10) + '-' + GLib.get_monotonic_time().toString(36); }
        catch (_) { return Math.random().toString(36).slice(2, 10); }
    }
}
