#!/bin/bash

# Speech Panel Extension Management Script
# Handles installation, running, and watching for the GNOME Shell extension

set -e

EXTENSION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_UUID="speech-panel@localhost"
SCHEMAS_DIR="$EXTENSION_DIR/schemas"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

require_wayland() {
    if [ "${XDG_SESSION_TYPE:-}" != "wayland" ]; then
        print_error "Speech Panel requires a Wayland desktop session."
        print_status "Current session: ${XDG_SESSION_TYPE:-unknown}"
        return 1
    fi
}

ensure_wayland_typing_helper() {
    local helper="$HOME/.local/bin/wtype"
    if command_exists wtype; then
        print_success "Wayland typing helper found in PATH: $(command -v wtype)"
        return 0
    fi
    if [ -x "$helper" ]; then
        print_success "Wayland typing helper found: $helper"
        return 0
    fi

    print_status "Installing Wayland typing helper (wtype)..."
    if command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y wtype || true
    fi
    if command_exists wtype || [ -x "$helper" ]; then
        return 0
    fi

    # Build locally when the distro package could not be installed.
    local build_dir="$HOME/.cache/speech-panel/wtype"
    mkdir -p "$HOME/.local/bin" "$HOME/.cache/speech-panel"
    if [ ! -d "$build_dir/.git" ]; then
        git clone --depth 1 https://github.com/atx/wtype.git "$build_dir"
    else
        git -C "$build_dir" pull --ff-only
    fi
    (
        cd "$build_dir"
        wayland-scanner client-header protocol/virtual-keyboard-unstable-v1.xml virtual-keyboard-unstable-v1-client-protocol.h
        wayland-scanner private-code protocol/virtual-keyboard-unstable-v1.xml virtual-keyboard-unstable-v1-protocol.c
        cc -O2 -DVERSION='\"speech-panel-local\"' -o "$helper" \
            main.c virtual-keyboard-unstable-v1-protocol.c \
            $(pkg-config --cflags --libs wayland-client xkbcommon) -lrt
        chmod 755 "$helper"
    )
    print_success "Built Wayland typing helper: $helper"
}

ensure_ydotool_helper() {
    local client="$HOME/.local/bin/ydotool"
    local daemon="$HOME/.local/bin/ydotoold"
    if command_exists ydotool && command_exists ydotoold; then
        print_success "Kernel Wayland typing helper found in PATH."
        return 0
    fi
    if [ -x "$client" ] && [ -x "$daemon" ]; then
        print_success "Kernel Wayland typing helper found locally."
        mkdir -p "$HOME/.config/systemd/user"
        mkdir -p "$HOME/.config/systemd/user"
        cp "$EXTENSION_DIR/speech-panel-ydotool.service" \
            "$HOME/.config/systemd/user/speech-panel-ydotool.service"
        systemctl --user daemon-reload || true
        systemctl --user enable --now speech-panel-ydotool.service || true
        return 0
    fi

    print_status "Installing ydotool for applications without AT-SPI text fields..."
    mkdir -p "$HOME/.local/bin" "$HOME/.cache/speech-panel/ydotool"
    local cache="$HOME/.cache/speech-panel/ydotool"
    if command_exists apt-get && (cd "$cache" && apt-get download ydotool >/dev/null 2>&1); then
        local package
        package="$(find "$cache" -maxdepth 1 -name 'ydotool_*.deb' -print -quit)"
        if [ -n "$package" ]; then
            rm -rf "$cache/root"
            dpkg-deb -x "$package" "$cache/root"
            cp "$cache/root/usr/bin/ydotool" "$client"
            cp "$cache/root/usr/bin/ydotoold" "$daemon"
            chmod 755 "$client" "$daemon"
            print_success "Installed local ydotool helper."
            mkdir -p "$HOME/.config/systemd/user"
            systemctl --user daemon-reload || true
            systemctl --user enable --now speech-panel-ydotool.service || true
            return 0
        fi
    fi
    print_warning "Could not install ydotool; AT-SPI typing remains available."
    return 1
}

ensure_dotool_helper() {
    local client="$HOME/.local/bin/dotoolc"
    local daemon="$HOME/.local/bin/dotoold"
    if [ -x "$client" ] && [ -x "$daemon" ]; then
        mkdir -p "$HOME/.config/systemd/user"
        cp "$EXTENSION_DIR/speech-panel-dotool.service" \
            "$HOME/.config/systemd/user/speech-panel-dotool.service"
        systemctl --user daemon-reload || true
        systemctl --user enable --now speech-panel-dotool.service || true
        print_success "dotool Wayland typing helper is installed and enabled."
        return 0
    fi
    print_status "dotool is not packaged on this Ubuntu release; install it from its upstream source."
    return 1
}

ensure_selected_whisper_model() {
    local whisper_dir="$HOME/apps/whisper.cpp"
    local model="${SPEECH_PANEL_MODEL:-large-v3}"
    if command_exists dconf; then
        model="$(dconf read /org/gnome/shell/extensions/speech-panel/whisper-model 2>/dev/null | tr -d "'")"
    fi
    [ -n "$model" ] || model="large-v3"

    case "$model" in
        tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large-v1|large-v2|large-v3|large-v3-turbo)
            ;;
        *)
            print_warning "Unsupported model '$model'; installing large-v3 instead."
            model="large-v3"
            ;;
    esac

    if [ -f "$whisper_dir/models/ggml-$model.bin" ]; then
        print_success "Whisper model already installed: $model"
        return 0
    fi
    if [ ! -x "$whisper_dir/models/download-ggml-model.sh" ]; then
        print_warning "Whisper model downloader not found; skipping model download."
        return 1
    fi
    print_status "Downloading selected Whisper model: $model"
    (cd "$whisper_dir" && ./models/download-ggml-model.sh "$model" models)
}

