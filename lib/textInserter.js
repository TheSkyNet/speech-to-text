/* textInserter.js
 * 
 * Text insertion implementation for Speech Panel extension
 * Following Single Responsibility Principle - handles only text insertion
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Atspi from 'gi://Atspi';
import {ITextInserter} from './interfaces.js';

function log(message) {
    console.log(`[TextInserter] ${message}`);
}

/**
 * Text insertion implementation using clipboard and virtual keyboard
 * Implements ITextInserter interface following Single Responsibility Principle
 */
export class TextInserter extends ITextInserter {
    constructor(notificationService) {
        super();
        this._notificationService = notificationService;
        this._capturedFocus = null;
        this._capturedWindow = null;
        this._externalFocusRestored = false;
        this._lastEditableFocus = null;
        this._lastEditableFocusAt = 0;
        this._focusListener = null;
        this._missingFocusNotified = false;
        this._insertionQueue = Promise.resolve();
        this._startFocusTracking();
    }

    _startFocusTracking() {
        try {
            this._focusListener = Atspi.EventListener.new(event => {
                try {
                    const source = event?.source;
                    const focused = event?.detail1 === 1 ||
                        event?.detail1 === true ||
                        event?.detail1 === '1' ||
                        event?.detail1 === 'true';
                    if (focused && this._isEditableAccessible(source)) {
                        this._lastEditableFocus = source;
                        this._lastEditableFocusAt = Date.now();
                        log(`Remembered editable keyboard-caret target: ${this._accessibleDescription(source)}`);
                    }
                } catch (error) {
                    log(`Focus event processing failed: ${error.message}`);
                }
            });
            this._focusListener.register('object:state-changed:focused');
            log('AT-SPI editable focus tracking enabled');
        } catch (error) {
            log(`Could not enable AT-SPI focus tracking: ${error.message}`);
        }
    }

    /**
     * Preserve the focused editable object while recording is controlled from
     * the shell panel. This keeps live insertion aimed at the user's field.
     */
    captureFocus() {
        this._capturedFocus = null;
        this._capturedWindow = null;
        this._externalFocusRestored = false;
        this._missingFocusNotified = false;

        // Keep the application window as a fallback for restoring activation
        try {
            const display = global.display;
            const focusWindow = display?.focus_window || display?.get_focus_window?.();
            if (focusWindow) {
                this._capturedWindow = focusWindow;
                log(`Captured focused window: ${this._windowDescription(focusWindow)}`);
            }
        } catch (error) {
            log(`Could not capture focused window: ${error.message}`);
        }

        try {
            const desktop = Atspi.get_desktop(0);
            const recentFocus = this._lastEditableFocus &&
                Date.now() - this._lastEditableFocusAt <= 5000
                ? this._lastEditableFocus
                : null;
            // The latest focused editable event is more trustworthy than a
            // desktop-tree walk, which can return an older editor exposed by
            // another application.
            const focus = recentFocus || this._findFocusedAccessible(desktop);
            if (focus) {
                this._capturedFocus = focus;
                let caret = 'unknown';
                try {
                    if (typeof focus.get_caret_offset === 'function')
                        caret = String(focus.get_caret_offset());
                } catch (_) {}
                log(`Captured focused keyboard-caret object (caret=${caret}): ${this._accessibleDescription(focus)}`);
            }
        } catch (error) {
            log(`Could not capture focused editable: ${error.message}`);
        }
    }

    releaseFocus() {
        this._capturedFocus = null;
        this._capturedWindow = null;
        this._missingFocusNotified = false;
    }

    _windowDescription(window) {
        try {
            const title = window.get_title?.() || '';
            const wmClass = window.get_wm_class?.() || '';
            return [wmClass, title].filter(Boolean).join(' — ') || 'unnamed application';
        } catch (_) {
            return 'application window';
        }
    }

    _accessibleDescription(accessible) {
        try {
            const role = accessible.get_role_name?.() || accessible.get_role?.() || 'unknown role';
            const name = accessible.get_name?.() || '';
            const app = accessible.get_application?.()?.get_name?.() || '';
            return [app, role, name].filter(Boolean).join(' / ') || 'unnamed editable';
        } catch (_) {
            return 'editable target';
        }
    }

