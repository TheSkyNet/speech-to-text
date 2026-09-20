/* textToSpeechService.js
 * 
 * Text-to-speech implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only text-to-speech operations
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {ITextToSpeechService} from './interfaces.js';

function log(message) {
    console.log(`[TextToSpeechService] ${message}`);
}

/**
 * Text-to-speech service implementation using system TTS tools
 * Implements ITextToSpeechService interface following Single Responsibility Principle
 */
export class TextToSpeechService extends ITextToSpeechService {
    constructor(settingsManager, notificationService) {
        super();
        this._settingsManager = settingsManager;
        this._notificationService = notificationService;
        this._availableEngines = [];
        this._preferredEngine = null;
        this._isPlaying = false;
        this._playbackProcess = null;
        
        // Initialize and detect available TTS engines
        this._detectAvailableEngines();
        
        log('TextToSpeechService initialized');
    }

    /**
     * Generate audio file from text using available TTS engine
     * @param {string} text - Text to convert to speech
     * @param {string} outputPath - Path to save the audio file
     * @param {Object} settings - TTS settings (optional)
     * @returns {Promise<void>}
     */
    async generateAudio(text, outputPath, settings = null) {
        log(`Generating audio for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        if (!text || text.trim().length === 0) {
            throw new Error('No text provided for TTS generation');
        }

        if (!this.isAvailable()) {
            throw new Error('No TTS engine available');
        }

        try {
            const ttsSettings = settings || this._getDefaultSettings();
            const engine = this._preferredEngine || this._availableEngines[0];
            
            log(`Using TTS engine: ${engine}`);
            
            // Generate audio using the selected engine
            await this._generateAudioWithEngine(engine, text, outputPath, ttsSettings);
            
            // Verify the output file was created
            if (!this._checkFileExists(outputPath)) {
                throw new Error(`TTS failed to create audio file: ${outputPath}`);
            }
            
            log(`Audio generated successfully: ${outputPath}`);
            
        } catch (error) {
            log(`Error generating audio: ${error.message}`);
            if (this._notificationService.enabled) {
                this._notificationService.notifyError('TTS Error', `Failed to generate audio: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Play audio file using system audio player
     * @param {string} audioPath - Path to audio file to play
     * @returns {Promise<void>}
     */
    async playAudio(audioPath) {
        log(`Playing audio file: ${audioPath}`);
        
        if (!this._checkFileExists(audioPath)) {
            throw new Error(`Audio file not found: ${audioPath}`);
        }

        if (this._isPlaying) {
            log('Already playing audio, stopping current playback');
            await this.stopPlayback();
        }

        try {
            // Try different audio players in order of preference
            const players = ['paplay', 'aplay', 'mpv', 'vlc'];
            let playerFound = false;
            
            for (const player of players) {
                if (this._checkExecutableExists(player)) {
                    await this._playWithPlayer(player, audioPath);
                    playerFound = true;
                    break;
                }
            }
            
            if (!playerFound) {
                throw new Error('No audio player found (tried: paplay, aplay, mpv, vlc)');
            }
            
            log('Audio playback completed');
            
        } catch (error) {
            log(`Error playing audio: ${error.message}`);
            if (this._notificationService.enabled) {
                this._notificationService.notifyError('Audio Playback Error', error.message);
            }
            throw error;
        }
    }

    /**
     * Stop current audio playback
     * @returns {Promise<void>}
     */
    async stopPlayback() {
        if (!this._isPlaying || !this._playbackProcess) {
            return;
        }

        log('Stopping audio playback...');
        
        try {
            GLib.spawn_command_line_sync(`kill ${this._playbackProcess}`);
        } catch (error) {
            log(`Error stopping playback: ${error.message}`);
        }
        
        this._isPlaying = false;
        this._playbackProcess = null;
    }

    /**
     * Check if TTS service is available
     * @returns {boolean}
     */
    isAvailable() {
        return this._availableEngines.length > 0;
    }

    /**
     * Get available TTS voices
     * @returns {Promise<string[]>} Array of available voice names
     */
    async getAvailableVoices() {
        if (!this.isAvailable()) {
            return [];
        }

        try {
            const engine = this._preferredEngine || this._availableEngines[0];
            return await this._getVoicesForEngine(engine);
        } catch (error) {
            log(`Error getting available voices: ${error.message}`);
            return [];
        }
    }

    /**
     * Test TTS functionality with a sample text
     * @param {string} testText - Text to test with
     * @returns {Promise<Object>} Test result
     */
    async testTTS(testText = "Hello! This is a text-to-speech test.") {
        log('Testing TTS functionality...');
        
        try {
            if (!this.isAvailable()) {
                return {
                    success: false,
                    message: 'No TTS engines available'
                };
            }

            // Create temporary test file
            const tempDir = GLib.get_tmp_dir();
            const testAudioFile = GLib.build_filenamev([tempDir, 'tts_test.wav']);
            
            // Generate test audio
            await this.generateAudio(testText, testAudioFile);
            
            // Check file size to ensure audio was generated
            const file = Gio.File.new_for_path(testAudioFile);
            const fileInfo = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const fileSize = fileInfo.get_size();
            
            // Clean up test file
            file.delete(null);
            
            if (fileSize > 0) {
                return {
                    success: true,
                    message: `TTS test successful! Generated ${fileSize} bytes of audio using ${this._preferredEngine || this._availableEngines[0]}`
                };
            } else {
                return {
                    success: false,
                    message: 'TTS generated empty audio file'
                };
            }
            
        } catch (error) {
            return {
                success: false,
                message: `TTS test failed: ${error.message}`
            };
        }
    }

    /**
     * Detect available TTS engines on the system
     * @private
     */
    _detectAvailableEngines() {
        const engines = [
            { name: 'festival', command: 'festival' },
            { name: 'espeak', command: 'espeak' },
            { name: 'espeak-ng', command: 'espeak-ng' },
            { name: 'spd-say', command: 'spd-say' }
        ];

        this._availableEngines = [];
        
        engines.forEach(engine => {
            if (this._checkExecutableExists(engine.command)) {
                this._availableEngines.push(engine.name);
                log(`Found TTS engine: ${engine.name}`);
            }
        });

        // Set preferred engine (festival first, then others)
        if (this._availableEngines.includes('festival')) {
            this._preferredEngine = 'festival';
        } else if (this._availableEngines.length > 0) {
            this._preferredEngine = this._availableEngines[0];
        }

        log(`Available TTS engines: [${this._availableEngines.join(', ')}]`);
        log(`Preferred engine: ${this._preferredEngine || 'none'}`);
    }

    /**
     * Generate audio using specific TTS engine
     * @param {string} engine - TTS engine name
     * @param {string} text - Text to convert
     * @param {string} outputPath - Output file path
     * @param {Object} settings - TTS settings
     * @private
     */
    async _generateAudioWithEngine(engine, text, outputPath, settings) {
        let command;
        
        switch (engine) {
            case 'festival':
                // Festival can output directly to WAV file
                command = [
                    'festival',
                    '--batch',
                    `(SayText "${text.replace(/"/g, '\\"')}")`,
                    `(utt.save.wave (utt.synth (Utterance Text "${text.replace(/"/g, '\\"')}")) "${outputPath}" 'wav)'`
                ];
                break;
                
            case 'espeak':
            case 'espeak-ng':
                command = [
                    engine,
                    '-w', outputPath,
                    '-s', settings.speed.toString(),
                    '-v', settings.voice || 'en',
                    text
                ];
                break;
                
            case 'spd-say':
                // spd-say doesn't directly support file output, use with sox/parecord
                command = [
                    'spd-say',
                    '-t', settings.voice || 'male1',
                    '-r', settings.speed.toString(),
                    text
                ];
                break;
                
            default:
                throw new Error(`Unsupported TTS engine: ${engine}`);
        }

        log(`TTS command: ${command.join(' ')}`);

        // Execute TTS command
        const [success, stdout, stderr] = GLib.spawn_sync(
            null,
            command,
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );

        if (!success) {
            const errorMsg = new TextDecoder().decode(stderr);
            throw new Error(`TTS command failed: ${errorMsg}`);
        }
    }

    /**
     * Play audio file with specific player
     * @param {string} player - Audio player command
     * @param {string} audioPath - Path to audio file
     * @private
     */
    async _playWithPlayer(player, audioPath) {
        let command;
        
        switch (player) {
            case 'paplay':
                command = ['paplay', audioPath];
                break;
            case 'aplay':
                command = ['aplay', audioPath];
                break;
            case 'mpv':
                command = ['mpv', '--no-video', '--really-quiet', audioPath];
                break;
            case 'vlc':
                command = ['vlc', '--intf', 'dummy', '--play-and-exit', audioPath];
                break;
            default:
                throw new Error(`Unsupported audio player: ${player}`);
        }

        log(`Audio playback command: ${command.join(' ')}`);

        // Start playback process
        const [success, pid] = GLib.spawn_async(
            null,
            command,
            null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        if (!success) {
            throw new Error(`Failed to start audio player: ${player}`);
        }

        this._isPlaying = true;
        this._playbackProcess = pid;

        // Monitor playback completion
        return new Promise((resolve) => {
            GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => {
                this._isPlaying = false;
                this._playbackProcess = null;
                log('Audio playback completed');
                resolve();
            });
        });
    }

    /**
     * Get available voices for specific engine
     * @param {string} engine - TTS engine name
     * @returns {Promise<string[]>} Available voices
     * @private
     */
    async _getVoicesForEngine(engine) {
        try {
            let command;
            
            switch (engine) {
                case 'espeak':
                case 'espeak-ng':
                    command = [engine, '--voices'];
                    break;
                case 'spd-say':
                    command = ['spd-say', '-L'];
                    break;
                case 'festival':
                    // Festival voices are more complex to enumerate
                    return ['english', 'american', 'british'];
                default:
                    return [];
            }

            const [success, stdout] = GLib.spawn_sync(
                null,
                command,
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );

            if (success) {
                const output = new TextDecoder().decode(stdout);
                return this._parseVoiceList(engine, output);
            }
            
            return [];
        } catch (error) {
            log(`Error getting voices for ${engine}: ${error.message}`);
            return [];
        }
    }

    /**
     * Parse voice list output from TTS engine
     * @param {string} engine - TTS engine name
     * @param {string} output - Command output
     * @returns {string[]} Parsed voice names
     * @private
     */
    _parseVoiceList(engine, output) {
        const voices = [];
        const lines = output.split('\n');
        
        switch (engine) {
            case 'espeak':
            case 'espeak-ng':
                lines.forEach(line => {
                    const match = line.match(/^\s*\d+\s+(\S+)/);
                    if (match) voices.push(match[1]);
                });
                break;
                
            case 'spd-say':
                lines.forEach(line => {
                    if (line.trim() && !line.startsWith('Available')) {
                        voices.push(line.trim());
                    }
                });
                break;
        }
        
        return voices;
    }

    /**
     * Get default TTS settings
     * @returns {Object} Default settings
     * @private
     */
    _getDefaultSettings() {
        return {
            voice: 'en',
            speed: 150, // words per minute
            pitch: 50,  // pitch level (0-100)
            volume: 100 // volume level (0-100)
        };
    }

    /**
     * Check if executable exists
     * @param {string} executable - Executable name
     * @returns {boolean}
     * @private
     */
    _checkExecutableExists(executable) {
        try {
            const [success] = GLib.spawn_sync(
                null,
                ['which', executable],
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
            return success;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if file exists
     * @param {string} filePath - File path
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
     * Clean up resources
     */
    destroy() {
        log('Destroying TextToSpeechService...');
        
        // Stop any active playback
        if (this._isPlaying) {
            this.stopPlayback().catch(error => {
                log(`Error stopping playback on destroy: ${error.message}`);
            });
        }
        
        this._availableEngines = [];
        this._preferredEngine = null;
        
        log('TextToSpeechService destroyed');
    }
}