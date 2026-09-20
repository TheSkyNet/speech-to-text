# Speech Panel

## What it is

Speech Panel is a GNOME Shell extension for live speech-to-text dictation on Wayland. It uses whisper.cpp to transcribe microphone audio and dotool to type the result into the focused application.

## Install

Run this one command in a GNOME Wayland session:

```bash
curl -fsSL https://raw.githubusercontent.com/TheSkyNet/speech-to-text/main/install.sh | bash
```

The installer downloads the project to `~/.local/src/speech-to-text`, installs or builds its dependencies, and enables the extension. It may ask for your administrator password when system packages are required.

## What it installs

The installer sets up the GNOME Shell extension, GSettings schema, whisper.cpp and its streaming binary, the selected Whisper model, SDL2 and audio support, the required build tools, and dotool built from its upstream source when it is not already installed. It enables the dotool user service for Wayland typing; after installation, focus a text field and click the Speech Panel button to start or stop live dictation.