    _findFocusedAccessible(root, depth = 0, visited = new Set()) {
        if (!root || depth > 32 || visited.has(root))
            return null;
        visited.add(root);

        let childCount = 0;
        try {
            childCount = Math.min(Number(root.get_child_count?.() || 0), 512);
        } catch (_) {}

        for (let i = 0; i < childCount; i++) {
            let child = null;
            try {
                child = root.get_child_at_index(i);
            } catch (_) {}
            const focused = this._findFocusedAccessible(child, depth + 1, visited);
            if (focused)
                return focused;
        }

        try {
            const stateSet = root.get_state_set?.();
            if (stateSet?.contains?.(Atspi.StateType.FOCUSED) &&
                this._isEditableAccessible(root))
                return root;
        } catch (_) {}
        return null;
    }

    _isEditableAccessible(accessible) {
        try {
            const interfaces = accessible.get_interfaces?.() || [];
            if (interfaces.includes('EditableText'))
                return true;
        } catch (_) {}
        try {
            if (accessible.is_editable_text?.() === true)
                return true;
            return accessible.get_state_set?.().contains?.(Atspi.StateType.EDITABLE) === true;
        } catch (_) {
            return false;
        }
    }

    async _insertViaEditableText(text) {
        const accessible = this._capturedFocus;
        if (!accessible)
            throw new Error('No editable text object captured');

        let caret = 0;
        try {
            if (typeof accessible.get_caret_offset === 'function')
                caret = Math.max(0, Number(accessible.get_caret_offset()) || 0);
        } catch (_) {}

        let editable = accessible;
        try {
            const iface = accessible.get_editable_text_iface?.();
            if (iface)
                editable = iface;
        } catch (_) {}

        if (typeof editable.insert_text !== 'function')
            throw new Error('Focused object has no native editable-text insertion method');

        const result = editable.insert_text(caret, text, text.length);
        if (result === false)
            throw new Error('The application rejected native text insertion');
        log(`Inserted ${text.length} characters at caret offset ${caret} via AT-SPI EditableText`);
    }