# Install whisper.cpp to ~/apps
install_whisper_cpp() {
    local apps_dir="$HOME/apps"
    local whisper_dir="$apps_dir/whisper.cpp"
    
    print_status "Creating ~/apps directory..."
    mkdir -p "$apps_dir"
    
    if [ -d "$whisper_dir" ]; then
        print_warning "whisper.cpp directory already exists. Updating..."
        cd "$whisper_dir"
        git pull || {
            print_error "Failed to update whisper.cpp repository"
            return 1
        }
    else
        print_status "Cloning whisper.cpp from GitHub..."
        cd "$apps_dir"
        git clone https://github.com/ggerganov/whisper.cpp.git || {
            print_error "Failed to clone whisper.cpp repository"
            return 1
        }
        cd whisper.cpp
    fi
    
    print_status "Building whisper.cpp core (whisper-cli)..."
    make || {
        print_error "Failed to build whisper.cpp"
        return 1
    }
    
    if [ ! -f "build/bin/whisper-cli" ]; then
        print_error "whisper.cpp build failed - 'build/bin/whisper-cli' executable not found"
        return 1
    fi
    
    # Ensure the streaming example that Type-As-You-Stream relies on is built
    print_status "Ensuring whisper.cpp streaming example is built (requires SDL2)..."
    ensure_whisper_stream || true
    if [ -f "build/bin/whisper-stream" ]; then
        print_success "Streaming binary available: $whisper_dir/build/bin/whisper-stream"
    else
        print_warning "Streaming binary not found at $whisper_dir/build/bin/whisper-stream. Type-As-You-Stream may not work until it's built."
    fi
    
    print_status "Downloading base model..."
    if [ ! -d "models" ]; then
        mkdir -p models
    fi
    
    # Download base model if not already present
    if [ ! -f "models/ggml-base.bin" ]; then
        ./models/download-ggml-model.sh base || {
            print_warning "Failed to download base model - you can download it later"
        }
    else
        print_status "Base model already exists"
    fi
    
    print_success "whisper.cpp installed successfully to $whisper_dir"
    print_status "Executable path: $whisper_dir/build/bin/whisper-cli"
    if [ -f "build/bin/whisper-stream" ]; then
        print_status "Stream path: $whisper_dir/build/bin/whisper-stream"
    fi
    
    # Update the default model path in extension settings
    if [ -f "$whisper_dir/models/ggml-base.bin" ]; then
        print_status "Base model path: $whisper_dir/models/ggml-base.bin"
    fi
}

# Ensure the streaming example binary is built even if whisper.cpp already existed
ensure_whisper_stream() {
    local whisper_dir="$HOME/apps/whisper.cpp"
    local stream_bin="$whisper_dir/build/bin/whisper-stream"

    if [ ! -d "$whisper_dir" ]; then
        # Nothing to do here; install_whisper_cpp will handle fresh install paths
        return 0
    fi

    print_status "Ensuring whisper.cpp streaming binary (whisper-stream) is available..."
    if [ -x "$stream_bin" ]; then
        print_success "Streaming binary present: $stream_bin"
        return 0
    fi

    # whisper.cpp's current stream example uses SDL2 for microphone capture.
    if command_exists apt-get; then
        sudo apt-get update -y || true
        sudo apt-get install -y libsdl2-dev pkg-config build-essential cmake || true
    elif command_exists dnf; then
        sudo dnf install -y SDL2-devel @development-tools pkgconf-pkg-config cmake || true
    elif command_exists pacman; then
        sudo pacman -S --needed --noconfirm sdl2 base-devel pkgconf cmake || true
    fi

    # Try CMake build path first (preferred in upstream)
    print_status "Attempting CMake build of 'whisper-stream'..."
    (
        set -e
        mkdir -p "$whisper_dir/build"
        cd "$whisper_dir/build"
        cmake -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=ON -DCMAKE_BUILD_TYPE=Release ..
        cmake --build . --target whisper-stream -j
    ) && {
        # Fast-path: expected location
        if [ -x "$stream_bin" ]; then
            print_success "Built streaming binary via CMake: $stream_bin"
            return 0
        fi
        # Some generators place binaries under bin/... or examples/...; try a few known spots
        local alt
        for alt in \
            "$whisper_dir/build/bin/whisper-stream" \
            "$whisper_dir/build/bin/Release/stream" \
            "$whisper_dir/build/examples/stream/whisper-stream"
        do
            if [ -x "$alt" ]; then
                mkdir -p "$whisper_dir/build/bin"
                cp -f "$alt" "$stream_bin"
                print_success "Built streaming binary via CMake (relocated): $stream_bin"
                return 0
            fi
        done
        # Last resort: search the build tree for the named whisper target.
        local found
        found="$(find "$whisper_dir/build" -type f -name whisper-stream -perm -u+x 2>/dev/null | head -n 1 || true)"
        if [ -n "$found" ] && [ -x "$found" ]; then
            mkdir -p "$whisper_dir/build/bin"
            cp -f "$found" "$stream_bin"
            print_success "Built streaming binary via CMake (discovered): $stream_bin"
            return 0
        fi
    }

    # Fallback: legacy Makefile in examples/stream
    print_status "CMake route failed; trying legacy make in examples/stream..."
    (
        set -e
        cd "$whisper_dir/examples/stream"
        make
    ) && {
        local exeb="$whisper_dir/examples/stream/whisper-stream"
        if [ -x "$exeb" ]; then
            mkdir -p "$whisper_dir/build/bin"
            cp -f "$exeb" "$stream_bin"
            print_success "Built streaming binary via legacy make: $stream_bin"
            return 0
        fi
    }

    # Attempt final fallback: build whisper-stream from an alternate repository.
    print_status "Attempting fallback: building 'whisper-stream' from alternate repository (ggml-org/whisper.cpp)..."
    (
        set -e
        # Ensure deps again (best-effort, quiet if already present)
        if command_exists apt-get; then
            sudo apt-get update -y || true
            sudo apt-get install -y git cmake build-essential pkg-config libsdl2-dev || true
        elif command_exists dnf; then
            sudo dnf install -y git cmake @development-tools pkgconf-pkg-config SDL2-devel || true
        elif command_exists pacman; then
            sudo pacman -S --needed --noconfirm git cmake base-devel pkgconf sdl2 || true
        fi

        local alt_dir="$HOME/apps/whisper-stream-fallback"
        if [ -d "$alt_dir/.git" ]; then
            print_status "Updating alternate whisper.cpp repo at $alt_dir..."
            cd "$alt_dir"
            git pull --rebase || git pull || true
        else
            print_status "Cloning alternate whisper.cpp repo to $alt_dir..."
            mkdir -p "$HOME/apps"
            cd "$HOME/apps"
            git clone https://github.com/ggml-org/whisper.cpp.git whisper-stream-fallback
            cd "$alt_dir"
        fi

        mkdir -p build
        cd build
        cmake -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=ON -DCMAKE_BUILD_TYPE=Release ..
        # Build all; targets vary across forks/versions
        cmake --build . -j
    ) && {
        # Locate built 'stream' in the alternate repo build
        local ffound
        ffound="$(find "$HOME/apps/whisper-stream-fallback/build" -type f -name whisper-stream -perm -u+x 2>/dev/null | head -n 1 || true)"
        if [ -n "$ffound" ] && [ -x "$ffound" ]; then
            mkdir -p "$whisper_dir/build/bin"
            cp -f "$ffound" "$stream_bin"
            chmod +x "$stream_bin"
            print_success "Built streaming binary via alternate repo: $stream_bin"
            return 0
        fi
        # Try common alt locations explicitly
        for altp in \
            "$HOME/apps/whisper-stream-fallback/build/bin/whisper-stream" \
            "$HOME/apps/whisper-stream-fallback/build/examples/stream/whisper-stream" \
            "$HOME/apps/whisper-stream-fallback/examples/stream/whisper-stream"; do
            if [ -x "$altp" ]; then
                mkdir -p "$whisper_dir/build/bin"
                cp -f "$altp" "$stream_bin"
                chmod +x "$stream_bin"
                print_success "Built streaming binary via alternate repo (relocated): $stream_bin"
                return 0
            fi
        done
    }

    # If we reach here, all automated attempts failed
    print_warning "Could not build the 'whisper-stream' binary automatically."
    print_status "You can still use the extension for non-streaming features. Run './manage.sh debug-logs' for details."
    return 1
}

