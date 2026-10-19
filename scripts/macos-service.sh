#!/bin/zsh
set -euo pipefail

LABEL=com.ronhouben.postgresql-mcp-server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/postgresql-mcp-server.log"
DOMAIN="gui/$(id -u)"
REPO_DIR="${0:A:h:h}"

unload() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

  # bootout returns before the job is gone; bootstrapping too early fails with error 5.
  for _ in {1..50}; do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
}

case "${1:-}" in
  install)
    node_bin="$(command -v node)"
    port="${MCP_HTTP_PORT:-7432}"

    mkdir -p "${PLIST:h}" "${LOG:h}"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO_DIR/bin/postgresql-mcp-server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key>
    <string>$node_bin</string>
    <key>MCP_TRANSPORT</key>
    <string>http</string>
    <key>MCP_HTTP_PORT</key>
    <string>$port</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF
    plutil -lint "$PLIST" >/dev/null

    unload
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $LABEL on http://127.0.0.1:$port/mcp (log: $LOG)"
    ;;
  uninstall)
    unload
    rm -f "$PLIST"
    echo "Removed $LABEL"
    ;;
  *)
    echo "Usage: $0 install|uninstall" >&2
    exit 1
    ;;
esac