    _resolveWtype() {
        const candidates = [
            GLib.getenv('SPEECH_PANEL_WTYPE'),
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'wtype']),
            GLib.find_program_in_path?.('wtype'),
        ].filter(Boolean);
        for (const candidate of candidates) {
            try {
                if (this._fileExists(candidate))
                    return candidate;
            } catch (_) {}
        }
        return null;
    }

    async _insertViaWtype(text) {
        const executable = this._resolveWtype();
        if (!executable)
            throw new Error('Wayland wtype helper is not installed');

        // Reactivate only the application window captured immediately before
        // the panel click; never grab the old AT-SPI object here.
        if (this._capturedWindow?.activate) {
            const timestamp = typeof global.get_current_time === 'function'
                ? global.get_current_time()
                : 0;
            this._capturedWindow.activate(timestamp);
            await new Promise(resolve => setTimeout(resolve, 35));
        }

        await new Promise((resolve, reject) => {
            let process;
            try {
                process = Gio.Subprocess.new(
                    [executable, '--', text],
                    Gio.SubprocessFlags.STDERR_PIPE
                );
                process.communicate_utf8_async(null, null, (_process, result) => {
                    try {
                        const [, stdout, stderr] = process.communicate_utf8_finish(result);
                        if (!process.get_successful()) {
                            reject(new Error((stderr || 'wtype failed').trim()));
                            return;
                        }
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
        log(`Inserted ${text.length} characters via Wayland wtype`);
    }

    _resolveYdotool(name) {
        const candidates = [
            GLib.getenv('SPEECH_PANEL_YDOTOOL'),
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', name]),
            GLib.find_program_in_path?.(name),
        ].filter(Boolean);
        for (const candidate of candidates) {
            if (this._fileExists(candidate))
                return candidate;
        }
        return null;
    }

    _resolveDotool(name) {
        const candidates = [
            GLib.getenv('SPEECH_PANEL_DOTOOL'),
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', name]),
            GLib.find_program_in_path?.(name),
        ].filter(Boolean);
        for (const candidate of candidates) {
            if (this._fileExists(candidate))
                return candidate;
        }
        return null;
    }

    _fileExists(path) {
        try {
            return Gio.File.new_for_path(path).query_exists(null);
        } catch (_) {
            return false;
        }
    }

    async _insertViaDotool(text) {
        const client = this._resolveDotool('dotoolc');
        if (!client)
            throw new Error('dotoolc is not installed');

        if (!this._externalFocusRestored && this._capturedWindow?.activate) {
            const timestamp = typeof global.get_current_time === 'function'
                ? global.get_current_time()
                : 0;
            this._capturedWindow.activate(timestamp);
            await new Promise(resolve => setTimeout(resolve, 80));
            this._externalFocusRestored = true;
        }

        const process = Gio.Subprocess.new(
            [client],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE |
                Gio.SubprocessFlags.STDERR_PIPE
        );
        const command = `typedelay 2\ntype ${String(text).replace(/\r?\n/g, ' ')}\n`;
        await new Promise((resolve, reject) => {
            process.communicate_utf8_async(command, null, (_process, result) => {
                try {
                    const [, , stderr] = process.communicate_utf8_finish(result);
                    if (!process.get_successful()) {
                        reject(new Error((stderr || 'dotoolc failed').trim()));
                        return;
                    }
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        log(`Inserted ${text.length} characters via dotool`);
    }

    _notifyMissingFocus() {
        if (this._missingFocusNotified)
            return;
        this._missingFocusNotified = true;
        const message = 'No active application cursor was detected. Click inside the chat or text field before starting speech.';
        log(message);
        this._notificationService?.notifyImportant?.('Speech Panel — No active cursor', message);
    }

    /**
     * Insert text into the currently focused input using clipboard and Ctrl+V simulation
     * @param {string} text - Text to insert
     * @param {Object|boolean} [options] - Optional options or legacy boolean. If true or {silent:true}, suppress notifications.
     * @returns {Promise<void>}
     */
    async insertText(text, options = null) {
        const insertion = this._insertionQueue.then(() => this._insertTextNow(text, options));
        this._insertionQueue = insertion.catch(() => {});
        return insertion;
    }

    async _insertTextNow(text, options = null) {
        const silent = options === true || (options && options.silent === true);
        log(`Inserting text: "${text?.substring(0, 50) || ''}${text && text.length > 50 ? '...' : ''}"`);
        
        if (!text || text.length === 0) {
            log('No text provided for insertion');
            return;
        }

        try {
            let inserted = false;

            // Use the already-running external dotool daemon. Never spawn an
            // input daemon from GNOME Shell because a uinput failure can hang
            // the compositor.
            try {
                await this._insertViaDotool(text);
                inserted = true;
            } catch (dotoolError) {
                log(`dotool insertion unavailable: ${dotoolError.message}`);
            }

            // wtype uses the Wayland virtual-keyboard protocol and works with
            // browser chat fields that do not expose AT-SPI EditableText.
            if (!inserted) try {
                await this._insertViaWtype(text);
                inserted = true;
            } catch (wtypeError) {
                log(`Wayland wtype insertion unavailable: ${wtypeError.message}`);
            }

            // Native AT-SPI insertion must use the field captured before the
            // panel click. Reactivating the old window here can move focus
            // back to a previous editor instead of the user's current field.
            if (!inserted && this._capturedFocus && this._isEditableAccessible(this._capturedFocus)) {
                try {
                    await this._insertViaEditableText(text);
                    inserted = true;
                    log('Inserted text via AT-SPI EditableText');
                } catch (atspiError) {
                    log(`AT-SPI insertion not possible: ${atspiError.message}`);
                }
            }

            if (!inserted)
                throw new Error('No typing backend accepted the text');

            log('Text insertion completed successfully');
            
            if (!silent && this._notificationService.enabled) {
                const previewText = text.substring(0, 50) + (text.length > 50 ? '...' : '');
                this._notificationService.notify('Speech Panel', `Text inserted: ${previewText}`);
            }

        } catch (error) {
            log(`Text insertion error: ${error.message}`);

            if (!silent && this._notificationService.enabled) {
                this._notificationService.notify('Speech Panel', `Text insertion failed: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Check if text insertion is available
     * @returns {boolean}
     */
    isAvailable() {
        try {
            // Check if clipboard is available
            const clipboard = St.Clipboard.get_default();
            if (!clipboard) {
                log('Clipboard not available');
                return false;
            }

            // Check if Clutter backend is available for virtual input
            const backend = Clutter.get_default_backend();
            if (!backend) {
                log('Clutter backend not available');
                return false;
            }

            const seat = backend.get_default_seat();
            if (!seat) {
                log('Default seat not available');
                return false;
            }

            log('Text insertion components are available');
            return true;
        } catch (error) {
            log(`Text insertion availability check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Test text insertion functionality
     * @param {string} testText - Optional test text (defaults to a standard test message)
     * @returns {Promise<Object>} Test result with success flag and message
     */
    async testTextInsertion(testText = "Hello! This is a test message from Speech Panel extension.") {
        log('Testing text insertion functionality...');
        
        try {
            if (!this.isAvailable()) {
                return {
                    success: false,
                    message: 'Text insertion components not available'
                };
            }

            // Test clipboard functionality
            const clipboardTest = await this._testClipboard(testText);
            if (!clipboardTest.success) {
                return clipboardTest;
            }

            // Test virtual keyboard functionality
            const virtualKeyboardTest = await this._testVirtualKeyboard();
            if (!virtualKeyboardTest.success) {
                return virtualKeyboardTest;
            }

            log('Text insertion test completed successfully');
            return {
                success: true,
                message: `Text insertion test successful. Test text: "${testText}"`
            };

        } catch (error) {
            return {
                success: false,
                message: `Text insertion test error: ${error.message}`
            };
        }
    }

    /**
     * Copy text to system clipboard
     * @param {string} text - Text to copy
     * @returns {Promise<void>}
     * @private
     */
    async _copyToClipboard(text) {
        try {
            const clipboard = St.Clipboard.get_default();
            if (!clipboard) {
                throw new Error('Clipboard not available');
            }

            // Use the normal clipboard selection for native paste.
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            log(`Text copied to Wayland clipboard: ${text.length} characters`);
        } catch (error) {
            log(`Clipboard error: ${error.message}`);
            throw new Error(`Failed to copy text to clipboard: ${error.message}`);
        }
    }

    async _focusTarget() {
        const focus = this._capturedFocus;
        try {
            if (this._capturedWindow && typeof this._capturedWindow.activate === 'function') {
                const timestamp = typeof global.get_current_time === 'function'
                    ? global.get_current_time()
                    : 0;
                this._capturedWindow.activate(timestamp);
                await new Promise(resolve => setTimeout(resolve, 80));
            }
            if (focus && typeof focus.grab_focus === 'function') {
                focus.grab_focus();
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            await new Promise(resolve => setTimeout(resolve, 40));
        } catch (error) {
            log(`Could not restore application text focus: ${error.message}`);
        }
    }

    async _simulateCtrlV() {
        try {
            const backend = Clutter.get_default_backend();
            const seat = backend ? backend.get_default_seat() : null;
            if (!seat) {
                throw new Error('Seat not available');
            }
            const virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

            if (!virtualDevice) {
                throw new Error('Failed to create virtual keyboard device');
            }

            // Helper function to add delay between key events
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            // Reset any modifier keys (Super, Shift, Alt) that might be held down from shortcut activation
            await this._resetModifiers(virtualDevice);
            await delay(20);

            let currentTime = Clutter.get_current_event_time();

            // Press Ctrl
            virtualDevice.notify_key(
                currentTime,
                Clutter.KEY_Control_L,
                Clutter.KeyState.PRESSED
            );

            await delay(25);
            currentTime = Clutter.get_current_event_time();

            // Press V
            virtualDevice.notify_key(
                currentTime,
                Clutter.KEY_v,
                Clutter.KeyState.PRESSED
            );

            await delay(25);
            currentTime = Clutter.get_current_event_time();

            // Release V
            virtualDevice.notify_key(
                currentTime,
                Clutter.KEY_v,
                Clutter.KeyState.RELEASED
            );

            await delay(25);
            currentTime = Clutter.get_current_event_time();

            // Release Ctrl
            virtualDevice.notify_key(
                currentTime,
                Clutter.KEY_Control_L,
                Clutter.KeyState.RELEASED
            );

            await delay(25);

            // Reset modifiers again to ensure clean keyboard state
            await this._resetModifiers(virtualDevice);

            // Properly dispose of virtual device to prevent resource leaks
            if (virtualDevice && typeof virtualDevice.dispose === 'function') {
                virtualDevice.dispose();
            }

            log('Ctrl+V simulation completed');

        } catch (error) {
            log(`Virtual keyboard error: ${error.message}`);
            throw new Error(`Failed to simulate Ctrl+V: ${error.message}`);
        }
    }

    /**
     * Test clipboard functionality
     * @param {string} testText - Test text to use
     * @returns {Promise<Object>} Test result
     * @private
     */
    async _testClipboard(testText) {
        try {
            await this._copyToClipboard(testText);
            
            // Try to read back from clipboard to verify
            return new Promise((resolve) => {
                const clipboard = St.Clipboard.get_default();
                clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
                    if (text === testText) {
                        log('Clipboard test successful');
                        resolve({
                            success: true,
                            message: 'Clipboard functionality working correctly'
                        });
                    } else {
                        log(`Clipboard test failed: expected "${testText}", got "${text}"`);
                        resolve({
                            success: false,
                            message: 'Clipboard read/write mismatch'
                        });
                    }
                });
            });
        } catch (error) {
            return {
                success: false,
                message: `Clipboard test failed: ${error.message}`
            };
        }
    }

    /**
     * Test virtual keyboard functionality
     * @returns {Promise<Object>} Test result
     * @private
     */
    async _testVirtualKeyboard() {
        try {
            const backend = Clutter.get_default_backend();
            if (!backend) {
                return {
                    success: false,
                    message: 'Clutter backend not available'
                };
            }

            const seat = backend.get_default_seat();
            if (!seat) {
                return {
                    success: false,
                    message: 'Default seat not available'
                };
            }

            const virtualDevice = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            if (!virtualDevice) {
                return {
                    success: false,
                    message: 'Failed to create virtual keyboard device'
                };
            }

            // Dispose of test device
            if (virtualDevice && typeof virtualDevice.dispose === 'function') {
                virtualDevice.dispose();
            }

            log('Virtual keyboard test successful');
            return {
                success: true,
                message: 'Virtual keyboard functionality working correctly'
            };

        } catch (error) {
            return {
                success: false,
                message: `Virtual keyboard test failed: ${error.message}`
            };
        }
    }

    /**
     * Insert text with a delay (useful for testing or when user needs time to focus input)
     * @param {string} text - Text to insert
     * @param {number} delaySeconds - Delay in seconds before insertion
     * @returns {Promise<void>}
     */
    async insertTextWithDelay(text, delaySeconds = 2) {
        log(`Inserting text with ${delaySeconds} second delay...`);
        
        if (this._notificationService.enabled) {
            this._notificationService.notify('Speech Panel', `Inserting text in ${delaySeconds} seconds...`);
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(async () => {
                try {
                    await this.insertText(text);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            }, delaySeconds * 1000);

            // Store timeout for potential cleanup
            this._delayedInsertionTimeout = timeoutId;
        });
    }

    /**
     * Cancel any pending delayed text insertion
     */
    cancelDelayedInsertion() {
        if (this._delayedInsertionTimeout) {
            clearTimeout(this._delayedInsertionTimeout);
            this._delayedInsertionTimeout = null;
            log('Cancelled delayed text insertion');
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        log('Destroying TextInserter...');
        
        // Cancel any pending delayed insertion
        this.cancelDelayedInsertion();
        this.releaseFocus();
        if (this._focusListener) {
            try {
                this._focusListener.deregister('object:state-changed:focused');
            } catch (_) {}
            this._focusListener = null;
        }
        
        log('TextInserter destroyed');
    }

    /**
     * Type text using a virtual keyboard device, character by character
     * Avoids clipboard usage and Ctrl+V simulation
     * @param {string} text
     * @returns {Promise<void>}
     * @private
     */
    async _typeTextVirtualKeyboard(text) {
        const backend = Clutter.get_default_backend();
        if (!backend)
            throw new Error('Clutter backend not available');
        const seat = backend.get_default_seat();
        if (!seat)
            throw new Error('Default seat not available');

        const vdev = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        if (!vdev)
            throw new Error('Failed to create virtual keyboard device');

        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            // Reset any held modifiers from keyboard shortcuts
            await this._resetModifiers(vdev);
            await delay(10);

            for (const ch of text) {
                const mapping = this._getKeyForChar(ch);
                if (!mapping) {
                    log(`No key mapping for character: ${JSON.stringify(ch)} — skipping`);
                    continue;
                }

                await this._pressKey(vdev, mapping.keysym, mapping.shift === true);
                // Small delay between characters to ensure reliable processing by target application
                await delay(8);
            }

            await this._resetModifiers(vdev);

        } finally {
            if (vdev && typeof vdev.dispose === 'function')
                vdev.dispose();
        }
    }

    /**
     * Press a keysym optionally with Shift modifier
     * @param {Clutter.VirtualInputDevice} vdev
     * @param {number} keysym
     * @param {boolean} withShift
     * @private
     */
    async _pressKey(vdev, keysym, withShift = false) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let t = Clutter.get_current_event_time();

        if (withShift) {
            vdev.notify_key(t, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
            await delay(10);
            t = Clutter.get_current_event_time();
        }

        vdev.notify_key(t, keysym, Clutter.KeyState.PRESSED);
        await delay(10);
        t = Clutter.get_current_event_time();
        vdev.notify_key(t, keysym, Clutter.KeyState.RELEASED);
        await delay(10);
        t = Clutter.get_current_event_time();

        if (withShift) {
            vdev.notify_key(t, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
            await delay(10);
        }
    }

    /**
     * Map a Unicode character to a Clutter keysym and whether Shift is needed
     * Supports common ASCII characters used in transcriptions.
     * @param {string} ch
     * @returns {{keysym:number, shift:boolean}|null}
     * @private
     */
    _getKeyForChar(ch) {
        if (!ch || ch.length !== 1)
            return null;

        // Newline, return, tab, space
        if (ch === '\n' || ch === '\r') return { keysym: Clutter.KEY_Return, shift: false };
        if (ch === '\t') return { keysym: Clutter.KEY_Tab, shift: false };
        if (ch === ' ') return { keysym: Clutter.KEY_space, shift: false };

        const code = ch.codePointAt(0);

        // a-z / A-Z
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
            const lower = ch.toLowerCase();
            const keysym = Clutter['KEY_' + lower];
            if (typeof keysym === 'number')
                return { keysym, shift: ch !== lower };
        }

        // 0-9
        const digitMap = {
            '0': Clutter.KEY_0,
            '1': Clutter.KEY_1,
            '2': Clutter.KEY_2,
            '3': Clutter.KEY_3,
            '4': Clutter.KEY_4,
            '5': Clutter.KEY_5,
            '6': Clutter.KEY_6,
            '7': Clutter.KEY_7,
            '8': Clutter.KEY_8,
            '9': Clutter.KEY_9,
        };
        if (digitMap[ch] !== undefined)
            return { keysym: digitMap[ch], shift: false };

        // Punctuation direct mappings
        const direct = {
            '.': Clutter.KEY_period,
            ',': Clutter.KEY_comma,
            '-': Clutter.KEY_minus,
            '=': Clutter.KEY_equal,
            '/': Clutter.KEY_slash,
            ';': Clutter.KEY_semicolon,
            "'": Clutter.KEY_apostrophe,
            '`': Clutter.KEY_grave,
            '[': Clutter.KEY_bracketleft,
            ']': Clutter.KEY_bracketright,
            '\\': Clutter.KEY_backslash,
        };
        if (direct[ch] !== undefined)
            return { keysym: direct[ch], shift: false };

        // Shifted punctuation
        const shifted = {
            '_': Clutter.KEY_minus,
            '+': Clutter.KEY_equal,
            '?': Clutter.KEY_slash,
            ':': Clutter.KEY_semicolon,
            '"': Clutter.KEY_apostrophe,
            '~': Clutter.KEY_grave,
            '{': Clutter.KEY_bracketleft,
            '}': Clutter.KEY_bracketright,
            '|': Clutter.KEY_backslash,
            '<': Clutter.KEY_comma,
            '>': Clutter.KEY_period,
            ')': Clutter.KEY_0,
            '!': Clutter.KEY_1,
            '@': Clutter.KEY_2,
            '#': Clutter.KEY_3,
            '$': Clutter.KEY_4,
            '%': Clutter.KEY_5,
            '^': Clutter.KEY_6,
            '&': Clutter.KEY_7,
            '*': Clutter.KEY_8,
            '(': Clutter.KEY_9,
        };
        if (shifted[ch] !== undefined)
            return { keysym: shifted[ch], shift: true };

        return null;
    }

    _isAscii(text) {
        try {
            // Fast path for ASCII-only detection
            return /^[\x00-\x7F]*$/.test(text);
        } catch (e) {
            // In case RegExp fails for any reason, fall back to manual check
            for (const ch of text) {
                if (ch.codePointAt(0) > 0x7F)
                    return false;
            }
            return true;
        }
    }

    _getCurrentLayout() {
        try {
            const settings = Gio.Settings.new('org.gnome.desktop.input-sources');
            const current = settings.get_int('current');
            const variant = settings.get_value('sources');
            let sources;
            try {
                sources = variant.deep_unpack();
            } catch (e) {
                // Compatibility with older GJS naming
                sources = variant.deepUnpack();
            }
            if (Array.isArray(sources) && current >= 0 && current < sources.length) {
                const entry = sources[current];
                // Expected form: ['xkb', 'us']
                if (Array.isArray(entry) && entry.length >= 2)
                    return String(entry[1]);
            }
        } catch (e) {
            log(`Failed to read current keyboard layout: ${e.message}`);
        }
        // Default to 'us' if unknown to avoid surprising fallback behavior
        return 'us';
    }

    async _resetModifiers(vdev) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const maybeRelease = async (keysym) => {
            if (typeof keysym === 'number') {
                const t = Clutter.get_current_event_time();
                vdev.notify_key(t, keysym, Clutter.KeyState.RELEASED);
                await delay(2);
            }
        };
        const mods = [
            Clutter.KEY_Shift_L,
            Clutter.KEY_Shift_R,
            Clutter.KEY_Control_L,
            Clutter.KEY_Control_R,
            Clutter.KEY_Alt_L,
            Clutter.KEY_Alt_R,
            // Some platforms use Super/Meta, release both if present
            typeof Clutter.KEY_Super_L === 'number' ? Clutter.KEY_Super_L : undefined,
            typeof Clutter.KEY_Super_R === 'number' ? Clutter.KEY_Super_R : undefined,
            typeof Clutter.KEY_Meta_L === 'number' ? Clutter.KEY_Meta_L : undefined,
            typeof Clutter.KEY_Meta_R === 'number' ? Clutter.KEY_Meta_R : undefined,
            // AltGr
            typeof Clutter.KEY_ISO_Level3_Shift === 'number' ? Clutter.KEY_ISO_Level3_Shift : undefined,
        ];
        for (const m of mods) {
            await maybeRelease(m);
        }
    }
}