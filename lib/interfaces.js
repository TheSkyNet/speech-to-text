/* interfaces.js
 * 
 * Interfaces and abstract classes for Speech Panel extension
 * Following Interface Segregation and Dependency Inversion principles
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/**
 * Interface for audio recording functionality
 */
export class IAudioRecorder {
    /**
     * Start recording audio
     * @param {string} outputPath - Path to save the recording
     * @param {Object} settings - Recording settings (sample rate, format, etc.)
     * @returns {Promise<void>}
     */
    async startRecording(outputPath, settings) {
        throw new Error('startRecording must be implemented');
    }

    /**
     * Stop recording audio
     * @returns {Promise<void>}
     */
    async stopRecording() {
        throw new Error('stopRecording must be implemented');
    }

    /**
     * Check if currently recording
     * @returns {boolean}
     */
    get isRecording() {
        throw new Error('isRecording getter must be implemented');
    }

    /**
     * Get maximum recording duration
     * @returns {number} Duration in seconds
     */
    get maxDuration() {
        throw new Error('maxDuration getter must be implemented');
    }
}

/**
 * Interface for speech transcription functionality
 */
export class ISpeechTranscriber {
    /**
     * Transcribe audio file to text
     * @param {string} audioFilePath - Path to audio file
     * @param {Object} settings - Transcription settings (model, language, etc.)
     * @returns {Promise<string>} Transcribed text
     */
    async transcribe(audioFilePath, settings) {
        throw new Error('transcribe must be implemented');
    }

    /**
     * Check if transcriber is available
     * @returns {boolean}
     */
    isAvailable() {
        throw new Error('isAvailable must be implemented');
    }
}

/**
 * Interface for text insertion functionality
 */
export class ITextInserter {
    /**
     * Insert text into the currently focused input
     * @param {string} text - Text to insert
     * @returns {Promise<void>}
     */
    async insertText(text) {
        throw new Error('insertText must be implemented');
    }

    /**
     * Check if text insertion is available
     * @returns {boolean}
     */
    isAvailable() {
        throw new Error('isAvailable must be implemented');
    }
}

/**
 * Interface for notification functionality
 */
export class INotificationService {
    /**
     * Show notification message
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} icon - Optional icon name
     */
    notify(title, message, icon = null) {
        throw new Error('notify must be implemented');
    }

    /**
     * Check if notifications are enabled
     * @returns {boolean}
     */
    get enabled() {
        throw new Error('enabled getter must be implemented');
    }
}

/**
 * Interface for settings management
 */
export class ISettingsManager {
    /**
     * Get string setting value
     * @param {string} key - Setting key
     * @returns {string}
     */
    getString(key) {
        throw new Error('getString must be implemented');
    }

    /**
     * Get integer setting value
     * @param {string} key - Setting key
     * @returns {number}
     */
    getInt(key) {
        throw new Error('getInt must be implemented');
    }

    /**
     * Get boolean setting value
     * @param {string} key - Setting key
     * @returns {boolean}
     */
    getBoolean(key) {
        throw new Error('getBoolean must be implemented');
    }

    /**
     * Get string array setting value
     * @param {string} key - Setting key
     * @returns {string[]}
     */
    getStrv(key) {
        throw new Error('getStrv must be implemented');
    }

    /**
     * Connect to setting change events
     * @param {string} key - Setting key to watch
     * @param {Function} callback - Callback function
     * @returns {number} Connection ID
     */
    connect(key, callback) {
        throw new Error('connect must be implemented');
    }
}

/**
 * Interface for state management
 */
export class IStateManager {
    /**
     * Set current state
     * @param {string} state - State name ('idle', 'listening', 'processing')
     */
    setState(state) {
        throw new Error('setState must be implemented');
    }

    /**
     * Get current state
     * @returns {string}
     */
    getState() {
        throw new Error('getState must be implemented');
    }

    /**
     * Connect to state change events
     * @param {Function} callback - Callback function
     * @returns {number} Connection ID
     */
    onStateChanged(callback) {
        throw new Error('onStateChanged must be implemented');
    }
}

/**
 * Interface for text-to-speech functionality
 */
export class ITextToSpeechService {
    /**
     * Generate audio file from text
     * @param {string} text - Text to convert to speech
     * @param {string} outputPath - Path to save the audio file
     * @param {Object} settings - TTS settings (voice, speed, etc.)
     * @returns {Promise<void>}
     */
    async generateAudio(text, outputPath, settings) {
        throw new Error('generateAudio must be implemented');
    }

    /**
     * Play audio file
     * @param {string} audioPath - Path to audio file to play
     * @returns {Promise<void>}
     */
    async playAudio(audioPath) {
        throw new Error('playAudio must be implemented');
    }

    /**
     * Check if TTS service is available
     * @returns {boolean}
     */
    isAvailable() {
        throw new Error('isAvailable must be implemented');
    }

    /**
     * Get available voices
     * @returns {Promise<string[]>} Array of available voice names
     */
    async getAvailableVoices() {
        throw new Error('getAvailableVoices must be implemented');
    }
}