# Install dependencies
install_dependencies() {
    print_status "Installing system dependencies..."
    
    # Check for audio recording tools
    if ! command_exists arecord && ! command_exists parecord && ! command_exists ffmpeg; then
        print_warning "No audio recording tool found. Installing alsa-utils..."
        if command_exists apt-get; then
            sudo apt-get update && sudo apt-get install -y alsa-utils
        elif command_exists dnf; then
            sudo dnf install -y alsa-utils
        elif command_exists pacman; then
            sudo pacman -S alsa-utils
        else
            print_error "Could not install audio tools. Please install arecord, parecord, or ffmpeg manually."
            return 1
        fi
    fi

    # Install SDL2 development packages for whisper-stream microphone capture
    print_status "Checking SDL2 development packages for streaming..."
    if command_exists apt-get; then
        sudo apt-get update && sudo apt-get install -y libsdl2-dev pkg-config build-essential || true
    elif command_exists dnf; then
        sudo dnf install -y SDL2-devel @development-tools pkgconf-pkg-config || true
    elif command_exists pacman; then
        sudo pacman -S --needed --noconfirm sdl2 base-devel pkgconf || true
    fi

    ensure_wayland_typing_helper || print_warning "Could not install wtype; AT-SPI typing remains available."
    ensure_dotool_helper || print_warning "Could not install or enable dotool; direct typing may be unavailable."
    
    # Check for whisper.cpp
    local whisper_path="$HOME/apps/whisper.cpp/build/bin/whisper-cli"
    if [ -f "$whisper_path" ]; then
        print_success "whisper.cpp found at $whisper_path!"
    elif command_exists main || command_exists whisper-cpp; then
        print_success "whisper.cpp found in system PATH!"
    else
        print_status "Installing whisper.cpp to ~/apps/whisper.cpp..."
        install_whisper_cpp
    fi
    
    # Ensure required developer and runtime tools are present (non-interactive install)
    if command_exists apt-get; then
        sudo apt-get update || print_warning "Could not authenticate for apt update; continuing with existing packages."
        # Base toolchain and helpers
        sudo apt-get install -y git curl build-essential pkg-config ||
            print_warning "Could not authenticate for apt packages; continuing with existing tools."
        # glib-compile-schemas (runtime tool)
        if ! command_exists glib-compile-schemas; then
            sudo apt-get install -y glib2.0-bin ||
                print_warning "glib-compile-schemas is missing and could not be installed."
        fi
        # GNOME extensions CLI
        if ! command_exists gnome-extensions; then
            sudo apt-get install -y gnome-shell-extension-prefs ||
                print_warning "gnome-extensions is missing and could not be installed."
        fi
    elif command_exists dnf; then
        sudo dnf install -y git curl @development-tools pkgconf-pkg-config
        # glib-compile-schemas is provided by glib2 on Fedora
        if ! command_exists glib-compile-schemas; then
            sudo dnf install -y glib2
        fi
        if ! command_exists gnome-extensions; then
            sudo dnf install -y gnome-extensions-app || true
        fi
    elif command_exists pacman; then
        sudo pacman -S --needed --noconfirm git curl base-devel pkgconf
        if ! command_exists glib-compile-schemas; then
            sudo pacman -S --needed --noconfirm glib2
        fi
        if ! command_exists gnome-extensions; then
            sudo pacman -S --needed --noconfirm gnome-extensions
        fi
    fi

    # Optionally prepare nested shell support (silent best-effort, no nagging)
    if command_exists dnf; then
        sudo dnf install -y mutter-devel || true
    elif command_exists pacman; then
        sudo pacman -S --needed --noconfirm mutter-devkit || true
    fi

    print_success "Dependency installation completed!"
}

