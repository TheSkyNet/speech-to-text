/* extension-new.js
 * 
 * Main extension file with SOLID architecture and dependency injection
 * This is the refactored version following SOLID principles
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Import service implementations
import {AudioRecorder} from './lib/audioRecorder.js';
import {SpeechTranscriber} from './lib/speechTranscriber.js';
import {TextInserter} from './lib/textInserter.js';
import {NotificationService} from './lib/notificationService.js';
import {SettingsManager} from './lib/settingsManager.js';
import {StateManager} from './lib/stateManager.js';
import {TextToSpeechService} from './lib/textToSpeechService.js';
import {SpeechIndicator} from './lib/speechIndicator.js';
import {TypeAsISpeakService} from './lib/typeAsISpeakService.js';
import {TypeAsIStreamService} from './lib/typeAsIStreamService.js';
import {DingService} from './lib/dingService.js';
import {init as initLogger, log as loggerLog} from './lib/logger.js';
import {LogService} from './lib/logService.js';

function log(message) {
    loggerLog(message, 'SpeechPanelExtension');
}

function requireWaylandSession() {
    const sessionType = GLib.getenv('XDG_SESSION_TYPE');
    if (sessionType && sessionType !== 'wayland') {
        log(`Notice: Current session is '${sessionType}'. Wayland is recommended.`);
    }
}

/**
 * Main Speech Panel Extension class following SOLID principles
 * Acts as a dependency injection container and application coordinator
 */
