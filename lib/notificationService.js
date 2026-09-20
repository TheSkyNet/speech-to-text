/* notificationService.js
 * 
 * Notification service implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only notifications
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {INotificationService} from './interfaces.js';
import {log as loggerLog} from './logger.js';

function log(message) {
    loggerLog(message, 'NotificationService');
}

/**
 * Notification service implementation using GNOME Shell notifications
 * Implements INotificationService interface following Single Responsibility Principle
 */
export class NotificationService extends INotificationService {
    constructor(settingsManager) {
        super();
        this._settingsManager = settingsManager;
        this._notificationHistory = [];
        this._maxHistorySize = 50;
    }

    /**
     * Show notification message using GNOME Shell's notification system
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} icon - Optional icon name (defaults to extension icon)
     */
    notify(title, message, icon = null) {
        if (!this.enabled) {
            log(`Notifications disabled, skipping: ${title} - ${message}`);
            return;
        }

        try {
            log(`Showing notification: ${title} - ${message}`);
            
            // Use GNOME Shell's notification system
            Main.notify(title, message, icon);
            
            // Add to history
            this._addToHistory(title, message, icon);
            
        } catch (error) {
            console.error(`[NotificationService] Error showing notification: ${error.message}`);
            console.error(error.stack);
        }
    }

    /**
     * Show a critical interaction warning even when routine notifications are
     * disabled, so insertion failures are actionable instead of silent.
     */
    notifyImportant(title, message, icon = 'dialog-warning-symbolic') {
        try {
            const compactTitle = String(title || 'Speech Panel').replace(/\s+/g, ' ').trim();
            const compactMessage = String(message || '').replace(/\s+/g, ' ').trim();
            Main.notify(compactTitle, compactMessage, icon);
            this._addToHistory(compactTitle, compactMessage, icon);
        } catch (error) {
            console.error(`[NotificationService] Error showing important notification: ${error.message}`);
        }
    }

    /**
     * Check if notifications are enabled in settings
     * @returns {boolean}
     */
    get enabled() {
        try {
            return this._settingsManager.getBoolean('show-notifications');
        } catch (error) {
            log(`Error checking notification setting: ${error.message}`);
            return false;
        }
    }

    /**
     * Show success notification with standard formatting
     * @param {string} message - Success message
     * @param {string} details - Optional details
     */
    notifySuccess(message, details = null) {
        const fullMessage = details ? `${message}\n${details}` : message;
        this.notify('Speech Panel', `✅ ${fullMessage}`, 'emblem-default-symbolic');
    }

    /**
     * Show error notification with standard formatting
     * @param {string} message - Error message
     * @param {string} details - Optional error details
     */
    notifyError(message, details = null) {
        const fullMessage = details ? `${message}\n${details}` : message;
        this.notify('Speech Panel', `❌ ${fullMessage}`, 'dialog-error-symbolic');
    }

    /**
     * Show warning notification with standard formatting
     * @param {string} message - Warning message
     * @param {string} details - Optional warning details
     */
    notifyWarning(message, details = null) {
        const fullMessage = details ? `${message}\n${details}` : message;
        this.notify('Speech Panel', `⚠️ ${fullMessage}`, 'dialog-warning-symbolic');
    }

    /**
     * Show info notification with standard formatting
     * @param {string} message - Info message
     * @param {string} details - Optional info details
     */
    notifyInfo(message, details = null) {
        const fullMessage = details ? `${message}\n${details}` : message;
        this.notify('Speech Panel', `ℹ️ ${fullMessage}`, 'dialog-information-symbolic');
    }

    /**
     * Show recording status notification
     * @param {string} status - Recording status ('started', 'stopped', 'processing')
     * @param {string} details - Optional details
     */
    notifyRecordingStatus(status, details = null) {
        let icon, message;
        
        switch (status) {
            case 'started':
                icon = 'audio-input-microphone-symbolic';
                message = '🎤 Recording started';
                break;
            case 'stopped':
                icon = 'media-playback-stop-symbolic';
                message = '⏹️ Recording stopped';
                break;
            case 'processing':
                icon = 'system-run-symbolic';
                message = '🔄 Processing audio...';
                break;
            default:
                icon = 'audio-input-microphone-symbolic';
                message = `🎤 Recording: ${status}`;
        }
        
        const fullMessage = details ? `${message}\n${details}` : message;
        this.notify('Speech Panel', fullMessage, icon);
    }

