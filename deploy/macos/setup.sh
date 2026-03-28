#!/bin/bash
# =============================================================
# AskDAO iMessage Bridge - Mac mini Deployment Script
# =============================================================
# Usage: ./setup.sh [install|uninstall|status|logs]
# =============================================================

set -euo pipefail

# --- Configuration ---
SERVICE_LABEL="com.askdao.imessage-bridge"
PLIST_NAME="${SERVICE_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PLIST_SRC="${SCRIPT_DIR}/${PLIST_NAME}"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_NAME}"
LOG_DIR="${PROJECT_DIR}/logs"

# Detect node path
detect_node_path() {
    local node_bin
    node_bin="$(dirname "$(which node 2>/dev/null || echo '')")"
    if [[ -z "$node_bin" || "$node_bin" == "." ]]; then
        # Try common locations
        for p in /opt/homebrew/bin /usr/local/bin "$HOME/.nvm/versions/node"/*/bin; do
            if [[ -x "$p/node" ]]; then
                node_bin="$p"
                break
            fi
        done
    fi
    echo "$node_bin"
}

install_service() {
    echo "==> Installing iMessage Bridge service..."

    # Check prerequisites
    if [[ ! -f "${PROJECT_DIR}/package.json" ]]; then
        echo "ERROR: package.json not found at ${PROJECT_DIR}"
        exit 1
    fi

    if [[ ! -f "${PROJECT_DIR}/.env" ]]; then
        echo "ERROR: .env not found. Copy .env.example and configure it first."
        exit 1
    fi

    # Install dependencies if needed
    if [[ ! -d "${PROJECT_DIR}/node_modules" ]]; then
        echo "==> Installing npm dependencies..."
        cd "$PROJECT_DIR" && npm install
    fi

    # Create log directory
    mkdir -p "$LOG_DIR"

    # Detect node path
    NODE_PATH="$(detect_node_path)"
    if [[ -z "$NODE_PATH" ]]; then
        echo "ERROR: Cannot find node. Install Node.js first."
        exit 1
    fi
    echo "==> Detected node at: ${NODE_PATH}"

    # Generate plist with actual paths
    echo "==> Generating launchd plist..."
    sed \
        -e "s|__INSTALL_DIR__|${PROJECT_DIR}|g" \
        -e "s|__NODE_PATH__|${NODE_PATH}|g" \
        "$PLIST_SRC" > "$PLIST_DST"

    # Unload if already loaded
    launchctl list "$SERVICE_LABEL" &>/dev/null && {
        echo "==> Unloading existing service..."
        launchctl unload "$PLIST_DST" 2>/dev/null || true
    }

    # Load service
    echo "==> Loading service..."
    launchctl load "$PLIST_DST"

    echo ""
    echo "==> Done! Service installed and started."
    echo "    Label:  ${SERVICE_LABEL}"
    echo "    Plist:  ${PLIST_DST}"
    echo "    Logs:   ${LOG_DIR}/bridge.log"
    echo "    Errors: ${LOG_DIR}/bridge.error.log"
    echo ""
    echo "    Check status: $0 status"
    echo "    View logs:    $0 logs"
}

uninstall_service() {
    echo "==> Uninstalling iMessage Bridge service..."

    if launchctl list "$SERVICE_LABEL" &>/dev/null; then
        launchctl unload "$PLIST_DST" 2>/dev/null || true
        echo "==> Service unloaded."
    else
        echo "==> Service was not loaded."
    fi

    if [[ -f "$PLIST_DST" ]]; then
        rm "$PLIST_DST"
        echo "==> Plist removed: ${PLIST_DST}"
    fi

    echo "==> Done."
}

show_status() {
    echo "==> iMessage Bridge service status:"
    echo ""
    if launchctl list "$SERVICE_LABEL" &>/dev/null; then
        launchctl list "$SERVICE_LABEL"
        echo ""
        echo "Service is LOADED."
        # Check if process is running
        local pid
        pid=$(launchctl list "$SERVICE_LABEL" 2>/dev/null | awk 'NR==2{print $1}')
        if [[ "$pid" != "-" && -n "$pid" ]]; then
            echo "Process PID: $pid"
        fi
    else
        echo "Service is NOT loaded."
    fi
}

show_logs() {
    echo "==> Recent logs (last 50 lines):"
    echo "--- stdout ---"
    tail -50 "${LOG_DIR}/bridge.log" 2>/dev/null || echo "(no logs yet)"
    echo ""
    echo "--- stderr ---"
    tail -50 "${LOG_DIR}/bridge.error.log" 2>/dev/null || echo "(no error logs yet)"
}

# --- Main ---
case "${1:-}" in
    install)
        install_service
        ;;
    uninstall)
        uninstall_service
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "Usage: $0 [install|uninstall|status|logs]"
        exit 1
        ;;
esac