# Compile schemas
compile_schemas() {
    print_status "Compiling GSettings schemas..."
    
    if [ -d "$SCHEMAS_DIR" ]; then
        cd "$SCHEMAS_DIR"
        glib-compile-schemas . || {
            print_error "Failed to compile schemas!"
            return 1
        }
        print_success "Schemas compiled successfully!"
    else
        print_error "Schemas directory not found!"
        return 1
    fi
}

# Install extension
install_extension() {
    print_status "Installing extension..."
    
    # Compile schemas first
    compile_schemas || return 1
    
    # Check if we're already in the right location
    local target_dir="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
    
    if [ "$EXTENSION_DIR" != "$target_dir" ]; then
        print_status "Copying extension to $target_dir"
        mkdir -p "$(dirname "$target_dir")"
        cp -r "$EXTENSION_DIR" "$target_dir"
    else
        print_status "Extension already in correct location"
    fi
    
    print_success "Extension installed!"
}

# Wayland session refresh
restart_shell() {
    print_warning "Wayland does not support restarting GNOME Shell in the active session."
    print_status "Log out and back in to reload GNOME Shell and this extension."
    return 1
}

# Enable extension
enable_extension() {
    print_status "Enabling extension..."
    
    if command_exists gnome-extensions; then
        gnome-extensions enable "$EXTENSION_UUID" || {
            print_error "Failed to enable extension!"
            return 1
        }
        print_success "Extension enabled!"
    else
        print_error "gnome-extensions command not found!"
        return 1
    fi
}

# Disable extension
disable_extension() {
    print_status "Disabling extension..."
    
    if command_exists gnome-extensions; then
        gnome-extensions disable "$EXTENSION_UUID" || {
            print_warning "Extension might not be enabled"
        }
        # GNOME Shell unloads extensions asynchronously. Give destroy() time
        # to remove the status-area actor before a subsequent enable.
        sleep 1
        print_success "Extension disabled!"
    else
        print_error "gnome-extensions command not found!"
        return 1
    fi
}

# Show extension status
show_status() {
    print_status "Extension status:"
    
    if command_exists gnome-extensions; then
        local status=$(gnome-extensions list --enabled | grep "$EXTENSION_UUID" || echo "disabled")
        if [ "$status" = "disabled" ]; then
            echo "  Status: ${RED}DISABLED${NC}"
        else
            echo "  Status: ${GREEN}ENABLED${NC}"
        fi
        
        # Check files
        local target_dir="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
        if [ -d "$target_dir" ]; then
            echo "  Location: $target_dir"
            echo "  Files: $(ls -1 "$target_dir" | wc -l) files"
        else
            echo "  Location: ${RED}NOT INSTALLED${NC}"
        fi
        
        # Check dependencies
        echo "  Dependencies:"
        if command_exists arecord; then
            echo "    arecord: ${GREEN}✓${NC}"
        else
            echo "    arecord: ${RED}✗${NC}"
        fi
        
        if command_exists main || command_exists whisper-cpp; then
            echo "    whisper.cpp: ${GREEN}✓${NC}"
        else
            echo "    whisper.cpp: ${RED}✗${NC}"
        fi
        
        if [ -f "$SCHEMAS_DIR/gschemas.compiled" ]; then
            echo "    schemas: ${GREEN}✓${NC}"
        else
            echo "    schemas: ${RED}✗${NC}"
        fi
    else
        print_error "gnome-extensions command not found!"
        return 1
    fi
}

# Watch for changes with comprehensive development setup
watch_changes() {
    print_status "🎯 Starting comprehensive development watch mode..."
    print_status "Setting up the best development environment with full debugging..."
    
    # Set up complete development environment
    print_status "Setting up development dependencies..."
    install_dependencies >/dev/null 2>&1
    install_extension >/dev/null 2>&1
    enable_extension >/dev/null 2>&1
    
    # Keep watch mode focused on this extension. Global Shell debug output also
    # includes unrelated Ubuntu extensions and makes failures hard to find.
    print_status "Configuring debug environment variables..."
    unset SHELL_DEBUG
    unset G_MESSAGES_DEBUG
    export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
    
    # Save debug environment for persistence
    cat > /tmp/shell_debug_env << EOF
unset SHELL_DEBUG
unset G_MESSAGES_DEBUG
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
EOF
    
    print_success "Debug environment configured:"
    echo "  Shell-wide debug output disabled (unrelated extensions are hidden)"
    echo "  MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768 (Nested shell resolution)"
    
    # Check for inotifywait
    if ! command_exists inotifywait; then
        print_warning "inotifywait not found. Installing inotify-tools..."
        if command_exists apt-get; then
            sudo apt-get install -y inotify-tools
        elif command_exists dnf; then
            sudo dnf install -y inotify-tools
        elif command_exists pacman; then
            sudo pacman -S inotify-tools
        else
            print_error "Could not install inotify-tools. Please install manually."
            return 1
        fi
    fi
    
    print_success "🚀 Development watch mode active!"
    print_status "Watching: $EXTENSION_DIR"
    print_status "Debug logs will appear below when extension is used..."
    print_status "Press Ctrl+C to stop watching"
    echo ""
    
    # Start background log monitoring
    journalctl -f --user -o cat | grep -i --color=always "speech\|whisper" &
    local log_pid=$!
    
    # Main file watching loop
    while true; do
        inotifywait -e modify,create,delete,move -r "$EXTENSION_DIR" --exclude '\.git|\.swp|~$|gschemas\.compiled' -q
        print_status "📝 Changes detected, reloading extension..."
        
        # Recompile schemas if changed
        if [ -f "$SCHEMAS_DIR/org.gnome.shell.extensions.speech-panel.gschema.xml" ]; then
            compile_schemas
        fi
        
        # Copy changes to installation directory if different
        local target_dir="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
        if [ "$EXTENSION_DIR" != "$target_dir" ]; then
            rsync -av --exclude='.git' "$EXTENSION_DIR/" "$target_dir/"
        fi
        
        # Disable and re-enable extension
        disable_extension >/dev/null 2>&1
        sleep 1
        enable_extension >/dev/null 2>&1
        
        print_success "✅ Extension reloaded! (Debug mode active)"
        echo ""
    done
    
    # Cleanup on exit
    trap "kill $log_pid 2>/dev/null; exit 0" INT TERM
}

