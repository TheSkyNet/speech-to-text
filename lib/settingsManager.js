/* settingsManager.js
 * 
 * Settings management implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only settings operations
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import {ISettingsManager} from './interfaces.js';
import {log as loggerLog} from './logger.js';

function log(message) {
    loggerLog(message, 'SettingsManager');
}

/**
 * Settings management implementation using GSettings
 * Implements ISettingsManager interface following Single Responsibility Principle
 */
export class SettingsManager extends ISettingsManager {
    constructor(gSettings) {
        super();
        this._settings = gSettings;
        this._connections = new Map();
        this._settingsCache = new Map();
        this._cacheEnabled = true;
        this._cacheTimeout = 5000; // 5 seconds cache timeout
        
        log('SettingsManager initialized');
    }

    /**
     * Get string setting value
     * @param {string} key - Setting key
     * @returns {string}
     */
    getString(key) {
        try {
            const cachedValue = this._getCachedValue(key);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const value = this._settings.get_string(key);
            this._setCachedValue(key, value);
            log(`Got string setting ${key}: "${value}"`);
            return value;
        } catch (error) {
            log(`Error getting string setting ${key}: ${error.message}`);
            throw new Error(`Failed to get string setting '${key}': ${error.message}`);
        }
    }

    /**
     * Get integer setting value
     * @param {string} key - Setting key
     * @returns {number}
     */
    getInt(key) {
        try {
            const cachedValue = this._getCachedValue(key);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const value = this._settings.get_int(key);
            this._setCachedValue(key, value);
            log(`Got integer setting ${key}: ${value}`);
            return value;
        } catch (error) {
            log(`Error getting integer setting ${key}: ${error.message}`);
            throw new Error(`Failed to get integer setting '${key}': ${error.message}`);
        }
    }

    /**
     * Get boolean setting value
     * @param {string} key - Setting key
     * @returns {boolean}
     */
    getBoolean(key) {
        try {
            const cachedValue = this._getCachedValue(key);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const value = this._settings.get_boolean(key);
            this._setCachedValue(key, value);
            log(`Got boolean setting ${key}: ${value}`);
            return value;
        } catch (error) {
            log(`Error getting boolean setting ${key}: ${error.message}`);
            throw new Error(`Failed to get boolean setting '${key}': ${error.message}`);
        }
    }

    /**
     * Set boolean setting value
     * @param {string} key - Setting key
     * @param {boolean} value - New value
     */
    setBoolean(key, value) {
        try {
            this._settings.set_boolean(key, value);
            this._invalidateCachedValue(key);
            log(`Set boolean setting ${key} = ${value}`);
        } catch (error) {
            log(`Error setting boolean setting ${key}: ${error.message}`);
            throw new Error(`Failed to set boolean setting '${key}': ${error.message}`);
        }
    }

    /**
     * Get string array setting value
     * @param {string} key - Setting key
     * @returns {string[]}
     */
    getStrv(key) {
        try {
            const cachedValue = this._getCachedValue(key);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const value = this._settings.get_strv(key);
            this._setCachedValue(key, value);
            log(`Got string array setting ${key}: [${value.join(', ')}]`);
            return value;
        } catch (error) {
            log(`Error getting string array setting ${key}: ${error.message}`);
            throw new Error(`Failed to get string array setting '${key}': ${error.message}`);
        }
    }

    /**
     * Set string setting value
     * @param {string} key - Setting key
     * @param {string} value - Setting value
     */
    setString(key, value) {
        try {
            this._settings.set_string(key, value);
            this._invalidateCachedValue(key);
            log(`Set string setting ${key}: "${value}"`);
        } catch (error) {
            log(`Error setting string value ${key}: ${error.message}`);
            throw new Error(`Failed to set string setting '${key}': ${error.message}`);
        }
    }

