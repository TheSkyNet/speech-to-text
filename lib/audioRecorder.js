/* audioRecorder.js
 * 
 * Audio recording implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only audio recording
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {IAudioRecorder} from './interfaces.js';

function log(message) {
    console.log(`[AudioRecorder] ${message}`);
}

/**
 * Audio recorder implementation using system audio tools
 * Implements IAudioRecorder interface following Single Responsibility Principle
 */
export class AudioRecorder extends IAudioRecorder {
    constructor(settingsManager, notificationService, textToSpeechService = null) {
        super();
        this._settingsManager = settingsManager;
        this._notificationService = notificationService;
        this._textToSpeechService = textToSpeechService;
        this._isRecording = false;
        this._recordingProcess = null;
        this._recordingTimeout = null;
        this._recordingCompletion = null;
        this._resolveRecordingCompletion = null;
        this._outputPath = null;
    }

    /**
     * Start recording audio to specified path
     * @param {string} outputPath - Path to save the recording
     * @param {Object} settings - Recording settings (optional, will use settings manager if not provided)
     * @returns {Promise<void>}
     */
    async startRecording(outputPath, settings = null) {
        log('Starting audio recording...');
        
        if (this._isRecording) {
            log('Already recording, ignoring request');
            throw new Error('Recording already in progress');
        }

        this._outputPath = outputPath;
        this._isRecording = true;

        try {
            // Get audio settings
            const audioSettings = {...(settings || this._getAudioSettings())};
            const skipTimeout = this._shouldSkipRecordingTimeout();
            audioSettings.unlimited = skipTimeout;
            
            // Build recording command
            const recordCmd = this._buildRecordingCommand(outputPath, audioSettings);
            log(`Recording command: ${recordCmd.join(' ')}`);

            // Start recording process
            const [success, pid] = GLib.spawn_async(
                null, // working directory
                recordCmd,
                null, // environment
                GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null // child setup function
            );

            if (!success) {
                this._isRecording = false;
                throw new Error('Failed to start recording process');
            }

            this._recordingProcess = pid;
            this._recordingCompletion = new Promise(resolve => {
                this._resolveRecordingCompletion = resolve;
            });
            log(`Recording started with PID: ${pid}`);

            // Set up process monitoring
            GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => {
                this._onRecordingFinished();
            });

            // Set automatic timeout (unless Type-As-I-Speak modes are enabled)
            if (!skipTimeout) {
                const maxDuration = audioSettings.maxDuration || this._settingsManager.getInt('max-recording-duration');
                this._recordingTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, maxDuration, () => {
                    if (this._isRecording) {
                        log(`Recording stopped automatically after ${maxDuration} seconds`);
                        this.stopRecording().catch(error => {
                            console.error('Error during automatic stop:', error);
                        });
                        if (this._notificationService.enabled) {
                            this._notificationService.notify('Speech Panel', `Recording stopped automatically after ${maxDuration} seconds`);
                        }
                    }
                    this._recordingTimeout = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                log('Skipping automatic recording timeout due to Type-As-I-Speak mode');
            }

        } catch (error) {
            this._isRecording = false;
            this._recordingProcess = null;
            this._resolveRecordingCompletion?.();
            this._recordingCompletion = null;
            this._resolveRecordingCompletion = null;
            log(`Recording error: ${error.message}`);
            
            if (this._notificationService.enabled) {
                this._notificationService.notify('Speech Panel', `Recording error: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Stop recording audio
     * @returns {Promise<void>}
     */
    async stopRecording() {
        if (!this._isRecording) {
            log('No active recording to stop');
            return;
        }

        log('Stopping audio recording...');

        // Clean up recording timeout
        if (this._recordingTimeout) {
            GLib.source_remove(this._recordingTimeout);
            this._recordingTimeout = null;
        }

        const recordingCompletion = this._recordingCompletion;

        // For duration-limited recordings, we can terminate early if needed
        if (this._recordingProcess) {
            try {
                // Send SIGTERM for graceful shutdown (non-blocking)
                GLib.spawn_command_line_async(`kill -TERM ${this._recordingProcess}`);
                log('Recording process termination requested');
            } catch (error) {
                log(`Recording process may have already finished: ${error.message}`);
            }
        }

        // Mark as not recording (the process monitor will handle cleanup)
        this._isRecording = false;
        if (recordingCompletion) {
            await recordingCompletion;
        }
        log('Recording stopped');
    }

    /**
     * Check if currently recording
     * @returns {boolean}
     */
    get isRecording() {
        return this._isRecording;
    }

    /**
     * Get maximum recording duration
     * @returns {number} Duration in seconds
     */
    get maxDuration() {
        return this._settingsManager.getInt('max-recording-duration');
    }

    /**
     * Get output path of current/last recording
     * @returns {string|null}
     */
    get outputPath() {
        return this._outputPath;
    }

    /**
     * Play audio file using TTS service
     * @param {string} audioPath - Path to audio file to play
     * @returns {Promise<Object>} Playback result
     */
    async playAudio(audioPath) {
        log(`Playing recorded audio: ${audioPath}`);
        
        if (!this._textToSpeechService) {
            return {
                success: false,
                message: 'Audio playback not available (TTS service not injected)'
            };
        }

        if (!this._checkFileExists(audioPath)) {
            return {
                success: false,
                message: `Audio file not found: ${audioPath}`
            };
        }

        try {
            await this._textToSpeechService.playAudio(audioPath);
            return {
                success: true,
                message: 'Audio playback completed successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: `Audio playback failed: ${error.message}`
            };
        }
    }

    /**
     * Test microphone functionality with recording and playback
     * @returns {Promise<Object>} Test result with success flag and message
     */
    async testMicrophone() {
        log('Testing microphone with recording and playback...');
        
        // Decide where to store the test file based on debug mode
        const debugMode = this._settingsManager.getBoolean('debug-mode');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let testAudioFile;
        if (debugMode) {
            const desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DESKTOP);
            testAudioFile = GLib.build_filenamev([desktopDir, `microphone_test_${timestamp}.wav`]);
        } else {
            const tmpDir = GLib.get_tmp_dir();
            testAudioFile = GLib.build_filenamev([tmpDir, `speech-panel-mic-test-${timestamp}.wav`]);
        }
        
        const result = {
            success: false,
            message: '',
            details: {
                recordingSuccessful: false,
                playbackSuccessful: false,
                fileSize: 0,
                recordingDuration: 3
            }
        };
        
        try {
            // Step 1: Record audio
            log('Step 1: Recording audio from microphone...');
            const audioSettings = this._getAudioSettings();
            const recordCmd = this._buildRecordingCommand(testAudioFile, {
                ...audioSettings,
                duration: 3 // 3 seconds test
            });
            
            log(`Test recording command: ${recordCmd.join(' ')}`);
            
            const [recordSuccess, stdout, stderr] = GLib.spawn_sync(
                null,
                recordCmd,
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
            
            if (!recordSuccess) {
                const errorMsg = new TextDecoder().decode(stderr);
                result.message = `Recording failed: ${errorMsg}`;
                return result;
            }
            
            // Step 2: Verify recording file exists and has content
            const file = Gio.File.new_for_path(testAudioFile);
            if (!file.query_exists(null)) {
                result.message = 'Recording failed: No audio file created';
                return result;
            }
            
            const fileInfo = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const fileSize = fileInfo.get_size();
            result.details.fileSize = fileSize;
            
            if (fileSize === 0) {
                // Clean up empty file
                file.delete(null);
                result.message = 'Recording failed: Empty audio file created';
                return result;
            }
            
            result.details.recordingSuccessful = true;
            log(`Recording successful: ${fileSize} bytes recorded`);
            
            // Step 3: Play back the recorded audio
            log('Step 2: Playing back recorded audio...');
            const playbackResult = await this.playAudio(testAudioFile);
            result.details.playbackSuccessful = playbackResult.success;
            
            // Step 4: Handle test file retention based on debug mode
            const fileName = testAudioFile.split('/').pop();
            if (debugMode) {
                log(`Test audio file saved to desktop: ${fileName}`);
            } else {
                try {
                    Gio.File.new_for_path(testAudioFile).delete(null);
                    log('Temporary test audio file deleted');
                } catch (e) {
                    log(`Failed to delete temporary test file: ${e.message}`);
                }
            }
            
            // Step 5: Determine overall success
            if (result.details.recordingSuccessful && result.details.playbackSuccessful) {
                result.success = true;
                result.message = `✅ Microphone test successful!\n` +
                               `📼 Recording: ${fileSize} bytes (${result.details.recordingDuration}s)\n` +
                               `🔊 Playback: Completed successfully` +
                               (debugMode ? `\n💾 File saved to desktop: ${fileName}` : '') +
                               `\n🎤 Your microphone is working correctly!`;
            } else if (result.details.recordingSuccessful && !result.details.playbackSuccessful) {
                result.success = false;
                result.message = `⚠️ Recording successful but playback failed:\n` +
                               `📼 Recording: ${fileSize} bytes (${result.details.recordingDuration}s) ✅\n` +
                               `🔊 Playback: ${playbackResult.message} ❌` +
                               (debugMode ? `\n💾 File saved to desktop: ${fileName}` : '') +
                               `\n🎤 Microphone works, but audio playback has issues.`;
            } else {
                result.success = false;
                result.message = 'Both recording and playback failed';
            }
            
            return result;
            
        } catch (error) {
            log(`Microphone test error: ${error.message}`);
            
            const fileName = testAudioFile.split('/').pop();
            if (debugMode) {
                log(`Test audio file preserved on desktop despite error: ${fileName}`);
            } else {
                // Clean up temp file on error as well
                try {
                    Gio.File.new_for_path(testAudioFile).delete(null);
                    log('Temporary test audio file deleted after error');
                } catch (e) {
                    log(`Failed to delete temporary test file after error: ${e.message}`);
                }
            }
            
            result.message = `Microphone test error: ${error.message}` +
                             (debugMode ? `\nPartial recording may be saved on desktop as: ${fileName}` : '');
            return result;
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        log('Destroying AudioRecorder...');
        
        // Clean up recording timeout
        if (this._recordingTimeout) {
            GLib.source_remove(this._recordingTimeout);
            this._recordingTimeout = null;
        }
        
        // Stop any active recording
        if (this._isRecording && this._recordingProcess) {
            try {
                GLib.spawn_command_line_sync(`kill ${this._recordingProcess}`);
            } catch (error) {
                console.error('Error stopping recording on destroy:', error);
            }
        }
        
        this._isRecording = false;
        this._recordingProcess = null;
        log('AudioRecorder destroyed');
    }

    /**
     * Get audio settings from settings manager
     * @returns {Object} Audio settings object
     * @private
     */
    _getAudioSettings() {
        return {
            recorder: this._settingsManager.getString('audio-recorder'),
            format: this._settingsManager.getString('audio-format'),
            sampleRate: this._settingsManager.getInt('audio-sample-rate'),
            channels: this._settingsManager.getInt('audio-channels'),
            maxDuration: this._settingsManager.getInt('max-recording-duration')
        };
    }

    /**
     * Check whether a continuous speech mode owns the recording lifetime.
     * @returns {boolean}
     * @private
     */
    _shouldSkipRecordingTimeout() {
        try {
            return this._settingsManager.getBoolean('type-as-i-speak-enabled') ||
                   this._settingsManager.getBoolean('type-as-i-speak-stream-enabled');
        } catch (error) {
            return false;
        }
    }

    /**
     * Build recording command array
     * @param {string} outputPath - Output file path
     * @param {Object} settings - Audio settings
     * @returns {string[]} Command array
     * @private
     */
    _buildRecordingCommand(outputPath, settings) {
        const recorder = settings.recorder || 'arecord';
        
        if (recorder === 'arecord') {
            const cmd = [
                'arecord',
                '-f', settings.format,
                '-r', settings.sampleRate.toString(),
                '-c', settings.channels.toString(),
                '-t', 'wav'
            ];

            if (!settings.unlimited) {
                const duration = settings.duration || settings.maxDuration || 30;
                cmd.push('-d', duration.toString());
            }
            
            cmd.push(outputPath);
            return cmd;
        } else if (recorder === 'parecord') {
            const cmd = [
                'parecord',
                '--format=s16le',
                `--rate=${settings.sampleRate}`,
                `--channels=${settings.channels}`,
                '--file-format=wav'
            ];
            
            cmd.push(outputPath);
            return cmd;
        } else if (recorder === 'ffmpeg') {
            const cmd = [
                'ffmpeg',
                '-f', 'alsa',
                '-i', 'default',
                '-ar', settings.sampleRate.toString(),
                '-ac', settings.channels.toString(),
                '-sample_fmt', 's16',
                '-y' // overwrite output file
            ];
            
            if (!settings.unlimited) {
                const duration = settings.duration || settings.maxDuration || 30;
                cmd.push('-t', duration.toString());
            }
            
            cmd.push(outputPath);
            return cmd;
        } else {
            // Fallback to arecord
            const cmd = [
                'arecord',
                '-f', settings.format,
                '-r', settings.sampleRate.toString(),
                '-c', settings.channels.toString(),
                '-t', 'wav'
            ];

            if (!settings.unlimited) {
                const duration = settings.duration || settings.maxDuration || 30;
                cmd.push('-d', duration.toString());
            }
            
            cmd.push(outputPath);
            return cmd;
        }
    }

    /**
     * Check if file exists
     * @param {string} filePath - File path to check
     * @returns {boolean}
     * @private
     */
    _checkFileExists(filePath) {
        try {
            const file = Gio.File.new_for_path(filePath);
            return file.query_exists(null);
        } catch (error) {
            return false;
        }
    }

    /**
     * Handle recording process completion
     * @private
     */
    _onRecordingFinished() {
        log('Recording process finished');
        this._isRecording = false;
        this._recordingProcess = null;

        // Clean up timeout if still active
        if (this._recordingTimeout) {
            GLib.source_remove(this._recordingTimeout);
            this._recordingTimeout = null;
        }

        try {
            // Check if output file exists and has content
            if (this._outputPath) {
                const file = Gio.File.new_for_path(this._outputPath);
                if (!file.query_exists(null)) {
                    log('No audio file created');
                    if (this._notificationService.enabled) {
                        this._notificationService.notify('Speech Panel', 'No audio recorded');
                    }
                } else {
                    log('Recording saved successfully');
                }
            }
        } finally {
            this._resolveRecordingCompletion?.();
            this._recordingCompletion = null;
            this._resolveRecordingCompletion = null;
        }
    }
}