# Show logs
show_logs() {
    print_status "Showing extension logs (press Ctrl+C to stop)..."
    journalctl -f --user -o cat | grep -i --color=always "speech\|whisper"
}

# Enable debug mode with SHELL_DEBUG
enable_debug() {
    local debug_mode="${1:-backtrace-warnings}"
    
    print_status "Enabling SHELL_DEBUG mode: $debug_mode"
    
    case "$debug_mode" in
        "backtrace-warnings")
            print_status "Enabling backtrace for warnings and critical messages..."
            export SHELL_DEBUG=backtrace-warnings
            ;;
        "backtrace-segfaults")
            print_status "Enabling backtrace for segfaults..."
            export SHELL_DEBUG=backtrace-segfaults
            ;;
        "all")
            print_status "Enabling all debug options..."
            export SHELL_DEBUG=all
            ;;
        *)
            print_error "Unknown debug mode: $debug_mode"
            print_status "Available modes: backtrace-warnings, backtrace-segfaults, all"
            return 1
            ;;
    esac
    
    # Set environment for current session
    echo "export SHELL_DEBUG=$debug_mode" > /tmp/shell_debug_env
    
    print_success "SHELL_DEBUG=$debug_mode enabled!"
    print_warning "This will take effect for new GNOME Shell sessions."
    print_status "To apply immediately:"
    print_status "  - Log out and log back in"
    print_status "  - Or run: source /tmp/shell_debug_env before running extension commands"
}

# Disable debug mode
disable_debug() {
    print_status "Disabling SHELL_DEBUG..."
    unset SHELL_DEBUG
    rm -f /tmp/shell_debug_env
    print_success "SHELL_DEBUG disabled!"
    print_status "Changes will take effect for new GNOME Shell sessions."
}

# Show debug status
show_debug_status() {
    print_status "SHELL_DEBUG Status:"
    
    if [ -n "$SHELL_DEBUG" ]; then
        echo "  Current session: ${GREEN}$SHELL_DEBUG${NC}"
    else
        echo "  Current session: ${RED}Not set${NC}"
    fi
    
    if [ -f "/tmp/shell_debug_env" ]; then
        local saved_debug=$(grep "export SHELL_DEBUG=" /tmp/shell_debug_env | cut -d'=' -f2)
        echo "  Saved setting: ${YELLOW}$saved_debug${NC}"
    else
        echo "  Saved setting: ${RED}None${NC}"
    fi
    
    echo ""
    print_status "SHELL_DEBUG Options:"
    echo "  backtrace-warnings  - Show JavaScript stack traces for console.warn() and console.error()"
    echo "  backtrace-segfaults - Show JavaScript stack traces for fatal crashes"
    echo "  all                 - Enable all debugging options"
    echo ""
    print_status "Usage:"
    echo "  ./manage.sh debug-enable [mode]     - Enable debug mode"
    echo "  ./manage.sh debug-disable           - Disable debug mode"
    echo "  ./manage.sh debug-logs              - Show logs with debug info"
    echo "  ./manage.sh debug-status            - Show current debug status"
}

# Show logs with debug information
show_debug_logs() {
    local debug_mode="${SHELL_DEBUG:-none}"
    print_status "Showing debug logs (SHELL_DEBUG=$debug_mode)..."
    print_status "Press Ctrl+C to stop..."
    
    if [ "$debug_mode" = "none" ]; then
        print_warning "SHELL_DEBUG not set. Enable with: ./manage.sh debug-enable"
        print_status "Showing regular logs instead..."
    fi
    
    # Show more comprehensive logs when debug is enabled
    if [ -n "$SHELL_DEBUG" ]; then
        journalctl -f --user -o cat | grep -i --color=always "speech\|whisper"
    else
        journalctl -f --user -o cat | grep -i --color=always "speech\|whisper"
    fi
}

# Run extension with debug environment
run_debug() {
    local debug_mode="${1:-backtrace-warnings}"
    
    print_status "Running extension with SHELL_DEBUG=$debug_mode..."
    
    # Source debug environment if available
    if [ -f "/tmp/shell_debug_env" ]; then
        source /tmp/shell_debug_env
        print_status "Loaded saved debug environment: SHELL_DEBUG=$SHELL_DEBUG"
    else
        export SHELL_DEBUG="$debug_mode"
        print_status "Set SHELL_DEBUG=$debug_mode for this session"
    fi
    
    # Install and enable extension
    install_extension
    enable_extension
    
    print_success "Extension running with debug mode enabled!"
    print_status "Monitor logs with: ./manage.sh debug-logs"
}

