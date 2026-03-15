#!/bin/bash
# Auth Handoff Setup Script
# Installs Auth Handoff and configures it to run on boot
# Supports macOS and Linux

set -e

INSTALL_DIR="$HOME/auth-handoff"
PORT="${PORT:-3847}"
REPO="https://github.com/reececantelon/auth-handoff"

echo ""
echo "  🔐 Auth Handoff Setup"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Check dependencies ──
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ❌ Required: $1 (not found)"
    echo "     Install it first: $2"
    exit 1
  fi
}

check_cmd node "https://nodejs.org"
check_cmd npm "https://nodejs.org"
check_cmd git "https://git-scm.com"

echo "  ✓ Node $(node --version)"
echo "  ✓ npm $(npm --version)"

# ── Clone or update ──
if [ -d "$INSTALL_DIR" ]; then
  echo ""
  echo "  📂 Found existing install at $INSTALL_DIR"
  echo "  Updating..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || echo "  (skipped git pull - local changes present)"
else
  echo ""
  echo "  📦 Cloning to $INSTALL_DIR..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo ""
echo "  📦 Installing dependencies..."
npm install --silent

# ── macOS setup ──
if [[ "$OSTYPE" == "darwin"* ]]; then
  setup_macos() {
    echo ""
    echo "  🍎 macOS detected — setting up launchd services..."

    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if [ ! -f "$CHROME_PATH" ]; then
      echo "  ⚠️  Google Chrome not found at default path."
      echo "     Install Chrome or update CHROME_PATH in the plist."
    fi

    # Chrome remote debugging service
    cat > "$HOME/Library/LaunchAgents/com.auth-handoff.chrome.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.auth-handoff.chrome</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string>
        <string>--remote-debugging-port=9222</string>
        <string>--user-data-dir=$HOME/.auth-handoff-chrome-profile</string>
        <string>--window-size=412,915</string>
        <string>--no-first-run</string>
        <string>--no-default-browser-check</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/logs/chrome.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/logs/chrome-err.log</string>
</dict>
</plist>
PLIST

    # Auth Handoff server service
    NODE_BIN=$(which node)
    cat > "$HOME/Library/LaunchAgents/com.auth-handoff.server.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.auth-handoff.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$INSTALL_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>$PORT</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/logs/server.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/logs/server-err.log</string>
</dict>
</plist>
PLIST

    mkdir -p "$INSTALL_DIR/logs"

    # Load services
    launchctl unload "$HOME/Library/LaunchAgents/com.auth-handoff.chrome.plist" 2>/dev/null || true
    launchctl unload "$HOME/Library/LaunchAgents/com.auth-handoff.server.plist" 2>/dev/null || true
    sleep 1
    launchctl load "$HOME/Library/LaunchAgents/com.auth-handoff.chrome.plist"
    launchctl load "$HOME/Library/LaunchAgents/com.auth-handoff.server.plist"

    echo "  ✓ Services installed and started"
    echo "  ✓ Will auto-start on login"
  }
  setup_macos

# ── Linux setup ──
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  setup_linux() {
    echo ""
    echo "  🐧 Linux detected — setting up systemd service..."

    # Find Chrome
    CHROME_BIN=""
    for bin in google-chrome google-chrome-stable chromium chromium-browser; do
      if command -v "$bin" &>/dev/null; then
        CHROME_BIN=$(which "$bin")
        break
      fi
    done

    if [ -z "$CHROME_BIN" ]; then
      echo "  ⚠️  Chrome/Chromium not found. Install it:"
      echo "     Ubuntu/Debian: sudo apt install chromium-browser"
      echo "     Or: https://google.com/chrome"
      echo "  Continuing without Chrome autostart..."
    else
      echo "  ✓ Chrome found at $CHROME_BIN"
      # Chrome systemd unit
      mkdir -p "$HOME/.config/systemd/user"
      cat > "$HOME/.config/systemd/user/auth-handoff-chrome.service" << UNIT
[Unit]
Description=Auth Handoff Chrome (remote debugging)
After=graphical-session.target

[Service]
ExecStart=$CHROME_BIN --remote-debugging-port=9222 --user-data-dir=$HOME/.auth-handoff-chrome-profile --window-size=412,915 --no-first-run --no-default-browser-check --headless=new
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
      systemctl --user enable auth-handoff-chrome.service
      systemctl --user start auth-handoff-chrome.service
      echo "  ✓ Chrome service enabled"
    fi

    # Server systemd unit
    NODE_BIN=$(which node)
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/auth-handoff.service" << UNIT
[Unit]
Description=Auth Handoff Server
After=network.target

[Service]
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$PORT
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable auth-handoff.service
    systemctl --user start auth-handoff.service
    echo "  ✓ Server service enabled"

    # Enable lingering so it runs without login (VPS use)
    if command -v loginctl &>/dev/null; then
      loginctl enable-linger "$USER" 2>/dev/null && echo "  ✓ Lingering enabled (runs without active session)"
    fi
  }
  setup_linux

else
  echo "  ⚠️  Unsupported OS. Manual setup required."
  echo "     Run: cd $INSTALL_DIR && npm start"
fi

# ── Wait for server and show token ──
echo ""
echo "  ⏳ Waiting for server to start..."
sleep 4

TOKEN=""
if [ -f "$INSTALL_DIR/.api-token" ]; then
  TOKEN=$(cat "$INSTALL_DIR/.api-token")
fi

if curl -s "http://localhost:$PORT/api/sessions" -H "Authorization: Bearer $TOKEN" | grep -q '\['; then
  echo "  ✅ Server is running!"
else
  echo "  ⚠️  Server may still be starting. Check logs:"
  echo "     cat $INSTALL_DIR/logs/server.log"
fi

echo ""
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎉 Auth Handoff is ready!"
echo ""
if [ -n "$TOKEN" ]; then
  echo "  API Token: $TOKEN"
  echo "  (saved to $INSTALL_DIR/.api-token)"
  echo ""
fi
echo "  Open on your phone (via Tailscale or local network):"
echo "  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR_IP'):$PORT"
echo ""
echo "  Bot usage:"
echo "  curl -H \"Authorization: Bearer \$TOKEN\" http://localhost:$PORT/api/keys/openai"
echo ""
