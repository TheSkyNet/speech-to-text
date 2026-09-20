/* logger.js
 *
 * Centralized logging utility for Speech Panel extension
 * - Controlled by debug-mode GSetting or temporary test logging window
 * - Supports levels: DEBUG, INFO, WARN, ERROR and per-scope tagging
 * - Appends logs to a Desktop file (speech-panel.log) in addition to console
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

let _settingsManager = null;
let _testLoggingUntil = 0; // epoch ms until which test logging is enabled
let _level = 1; // 0=DEBUG,1=INFO,2=WARN,3=ERROR
let _settingsConnId = null;

const LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

function _now() { return Date.now(); }

function _desktopLogFilePath() {
    try {
        const desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
        return GLib.build_filenamev([desktopDir, 'speech-panel.log']);
    } catch (e) {
        // Fallback to home directory if Desktop is not available
        return GLib.build_filenamev([GLib.get_home_dir(), 'speech-panel.log']);
    }
}

function _appendToFile(line) {
    try {
        const filePath = _desktopLogFilePath();
        const file = Gio.File.new_for_path(filePath);
        let stream;
        try {
            stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        } catch (e) {
            stream = file.create(Gio.FileCreateFlags.NONE, null);
        }
        const dataStream = new Gio.DataOutputStream({ base_stream: stream });
        dataStream.put_string(line + '\n', null);
        dataStream.close(null);
    } catch (e) {
        try { console.error('[Logger] Failed to write to Desktop log:', e.message); } catch (_) {}
    }
}

function _shouldLogLevel(level) {
    // Gate by debug/test flag: if neither debug-mode nor test window are active, only WARN/ERROR are emitted
    const testActive = _now() < _testLoggingUntil;
    let debugEnabled = false;
    try { debugEnabled = _settingsManager ? _settingsManager.getBoolean('debug-mode') : false; } catch (_) { debugEnabled = false; }

    // Determine active threshold
    const threshold = debugEnabled || testActive ? _level : Math.max(_level, LEVELS.WARN);
    return level >= threshold ? true : false;
}

function _format(scope, levelName, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${scope}] [${levelName}] ${message}`;
}

/**
 * Initialize the logger with SettingsManager so we can react to debug-mode changes.
 * Safe to call multiple times; last provided instance is used.
 * @param {ISettingsManager} settingsManager
 */
export function init(settingsManager) {
    _settingsManager = settingsManager;
    // Default level: INFO; elevate to DEBUG if debug-mode is true
    try {
        const dbg = _settingsManager.getBoolean('debug-mode');
        _level = dbg ? LEVELS.DEBUG : LEVELS.INFO;
        // React to changes dynamically
        if (_settingsConnId) {
            try { _settingsManager.disconnect(_settingsConnId); } catch (_) {}
            _settingsConnId = null;
        }
        _settingsConnId = _settingsManager.connect('debug-mode', () => {
            try {
                const d = _settingsManager.getBoolean('debug-mode');
                setLevel(d ? 'DEBUG' : 'INFO');
                // Also note this in the log immediately if allowed
                if (_shouldLogLevel(LEVELS.INFO)) info(`debug-mode changed => level=${d ? 'DEBUG' : 'INFO'}`);
            } catch (_) {}
        });
    } catch (_) {
        // ignore
    }
}

/** Temporarily enable verbose logging for tests (e.g., when user presses a test button). */
export function enableTestLogging(durationMs = 5 * 60 * 1000) {
    _testLoggingUntil = Math.max(_testLoggingUntil, _now() + durationMs);
}

/** Returns whether any logs would be emitted at INFO level now. */
export function isEnabled() {
    return _shouldLogLevel(LEVELS.INFO);
}

export function setLevel(levelName) {
    const name = String(levelName || 'INFO').toUpperCase();
    if (LEVELS[name] === undefined) return;
    _level = LEVELS[name];
}

export function getLevel() {
    for (const [k, v] of Object.entries(LEVELS)) if (v === _level) return k;
    return 'INFO';
}

// Backward-compatible log() as INFO
export function log(message, scope = 'SpeechPanel') {
    if (!_shouldLogLevel(LEVELS.INFO)) return;
    const line = _format(scope, 'INFO', message);
    try { console.log(line); } catch (_) {}
    _appendToFile(line);
}

export function debug(message, scope = 'SpeechPanel') {
    if (!_shouldLogLevel(LEVELS.DEBUG)) return;
    const line = _format(scope, 'DEBUG', message);
    try { console.log(line); } catch (_) {}
    _appendToFile(line);
}

export function info(message, scope = 'SpeechPanel') { return log(message, scope); }

export function warn(message, scope = 'SpeechPanel') {
    if (!_shouldLogLevel(LEVELS.WARN)) return;
    const line = _format(scope, 'WARN', message);
    try { console.warn(line); } catch (_) { try { console.log(line); } catch (_) {} }
    _appendToFile(line);
}

export function error(message, scope = 'SpeechPanel') {
    if (!_shouldLogLevel(LEVELS.ERROR)) return;
    const line = _format(scope, 'ERROR', message);
    try { console.error(line); } catch (_) { try { console.log(line); } catch (_) {} }
    _appendToFile(line);
}