# Start nested GNOME Shell instance
start_nested_shell() {
    print_warning "WARNING: A nested instance of GNOME Shell is not fully isolated!"
    print_warning "This will not protect your system from data loss or other consequences."
    print_warning "Use only for development and testing purposes."
    echo ""
    
    # Check if we're on Wayland
    if [ "$XDG_SESSION_TYPE" != "wayland" ]; then
        print_error "Nested GNOME Shell is only supported on Wayland desktops!"
        print_status "Current session type: $XDG_SESSION_TYPE"
        return 1
    fi
    
    # Check if gnome-shell is available
    if ! command_exists gnome-shell; then
        print_error "gnome-shell command not found!"
        return 1
    fi
    
    # Check for mutter-devkit on GNOME Shell 49+
    local gnome_shell_version=""
    if command_exists gnome-shell; then
        gnome_shell_version=$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1)
        if [ -n "$gnome_shell_version" ] && [ "$gnome_shell_version" -ge 49 ]; then
            print_status "Running GNOME Shell $gnome_shell_version - checking for mutter-devkit..."
            
            # Check if mutter-devkit packages are installed
            local mutter_devkit_installed=false
            if command_exists dpkg && dpkg -l | grep -q "mutter-devel"; then
                mutter_devkit_installed=true
            elif command_exists rpm && rpm -qa | grep -q "mutter-devel"; then
                mutter_devkit_installed=true
            elif command_exists pacman && pacman -Q mutter-devkit >/dev/null 2>&1; then
                mutter_devkit_installed=true
            fi
            
            if ! $mutter_devkit_installed; then
                print_warning "mutter-devkit may not be installed!"
                print_warning "For GNOME Shell 49+, mutter-devkit is recommended for nested sessions."
                print_status "Install with: ./manage.sh installall (to check and install dependencies)"
                print_status "Or install manually:"
                print_status "  Arch Linux: sudo pacman -S mutter-devkit"
                print_status "  Fedora: sudo dnf install mutter-devel"
                print_status "Attempting to continue anyway..."
                echo ""
            else
                print_success "mutter-devkit is installed"
            fi
        fi
    fi
    
    # Check if already running
    if pgrep -f "gnome-shell --devkit" > /dev/null; then
        print_error "Nested GNOME Shell is already running!"
        print_status "Use './manage.sh nested-stop' to stop it first."
        return 1
    fi
    
    print_status "Starting nested GNOME Shell instance..."
    print_status "This will open a new window with a complete GNOME Shell environment."
    print_status "Your extension will be available for testing in the nested shell."
    echo ""
    
    # Install extension first if not already done
    install_extension
    
    # Start nested shell in background
    print_status "Command: dbus-run-session -- gnome-shell --nested --wayland"
    print_status "Starting in 3 seconds... (Press Ctrl+C to cancel)"
    sleep 3
    
    # Start the nested shell with log filtering
    (dbus-run-session -- gnome-shell --nested --wayland 2>&1 | grep "GNOME Shell-Message") &
    local nested_pid=$!
    
    # Save the PID for later management
    echo "$nested_pid" > /tmp/speech-panel-nested-shell.pid
    
    sleep 2
    
    if ps -p "$nested_pid" > /dev/null; then
        print_success "Nested GNOME Shell started successfully!"
        print_status "Process ID: $nested_pid"
        print_status "Window should appear shortly with a complete GNOME Shell environment."
        echo ""
        print_status "In the nested shell, you can:"
        print_status "  - Enable your extension: gnome-extensions enable $EXTENSION_UUID"
        print_status "  - Test functionality in an isolated environment"
        print_status "  - Use Looking Glass (Alt+F2, type 'lg') for debugging"
        echo ""
        print_status "To stop the nested shell: ./manage.sh nested-stop"
        print_status "To check status: ./manage.sh nested-status"
    else
        print_error "Failed to start nested GNOME Shell!"
        rm -f /tmp/speech-panel-nested-shell.pid
        return 1
    fi
}

# Stop nested GNOME Shell instance
stop_nested_shell() {
    local pid_file="/tmp/speech-panel-nested-shell.pid"
    
    if [ ! -f "$pid_file" ]; then
        print_warning "No nested GNOME Shell PID file found."
        print_status "Checking for running nested shells..."
        
        local nested_pids=$(pgrep -f "gnome-shell --nested --wayland")
        if [ -n "$nested_pids" ]; then
            print_status "Found nested GNOME Shell processes: $nested_pids"
            print_status "Terminating nested shells..."
            pkill -f "gnome-shell --nested --wayland"
            sleep 2
            print_success "Nested GNOME Shell processes terminated."
        else
            print_status "No nested GNOME Shell processes found."
        fi
        return 0
    fi
    
    local nested_pid=$(cat "$pid_file")
    
    if ps -p "$nested_pid" > /dev/null; then
        print_status "Stopping nested GNOME Shell (PID: $nested_pid)..."
        kill "$nested_pid"
        
        # Wait for graceful shutdown
        local count=0
        while ps -p "$nested_pid" > /dev/null && [ $count -lt 10 ]; do
            sleep 1
            count=$((count + 1))
        done
        
        if ps -p "$nested_pid" > /dev/null; then
            print_warning "Nested shell not responding, force killing..."
            kill -9 "$nested_pid" 2>/dev/null
        fi
        
        print_success "Nested GNOME Shell stopped."
    else
        print_status "Nested GNOME Shell is not running."
    fi
    
    rm -f "$pid_file"
}

# Show nested GNOME Shell status
nested_shell_status() {
    local pid_file="/tmp/speech-panel-nested-shell.pid"
    
    print_status "Nested GNOME Shell Status:"
    
    # Check session type compatibility
    if [ "$XDG_SESSION_TYPE" != "wayland" ]; then
        echo "  Compatibility: ${RED}Not supported (requires Wayland)${NC}"
        echo "  Current session: $XDG_SESSION_TYPE"
    else
        echo "  Compatibility: ${GREEN}Supported (Wayland)${NC}"
    fi
    
    # Check if gnome-shell command exists
    if command_exists gnome-shell; then
        echo "  GNOME Shell: ${GREEN}Available${NC}"
    else
        echo "  GNOME Shell: ${RED}Not found${NC}"
    fi
    
    # Check running status
    local nested_pids=$(pgrep -f "gnome-shell --nested --wayland")
    if [ -n "$nested_pids" ]; then
        echo "  Status: ${GREEN}RUNNING${NC}"
        echo "  Process IDs: $nested_pids"
        
        if [ -f "$pid_file" ]; then
            local saved_pid=$(cat "$pid_file")
            echo "  Saved PID: $saved_pid"
            if echo "$nested_pids" | grep -q "$saved_pid"; then
                echo "  PID Status: ${GREEN}Valid${NC}"
            else
                echo "  PID Status: ${YELLOW}Stale${NC} (cleaning up...)"
                rm -f "$pid_file"
            fi
        else
            echo "  PID File: ${YELLOW}Missing${NC}"
        fi
    else
        echo "  Status: ${RED}NOT RUNNING${NC}"
        if [ -f "$pid_file" ]; then
            echo "  PID File: ${YELLOW}Stale${NC} (cleaning up...)"
            rm -f "$pid_file"
        fi
    fi
    
    echo ""
    print_status "Nested Shell Commands:"
    echo "  ./manage.sh nested-start   - Start nested GNOME Shell"
    echo "  ./manage.sh nested-stop    - Stop nested GNOME Shell"  
    echo "  ./manage.sh nested-restart - Restart nested GNOME Shell"
    echo "  ./manage.sh nested-status  - Show this status"
}