    /**
     * Show transcription result notification
     * @param {string} transcribedText - The transcribed text
     * @param {boolean} success - Whether transcription was successful
     */
    notifyTranscriptionResult(transcribedText, success = true) {
        if (success && transcribedText && transcribedText.length > 0) {
            const previewText = transcribedText.substring(0, 100) + 
                               (transcribedText.length > 100 ? '...' : '');
            this.notifySuccess('Transcription completed', previewText);
        } else if (success && (!transcribedText || transcribedText.length === 0)) {
            this.notifyWarning('No speech detected in audio');
        } else {
            this.notifyError('Transcription failed');
        }
    }

    /**
     * Show text insertion notification
     * @param {string} insertedText - The text that was inserted
     * @param {boolean} success - Whether insertion was successful
     */
    notifyTextInsertion(insertedText, success = true) {
        if (success) {
            const previewText = insertedText.substring(0, 50) + 
                               (insertedText.length > 50 ? '...' : '');
            this.notifySuccess('Text inserted', previewText);
        } else {
            this.notifyError('Text insertion failed');
        }
    }

    /**
     * Test notification functionality
     * @returns {Promise<Object>} Test result with success flag and message
     */
    async testNotifications() {
        log('Testing notification functionality...');
        
        try {
            if (!this.enabled) {
                return {
                    success: false,
                    message: 'Notifications are disabled in settings'
                };
            }

            // Test basic notification
            this.notify('Speech Panel Test', 'Testing notification system...');
            
            // Test different notification types
            await new Promise(resolve => setTimeout(resolve, 500));
            this.notifySuccess('Success notification test');
            
            await new Promise(resolve => setTimeout(resolve, 500));
            this.notifyInfo('Info notification test');
            
            await new Promise(resolve => setTimeout(resolve, 500));
            this.notifyWarning('Warning notification test');
            
            // Don't test error notification to avoid confusion
            
            log('Notification test completed successfully');
            return {
                success: true,
                message: 'Notification system working correctly. Check your notification area.'
            };
            
        } catch (error) {
            return {
                success: false,
                message: `Notification test failed: ${error.message}`
            };
        }
    }

    /**
     * Get notification history
     * @returns {Array} Array of notification objects
     */
    getHistory() {
        return [...this._notificationHistory];
    }

    /**
     * Clear notification history
     */
    clearHistory() {
        this._notificationHistory = [];
        log('Notification history cleared');
    }

    /**
     * Get notification statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        const stats = {
            total: this._notificationHistory.length,
            byType: {},
            recent: this._notificationHistory.slice(-10)
        };

        // Count by type (based on icon or message content)
        this._notificationHistory.forEach(notification => {
            if (notification.message.startsWith('✅')) {
                stats.byType.success = (stats.byType.success || 0) + 1;
            } else if (notification.message.startsWith('❌')) {
                stats.byType.error = (stats.byType.error || 0) + 1;
            } else if (notification.message.startsWith('⚠️')) {
                stats.byType.warning = (stats.byType.warning || 0) + 1;
            } else if (notification.message.startsWith('ℹ️')) {
                stats.byType.info = (stats.byType.info || 0) + 1;
            } else if (notification.message.includes('🎤')) {
                stats.byType.recording = (stats.byType.recording || 0) + 1;
            } else {
                stats.byType.other = (stats.byType.other || 0) + 1;
            }
        });

        return stats;
    }

    /**
     * Enable or disable notifications temporarily (runtime only)
     * @param {boolean} enabled - Whether to enable notifications
     */
    setEnabled(enabled) {
        log(`Notifications ${enabled ? 'enabled' : 'disabled'} (runtime only)`);
        this._runtimeEnabled = enabled;
    }

    /**
     * Check if notifications are enabled (considering both settings and runtime state)
     * @returns {boolean}
     */
    get isRuntimeEnabled() {
        if (this._runtimeEnabled !== undefined) {
            return this._runtimeEnabled && this.enabled;
        }
        return this.enabled;
    }

    /**
     * Add notification to history
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} icon - Notification icon
     * @private
     */
    _addToHistory(title, message, icon) {
        const notification = {
            title,
            message,
            icon,
            timestamp: new Date().toISOString(),
            id: Date.now() + Math.random()
        };

        this._notificationHistory.push(notification);
        
        // Trim history if it gets too large
        if (this._notificationHistory.length > this._maxHistorySize) {
            this._notificationHistory = this._notificationHistory.slice(-this._maxHistorySize);
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        log('Destroying NotificationService...');
        
        // Clear history
        this.clearHistory();
        
        // Reset runtime state
        this._runtimeEnabled = undefined;
        
        log('NotificationService destroyed');
    }
}