    /**
     * Set integer setting value
     * @param {string} key - Setting key
     * @param {number} value - Setting value
     */
    setInt(key, value) {
        try {
            this._settings.set_int(key, value);
            this._invalidateCachedValue(key);
            log(`Set integer setting ${key}: ${value}`);
        } catch (error) {
            log(`Error setting integer value ${key}: ${error.message}`);
            throw new Error(`Failed to set integer setting '${key}': ${error.message}`);
        }
    }

    /**
     * Set boolean setting value
     * @param {string} key - Setting key
     * @param {boolean} value - Setting value
     */
    setBoolean(key, value) {
        try {
            this._settings.set_boolean(key, value);
            this._invalidateCachedValue(key);
            log(`Set boolean setting ${key}: ${value}`);
        } catch (error) {
            log(`Error setting boolean value ${key}: ${error.message}`);
            throw new Error(`Failed to set boolean setting '${key}': ${error.message}`);
        }
    }

    /**
     * Set string array setting value
     * @param {string} key - Setting key
     * @param {string[]} value - Setting value
     */
    setStrv(key, value) {
        try {
            this._settings.set_strv(key, value);
            this._invalidateCachedValue(key);
            log(`Set string array setting ${key}: [${value.join(', ')}]`);
        } catch (error) {
            log(`Error setting string array value ${key}: ${error.message}`);
            throw new Error(`Failed to set string array setting '${key}': ${error.message}`);
        }
    }

    /**
     * Connect to setting change events
     * @param {string} key - Setting key to watch (use 'changed::key-name' format)
     * @param {Function} callback - Callback function
     * @returns {number} Connection ID
     */
    connect(key, callback) {
        try {
            const signalName = key.startsWith('changed::') ? key : `changed::${key}`;
            const cacheKey = key.startsWith('changed::') ? key.slice('changed::'.length) : key;
            const connectionId = this._settings.connect(signalName, (...args) => {
                this._invalidateCachedValue(cacheKey);
                callback(...args);
            });
            
            // Store connection for cleanup
            if (!this._connections.has(key)) {
                this._connections.set(key, []);
            }
            this._connections.get(key).push(connectionId);
            
            log(`Connected to setting change: ${signalName} (ID: ${connectionId})`);
            return connectionId;
        } catch (error) {
            log(`Error connecting to setting ${key}: ${error.message}`);
            throw new Error(`Failed to connect to setting '${key}': ${error.message}`);
        }
    }

    /**
     * Disconnect from setting change event
     * @param {number} connectionId - Connection ID returned from connect()
     */
    disconnect(connectionId) {
        try {
            this._settings.disconnect(connectionId);
            
            // Remove from connections tracking
            for (const [key, connections] of this._connections.entries()) {
                const index = connections.indexOf(connectionId);
                if (index !== -1) {
                    connections.splice(index, 1);
                    if (connections.length === 0) {
                        this._connections.delete(key);
                    }
                    break;
                }
            }
            
            log(`Disconnected from setting change (ID: ${connectionId})`);
        } catch (error) {
            log(`Error disconnecting from setting: ${error.message}`);
        }
    }

