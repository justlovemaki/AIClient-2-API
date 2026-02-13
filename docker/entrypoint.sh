#!/bin/sh
set -eu

start_browser_gui() {
  # Toggle with BROWSER_GUI_ENABLED=1
  enabled="${BROWSER_GUI_ENABLED:-0}"
  if [ "$enabled" != "1" ] && [ "$enabled" != "true" ]; then
    return 0
  fi

  display="${BROWSER_DISPLAY:-:99}"
  screen="${BROWSER_SCREEN:-1280x720x24}"
  vnc_port="${VNC_PORT:-5900}"
  novnc_port="${NOVNC_PORT:-6080}"

  export DISPLAY="$display"

  echo "[BrowserGUI] DISPLAY=$DISPLAY SCREEN=$screen VNC_PORT=$vnc_port NOVNC_PORT=$novnc_port"

  # X virtual framebuffer (headful Chromium needs an X server).
  Xvfb "$DISPLAY" -screen 0 "$screen" -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
  sleep 0.2

  # Lightweight window manager so Chromium behaves normally.
  if command -v openbox-session >/dev/null 2>&1; then
    openbox-session >/tmp/openbox.log 2>&1 &
  elif command -v openbox >/dev/null 2>&1; then
    openbox >/tmp/openbox.log 2>&1 &
  fi

  # VNC server for the X display.
  vnc_pass="${VNC_PASSWORD:-}"
  if [ -n "$vnc_pass" ]; then
    mkdir -p /root/.vnc
    x11vnc -storepasswd "$vnc_pass" /root/.vnc/passwd >/dev/null 2>&1 || true
    x11vnc -display "$DISPLAY" -forever -shared -rfbport "$vnc_port" -rfbauth /root/.vnc/passwd >/tmp/x11vnc.log 2>&1 &
  else
    echo "[BrowserGUI] WARNING: VNC_PASSWORD not set; starting VNC without password."
    x11vnc -display "$DISPLAY" -forever -shared -rfbport "$vnc_port" -nopw >/tmp/x11vnc.log 2>&1 &
  fi

  # noVNC (web client) on top of VNC.
  if command -v novnc_proxy >/dev/null 2>&1; then
    novnc_proxy --listen "$novnc_port" --vnc "127.0.0.1:$vnc_port" >/tmp/novnc.log 2>&1 &
  elif command -v websockify >/dev/null 2>&1; then
    web_dir="${NOVNC_WEB_DIR:-/usr/share/novnc}"
    websockify --web "$web_dir" "$novnc_port" "127.0.0.1:$vnc_port" >/tmp/novnc.log 2>&1 &
  else
    echo "[BrowserGUI] WARNING: noVNC not installed; skipping web VNC."
  fi
}

start_browser_gui

exec node src/core/master.js ${ARGS:-}

