/* prefs.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SpeechPanelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Bind settings to the extension
        this.settings = this.getSettings('org.gnome.shell.extensions.speech-panel');
        
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Keyboard Shortcuts Group
        const keyboardGroup = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Configure keyboard shortcuts for speech recognition'),
        });
        page.add(keyboardGroup);

        // Toggle recording shortcut
        const shortcutRow = new Adw.ActionRow({
            title: _('Toggle Recording'),
            subtitle: _('Keyboard shortcut to start/stop speech recording'),
        });
        
        const shortcutLabel = new Gtk.Label({
            label: this.settings.get_strv('toggle-recording-shortcut')[0] || '<Super><Shift>s',
        });
        shortcutRow.add_suffix(shortcutLabel);
        keyboardGroup.add(shortcutRow);

        // (Removed) Cancel/Stop shortcut row to reflect current behavior without extra keybinding

        // Whisper Settings Group
        const whisperGroup = new Adw.PreferencesGroup({
            title: _('Whisper Configuration'),
            description: _('Configure Whisper speech recognition settings'),
        });
        page.add(whisperGroup);

        // Whisper model selection
        const modelRow = new Adw.ComboRow({
            title: _('Whisper Model'),
            subtitle: _('Larger models are more accurate but slower'),
        });
        
        const modelList = new Gtk.StringList();
        modelList.append('tiny');
        modelList.append('tiny.en');
        modelList.append('base');
        modelList.append('small');
        modelList.append('medium');
        modelList.append('large');
        modelList.append('large-v3');
        
        modelRow.set_model(modelList);
        const currentModel = this.settings.get_string('whisper-model');
        const modelIndex = ['tiny', 'tiny.en', 'base', 'small', 'medium', 'large', 'large-v3'].indexOf(currentModel);
        modelRow.set_selected(modelIndex >= 0 ? modelIndex : 2);
        
        modelRow.connect('notify::selected', () => {
            const models = ['tiny', 'tiny.en', 'base', 'small', 'medium', 'large', 'large-v3'];
            this.settings.set_string('whisper-model', models[modelRow.get_selected()]);
        });
        
        whisperGroup.add(modelRow);

        // Language setting
        const languageRow = new Adw.EntryRow({
            title: _('Language Code'),
            text: this.settings.get_string('whisper-language'),
        });
        languageRow.connect('notify::text', () => {
            this.settings.set_string('whisper-language', languageRow.get_text());
        });
        whisperGroup.add(languageRow);

        // Whisper executable path
        const executableRow = new Adw.EntryRow({
            title: _('Whisper Executable'),
            text: this.settings.get_string('whisper-executable'),
        });
        executableRow.connect('notify::text', () => {
            this.settings.set_string('whisper-executable', executableRow.get_text());
        });
        whisperGroup.add(executableRow);

        // Audio Settings Group
        const audioGroup = new Adw.PreferencesGroup({
            title: _('Audio Recording'),
            description: _('Configure audio recording parameters'),
        });
        page.add(audioGroup);

        // Audio recorder selection
        const recorderRow = new Adw.ComboRow({
            title: _('Audio Recorder'),
            subtitle: _('Audio recording tool to use'),
        });
        
        const recorderList = new Gtk.StringList();
        recorderList.append('arecord');
        recorderList.append('parecord');
        recorderList.append('ffmpeg');
        
        recorderRow.set_model(recorderList);
        const currentRecorder = this.settings.get_string('audio-recorder');
        const recorderIndex = ['arecord', 'parecord', 'ffmpeg'].indexOf(currentRecorder);
        recorderRow.set_selected(recorderIndex >= 0 ? recorderIndex : 0);
        
        recorderRow.connect('notify::selected', () => {
            const recorders = ['arecord', 'parecord', 'ffmpeg'];
            this.settings.set_string('audio-recorder', recorders[recorderRow.get_selected()]);
        });
        
        audioGroup.add(recorderRow);

        // Sample rate setting
        const sampleRateRow = new Adw.SpinRow({
            title: _('Sample Rate (Hz)'),
            subtitle: _('16000 Hz is optimal for Whisper'),
            adjustment: new Gtk.Adjustment({
                lower: 8000,
                upper: 48000,
                step_increment: 1000,
                value: this.settings.get_int('audio-sample-rate'),
            }),
        });
        sampleRateRow.connect('notify::value', () => {
            this.settings.set_int('audio-sample-rate', sampleRateRow.get_value());
        });
        audioGroup.add(sampleRateRow);

        // Audio channels setting
        const channelsRow = new Adw.SpinRow({
            title: _('Audio Channels'),
            subtitle: _('1 = Mono, 2 = Stereo (Mono recommended for speech)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 2,
                step_increment: 1,
                value: this.settings.get_int('audio-channels'),
            }),
        });
        channelsRow.connect('notify::value', () => {
            this.settings.set_int('audio-channels', channelsRow.get_value());
        });
        audioGroup.add(channelsRow);

        // Audio format selection
        const formatRow = new Adw.ComboRow({
            title: _('Audio Format'),
            subtitle: _('Audio format for recording'),
        });
        
        const formatList = new Gtk.StringList();
        formatList.append('S16_LE');
        formatList.append('S24_LE');
        formatList.append('S32_LE');
        
        formatRow.set_model(formatList);
        const currentFormat = this.settings.get_string('audio-format');
        const formatIndex = ['S16_LE', 'S24_LE', 'S32_LE'].indexOf(currentFormat);
        formatRow.set_selected(formatIndex >= 0 ? formatIndex : 0);
        
        formatRow.connect('notify::selected', () => {
            const formats = ['S16_LE', 'S24_LE', 'S32_LE'];
            this.settings.set_string('audio-format', formats[formatRow.get_selected()]);
        });
        
        audioGroup.add(formatRow);

        // Behavior Settings Group
        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('Configure extension behavior'),
        });
        page.add(behaviorGroup);

        // Type As I Speak toggle
        const tasRow = new Adw.SwitchRow({
            title: _('Type As I Speak'),
            subtitle: _('Type partial transcriptions into the focused app as you talk')
        });
        tasRow.set_active(this.settings.get_boolean('type-as-i-speak-enabled'));
        tasRow.connect('notify::active', () => {
            const newVal = tasRow.get_active();
            this.settings.set_boolean('type-as-i-speak-enabled', newVal);
            // Mutual exclusivity: turning this on disables stream mode
            if (newVal) this.settings.set_boolean('type-as-i-speak-stream-enabled', false);
        });
        behaviorGroup.add(tasRow);

        // Type As I Speak Stream toggle (mutually exclusive)
        const tasStreamRow = new Adw.SwitchRow({
            title: _('Type As I Speak — Stream'),
            subtitle: _('Use whisper.cpp microphone streaming instead of the reliable live-typing mode')
        });
        // Guard if key is missing (older compiled schemas); default false
        try {
            tasStreamRow.set_active(this.settings.get_boolean('type-as-i-speak-stream-enabled'));
        } catch (e) {
            tasStreamRow.set_active(false);
        }
        tasStreamRow.connect('notify::active', () => {
            const newVal = tasStreamRow.get_active();
            try { this.settings.set_boolean('type-as-i-speak-stream-enabled', newVal); } catch (e) {}
            // Mutual exclusivity: turning this on disables regular TAS
            if (newVal) this.settings.set_boolean('type-as-i-speak-enabled', false);
        });
        behaviorGroup.add(tasStreamRow);

        // Maximum recording duration
        const maxDurationRow = new Adw.SpinRow({
            title: _('Max Recording Duration (seconds)'),
            subtitle: _('Maximum time to record before automatically stopping (ignored by stream modes)'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 300,
                step_increment: 5,
                value: this.settings.get_int('max-recording-duration'),
            }),
        });
        maxDurationRow.connect('notify::value', () => {
            this.settings.set_int('max-recording-duration', maxDurationRow.get_value());
        });
        behaviorGroup.add(maxDurationRow);

        // Show notifications toggle
        const notificationsRow = new Adw.SwitchRow({
            title: _('Show Notifications'),
            subtitle: _('Show notification messages for results and errors'),
            active: this.settings.get_boolean('show-notifications'),
        });
        notificationsRow.connect('notify::active', () => {
            this.settings.set_boolean('show-notifications', notificationsRow.get_active());
        });
        behaviorGroup.add(notificationsRow);

        // Sound effects toggle
        const soundsRow = new Adw.SwitchRow({
            title: _('Sound Effects'),
            subtitle: _('Play a short ding on start, stop, completion, and errors'),
            active: (() => { try { return this.settings.get_boolean('sounds-enabled'); } catch (e) { return false; } })(),
        });
        soundsRow.connect('notify::active', () => {
            try {
                this.settings.set_boolean('sounds-enabled', soundsRow.get_active());
            } catch (e) {
                try { console.warn('[SpeechPanel][Prefs] Failed to set sounds-enabled:', e?.message || e); } catch (_) {}
            }
        });
        behaviorGroup.add(soundsRow);


        // Type As I Speak cadence (ms)
        const tasIntervalRow = new Adw.SpinRow({
            title: _('Type As I Speak cadence (milliseconds)'),
            subtitle: _('This is the typing interval, not the maximum recording duration'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100000,
                step_increment: 0.25,
                value: (() => {
                    try { return this.settings.get_double('type-as-i-speak-interval-ms'); }
                    catch (e) {
                        try { return this.settings.get_int('type-as-i-speak-interval-ms'); }
                        catch (_) { return 800; }
                    }
                })(),
            }),
        });
        // Gtk.Adjustment supports fractional values, but SpinRow otherwise
        // renders them as whole numbers.
        tasIntervalRow.set_digits(2);
        tasIntervalRow.connect('notify::value', () => {
            try {
                const value = Math.round(tasIntervalRow.get_value() * 4) / 4;
                this.settings.set_double('type-as-i-speak-interval-ms', value);
            } catch (e) {
                try { console.warn('[SpeechPanel][Prefs] Failed to set type-as-i-speak-interval-ms:', e?.message || e); } catch (_) {}
            }
        });
        behaviorGroup.add(tasIntervalRow);
    }
}