#!/usr/bin/env bash

set -euo pipefail

REPOSITORY="https://github.com/TheSkyNet/speech-to-text.git"
BRANCH="${SPEECH_PANEL_BRANCH:-main}"
SOURCE_DIR="${SPEECH_PANEL_SOURCE_DIR:-${HOME}/.local/src/speech-to-text}"

if [[ "${XDG_SESSION_TYPE:-wayland}" != "wayland" ]]; then
    echo "Speech Panel requires a GNOME Wayland session." >&2
    exit 1
fi

if ! command -v git >/dev/null 2>&1; then
    echo "Git is required. Install Git, then run this command again." >&2
    exit 1
fi

if [[ -d "${SOURCE_DIR}/.git" ]]; then
    git -C "$SOURCE_DIR" fetch --quiet origin "$BRANCH"
    git -C "$SOURCE_DIR" checkout --quiet "$BRANCH"
    git -C "$SOURCE_DIR" pull --ff-only --quiet origin "$BRANCH"
else
    mkdir -p "$(dirname "$SOURCE_DIR")"
    git clone --branch "$BRANCH" --depth 1 "$REPOSITORY" "$SOURCE_DIR"
fi

exec "$SOURCE_DIR/manage.sh" installall
