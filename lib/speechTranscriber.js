/* speechTranscriber.js
 * 
 * Speech transcription implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only speech transcription
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {ISpeechTranscriber} from './interfaces.js';

function log(message) {
    console.log(`[SpeechTranscriber] ${message}`);
}

/**
 * Speech transcription implementation using Whisper.cpp
 * Implements ISpeechTranscriber interface following Single Responsibility Principle
 */
export class SpeechTranscriber extends ISpeechTranscriber {
    constructor(settingsManager, notificationService, textToSpeechService = null) {
        super();
        this._settingsManager = settingsManager;
        this._notificationService = notificationService;
        this._textToSpeechService = textToSpeechService;
    }

    /**
     * Transcribe audio file to text using Whisper.cpp
     * @param {string} audioFilePath - Path to audio file
     * @param {Object} settings - Transcription settings (optional, will use settings manager if not provided)
     * @returns {Promise<string>} Transcribed text
     */
    async transcribe(audioFilePath, settings = null) {
        log(`Starting transcription for: ${audioFilePath}`);
        
        try {
            // Get transcription settings
            const transcriptionSettings = settings || this._getTranscriptionSettings();
            
            // Validate Whisper executable
            const executablePath = this._expandPath(transcriptionSettings.executable);
            if (!this._checkExecutableExists(executablePath)) {
                const errorMsg = `Whisper.cpp executable '${executablePath}' not found. Please install whisper.cpp or update the path in settings.`;
                log(errorMsg);
                if (this._notificationService.enabled) {
                    this._notificationService.notify('Speech Panel', errorMsg);
                }
                throw new Error(errorMsg);
            }

            // Validate input file
            if (!this._checkFileExists(audioFilePath)) {
                const errorMsg = `Audio file '${audioFilePath}' not found`;
                log(errorMsg);
                throw new Error(errorMsg);
            }

            // Create output file path
            const outputFile = audioFilePath.replace('.wav', '.txt');
            const outputBasename = outputFile.replace('.txt', '');
            
            // Build Whisper command
            const whisperCmd = this._buildWhisperCommand(
                executablePath,
                audioFilePath,
                outputBasename,
                transcriptionSettings
            );
            
            log(`Whisper command: ${whisperCmd.join(' ')}`);

            // Execute transcription asynchronously to avoid blocking the GNOME Shell UI
            let ok, out, err;
            try {
                const proc = Gio.Subprocess.new(
                    whisperCmd,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );

                [ok, out, err] = await new Promise((resolve, reject) => {
                    proc.communicate_utf8_async(null, null, (p, res) => {
                        try {
                            resolve(p.communicate_utf8_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            } catch (e) {
                const errorMsg = `Whisper execution error: ${e.message}`;
                log(errorMsg);
                if (this._notificationService.enabled) {
                    this._notificationService.notify('Speech Panel', errorMsg);
                }
                throw new Error(errorMsg);
            }

            if (!ok) {
                const errorMsg = `Whisper execution failed: ${err || 'unknown error'}`;
                log(errorMsg);
                if (this._notificationService.enabled) {
                    this._notificationService.notify('Speech Panel', errorMsg);
                }
                throw new Error(errorMsg);
            }

            // Read transcription result
            const transcription = await this._readTranscriptionResult(outputFile);
            
            // Clean up temporary output file
            this._cleanupFile(outputFile);
            
            if (!transcription || transcription.length === 0) {
                const msg = 'No speech detected in audio';
                log(msg);
                if (this._notificationService.enabled) {
                    this._notificationService.notify('Speech Panel', msg);
                }
                return '';
            }

            log(`Transcription successful: "${transcription.substring(0, 50)}${transcription.length > 50 ? '...' : ''}"`);
            
            // Persist Whisper output to Desktop log for validation
            try {
                const lines = [
                    `Audio File: ${audioFilePath}`,
                    `Model: ${transcriptionSettings.model}`,
                    `Language: ${transcriptionSettings.language || 'auto'}`,
                    `Command: ${whisperCmd.join(' ')}`,
                    `Transcription: "${transcription}"`
                ];
                this._appendToDesktopLog('Whisper Transcription', lines);
            } catch (e) {
                log(`Desktop logging failed: ${e.message}`);
            }
            
            return transcription;

        } catch (error) {
            log(`Transcription error: ${error.message}`);
            if (this._notificationService.enabled) {
                this._notificationService.notify('Speech Panel', `Transcription error: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Check if Whisper.cpp transcriber is available
     * @returns {boolean}
     */
    isAvailable() {
        try {
            const settings = this._getTranscriptionSettings();
            const executablePath = this._expandPath(settings.executable);
            return this._checkExecutableExists(executablePath);
        } catch (error) {
            log(`Availability check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Generate test audio from text using TTS service
     * @param {string} testText - Text to convert to audio
     * @param {string} outputPath - Path to save the generated audio
     * @returns {Promise<Object>} Generation result
     */
    async generateTestAudio(testText, outputPath) {
        log(`Generating test audio for: "${testText}"`);
        
        if (!this._textToSpeechService) {
            return {
                success: false,
                message: 'Text-to-speech service not available'
            };
        }

        try {
            await this._textToSpeechService.generateAudio(testText, outputPath);
            
            if (this._checkFileExists(outputPath)) {
                return {
                    success: true,
                    message: `Test audio generated successfully: ${outputPath}`
                };
            } else {
                return {
                    success: false,
                    message: 'Test audio generation failed - no output file created'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Test audio generation failed: ${error.message}`
            };
        }
    }

    /**
     * Play audio file for verification
     * @param {string} audioPath - Path to audio file to play
     * @returns {Promise<Object>} Playback result
     */
    async playAudio(audioPath) {
        log(`Playing audio file: ${audioPath}`);
        
        if (!this._textToSpeechService) {
            return {
                success: false,
                message: 'Text-to-speech service not available for audio playback'
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
     * Test complete Whisper workflow: text → audio → transcription → comparison
     * @param {string} testText - Text to use for testing (optional)
     * @returns {Promise<Object>} Comprehensive test result
     */
    async testCompleteWhisperWorkflow(testText = "Hello world, this is a comprehensive test of the speech recognition system.") {
        log('Running complete Whisper workflow test...');
        
        const result = {
            success: false,
            message: '',
            details: {
                whisperAvailable: false,
                ttsAvailable: false,
                audioGenerated: false,
                audioPlayed: false,
                transcriptionSuccessful: false,
                textMatch: false,
                originalText: testText,
                transcribedText: '',
                matchScore: 0
            }
        };

        try {
            // Step 1: Check Whisper availability
            const whisperCheck = await this.testWhisper();
            result.details.whisperAvailable = whisperCheck.success;
            
            if (!whisperCheck.success) {
                result.message = `Whisper not available: ${whisperCheck.message}`;
                return result;
            }

            // Step 2: Check TTS availability
            if (!this._textToSpeechService || !this._textToSpeechService.isAvailable()) {
                result.message = 'Text-to-speech service not available for complete workflow test';
                return result;
            }
            result.details.ttsAvailable = true;

            // Step 3: Generate test audio from text
            const tempDir = GLib.get_tmp_dir();
            const testAudioFile = GLib.build_filenamev([tempDir, 'whisper_workflow_test.wav']);
            
            const audioGenResult = await this.generateTestAudio(testText, testAudioFile);
            result.details.audioGenerated = audioGenResult.success;
            
            if (!audioGenResult.success) {
                result.message = `Audio generation failed: ${audioGenResult.message}`;
                return result;
            }

            // Step 4: Play the generated audio (for user verification)
            log('Playing generated test audio...');
            const playResult = await this.playAudio(testAudioFile);
            result.details.audioPlayed = playResult.success;
            
            if (!playResult.success) {
                log(`Audio playback warning: ${playResult.message}`);
                // Continue with test even if playback fails
            }

            // Step 5: Transcribe the generated audio back to text
            let transcribedText;
            try {
                transcribedText = await this.transcribe(testAudioFile);
                result.details.transcriptionSuccessful = true;
                result.details.transcribedText = transcribedText;
            } catch (error) {
                result.message = `Transcription failed: ${error.message}`;
                // Clean up test file
                this._cleanupFile(testAudioFile);
                return result;
            }

            // Step 6: Compare original text with transcribed text
            const matchScore = this._calculateTextSimilarity(testText, transcribedText);
            result.details.matchScore = matchScore;
            result.details.textMatch = matchScore > 0.7; // 70% similarity threshold

            // Step 7: Clean up test file
            this._cleanupFile(testAudioFile);

            // Determine overall success
            result.success = result.details.whisperAvailable && 
                           result.details.ttsAvailable && 
                           result.details.audioGenerated && 
                           result.details.transcriptionSuccessful;

            // Create result message
            if (result.success) {
                result.message = `✅ Complete Whisper workflow test successful!\n` +
                               `📝 Original: "${testText}"\n` +
                               `🎤 Transcribed: "${transcribedText}"\n` +
                               `📊 Similarity: ${Math.round(matchScore * 100)}%\n` +
                               `${result.details.textMatch ? '✅' : '⚠️'} Text match: ${result.details.textMatch ? 'Good' : 'Poor'}`;
            } else {
                result.message = `❌ Workflow test completed with issues. Check details for more information.`;
            }

            return result;

        } catch (error) {
            result.message = `Complete workflow test error: ${error.message}`;
            return result;
        }
    }

    /**
     * Test Whisper.cpp functionality (enhanced version)
     * @param {string} testAudioPath - Path to test audio file (optional)
     * @returns {Promise<Object>} Test result with success flag and message
     */
    async testWhisper(testAudioPath) {
        log('Testing Whisper.cpp functionality...');
        
        try {
            const settings = this._getTranscriptionSettings();
            const executablePath = this._expandPath(settings.executable);
            
            // Check executable exists
            if (!this._checkExecutableExists(executablePath)) {
                return {
                    success: false,
                    message: `Whisper.cpp executable not found at: ${executablePath}`
                };
            }

            // Check model exists
            const modelPath = this._getModelPath(settings.model);
            if (!this._checkFileExists(modelPath)) {
                return {
                    success: false,
                    message: `Whisper model not found at: ${modelPath}. Please download the model.`
                };
            }

            // If test audio provided, try transcribing it
            if (testAudioPath && this._checkFileExists(testAudioPath)) {
                try {
                    const transcription = await this.transcribe(testAudioPath);
                    return {
                        success: true,
                        message: `Whisper.cpp test successful! Transcription: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`
                    };
                } catch (error) {
                    return {
                        success: false,
                        message: `Whisper.cpp transcription test failed: ${error.message}`
                    };
                }
            } else {
                return {
                    success: true,
                    message: `Whisper.cpp is available. Executable: ${executablePath}, Model: ${settings.model}, Language: ${settings.language}`
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `Whisper.cpp test error: ${error.message}`
            };
        }
    }

    /**
     * Calculate text similarity between original and transcribed text
     * @param {string} original - Original text
     * @param {string} transcribed - Transcribed text
     * @returns {number} Similarity score (0-1)
     * @private
     */
    _calculateTextSimilarity(original, transcribed) {
        if (!original || !transcribed) {
            return 0;
        }

        // Normalize texts (lowercase, remove punctuation, trim)
        const normalize = (text) => {
            return text.toLowerCase()
                      .replace(/[^\w\s]/g, '')
                      .replace(/\s+/g, ' ')
                      .trim();
        };

        const normalizedOriginal = normalize(original);
        const normalizedTranscribed = normalize(transcribed);

        // Simple word-based similarity calculation
        const originalWords = normalizedOriginal.split(' ');
        const transcribedWords = normalizedTranscribed.split(' ');

        if (originalWords.length === 0 && transcribedWords.length === 0) {
            return 1;
        }

        if (originalWords.length === 0 || transcribedWords.length === 0) {
            return 0;
        }

        // Count matching words
        let matchCount = 0;
        const usedIndices = new Set();

        originalWords.forEach(originalWord => {
            transcribedWords.forEach((transcribedWord, index) => {
                if (!usedIndices.has(index) && originalWord === transcribedWord) {
                    matchCount++;
                    usedIndices.add(index);
                }
            });
        });

        // Calculate similarity score
        const maxLength = Math.max(originalWords.length, transcribedWords.length);
        return matchCount / maxLength;
    }

    /**
     * Get transcription settings from settings manager
     * @returns {Object} Transcription settings object
     * @private
     */
    _getTranscriptionSettings() {
        return {
            executable: this._settingsManager.getString('whisper-executable'),
            model: this._settingsManager.getString('whisper-model'),
            language: this._settingsManager.getString('whisper-language')
        };
    }

    /**
     * Expand tilde path to full home directory path
     * @param {string} path - Path that may contain tilde
     * @returns {string} Expanded path
     * @private
     */
    _expandPath(path) {
        if (path.startsWith('~/')) {
            return GLib.get_home_dir() + path.slice(1);
        }
        return path;
    }

    /**
     * Check if executable file exists and is executable
     * @param {string} executablePath - Path to executable
     * @returns {boolean}
     * @private
     */
    _checkExecutableExists(executablePath) {
        try {
            const file = Gio.File.new_for_path(executablePath);
            const fileInfo = file.query_info(
                'access::can-execute', 
                Gio.FileQueryInfoFlags.NONE, 
                null
            );
            return file.query_exists(null) && fileInfo.get_attribute_boolean('access::can-execute');
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if file exists
     * @param {string} filePath - Path to file
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
     * Get full path to Whisper model
     * @param {string} modelName - Model name (e.g., 'base', 'small')
     * @returns {string} Full path to model
     * @private
     */
    _getModelPath(modelName) {
        return `${GLib.get_home_dir()}/apps/whisper.cpp/models/ggml-${modelName}.bin`;
    }

    /**
     * Build Whisper.cpp command array
     * @param {string} executablePath - Path to Whisper executable
     * @param {string} audioFilePath - Path to input audio file
     * @param {string} outputBasename - Output file basename (without extension)
     * @param {Object} settings - Transcription settings
     * @returns {string[]} Command array
     * @private
     */
    _buildWhisperCommand(executablePath, audioFilePath, outputBasename, settings) {
        const cmd = [
            executablePath,
            '-f', audioFilePath,
            '-m', this._getModelPath(settings.model),
            '-otxt',
            '-of', outputBasename
        ];

        // Add language parameter if not auto
        if (settings.language && settings.language !== 'auto') {
            cmd.push('-l', settings.language);
        }

        // Add optimization parameters
        cmd.push('-t', '4'); // Use 4 threads
        cmd.push('-np'); // No print timestamps
        
        return cmd;
    }

    /**
     * Read transcription result from output file
     * @param {string} outputFile - Path to output text file
     * @returns {Promise<string>} Transcribed text
     * @private
     */
    async _readTranscriptionResult(outputFile) {
        try {
            const file = Gio.File.new_for_path(outputFile);
            
            if (!file.query_exists(null)) {
                throw new Error(`Transcription output file not found: ${outputFile}`);
            }

            const [, contents] = file.load_contents(null);
            const transcription = new TextDecoder().decode(contents).trim();
            
            log(`Read transcription result: ${transcription.length} characters`);
            return transcription;
        } catch (error) {
            log(`Error reading transcription result: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean up temporary file
     * @param {string} filePath - Path to file to delete
     * @private
     */
    _cleanupFile(filePath) {
        try {
            const file = Gio.File.new_for_path(filePath);
            if (file.query_exists(null)) {
                file.delete(null);
                log(`Cleaned up file: ${filePath}`);
            }
        } catch (error) {
            log(`Error cleaning up file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Append a log entry to a Desktop file for validation
     * @param {string} header - Section title
     * @param {string[]} bodyLines - Lines to log
     * @private
     */
    _appendToDesktopLog(header, bodyLines = []) {
        try {
            const desktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
            const filePath = GLib.build_filenamev([desktopDir, 'speech-panel-test.log']);
            const file = Gio.File.new_for_path(filePath);
            const timestamp = new Date().toISOString();
            const content = ['','=== ' + header + ' @ ' + timestamp + ' ===', ...bodyLines].join('\n') + '\n';
            let stream;
            try {
                stream = file.append_to(Gio.FileCreateFlags.NONE, null);
            } catch (e) {
                stream = file.create(Gio.FileCreateFlags.NONE, null);
            }
            const dataStream = new Gio.DataOutputStream({ base_stream: stream });
            dataStream.put_string(content, null);
            dataStream.close(null);
        } catch (e) {
            log(`Failed to write Desktop log: ${e.message}`);
        }
    }
}