# Speech Panel

## What it is

Speech Panel is a GNOME Shell extension for live speech-to-text dictation on Wayland. It uses whisper.cpp to transcribe microphone audio and dotool to type the result into the focused application.

## Install

After publishing this repository, install it with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPOSITORY/main/install.sh | bash
```

The repository currently has no configured remote, so replace `OWNER/REPOSITORY` with its actual GitHub path.

## What it installs

The installer installs the GNOME extension, GSettings schema, Whisper.cpp and the selected model, the SDL2 streaming binary, audio support, dotool for Wayland typing, required build tools, and the user service needed to type into the focused application. It then enables the extension.
