/* stateManager.js
 * 
 * State management implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only state management
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import {IStateManager} from './interfaces.js';

function log(message) {
    console.log(`[StateManager] ${message}`);
}

/**
 * State management implementation with event system
 * Implements IStateManager interface following Single Responsibility Principle
 */
export class StateManager extends IStateManager {
    constructor() {
        super();
        this._currentState = 'idle';
        this._previousState = null;
        this._stateHistory = [];
        this._maxHistorySize = 20;
        this._callbacks = new Map();
        this._stateTransitions = new Map();
        this._stateTimestamps = new Map();
        
        // Define valid states and transitions
        this._validStates = ['idle', 'listening', 'processing'];
        this._defineValidTransitions();
        
        log('StateManager initialized with state: idle');
    }

    /**
     * Set current state with validation and event emission
     * @param {string} state - State name ('idle', 'listening', 'processing')
     */
    setState(state) {
        if (!this._isValidState(state)) {
            const error = `Invalid state: ${state}. Valid states: ${this._validStates.join(', ')}`;
            log(error);
            throw new Error(error);
        }

        if (!this._isValidTransition(this._currentState, state)) {
            const error = `Invalid state transition from ${this._currentState} to ${state}`;
            log(error);
            throw new Error(error);
        }

        if (this._currentState === state) {
            log(`State already set to ${state}, ignoring`);
            return;
        }

        const previousState = this._currentState;
        this._previousState = previousState;
        this._currentState = state;
        
        // Record state change in history
        this._addToHistory(previousState, state);
        
        // Record timestamp
        this._stateTimestamps.set(state, Date.now());
        
        log(`State changed from ${previousState} to ${state}`);
        
        // Emit state change events
        this._emitStateChange(state, previousState);
    }

    /**
     * Get current state
     * @returns {string} Current state name
     */
    getState() {
        return this._currentState;
    }

    /**
     * Get previous state
     * @returns {string|null} Previous state name or null if no previous state
     */
    getPreviousState() {
        return this._previousState;
    }

    /**
     * Check if currently in a specific state
     * @param {string} state - State to check
     * @returns {boolean}
     */
    isState(state) {
        return this._currentState === state;
    }

    /**
     * Check if state is idle
     * @returns {boolean}
     */
    get isIdle() {
        return this._currentState === 'idle';
    }

    /**
     * Check if state is listening
     * @returns {boolean}
     */
    get isListening() {
        return this._currentState === 'listening';
    }

    /**
     * Check if state is processing
     * @returns {boolean}
     */
    get isProcessing() {
        return this._currentState === 'processing';
    }

    /**
     * Connect to state change events
     * @param {Function} callback - Callback function (newState, previousState) => void
     * @returns {number} Connection ID for removal
     */
    onStateChanged(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }

        const id = Date.now() + Math.random();
        
        if (!this._callbacks.has('stateChanged')) {
            this._callbacks.set('stateChanged', new Map());
        }
        