# Restart nested GNOME Shell
restart_nested_shell() {
    print_status "Restarting nested GNOME Shell..."
    stop_nested_shell
    sleep 2
    start_nested_shell
}

# Open preferences
open_prefs() {
    print_status "Opening extension preferences..."
    if command_exists gnome-extensions; then
        gnome-extensions prefs "$EXTENSION_UUID"
    else
        print_error "gnome-extensions command not found!"
        return 1
    fi
}

# Quick development setup - instant dev environment
dev_setup() {
    print_status "🚀 Setting up development environment..."
    
    # Quick dependency check and install if needed
    install_dependencies
    install_extension
    enable_extension
    
    # Enable debug mode automatically
    enable_debug "backtrace-warnings"
    
    print_success "Development environment ready!"
    print_status "Extension is installed and enabled with debug mode."
    print_status "Next steps:"
    print_status "  - Start watching: ./manage.sh devloop"
    print_status "  - Quick test: ./manage.sh quicktest"
    print_status "  - View logs: ./manage.sh debug-logs"
}

# Quick test cycle - fast iteration testing
quick_test() {
    print_status "⚡ Quick test cycle..."
    
    # Disable and re-enable quickly
    disable_extension >/dev/null 2>&1
    sleep 0.5
    enable_extension >/dev/null 2>&1
    
    print_success "Extension reloaded for testing!"
    print_status "Test your functionality now."
    print_status "Watch logs with: ./manage.sh logs"
}

# Development loop - continuous development with auto-reload
dev_loop() {
    print_status "🔄 Starting development loop with auto-reload..."
    print_status "This will watch for changes and auto-reload the extension."
    print_status "Press Ctrl+C to stop."
    
    # Ensure extension is set up first
    if ! gnome-extensions list --enabled | grep -q "$EXTENSION_UUID"; then
        print_status "Extension not enabled, setting up..."
        install_extension
        enable_extension
    fi
    
    # Enable debug mode if not already enabled
    if [ -z "$SHELL_DEBUG" ]; then
        export SHELL_DEBUG=backtrace-warnings
        print_status "Debug mode enabled for this session."
    fi
    
    # Start watching with faster reload
    watch_changes
}

# Watch for file changes and auto-reload extension
watch_changes() {
    print_status "🎯 Starting comprehensive development watch mode..."
    print_status "Setting up the best development environment with full debugging..."
    
    # Check if inotify-tools is available
    if ! command_exists inotifywait; then
        print_error "inotify-tools not found. Installing..."
        if command_exists apt-get; then
            sudo apt-get install -y inotify-tools
        elif command_exists dnf; then
            sudo dnf install -y inotify-tools
        elif command_exists pacman; then
            sudo pacman -S --noconfirm inotify-tools
        else
            print_error "Please install inotify-tools manually for your distribution"
            return 1
        fi
    fi
    
    print_status "Setting up development dependencies..."
    install_extension >/dev/null 2>&1 || true
    
    print_status "Configuring debug environment variables..."
    unset SHELL_DEBUG
    unset G_MESSAGES_DEBUG
    export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
    
    print_success "Debug environment configured:"
    echo "  Shell-wide debug output disabled (unrelated extensions are hidden)"
    echo "  MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768 (Nested shell resolution)"
    
    print_success "🚀 Development watch mode active!"
    print_status "Watching: $EXTENSION_DIR"
    print_status "Debug logs will appear below when extension is used..."
    print_status "Press Ctrl+C to stop watching"
    echo ""
    
    # Start debug logs in background
    journalctl -f --user -o cat | grep -i --color=always "speech\|whisper" &
    local log_pid=$!
    
    # Set up cleanup trap
    trap "print_status 'Stopping watch mode...'; kill $log_pid 2>/dev/null; exit 0" INT TERM
    
    # Watch for changes in extension files
    inotifywait -m -r -e modify,create,delete,move \
        --exclude '\.(git|tmp|log)' \
        "$EXTENSION_DIR" |
    while read path action file; do
        # Skip temporary files and hidden files
        if [[ "$file" =~ ^\. ]] || [[ "$file" =~ ~$ ]] || [[ "$file" =~ \.tmp$ ]]; then
            continue
        fi
        
        # Only react to JavaScript, JSON, CSS, and XML files
        if [[ "$file" =~ \.(js|json|css|xml)$ ]]; then
            print_status "File changed: $file ($action)"
            print_status "Reloading extension..."
            
            # Recompile schemas if gschema.xml changed
            if [[ "$file" =~ \.gschema\.xml$ ]]; then
                print_status "Schema file changed, recompiling..."
                compile_schemas >/dev/null 2>&1
            fi
            
            # Reload extension (disable then enable)
            disable_extension >/dev/null 2>&1
            sleep 0.5
            install_extension >/dev/null 2>&1
            sleep 0.5
            enable_extension >/dev/null 2>&1
            
            print_success "✅ Extension reloaded! (Debug mode active)"
            echo ""
        fi
    done
}

# Quick debug setup - immediate debugging environment
quick_debug() {
    local debug_mode="${1:-all}"
    
    print_status "🐛 Setting up debug environment..."
    
    # Enable comprehensive debugging
    enable_debug "$debug_mode"
    
    # Set up extension
    install_extension
    enable_extension
    
    print_success "Debug environment ready!"
    print_status "Debug mode: $debug_mode"
    print_status "Monitor with: ./manage.sh debug-logs"
    
    # Start debug logs automatically in background for a few seconds
    print_status "Starting debug logs (5 seconds preview)..."
    timeout 5s bash -c "journalctl -f --user -o cat | grep -i --color=always 'speech\|whisper'" || true
    
    print_status "Debug logs stopped. Continue monitoring with: ./manage.sh debug-logs"
}

