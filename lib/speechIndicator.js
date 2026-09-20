/* speechIndicator.js
 * 
 * UI component for Speech Panel extension
 * Following Single Responsibility Principle - handles only UI presentation
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {log as loggerLog, enableTestLogging} from './logger.js';

function log(message) {
    loggerLog(message, 'SpeechIndicator');
}

// Append a line-based log entry to a Desktop log file for validation
function appendToDesktopLog(header, bodyLines = []) {
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

/**
 * Speech Panel UI indicator following Single Responsibility Principle
 * Handles only UI presentation and user interaction
 */
export const SpeechIndicator = GObject.registerClass({
    GTypeName: 'SpeechIndicator'
}, class SpeechIndicator extends PanelMenu.Button {
    
    /**
     * Initialize the speech panel indicator with dependency injection
     * @param {Object} dependencies - Injected dependencies
     * @param {IAudioRecorder} dependencies.audioRecorder - Audio recording service
     * @param {ISpeechTranscriber} dependencies.speechTranscriber - Speech transcription service
     * @param {ITextInserter} dependencies.textInserter - Text insertion service
     * @param {INotificationService} dependencies.notificationService - Notification service
     * @param {ISettingsManager} dependencies.settingsManager - Settings management service
     * @param {IStateManager} dependencies.stateManager - State management service
     */
    _init(dependencies) {
        log('Initializing SpeechIndicator UI...');
        
        super._init(0.0, 'Speech Panel');
        
        // Store injected dependencies
        this._audioRecorder = dependencies.audioRecorder;
        this._speechTranscriber = dependencies.speechTranscriber;
        this._textInserter = dependencies.textInserter;
        this._notificationService = dependencies.notificationService;
        this._settingsManager = dependencies.settingsManager;
        this._stateManager = dependencies.stateManager;
        this._typeAsISpeakService = dependencies.typeAsISpeakService || null;
        this._typeAsIStreamService = dependencies.typeAsIStreamService || null;
        this._dingService = dependencies.dingService || null;
        
        // Initialize UI components
        this._createIcon();
        this._createMenu();
        this._setupEventHandlers();
        
        // Connect to state changes for UI updates
        this._stateCallbackId = this._stateManager.onStateChanged((newState, previousState) => {
            this._updateIconForState(newState);
            this._updateToggleMenuLabel(newState);
        });
        
        log('SpeechIndicator UI initialized successfully');
    }
    
    /**
     * Create the microphone icon
     * @private
     */
    _createIcon() {
        log('Creating microphone icon...');
        
        this._icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon speech-panel-icon'
        });
        
        this.add_child(this._icon);
        
        // Ensure button is interactive
        this.reactive = true;
        this.can_focus = true;
        this.track_hover = true;
        
        // Set initial icon state
        this._updateIconForState('idle');
        
        log('Icon created and configured');
    }
    
    /**
     * Create the popup menu with all menu items
     * @private
     */
    _createMenu() {
        log('Creating popup menu...');
        
        // Toggle recording menu item (acts like the keyboard shortcut)
        this._toggleMenuItem = new PopupMenu.PopupMenuItem('🎙 Start Listening');
        this._toggleMenuItem.connect('activate', () => {
            log('Toggle Recording menu item clicked');
            this.toggleRecording();
        });
        this.menu.addMenuItem(this._toggleMenuItem);
        // Initialize label based on current state
        this._updateToggleMenuLabel(this._stateManager.getState());

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings menu item
        this._createSettingsMenuItem();
        
        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Menu event handlers
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                // Capture the application before the popup takes keyboard
                // focus. Menu activation happens too late to recover it.
                this._textInserter?.captureFocus?.();
                log('Menu opened');
            } else {
                log('Menu closed');
            }
        });
        
        log('Popup menu created successfully');
    }
    
    /**
     * Create settings menu item
     * @private
     */
    _createSettingsMenuItem() {
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            log('Settings menu item clicked');
            this._openSettings();
        });
        this.menu.addMenuItem(settingsItem);
    }
    
    /**
     * Create test menu items
     * @private
     */
    _createTestMenuItems() {
        // Test Microphone
        const testMicrophoneItem = new PopupMenu.PopupMenuItem('🎤 Test Microphone (Record & Play)');
        testMicrophoneItem.connect('activate', () => {
            enableTestLogging();
            log('Test Microphone menu item clicked');
            this._testMicrophone();
        });
        this.menu.addMenuItem(testMicrophoneItem);
        
        // Test Whisper
        const testWhisperItem = new PopupMenu.PopupMenuItem('🤖 Test Whisper');
        testWhisperItem.connect('activate', () => {
            enableTestLogging();
            log('Test Whisper menu item clicked');
            this._testWhisper();
        });
        this.menu.addMenuItem(testWhisperItem);
        
        // Test Complete Whisper Workflow
        const testCompleteWorkflowItem = new PopupMenu.PopupMenuItem('🔄 Test Complete Workflow');
        testCompleteWorkflowItem.connect('activate', () => {
            enableTestLogging();
            log('Test Complete Workflow menu item clicked');
            this._testCompleteWhisperWorkflow();
        });
        this.menu.addMenuItem(testCompleteWorkflowItem);
        
        // Test Text Insertion
        const testTextInsertionItem = new PopupMenu.PopupMenuItem('📝 Test Text Insertion');
        testTextInsertionItem.connect('activate', () => {
            enableTestLogging();
            log('Test Text Insertion menu item clicked');
            this._testTextInsertion();
        });
        this.menu.addMenuItem(testTextInsertionItem);
        
        // Test Audio Settings
        const testAudioSettingsItem = new PopupMenu.PopupMenuItem('🔊 Test Audio Settings');
        testAudioSettingsItem.connect('activate', () => {
            enableTestLogging();
            log('Test Audio Settings menu item clicked');
            this._testAudioSettings();
        });
        this.menu.addMenuItem(testAudioSettingsItem);
        
        // Test Keyboard Shortcut
        const testShortcutItem = new PopupMenu.PopupMenuItem('⌨️ Test Keyboard Shortcut');
        testShortcutItem.connect('activate', () => {
            enableTestLogging();
            log('Test Keyboard Shortcut menu item clicked');
            this._testKeyboardShortcut();
        });
        this.menu.addMenuItem(testShortcutItem);

        // Test Type As I Speak (Dry Run)
        const testTasItem = new PopupMenu.PopupMenuItem('🧪 Test Type As I Speak (Dry Run)');
        testTasItem.connect('activate', () => {
            enableTestLogging();
            log('Test Type As I Speak (Dry Run) menu item clicked');
            this._testTypeAsISpeakDryRun();
        });
        this.menu.addMenuItem(testTasItem);

        // Test Type As You Stream (Dry Run)
        const testTaysItem = new PopupMenu.PopupMenuItem('🧪 Test Type As You Stream (Dry Run)');
        testTaysItem.connect('activate', () => {
            enableTestLogging();
            log('Test Type As You Stream (Dry Run) menu item clicked');
            this._testTypeAsIStreamDryRun();
        });
        this.menu.addMenuItem(testTaysItem);
    }
    
    /**
     * Setup event handlers for UI interactions
     * @private
     */
    _setupEventHandlers() {
        // A primary click is the recording control itself. Keep the popup
        // available through secondary-click so starting never needs two clicks.
        this.connect('button-press-event', (actor, event) => {
            const button = event.get_button();
            if (button === 1) {
                log('Primary button click - toggling recording');
                this._textInserter?.captureFocus?.();
                this.toggleRecording().catch(error => {
                    log(`Primary button toggle failed: ${error.message}`);
                });
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        
        this.connect('touch-event', (actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                log('Button touched - touch-event triggered');
            }
            return false; // Allow menu to show
        });
    }
    
    /**
     * Update icon appearance based on current state
     * @param {string} state - Current state ('idle', 'listening', 'processing')
     * @private
     */
    _updateIconForState(state) {
        // Remove all state classes
        this._icon.remove_style_class_name('idle');
        this._icon.remove_style_class_name('listening');
        this._icon.remove_style_class_name('processing');
        
        // Add current state class for CSS styling
        this._icon.add_style_class_name(state);
        
        log(`Icon updated for state: ${state}`);
    }
    
    /**
     * Update the toggle menu item label based on state
     * @param {string} state
     * @private
     */
    _updateToggleMenuLabel(state) {
        try {
            if (!this._toggleMenuItem) return;
            const listening = state ? state === 'listening' : this._stateManager.isListening;
            const label = listening ? '⏹ Stop Listening' : '🎙 Start Listening';
            if (this._toggleMenuItem.label && this._toggleMenuItem.label.text !== undefined) {
                this._toggleMenuItem.label.text = label;
            }
        } catch (e) {
            log(`Failed to update toggle menu label: ${e.message}`);
        }
    }

    /**
     * Toggle recording/streaming depending on mode
     */
    async toggleRecording() {
        // Keyboard shortcuts and menu actions do not pass through the primary
        // button handler, so capture the target here when starting.
        if (this._stateManager.isIdle && !this._typeAsIStreamService?.isActive)
            this._textInserter?.captureFocus?.();

        let streamEnabled = false;
        try {
            streamEnabled = this._settingsManager.getBoolean('type-as-i-speak-stream-enabled');
        } catch (_) {
            streamEnabled = false;
        }

        if (streamEnabled && this._typeAsIStreamService) {
            try {
                if (!this._typeAsIStreamService.isActive &&
                    !this._typeAsIStreamService.isAvailable()) {
                    const message = 'Whisper streaming is not available on this PC. Stream mode was not started.';
                    log(message);
                    this._notificationService?.notifyImportant?.('Speech Panel — Stream unavailable', message);
                    return;
                }
                if (this._typeAsIStreamService.isActive || this._stateManager.isListening) {
                    await this._typeAsIStreamService.stop();
                } else {
                    await this._typeAsIStreamService.start();
                }
                return;
            } catch (error) {
                this._playFeedback('error');
                throw error;
            }
        }

        // Default to file recording path
        if (this._stateManager.isIdle) {
            await this.startRecording();
        } else if (this._stateManager.isListening) {
            await this.stopRecording();
        } else {
            log('Toggle ignored in processing state');
        }
    }

    /**
     * Start recording workflow
     */
    async startRecording() {
        log('Starting recording workflow...');
        
        try {
            // If stream mode is enabled, delegate to stream service
            try {
                let streamEnabled = false; try { streamEnabled = this._settingsManager.getBoolean('type-as-i-speak-stream-enabled'); } catch (_) {}
                if (streamEnabled && this._typeAsIStreamService) {
                    if (!this._typeAsIStreamService.isAvailable()) {
                        const message = 'Whisper streaming is not available on this PC. Stream mode was not started.';
                        this._notificationService?.notifyImportant?.('Speech Panel — Stream unavailable', message);
                        log(message);
                        return;
                    } else {
                        if (!this._typeAsIStreamService.isActive) await this._typeAsIStreamService.start();
                        return;
                    }
                }
            } catch (e) {
                log(`Stream start failed: ${e.message}`);
                this._notificationService?.notifyImportant?.('Speech Panel — Stream failed', 'Stream mode did not start. No fallback was used.');
                return;
            }
            // Check if already recording
            if (this._stateManager.isListening || this._stateManager.isProcessing) {
                log('Already in recording/processing state, ignoring request');
                return;
            }
            
            // Set state to listening
            this._stateManager.setState('listening');
            
            // Create audio file in tmpfs (prefer /dev/shm) to minimize disk IO
            let tmpBase = GLib.build_filenamev(['/dev', 'shm']);
            try {
                const f = Gio.File.new_for_path(tmpBase);
                if (!f.query_exists(null)) throw new Error('no shm');
            } catch (_) {
                tmpBase = GLib.get_tmp_dir();
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const audioFile = GLib.build_filenamev([tmpBase, `speech-panel-${timestamp}.wav`]);
            
            // Start recording
            await this._audioRecorder.startRecording(audioFile);
            
            // Notify user (no persistent file path)
            this._notificationService.notifyInfo('🎤 Recording Started', 'Listening… (temporary buffer)');
            this._playFeedback('recording');
            
            log('Recording workflow started successfully');
            
        } catch (error) {
            log(`Error starting recording: ${error.message}`);
            this._stateManager.setState('idle');
            this._notificationService.notifyError('Failed to start recording', error.message);
            this._playFeedback('error');
        }
    }
    
    /**
     * Stop recording workflow and process audio
     */
    async stopRecording() {
        log('Stopping recording workflow...');
        
        try {
            // If stream mode is enabled, delegate to stream service
            try {
                let streamEnabled = false; try { streamEnabled = this._settingsManager.getBoolean('type-as-i-speak-stream-enabled'); } catch (_) {}
                if (streamEnabled && this._typeAsIStreamService && this._typeAsIStreamService.isActive) {
                    await this._typeAsIStreamService.stop();
                    this._textInserter?.releaseFocus?.();
                    return;
                }
            } catch (e) { log(`Stream branch (stop) failed: ${e.message}`); }
            if (!this._stateManager.isListening) {
                log('Not currently recording, ignoring stop request');
                return;
            }
            
            // Stop recording
            await this._audioRecorder.stopRecording();
            
            // Set state to processing
            this._stateManager.setState('processing');
            this._playFeedback('processing');
            
            // Get the recorded audio file path
            const audioFile = this._audioRecorder.outputPath;
            if (!audioFile) {
                throw new Error('No audio file available for processing');
            }
            
            // Transcribe audio
            const transcription = await this._speechTranscriber.transcribe(audioFile);
            
            if (transcription && transcription.length > 0) {
                // If Type As I Speak is enabled, avoid duplicating already typed content
                let textToInsert = transcription;
                let tasEnabled = false;
                try { tasEnabled = this._settingsManager.getBoolean('type-as-i-speak-enabled'); } catch (e) { tasEnabled = false; }
                if (tasEnabled && this._typeAsISpeakService && typeof this._typeAsISpeakService.getTypedText === 'function') {
                    const alreadyTyped = this._typeAsISpeakService.getTypedText() || '';
                    if (alreadyTyped) {
                        if (transcription.startsWith(alreadyTyped)) {
                            textToInsert = transcription.slice(alreadyTyped.length);
                        } else {
                            // Fallback: compute suffix after longest common prefix
                            const minLen = Math.min(alreadyTyped.length, transcription.length);
                            let i = 0; while (i < minLen && alreadyTyped[i] === transcription[i]) i++;
                            textToInsert = transcription.slice(i);
                        }
                    }
                }

                if (textToInsert && textToInsert.trim().length > 0) {
                    await this._textInserter.insertText(textToInsert);
                } else {
                    log('No new text to insert (already typed during live mode)');
                }

                // Always notify result with the full transcription for user reference
                this._notificationService.notifyTranscriptionResult(transcription, true);

                // Clean up temporary recording file to avoid disk IO accumulation
                try { const f = Gio.File.new_for_path(audioFile); if (f.query_exists(null)) f.delete(null); } catch (_) {}

                // Reset live typing session buffer after finalization
                if (this._typeAsISpeakService && typeof this._typeAsISpeakService.clearSession === 'function') {
                    this._typeAsISpeakService.clearSession();
                }
            } else {
                this._notificationService.notifyTranscriptionResult('', true);
                
                // Clean up temporary recording file (no transcription)
                try { const f = Gio.File.new_for_path(audioFile); if (f.query_exists(null)) f.delete(null); } catch (_) {}
            }
            
            // Set state back to idle
            this._stateManager.setState('idle');
            this._playFeedback('complete');
            
            log('Recording workflow completed successfully');
            
        } catch (error) {
            log(`Error in recording workflow: ${error.message}`);
            this._stateManager.setState('idle');
            this._notificationService.notifyError('Recording workflow failed', error.message);
            this._playFeedback('error');
        }
    }
    
    /**
     * Play accessible audio feedback without interrupting the recording workflow.
     * @param {string} feedback
     * @private
     */
    _playFeedback(feedback) {
        try {
            this._dingService?.playFeedback(feedback);
        } catch (error) {
            log(`Failed to play ${feedback} sound feedback: ${error.message}`);
        }
    }
    
    /**
     * Open extension settings
     * @private
     */
    _openSettings() {
        try {
            const [success] = GLib.spawn_async(
                null, 
                ['gnome-extensions', 'prefs', 'speech-panel@localhost'], 
                null, 
                GLib.SpawnFlags.SEARCH_PATH, 
                null
            );
            
            if (!success) {
                this._notificationService.notifyError('Could not open settings');
            }
        } catch (error) {
            log(`Settings open error: ${error.message}`);
            this._notificationService.notifyError('Settings error', error.message);
        }
    }
    
    /**
     * Test microphone functionality
     * @private
     */
    async _testMicrophone() {
        this._notificationService.notifyInfo('Testing microphone...', 'Recording 3 seconds of audio, then playing it back');
        
        try {
            const result = await this._audioRecorder.testMicrophone();
            if (result.success) {
                this._notificationService.notifySuccess('Microphone test successful', result.message);
            } else {
                this._notificationService.notifyError('Microphone test failed', result.message);
            }
        } catch (error) {
            this._notificationService.notifyError('Microphone test error', error.message);
        }
    }
    
    /**
     * Test Whisper functionality
     * @private
     */
    async _testWhisper() {
        this._notificationService.notifyInfo('Testing Whisper.cpp...', 'Checking installation and configuration');
        
        try {
            const result = await this._speechTranscriber.testWhisper();
            if (result.success) {
                this._notificationService.notifySuccess('Whisper.cpp test successful', result.message);
            } else {
                this._notificationService.notifyError('Whisper.cpp test failed', result.message);
            }
        } catch (error) {
            this._notificationService.notifyError('Whisper.cpp test error', error.message);
        }
    }
    
    /**
     * Test complete Whisper workflow: text → TTS → audio → Whisper → text comparison
     * @private
     */
    async _testCompleteWhisperWorkflow() {
        this._notificationService.notifyInfo('🔄 Testing Complete Workflow', 'Starting comprehensive text-to-speech-to-text test...');
        
        try {
            // Run the comprehensive workflow test
            const result = await this._speechTranscriber.testCompleteWhisperWorkflow();
            
            // Write detailed results to Desktop log for validation
            try {
                const lines = [
                    `Whisper Available: ${result.details.whisperAvailable}`,
                    `TTS Available: ${result.details.ttsAvailable}`,
                    `Audio Generated: ${result.details.audioGenerated}`,
                    `Audio Played: ${result.details.audioPlayed}`,
                    `Transcription Successful: ${result.details.transcriptionSuccessful}`,
                    `Match Score: ${Math.round(result.details.matchScore * 100)}%`,
                    `Text Match: ${result.details.textMatch}`,
                    `Original Text: "${result.details.originalText}"`,
                    `Transcribed Text: "${result.details.transcribedText || ''}"`
                ];
                appendToDesktopLog('Comprehensive Workflow Test', lines);
            } catch (e) {
                log(`Desktop logging failed: ${e.message}`);
            }
            
            if (result.success) {
                // Show detailed success notification
                this._notificationService.notifySuccess('🎉 Complete Workflow Test Successful!', result.message);
                
                // Also log detailed results for debugging
                log(`Complete workflow test results:
                    - Whisper Available: ${result.details.whisperAvailable}
                    - TTS Available: ${result.details.ttsAvailable}
                    - Audio Generated: ${result.details.audioGenerated}
                    - Audio Played: ${result.details.audioPlayed}
                    - Transcription Successful: ${result.details.transcriptionSuccessful}
                    - Text Match Quality: ${result.details.textMatch}
                    - Match Score: ${Math.round(result.details.matchScore * 100)}%`);
                    
            } else {
                // Show error with details
                this._notificationService.notifyError('❌ Workflow Test Failed', result.message);
                
                // Log failure details for debugging
                log(`Workflow test failed with details:
                    - Whisper Available: ${result.details.whisperAvailable}
                    - TTS Available: ${result.details.ttsAvailable}
                    - Audio Generated: ${result.details.audioGenerated}
                    - Audio Played: ${result.details.audioPlayed}
                    - Transcription Successful: ${result.details.transcriptionSuccessful}`);
            }
            
            // Show step-by-step breakdown in a separate notification
            const stepDetails = this._formatWorkflowSteps(result.details);
            setTimeout(() => {
                this._notificationService.notifyInfo('📋 Workflow Steps Breakdown', stepDetails);
            }, 2000);
            
        } catch (error) {
            this._notificationService.notifyError('🚨 Workflow Test Error', `Unexpected error: ${error.message}`);
            console.error('[SpeechIndicator] Complete workflow test error:', error);
        }
    }
    
    /**
     * Format workflow test steps for user display
     * @param {Object} details - Test result details
     * @returns {string} Formatted step information
     * @private
     */
    _formatWorkflowSteps(details) {
        const steps = [
            `1. Whisper Check: ${details.whisperAvailable ? '✅' : '❌'}`,
            `2. TTS Check: ${details.ttsAvailable ? '✅' : '❌'}`,
            `3. Audio Generation: ${details.audioGenerated ? '✅' : '❌'}`,
            `4. Audio Playback: ${details.audioPlayed ? '✅' : '⚠️'}`,
            `5. Transcription: ${details.transcriptionSuccessful ? '✅' : '❌'}`,
            `6. Text Match (${Math.round(details.matchScore * 100)}%): ${details.textMatch ? '✅' : '⚠️'}`
        ];
        
        return steps.join('\n');
    }
    
    /**
     * Test text insertion functionality
     * @private
     */
    async _testTextInsertion() {
        const testText = "Hello! This is a test message from Speech Panel extension.";
        
        try {
            await this._textInserter.insertTextWithDelay(testText, 2);
            this._notificationService.notifySuccess('Text insertion test completed', 'Test text should appear in 2 seconds');
        } catch (error) {
            this._notificationService.notifyError('Text insertion test failed', error.message);
        }
    }
    
    /**
     * Test audio settings
     * @private
     */
    _testAudioSettings() {
        try {
            const audioRecorder = this._settingsManager.getString('audio-recorder');
            const audioFormat = this._settingsManager.getString('audio-format');
            const sampleRate = this._settingsManager.getInt('audio-sample-rate');
            const channels = this._settingsManager.getInt('audio-channels');
            const maxDuration = this._settingsManager.getInt('max-recording-duration');
            
            // Test if recorder exists
            const [recorderExists] = GLib.spawn_sync(
                null, 
                ['which', audioRecorder], 
                null, 
                GLib.SpawnFlags.SEARCH_PATH, 
                null
            );
            
            const status = recorderExists ? '✅' : '❌';
            const message = `${status} Recorder: ${audioRecorder}, Format: ${audioFormat}, Sample Rate: ${sampleRate} Hz, Channels: ${channels}, Max Duration: ${maxDuration}s`;
            
            this._notificationService.notifyInfo('Audio Settings Test', message);
            
        } catch (error) {
            this._notificationService.notifyError('Audio settings test error', error.message);
        }
    }
    
    /**
     * Test keyboard shortcut
     * @private
     */
    _testKeyboardShortcut() {
        try {
            const shortcut = this._settingsManager.getStrv('toggle-recording-shortcut')[0] || '<Super><Shift>s';
            this._notificationService.notifyInfo('Keyboard Shortcut Test', `Current shortcut: ${shortcut}`);
        } catch (error) {
            this._notificationService.notifyError('Keyboard shortcut test error', error.message);
        }
    }

    /**
     * Dry-run tester for Type As I Speak
     * Simulates incremental typing without using the microphone or Whisper
     * @private
     */
    async _testTypeAsISpeakDryRun() {
        try {
            const chunks = [
                'This is ',
                'a dry-run ',
                'test for ',
                'Type As I Speak. ',
                'It types ',
                'incrementally.\n'
            ];

            this._notificationService.notifyInfo('🧪 Type As I Speak (Dry Run)', 'Will type a short sentence in chunks. Focus a text field.');

            // Small delay to allow focusing a text field
            await new Promise(r => setTimeout(r, 1200));

            for (const part of chunks) {
                await this._textInserter.insertText(part);
                await new Promise(r => setTimeout(r, 400));
            }

            this._notificationService.notifySuccess('Dry Run Complete', 'Typed sample chunks successfully');
        } catch (error) {
            this._notificationService.notifyError('Dry Run Error', error.message);
        }
    }

    /**
     * Dry-run tester for Type As You Stream
     * Simulates live partials and coalesced inserts without Whisper
     * @private
     */
    async _testTypeAsIStreamDryRun() {
        try {
            enableTestLogging();
            appendToDesktopLog('Test: Type As You Stream (Dry Run) — START');
            this._notificationService.notifyInfo('🧪 Type As You Stream (Dry Run)', 'Focus a text field; typing will simulate streaming.');

            // Give the user a moment to focus a text field
            await new Promise(r => setTimeout(r, 1000));

            // Simulated partial outputs from a streaming session
            const parts = [
                'hello',
                ' wor',
                'ld',
                ',',
                ' this',
                ' is',
                ' stream',
                ' typing',
                '.',
                ' New',
                ' sentence',
                '!'
            ];

            let total = 0;
            for (const p of parts) {
                await this._textInserter.insertText(p, { silent: true });
                total += p.length;
                // Short, variable delay to mimic incoming partials
                const jitter = 60 + Math.floor(Math.random() * 60);
                await new Promise(r => setTimeout(r, jitter));
            }

            appendToDesktopLog('Test: Type As You Stream (Dry Run) — COMPLETE', [
                `Inserted characters: ${total}`
            ]);
            this._notificationService.notifySuccess('Stream Dry Run Complete', `Inserted ~${total} characters`);
        } catch (e) {
            appendToDesktopLog('Test: Type As You Stream (Dry Run) — ERROR', [String(e?.message || e)]);
            this._notificationService.notifyError('Stream Dry Run Error', e.message || String(e));
        }
    }
    
    /**
     * Get current indicator state information
     * @returns {Object} State information
     */
    getStateInfo() {
        return {
            currentState: this._stateManager.getState(),
            isRecording: this._audioRecorder.isRecording,
            whisperAvailable: this._speechTranscriber.isAvailable(),
            textInserterAvailable: this._textInserter.isAvailable(),
            notificationsEnabled: this._notificationService.enabled
        };
    }
    
    /**
     * Clean up resources and connections
     */
    destroy() {
        log('Destroying SpeechIndicator...');
        
        // Remove state change callback
        if (this._stateCallbackId) {
            this._stateManager.removeCallback(this._stateCallbackId);
            this._stateCallbackId = null;
        }
        
        // Cancel any delayed operations
        if (this._textInserter) {
            this._textInserter.cancelDelayedInsertion();
        }
        
        // Stop any active recording
        if (this._stateManager.isListening && this._audioRecorder) {
            this._audioRecorder.stopRecording().catch(error => {
                log(`Error stopping recording on destroy: ${error.message}`);
            });
        }
        
        // Reset state
        if (this._stateManager) {
            this._stateManager.setState('idle');
        }
        
        log('SpeechIndicator destroyed');
        super.destroy();
    }
});