    /**
     * Check if a setting key exists
     * @param {string} key - Setting key
     * @returns {boolean}
     */
    hasKey(key) {
        try {
            return this._settings.list_keys().includes(key);
        } catch (error) {
            log(`Error checking if key exists ${key}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get all available setting keys
     * @returns {string[]}
     */
    listKeys() {
        try {
            const keys = this._settings.list_keys();
            log(`Available settings keys: ${keys.join(', ')}`);
            return keys;
        } catch (error) {
            log(`Error listing keys: ${error.message}`);
            return [];
        }
    }

    /**
     * Reset a setting to its default value
     * @param {string} key - Setting key
     */
    reset(key) {
        try {
            this._settings.reset(key);
            this._invalidateCachedValue(key);
            log(`Reset setting ${key} to default`);
        } catch (error) {
            log(`Error resetting setting ${key}: ${error.message}`);
            throw new Error(`Failed to reset setting '${key}': ${error.message}`);
        }
    }

    /**
     * Reset all settings to their default values
     */
    resetAll() {
        try {
            const keys = this.listKeys();
            keys.forEach(key => {
                this.reset(key);
            });
            this._clearCache();
            log('Reset all settings to defaults');
        } catch (error) {
            log(`Error resetting all settings: ${error.message}`);
            throw new Error(`Failed to reset all settings: ${error.message}`);
        }
    }

    /**
     * Get setting value as generic type (auto-detects type)
     * @param {string} key - Setting key
     * @returns {*} Setting value
     */
    getValue(key) {
        try {
            const variant = this._settings.get_value(key);
            const typeString = variant.get_type_string();
            
            switch (typeString) {
                case 's':
                    return this.getString(key);
                case 'i':
                case 'u':
                    return this.getInt(key);
                case 'b':
                    return this.getBoolean(key);
                case 'as':
                    return this.getStrv(key);
                default:
                    log(`Unsupported setting type for ${key}: ${typeString}`);
                    return null;
            }
        } catch (error) {
            log(`Error getting generic value for ${key}: ${error.message}`);
            throw new Error(`Failed to get setting '${key}': ${error.message}`);
        }
    }

    /**
     * Enable or disable settings caching
     * @param {boolean} enabled - Whether to enable caching
     */
    setCacheEnabled(enabled) {
        this._cacheEnabled = enabled;
        if (!enabled) {
            this._clearCache();
        }
        log(`Settings cache ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Clear the settings cache
     */
    clearCache() {
        this._clearCache();
    }

    /**
     * Get cached value if available and not expired
     * @param {string} key - Setting key
     * @returns {*} Cached value or undefined
     * @private
     */
    _getCachedValue(key) {
        if (!this._cacheEnabled) {
            return undefined;
        }

        const cached = this._settingsCache.get(key);
        if (!cached) {
            return undefined;
        }

        // Check if cache entry is expired
        if (Date.now() - cached.timestamp > this._cacheTimeout) {
            this._settingsCache.delete(key);
            return undefined;
        }

        return cached.value;
    }

    /**
     * Set cached value with timestamp
     * @param {string} key - Setting key
     * @param {*} value - Value to cache
     * @private
     */
    _setCachedValue(key, value) {
        if (!this._cacheEnabled) {
            return;
        }

        this._settingsCache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Invalidate cached value for a key
     * @param {string} key - Setting key
     * @private
     */
    _invalidateCachedValue(key) {
        this._settingsCache.delete(key);
    }

    /**
     * Clear all cached values
     * @private
     */
    _clearCache() {
        this._settingsCache.clear();
        log('Settings cache cleared');
    }

    /**
     * Get settings statistics and information
     * @returns {Object} Settings statistics
     */
    getStatistics() {
        const stats = {
            totalKeys: this.listKeys().length,
            activeConnections: Array.from(this._connections.values()).flat().length,
            cacheSize: this._settingsCache.size,
            cacheEnabled: this._cacheEnabled,
            cacheTimeout: this._cacheTimeout
        };

        log(`Settings statistics: ${JSON.stringify(stats)}`);
        return stats;
    }

    /**
     * Export all settings to a plain object
     * @returns {Object} Settings object
     */
    exportSettings() {
        const settings = {};
        const keys = this.listKeys();
        
        keys.forEach(key => {
            try {
                settings[key] = this.getValue(key);
            } catch (error) {
                log(`Error exporting setting ${key}: ${error.message}`);
            }
        });

        log(`Exported ${Object.keys(settings).length} settings`);
        return settings;
    }

    /**
     * Clean up resources and connections
     */
    destroy() {
        log('Destroying SettingsManager...');
        
        // Disconnect all connections
        for (const [key, connections] of this._connections.entries()) {
            connections.forEach(connectionId => {
                try {
                    this._settings.disconnect(connectionId);
                } catch (error) {
                    log(`Error disconnecting ${connectionId}: ${error.message}`);
                }
            });
        }
        this._connections.clear();
        
        // Clear cache
        this._clearCache();
        
        log('SettingsManager destroyed');
    }
}