export default class SpeechPanelExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        
        // Service instances
        this._services = {};
        this._indicator = null;
        this._keyBindingId = null;
        
        log('Extension constructor called');
    }

    /**
     * Enable the extension - create and wire up all services
     */
    enable() {
        log('Extension enable() called - starting initialization');
        
        try {
            requireWaylandSession();
            log('Wayland session confirmed');

            // Initialize services with dependency injection
            this._initializeServices();
            
            // Create and configure UI
            this._initializeUI();
            
            // Setup keyboard shortcuts
            this._setupKeyboardShortcuts();
            
            log('Extension enabled successfully');
            
        } catch (error) {
            log(`Error enabling extension: ${error.message}`);
            console.error('[SpeechPanelExtension] Enable error:', error);
            
            // Clean up if initialization failed
            this._cleanup();
            throw error;
        }
    }

    /**
     * Disable the extension - clean up all services and UI
     */
    disable() {
        log('Extension disable() called - starting cleanup');
        
        try {
            this._cleanup();
            log('Extension disabled successfully');
            
        } catch (error) {
            log(`Error disabling extension: ${error.message}`);
            console.error('[SpeechPanelExtension] Disable error:', error);
        }
    }

    /**
     * Initialize all services with proper dependency injection
     * Following Dependency Inversion Principle by injecting interfaces
     * @private
     */
    _initializeServices() {
        log('Initializing services with dependency injection...');
        
        // Create GSettings instance
        const gSettings = this.getSettings('org.gnome.shell.extensions.speech-panel');
        this._ensureTypingDefaults(gSettings);
        
        // Initialize core services (no dependencies)
        this._services.settingsManager = new SettingsManager(gSettings);
        // Initialize logger with settings manager so logging can follow notification setting
        initLogger(this._services.settingsManager);
        this._services.stateManager = new StateManager();
        // Initialize app-wide log service (observes state transitions)
        this._services.logService = new LogService(
            this._services.settingsManager,
            this._services.stateManager
        );
        
        // Initialize ding service (sound effects)
        this._services.dingService = new DingService(
            this._services.settingsManager
        );
        
        // Initialize services with dependencies
        this._services.notificationService = new NotificationService(
            this._services.settingsManager
        );
        
        this._services.textToSpeechService = new TextToSpeechService(
            this._services.settingsManager,
            this._services.notificationService
        );
        
        this._services.audioRecorder = new AudioRecorder(
            this._services.settingsManager,
            this._services.notificationService,
            this._services.textToSpeechService
        );
        
        this._services.speechTranscriber = new SpeechTranscriber(
            this._services.settingsManager,
            this._services.notificationService,
            this._services.textToSpeechService
        );
        
        this._services.textInserter = new TextInserter(
            this._services.notificationService
        );
        
        // Initialize experimental Type As I Speak service (toggleable via settings)
        this._services.typeAsISpeakService = new TypeAsISpeakService({
            settingsManager: this._services.settingsManager,
            stateManager: this._services.stateManager,
            speechTranscriber: this._services.speechTranscriber,
            textInserter: this._services.textInserter,
            audioRecorder: this._services.audioRecorder,
            notificationService: this._services.notificationService,
        });

        // Initialize new Type As You Stream service (true streaming, no files)
        this._services.typeAsIStreamService = new TypeAsIStreamService({
            settingsManager: this._services.settingsManager,
            stateManager: this._services.stateManager,
            textInserter: this._services.textInserter,
            notificationService: this._services.notificationService,
            dingService: this._services.dingService,
        });
        
        log('All services initialized successfully');
    }

    /**
     * Enable the reliable live-typing mode for existing installs that still
     * have the pre-live-typing default, without overriding explicit choices.
     * @param {Gio.Settings} gSettings
     * @private
     */
    _ensureTypingDefaults(gSettings) {
        try {
            if (typeof gSettings.get_user_value !== 'function')
                return;

            const liveValue = gSettings.get_user_value('type-as-i-speak-enabled');
            const streamValue = gSettings.get_user_value('type-as-i-speak-stream-enabled');
            if (liveValue === null && streamValue === null) {
                gSettings.set_boolean('type-as-i-speak-enabled', true);
                gSettings.set_boolean('type-as-i-speak-stream-enabled', false);
                gSettings.set_boolean('show-notifications', false);
                gSettings.set_boolean('sounds-enabled', false);
                log('Enabled live typing defaults for this installation');
            } else if (liveValue === null && streamValue?.get_boolean?.() === true) {
                gSettings.set_boolean('type-as-i-speak-enabled', false);
            }
        } catch (error) {
            log(`Could not apply live typing defaults: ${error.message}`);
        }
    }

    /**
     * Initialize UI components with dependency injection
     * @private
     */
    _initializeUI() {
        log('Initializing UI components...');

        this._removeStalePanelIndicators();
        
        // Create indicator with all service dependencies
        this._indicator = new SpeechIndicator({
            audioRecorder: this._services.audioRecorder,
            speechTranscriber: this._services.speechTranscriber,
            textInserter: this._services.textInserter,
            notificationService: this._services.notificationService,
            settingsManager: this._services.settingsManager,
            stateManager: this._services.stateManager,
            typeAsISpeakService: this._services.typeAsISpeakService,
            typeAsIStreamService: this._services.typeAsIStreamService,
            dingService: this._services.dingService,
        });
        
        // Add indicator to panel
        Main.panel.addToStatusArea('speech-panel', this._indicator);
        
        // Attach context to LogService for richer snapshots
        try {
            if (this._services.logService) this._services.logService.attachContext(this._services, this._indicator);
        } catch (e) { log(`LogService attach failed: ${e.message}`); }

        log('UI components initialized successfully');
    }

    _removeStalePanelIndicators() {
        const stale = new Set();
        const registered = Main.panel.statusArea?.['speech-panel'];
        if (registered)
            stale.add(registered);

        const boxes = [
            Main.panel._leftBox,
            Main.panel._centerBox,
            Main.panel._rightBox,
        ];
        const visit = actor => {
            if (!actor || typeof actor.get_children !== 'function')
                return;
            let children = [];
            try {
                children = actor.get_children();
            } catch (_) {
                return;
            }
            for (const child of children) {
                let isSpeechIcon = false;
                try {
                    isSpeechIcon = child.has_style_class_name?.('speech-panel-icon') === true;
                } catch (_) {}
                if (isSpeechIcon && child.get_parent?.())
                    stale.add(child.get_parent());
                visit(child);
            }
        };

        for (const box of boxes)
            visit(box);

        for (const indicator of stale) {
            try {
                log('Removing stale Speech Panel indicator actor');
                indicator.destroy();
            } catch (error) {
                log(`Could not destroy stale Speech Panel actor: ${error.message}`);
            }
        }

        if (Main.panel.statusArea['speech-panel'] === registered)
            Main.panel.statusArea['speech-panel'] = null;
    }

    /**
     * Setup keyboard shortcuts
     * @private
     */
    _setupKeyboardShortcuts() {
        log('Setting up keyboard shortcuts...');
        
        try {
            Main.wm.addKeybinding(
                'toggle-recording-shortcut',
                this._services.settingsManager._settings, // Access underlying GSettings
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                this._onToggleRecordingShortcut.bind(this)
            );

            log('Keyboard shortcuts configured successfully');
            
        } catch (error) {
            log(`Error setting up keyboard shortcuts: ${error.message}`);
            throw error;
        }
    }

    /**
     * Handle keyboard shortcut for toggle recording
     * @private
     */
    _onToggleRecordingShortcut() {
        log('Keyboard shortcut triggered - toggle recording');
        
        if (!this._indicator) {
            log('No indicator available, ignoring toggle request');
            return;
        }
        
        // Delegate to UI component
        this._indicator.toggleRecording().catch(error => {
            log(`Error handling toggle recording shortcut: ${error.message}`);
        });
    }

    /**
     * Handle keyboard shortcut for cancel/stop recording (e.g., Escape)
     * @private
     */
    _onCancelRecordingShortcut() {
        log('Cancel/Stop shortcut triggered');

        if (!this._indicator) {
            log('No indicator available, ignoring cancel request');
            return;
        }

        try {
            const stateMgr = this._services.stateManager;
            if (stateMgr && stateMgr.isListening) {
                // If recording, stop gracefully (will also finalize transcription)
                this._indicator.stopRecording().catch(e => log(`Error stopping via cancel shortcut: ${e.message}`));
            } else {
                log('Not currently recording; cancel shortcut ignored');
            }
        } catch (error) {
            log(`Error handling cancel shortcut: ${error.message}`);
        }
    }

    /**
     * Get extension information for debugging
     * @returns {Object} Extension information
     */
    getExtensionInfo() {
        const info = {
            enabled: !!this._indicator,
            services: Object.keys(this._services),
            state: this._services.stateManager ? this._services.stateManager.getDetailedState() : null
        };
        
        if (this._indicator) {
            info.indicatorState = this._indicator.getStateInfo();
        }
        
        return info;
    }

    /**
     * Test all extension components
     * @returns {Promise<Object>} Test results
     */
    async testExtension() {
        log('Running extension tests...');
        
        const results = {
            services: {},
            overall: true
        };
        
        try {
            // Test each service
            if (this._services.audioRecorder) {
                results.services.audioRecorder = await this._services.audioRecorder.testMicrophone();
            }
            
            if (this._services.speechTranscriber) {
                results.services.speechTranscriber = await this._services.speechTranscriber.testWhisper();
            }
            
            if (this._services.textInserter) {
                results.services.textInserter = await this._services.textInserter.testTextInsertion();
            }
            
            if (this._services.notificationService) {
                results.services.notificationService = await this._services.notificationService.testNotifications();
            }
            
            // Check overall status
            results.overall = Object.values(results.services).every(result => result.success);
            
            log(`Extension tests completed. Overall success: ${results.overall}`);
            return results;
            
        } catch (error) {
            log(`Error running extension tests: ${error.message}`);
            results.overall = false;
            results.error = error.message;
            return results;
        }
    }

    /**
     * Get statistics from all services
     * @returns {Object} Combined statistics
     */
    getStatistics() {
        const stats = {
            timestamp: new Date().toISOString(),
            extension: {
                enabled: !!this._indicator,
                servicesCount: Object.keys(this._services).length
            }
        };
        
        // Collect statistics from each service
        Object.entries(this._services).forEach(([name, service]) => {
            try {
                if (typeof service.getStatistics === 'function') {
                    stats[name] = service.getStatistics();
                } else if (typeof service.getDetailedState === 'function') {
                    stats[name] = service.getDetailedState();
                }
            } catch (error) {
                stats[name] = { error: error.message };
            }
        });
        
        return stats;
    }

    /**
     * Reset all services to their initial state
     */
    resetServices() {
        log('Resetting all services...');
        
        try {
            // Reset state manager first
            if (this._services.stateManager) {
                this._services.stateManager.reset();
            }
            
            // Clear caches and histories
            Object.entries(this._services).forEach(([name, service]) => {
                try {
                    if (typeof service.clearCache === 'function') {
                        service.clearCache();
                    }
                    if (typeof service.clearHistory === 'function') {
                        service.clearHistory();
                    }
                    if (typeof service.reset === 'function') {
                        service.reset();
                    }
                } catch (error) {
                    log(`Error resetting ${name}: ${error.message}`);
                }
            });
            
            log('All services reset successfully');
            
        } catch (error) {
            log(`Error resetting services: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clean up all resources
     * @private
     */
    _cleanup() {
        // Remove keyboard shortcuts
        if (this._keyBindingId) {
            log('Removing keyboard shortcut bindings...');
            try {
                Main.wm.removeKeybinding('toggle-recording-shortcut');
            } catch (error) {
                log(`Error removing toggle-recording-shortcut: ${error.message}`);
            }
            this._keyBindingId = null;
        }

        // Destroy UI components
        if (this._indicator) {
            log('Destroying indicator...');
            try {
                this._indicator.destroy();
            } catch (error) {
                log(`Error destroying indicator: ${error.message}`);
            }
            if (Main.panel.statusArea['speech-panel'] === this._indicator)
                Main.panel.statusArea['speech-panel'] = null;
            this._indicator = null;
        }

        // Clean up services in reverse dependency order
        log('Cleaning up services...');
        const serviceCleanupOrder = [
            'typeAsIStreamService',
            'typeAsISpeakService',
            'textInserter',
            'speechTranscriber', 
            'audioRecorder',
            'dingService',
            'notificationService',
            'logService',
            'stateManager',
            'settingsManager'
        ];

        serviceCleanupOrder.forEach(serviceName => {
            if (this._services[serviceName]) {
                try {
                    if (typeof this._services[serviceName].destroy === 'function') {
                        this._services[serviceName].destroy();
                    }
                } catch (error) {
                    log(`Error destroying ${serviceName}: ${error.message}`);
                }
                this._services[serviceName] = null;
            }
        });

        // Clear services object
        this._services = {};
        
        log('Cleanup completed');
    }

    /**
     * Emergency reset - force clean state
     */
    emergencyReset() {
        log('Performing emergency reset...');
        
        try {
            // Force disable if enabled
            if (this._indicator) {
                this.disable();
            }
            
            // Re-enable after short delay
            setTimeout(() => {
                try {
                    this.enable();
                    log('Emergency reset completed successfully');
                } catch (error) {
                    log(`Error during emergency reset re-enable: ${error.message}`);
                }
            }, 1000);
            
        } catch (error) {
            log(`Error during emergency reset: ${error.message}`);
            throw error;
        }
    }
}