# Development status - show everything developers need to know
dev_status() {
    print_status "📊 Development Status Dashboard"
    echo ""
    
    # Extension status
    show_status
    echo ""
    
    # Debug status
    show_debug_status
    echo ""
    
    # Quick development commands
    print_status "Quick Development Commands:"
    echo "  ./manage.sh dev          - Set up dev environment"
    echo "  ./manage.sh quicktest    - Quick test cycle"
    echo "  ./manage.sh devloop      - Start development loop"
    echo "  ./manage.sh quickdebug   - Quick debug setup"
    echo "  ./manage.sh devstatus    - Show this status"
}

# Show help
show_help() {
    echo "Speech Panel Extension Management Script"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  installall    - Install all dependencies and setup extension"
    echo "  run           - Enable and run the extension"  
    echo "  watch         - Watch for file changes and auto-reload"
    echo "  status        - Show extension and dependency status"
    echo "  enable        - Enable the extension"
    echo "  disable       - Disable the extension"
    echo "  restart       - Explain how to reload the Wayland GNOME Shell session"
    echo "  logs          - Show extension logs"
    echo "  prefs         - Open extension preferences"
    echo "  compile       - Compile GSettings schemas"
    echo "  test-unit     - Run GJS unit tests"
    echo "  help          - Show this help message"
    echo ""
    echo "Quick Development Commands (🚀 Fast workflow):"
    echo "  dev           - Instant development environment setup"
    echo "  quicktest     - Quick test cycle (fast reload)"
    echo "  devloop       - Start development loop with auto-reload"
    echo "  quickdebug [mode] - Quick debug setup with preview"
    echo "  devstatus     - Development status dashboard"
    echo ""
    echo "Debug Commands:"
    echo "  debug-enable [mode]  - Enable SHELL_DEBUG (backtrace-warnings|backtrace-segfaults|all)"
    echo "  debug-disable        - Disable SHELL_DEBUG"
    echo "  debug-status         - Show current debug status and options"
    echo "  debug-logs          - Show logs with debug information"
    echo "  run-debug [mode]    - Run extension with debug mode enabled"
    echo ""
    echo "Nested GNOME Shell Commands (⚠️  EXPERIMENTAL - Wayland only):"
    echo "  nested-start         - Start nested GNOME Shell for development"
    echo "  nested-stop          - Stop nested GNOME Shell instance"
    echo "  nested-status        - Show nested shell status and compatibility"
    echo "  nested-restart       - Restart nested GNOME Shell instance"
    echo ""
    echo "Combined commands:"
    echo "  installall && run     - Full setup and run"
    echo "  run && watch          - Run and start watching"
    echo "  debug-enable all && run-debug - Enable full debugging and run"
    echo "  nested-start && nested-status - Start nested shell and show status"
    echo ""
    echo "Debug Modes:"
    echo "  backtrace-warnings   - Show JavaScript stack traces for console.warn() and console.error()"
    echo "  backtrace-segfaults  - Show JavaScript stack traces for fatal crashes"  
    echo "  all                  - Enable all debugging options"
    echo ""
    echo "Nested Shell Notes:"
    echo "  ⚠️  WARNING: Nested shells are NOT fully isolated from your system"
    echo "  ⚠️  Use only for development and testing purposes"
    echo "  ⚠️  Requires Wayland desktop session to function properly"
    echo "  ⚠️  GNOME Shell 49+ requires mutter-devkit package to be installed"
    echo "  ⚠️  May cause system instability - save your work before using"
    echo ""
    echo "mutter-devkit Installation:"
    echo "  Arch Linux: sudo pacman -S mutter-devkit"
    echo "  Fedora: sudo dnf install mutter-devel"
    echo "  Ubuntu/Debian: sudo apt install mutter-devel (if available)"
    echo "  Or run: ./manage.sh installall (automatic detection and installation)"
    echo ""
}

# Dev command - ensure deps + whisper-stream binary, then run nested shell for development
dev_setup() {
    print_status "Preparing development run (deps + whisper-stream binary)..."
    install_dependencies >/dev/null 2>&1 || true
    ensure_whisper_stream || true
    install_extension || true
    # Launch nested shell with helper (handles logs and PID management)
    start_nested_shell
}

# Main command handler
main() {
    require_wayland || return 1

    case "${1:-help}" in
        "installall"|"install-all")
            install_dependencies
            ensure_whisper_stream || true
            install_extension
            ensure_selected_whisper_model || true
            enable_extension || true
            ;;
        "install-whisper")
            install_whisper_cpp
            ;;
        "run")
            install_extension
            enable_extension
            show_status
            ;;
        "watch")
            watch_changes
            ;;
        "status")
            show_status
            ;;
        "enable")
            enable_extension
            ;;
        "disable")
            disable_extension
            ;;
        "restart")
            restart_shell
            ;;
        "logs")
            show_logs
            ;;
        "prefs"|"preferences")
            open_prefs
            ;;
        "compile")
            compile_schemas
            ;;
        "debug-enable")
            enable_debug "$2"
            ;;
        "debug-disable")
            disable_debug
            ;;
        "debug-status")
            show_debug_status
            ;;
        "debug-logs")
            show_debug_logs
            ;;
        "run-debug")
            run_debug "$2"
            ;;
        "nested-start")
            start_nested_shell
            ;;
        "nested-stop")
            stop_nested_shell
            ;;
        "nested-status")
            nested_shell_status
            ;;
        "nested-restart")
            restart_nested_shell
            ;;
        "dev")
            dev_setup
            ;;
        "quicktest")
            quick_test
            ;;
        "devloop")
            dev_loop
            ;;
        "quickdebug")
            quick_debug "$2"
            ;;
        "devstatus")
            dev_status
            ;;
        "test-unit")
            bash "$EXTENSION_DIR/test-unit.sh"
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"