        this._callbacks.get('stateChanged').set(id, callback);
        log(`Added state change callback with ID: ${id}`);
        return id;
    }

    /**
     * Connect to specific state entry events
     * @param {string} state - State to monitor
     * @param {Function} callback - Callback function (previousState) => void
     * @returns {number} Connection ID for removal
     */
    onStateEnter(state, callback) {
        if (!this._isValidState(state)) {
            throw new Error(`Invalid state: ${state}`);
        }
        
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }

        const id = Date.now() + Math.random();
        const eventName = `enter:${state}`;
        
        if (!this._callbacks.has(eventName)) {
            this._callbacks.set(eventName, new Map());
        }
        
        this._callbacks.get(eventName).set(id, callback);
        log(`Added state enter callback for ${state} with ID: ${id}`);
        return id;
    }

    /**
     * Connect to specific state exit events
     * @param {string} state - State to monitor
     * @param {Function} callback - Callback function (newState) => void
     * @returns {number} Connection ID for removal
     */
    onStateExit(state, callback) {
        if (!this._isValidState(state)) {
            throw new Error(`Invalid state: ${state}`);
        }
        
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }

        const id = Date.now() + Math.random();
        const eventName = `exit:${state}`;
        
        if (!this._callbacks.has(eventName)) {
            this._callbacks.set(eventName, new Map());
        }
        
        this._callbacks.get(eventName).set(id, callback);
        log(`Added state exit callback for ${state} with ID: ${id}`);
        return id;
    }

    /**
     * Remove event callback
     * @param {number} callbackId - Callback ID returned from on* methods
     */
    removeCallback(callbackId) {
        for (const [eventName, callbacks] of this._callbacks.entries()) {
            if (callbacks.has(callbackId)) {
                callbacks.delete(callbackId);
                if (callbacks.size === 0) {
                    this._callbacks.delete(eventName);
                }
                log(`Removed callback with ID: ${callbackId}`);
                return;
            }
        }
        log(`Callback with ID ${callbackId} not found`);
    }

    /**
     * Get state history
     * @returns {Array} Array of state transition objects
     */
    getHistory() {
        return [...this._stateHistory];
    }

    /**
     * Get time spent in current state (milliseconds)
     * @returns {number}
     */
    getTimeInCurrentState() {
        const stateStartTime = this._stateTimestamps.get(this._currentState);
        return stateStartTime ? Date.now() - stateStartTime : 0;
    }

    /**
     * Get state statistics
     * @returns {Object} Statistics object
     */
    getStatistics() {
        const stats = {
            currentState: this._currentState,
            previousState: this._previousState,
            timeInCurrentState: this.getTimeInCurrentState(),
            totalTransitions: this._stateHistory.length,
            stateFrequency: {},
            averageTimePerState: {},
            activeCallbacks: 0
        };

        // Calculate state frequency
        this._validStates.forEach(state => {
            stats.stateFrequency[state] = this._stateHistory.filter(h => h.toState === state).length;
        });

        // Calculate average time per state
        const stateTimings = new Map();
        this._stateHistory.forEach((transition, index) => {
            const nextTransition = this._stateHistory[index + 1];
            if (nextTransition) {
                const duration = nextTransition.timestamp - transition.timestamp;
                if (!stateTimings.has(transition.toState)) {
                    stateTimings.set(transition.toState, []);
                }
                stateTimings.get(transition.toState).push(duration);
            }
        });

        stateTimings.forEach((durations, state) => {
            const average = durations.reduce((sum, d) => sum + d, 0) / durations.length;
            stats.averageTimePerState[state] = Math.round(average);
        });

        // Count active callbacks
        for (const callbacks of this._callbacks.values()) {
            stats.activeCallbacks += callbacks.size;
        }

        return stats;
    }

    /**
     * Reset state to idle and clear history
     */
    reset() {
        log('Resetting state manager');
        
        const previousState = this._currentState;
        this._currentState = 'idle';
        this._previousState = null;
        this._stateHistory = [];
        this._stateTimestamps.clear();
        this._stateTimestamps.set('idle', Date.now());
        
        // Emit reset event if state actually changed
        if (previousState !== 'idle') {
            this._emitStateChange('idle', previousState);
        }
        
        log('State manager reset to idle');
    }

    /**
     * Validate if a state transition is allowed
     * @param {string} fromState - Current state
     * @param {string} toState - Target state
     * @returns {boolean}
     * @private
     */
    _isValidTransition(fromState, toState) {
        const allowedTransitions = this._stateTransitions.get(fromState) || [];
        return allowedTransitions.includes(toState);
    }

    /**
     * Check if a state name is valid
     * @param {string} state - State name
     * @returns {boolean}
     * @private
     */
    _isValidState(state) {
        return this._validStates.includes(state);
    }

    /**
     * Define valid state transitions
     * @private
     */
    _defineValidTransitions() {
        // Define allowed state transitions
        this._stateTransitions.set('idle', ['listening']);
        this._stateTransitions.set('listening', ['processing', 'idle']);
        this._stateTransitions.set('processing', ['idle']);
        
        log('State transitions defined');
    }

    /**
     * Add state transition to history
     * @param {string} fromState - Previous state
     * @param {string} toState - New state
     * @private
     */
    _addToHistory(fromState, toState) {
        const transition = {
            fromState,
            toState,
            timestamp: Date.now(),
            id: Date.now() + Math.random()
        };
        
        this._stateHistory.push(transition);
        
        // Trim history if it gets too large
        if (this._stateHistory.length > this._maxHistorySize) {
            this._stateHistory = this._stateHistory.slice(-this._maxHistorySize);
        }
    }

    /**
     * Emit state change events to registered callbacks
     * @param {string} newState - New state
     * @param {string} previousState - Previous state
     * @private
     */
    _emitStateChange(newState, previousState) {
        // Emit general state change event
        const stateChangeCallbacks = this._callbacks.get('stateChanged');
        if (stateChangeCallbacks) {
            stateChangeCallbacks.forEach((callback, id) => {
                try {
                    callback(newState, previousState);
                } catch (error) {
                    log(`Error in state change callback ${id}: ${error.message}`);
                }
            });
        }

        // Emit state exit event for previous state
        if (previousState) {
            const exitCallbacks = this._callbacks.get(`exit:${previousState}`);
            if (exitCallbacks) {
                exitCallbacks.forEach((callback, id) => {
                    try {
                        callback(newState);
                    } catch (error) {
                        log(`Error in state exit callback ${id}: ${error.message}`);
                    }
                });
            }
        }

        // Emit state enter event for new state
        const enterCallbacks = this._callbacks.get(`enter:${newState}`);
        if (enterCallbacks) {
            enterCallbacks.forEach((callback, id) => {
                try {
                    callback(previousState);
                } catch (error) {
                    log(`Error in state enter callback ${id}: ${error.message}`);
                }
            });
        }
    }

    /**
     * Get detailed state information
     * @returns {Object} Detailed state information
     */
    getDetailedState() {
        return {
            current: this._currentState,
            previous: this._previousState,
            timeInCurrent: this.getTimeInCurrentState(),
            validStates: [...this._validStates],
            validTransitions: Object.fromEntries(this._stateTransitions),
            history: this.getHistory().slice(-5), // Last 5 transitions
            statistics: this.getStatistics()
        };
    }

    /**
     * Clean up resources and callbacks
     */
    destroy() {
        log('Destroying StateManager...');
        
        // Clear all callbacks
        this._callbacks.clear();
        
        // Clear history and timestamps
        this._stateHistory = [];
        this._stateTimestamps.clear();
        
        // Reset to idle state
        this._currentState = 'idle';
        this._previousState = null;
        
        log('StateManager destroyed');
    }
}