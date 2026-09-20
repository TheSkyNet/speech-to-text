/* whisperStreamer.js
 *
 * Live streaming wrapper for whisper.cpp (no intermediate audio file).
 * Spawns the whisper.cpp streaming binary ("whisper-stream") and parses incremental
 * transcription output from stdout. Provides start/stop and partial callbacks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

function log(message) {
    try { console.log(`[WhisperStreamer] ${message}`); } catch (_) {}
}

export class WhisperStreamer {
    constructor(settingsManager, notificationService) {
        this._settingsManager = settingsManager;
        this._notificationService = notificationService;
        this._proc = null;
        this._stdoutStream = null;
        this._stdoutDataStream = null;
        this._stderrStream = null;
        this._stderrDataStream = null;
        this._onPartialCbs = new Set();
        this._onErrorCbs = new Set();
        this._onExitCbs = new Set();
        this._lastLine = '';
        this._isRunning = false;
        this._killed = false;
        this._expectedExit = false;
    }

    get isRunning() {
        return this._isRunning;
    }

    isAvailable() {
        return !!this._resolveStreamExecutable();
    }

    onPartial(callback) {
        this._onPartialCbs.add(callback);
        return () => this._onPartialCbs.delete(callback);
    }

    onError(callback) {
        this._onErrorCbs.add(callback);
        return () => this._onErrorCbs.delete(callback);
    }

    onExit(callback) {
        this._onExitCbs.add(callback);
        return () => this._onExitCbs.delete(callback);
    }

    async start(options = {}) {
        if (this._isRunning) {
            log('Already running; start() ignored');
            return;
        }
        this._killed = false;
        this._expectedExit = false;

        // Resolve streaming executable
        const execPath = this._resolveStreamExecutable();
        if (!execPath) {
            const msg = 'Whisper streaming binary not found (expected whisper-stream). Install SDL2 development files and build whisper.cpp with WHISPER_SDL2=ON.';
            log(msg);
            this._notificationService?.notifyImportant?.('Speech Panel — Stream unavailable', msg);
            throw new Error(msg);
        }

        // Resolve model path and language
        const modelName = this._safe(() => this._settingsManager.getString('whisper-model'), 'base');
        const language = this._safe(() => this._settingsManager.getString('whisper-language'), 'auto');
        const modelPath = this._getModelPath(modelName);
        if (!this._fileExists(modelPath)) {
            const msg = `Whisper model not found at: ${modelPath}`;
            if (this._notificationService?.enabled)
                this._notificationService.notifyError('Speech Panel — Stream', msg);
            throw new Error(msg);
        }

        // Build command args. The whisper.cpp stream example captures mic via SDL2.
        // Common flags: -m <model> -l <lang> (auto) -t <threads>
        // The installed machine has no usable GPU, so give the larger model
        // enough CPU workers to keep its rolling decode close to real time.
        const threads = Math.max(1, Math.min(16, this._guessThreadCount()));
        const args = [execPath, '-m', modelPath];
        if (language && language !== 'auto') {
            args.push('-l', language);
        }
        // Use the user's cadence for the stream audio window. This local
        // whisper-stream build requires the long option names and needs at
        // least one second of audio per decode.
        let stepMs = 1000;
        try {
            stepMs = Number(this._settingsManager.getDouble('type-as-i-speak-interval-ms'));
        } catch (_) {
            try { stepMs = Number(this._settingsManager.getInt('type-as-i-speak-interval-ms')); } catch (_) {}
        }
        if (!Number.isFinite(stepMs)) stepMs = 1000;
        stepMs = Math.max(1000, Math.min(100000, Math.round(stepMs)));
        // Keep three seconds of context while decoding every second. This
        // reduces first-result latency with the CPU-only base model while
        // retaining enough context for ordinary phrases.
        const lengthMs = Math.max(3000, Math.min(100000, stepMs * 3));
        const keepMs = Math.min(1000, Math.max(250, Math.floor(stepMs / 2)));
        args.push('-t', String(threads), '--step', String(stepMs),
            '--length', String(lengthMs), '--keep', String(keepMs));
        log(`Stream cadence: ${stepMs}ms (window=${lengthMs}ms, keep=${keepMs}ms)`);

        log(`Starting stream: ${args.join(' ')}`);

        try {
            this._proc = Gio.Subprocess.new(
                args,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            const msg = `Failed to start stream process: ${e.message}`;
            this._emitError(msg);
            throw new Error(msg);
        }

        this._stdoutStream = this._proc.get_stdout_pipe();
        this._stdoutDataStream = new Gio.DataInputStream({ base_stream: this._stdoutStream });
        this._stdoutDataStream.set_newline_type(Gio.DataStreamNewlineType.ANY);
        this._stderrStream = this._proc.get_stderr_pipe();
        this._stderrDataStream = new Gio.DataInputStream({ base_stream: this._stderrStream });
        this._stderrDataStream.set_newline_type(Gio.DataStreamNewlineType.ANY);
        this._isRunning = true;
        // Never use synchronous pipe reads from a GNOME Shell timeout: an
        // audio process can remain silent and block the shell main loop.
        this._readLinesAsync(this._stdoutDataStream, false);
        this._readLinesAsync(this._stderrDataStream, true);

        // Use Gio's async wait instead of GLib.child_watch_add. The latter
        // converts the subprocess identifier through a JS Number on this
        // GNOME/GJS build, producing huge-value warnings and destabilizing
        // the shell.
        this._proc.wait_check_async(null, (process, result) => {
            try {
                const successful = process.wait_check_finish(result);
                if (!this._expectedExit && !successful) {
                    log('Whisper stream stopped unexpectedly.');
                    this._emitError('Whisper stream stopped unexpectedly.');
                }
            } catch (error) {
                if (!this._expectedExit)
                    this._emitError(`Whisper stream wait failed: ${error.message}`);
            }
            this._cleanup(true);
            this._expectedExit = false;
        });
    }

    async stop() {
        if (!this._isRunning) return;
        try {
            this._killed = true;
            this._expectedExit = true;
            if (this._proc) {
                try { this._proc.send_signal(15); } catch (_) {}
                // Give it a moment, then force if needed
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    try { this._proc?.force_exit(); } catch (_) {}
                    return GLib.SOURCE_REMOVE;
                });
            }
        } finally {
            this._cleanup(false);
        }
    }

    _readLinesAsync(dataStream, isError) {
        if (!dataStream || !this._isRunning) return;
        try {
            dataStream.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
                if (!this._isRunning) return;
                try {
                    const [line, length] = stream.read_line_finish_utf8(result);
                    if (line !== null && length > 0) {
                        if (isError) {
                            log(`whisper-stream: ${line}`);
                        } else {
                            const text = this._parseStreamOutputLine(line);
                            if (text && text.trim().length > 0)
                                this._emitPartial(text);
                        }
                    }
                    if (line !== null)
                        this._readLinesAsync(stream, isError);
                } catch (e) {
                    if (!this._killed)
                        this._emitError(`${isError ? 'stderr' : 'stdout'} read error: ${e.message}`);
                }
            });
        } catch (e) {
            if (!this._killed) {
                this._emitError(`${isError ? 'stderr' : 'stdout'} read error: ${e.message}`);
            }
        }
    }

    _parseStreamOutputLine(line) {
        // SDL/whisper-stream redraws its current transcript with ANSI
        // clear-line sequences. Keep only the newest redraw so terminal
        // control characters and superseded partials are never typed.
        let s = (line || '').toString().replace(/\r/g, '');
        const redraws = s.split(/\x1b\[2K/);
        if (redraws.length > 1)
            s = redraws[redraws.length - 1];

        // Remove ANSI CSI sequences and remaining non-printing controls.
        s = s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .trim();

        // Filter obvious progress / debug lines
        if (!s) return '';
        if (/^\[(?:BLANK_AUDIO|Start speaking)\]$/i.test(s)) return '';
        if (/^\d+%/.test(s)) return '';
        if (/^(?:progress|info|warn|error|init|main|system_info|whisper_|ggml_)/i.test(s))
            return '';
        if (/^(?:.+\s+time|load time|sample time|encode time|decode time|total time)\s*=/i.test(s))
            return '';
        // Remove typical timestamp prefix if present
        s = s.replace(/^\[[^\]]+\]\s*/, '');
        // Remove leading speaker tags like (user):
        s = s.replace(/^\([^)]*\):\s*/, '');
        return s;
    }

    _emitPartial(text) {
        // De-dup and ignore regressions (some builds output shorter backtracks)
        if (this._lastLine) {
            if (text === this._lastLine) return;
            if (this._lastLine.startsWith(text)) return; // regression or duplicate prefix
        }
        this._lastLine = text;
        for (const cb of this._onPartialCbs) {
            try { cb(text); } catch (e) { log(`partial callback error: ${e.message}`); }
        }
    }

    _emitError(message) {
        log(message);
        for (const cb of this._onErrorCbs) {
            try { cb(message); } catch (e) { log(`error callback error: ${e.message}`); }
        }
        if (this._notificationService?.enabled) {
            try {
                const visibleMessage = String(message).replace(/\s+/g, ' ').trim().slice(0, 120);
                this._notificationService.notifyError('Speech Panel — Stream error', visibleMessage);
            } catch (_) {}
        }
    }

    _cleanup(exited) {
        this._stdoutDataStream = null;
        this._stdoutStream = null;
        this._stderrDataStream = null;
        this._stderrStream = null;
        const wasKilled = !!this._killed;
        this._isRunning = false;
        if (exited) {
            log('Stream process exited');
        } else {
            log('Stream process stopped');
        }
        // Notify listeners about exit; indicate if unexpected
        try {
            const unexpected = exited && !wasKilled;
            for (const cb of this._onExitCbs) {
                try { cb({ unexpected }); } catch (e) { log(`exit callback error: ${e.message}`); }
            }
        } catch (_) {}
        // Keep expected-exit state until child_watch runs; otherwise a normal
        // user stop is incorrectly reported as an unexpected status -1 exit.
        this._killed = false;
    }

    _resolveStreamExecutable() {
        try {
            // 0) Explicit env override (for CI/dev): SPEECH_PANEL_STREAM_BIN
            try {
                const envBin = GLib.getenv('SPEECH_PANEL_STREAM_BIN');
                if (envBin && this._fileExists(envBin)) return envBin;
            } catch (_) {}

            // 1) User setting (often points to whisper-cli). Try sibling
            // 'whisper-stream', the current whisper.cpp target name.
            const exe = this._safe(() => this._settingsManager.getString('whisper-executable'), '');
            const resolved = this._expandPath(exe);
            if (resolved && resolved.endsWith('whisper-cli')) {
                const candidate = resolved.replace(/whisper-cli$/, 'whisper-stream');
                if (this._fileExists(candidate)) return candidate;
            }
            // If setting is a bare program name (e.g., 'whisper-cli'), resolve via PATH
            if (resolved && !resolved.startsWith('/') && resolved.length > 0) {
                const inPath = GLib.find_program_in_path ? GLib.find_program_in_path(resolved) : null;
                if (inPath && inPath.endsWith('whisper-cli')) {
                    const sibling = inPath.replace(/whisper-cli$/, 'whisper-stream');
                    if (this._fileExists(sibling)) return sibling;
                }
                if (inPath && inPath.endsWith('/whisper-stream') && this._fileExists(inPath))
                    return inPath;
            }

            // 2) Known install paths (primary and legacy)
            const home = GLib.get_home_dir();
            const candidates = [
                GLib.build_filenamev([home, 'apps', 'whisper.cpp', 'build', 'bin', 'whisper-stream']),
                GLib.build_filenamev([home, 'apps', 'whisper.cpp', 'examples', 'stream', 'whisper-stream']),
                // Alternate fallback repo used by manage.sh when local build fails
                GLib.build_filenamev([home, 'apps', 'whisper-stream-fallback', 'build', 'bin', 'whisper-stream']),
                GLib.build_filenamev([home, 'apps', 'whisper-stream-fallback', 'build', 'examples', 'stream', 'whisper-stream']),
                GLib.build_filenamev([home, 'apps', 'whisper-stream-fallback', 'examples', 'stream', 'whisper-stream'])
            ];
            for (const c of candidates) {
                if (this._fileExists(c)) return c;
            }

            // 3) If the setting already points to a whisper-stream path
            if (resolved && resolved.endsWith('/whisper-stream') && this._fileExists(resolved))
                return resolved;

            // Never use a bare PATH entry named "stream": Ubuntu commonly
            // provides ImageMagick's unrelated image-conversion command under
            // that name. Only a whisper.cpp stream binary is valid here.
        } catch (e) {
            log(`resolve stream exec error: ${e.message}`);
        }
        return null;
    }

    _getModelPath(modelName) {
        // Common model directory under whisper.cpp
        const home = GLib.get_home_dir();
        const base = GLib.build_filenamev([home, 'apps', 'whisper.cpp', 'models']);
        // Typical filenames: ggml-base.bin, ggml-small.bin, etc.
        const fileName = `ggml-${modelName}.bin`;
        const path = GLib.build_filenamev([base, fileName]);
        return path;
    }

    _expandPath(path) {
        if (!path) return path;
        if (path.startsWith('~')) {
            return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
        }
        return path;
    }

    _fileExists(path) {
        try {
            const f = Gio.File.new_for_path(path);
            return f.query_exists(null);
        } catch (_) {
            return false;
        }
    }

    _guessThreadCount() {
        try {
            const n = GLib.get_num_processors ? GLib.get_num_processors() : 4;
    
            if (typeof n === 'number' && n > 0) return n; 
        } catch (_) {}
        return 4;
    }

    _safe(fn, fallback) {
        try { return fn(); } catch (_) { return fallback; }
    }
}
