#!/bin/sh
# Builds the demo's stage on this Mac, all of it synthetic, and prints the folder it lives in.
# `stage.sh --down <folder>` stops it and deletes it.
#
#   w=$(sh docs/demo/stage.sh)
#   (. "$w/env.sh" && herdr-app status)
#   sh docs/demo/stage.sh --down "$w"
#
# The stage is a herdr-core of its own and a second Herdr app whose home is the stage, with
# this repository's sidebar installed. `gh` and `curl` there are bin/gh and bin/curl, which
# make up the pull requests and draw the avatars. Nothing of yours is read or touched, and
# nothing asks GitHub.
set -eu
kit=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$kit/../.." && pwd)
hc_bin=$(command -v herdr-core 2>/dev/null || echo "$HOME/.local/bin/herdr-core")
app=${HERDR_APP:-/Applications/Herdr.app}
app_cli="$app/Contents/MacOS/Herdr"

if [ "${1:-}" = --down ]; then
  w=${2:?usage: stage.sh --down <folder>}
  [ -f "$w/env.sh" ] || { echo "not a demo folder: $w" >&2; exit 2; }
  # shellcheck disable=SC1091
  . "$w/env.sh"
  [ -f "$w/app.pid" ] && kill "$(cat "$w/app.pid")" 2>/dev/null || :
  herdr-core server stop >/dev/null 2>&1 || :
  # A program still running from the folder ends by its PID.
  pids=$(ps -axo pid=,command= | awk -v w="$w/" 'index($0, w) {print $1}')
  [ -z "$pids" ] || kill $pids 2>/dev/null || :
  rm -rf "$w"
  exit 0
fi

[ -x "$hc_bin" ] || { echo "needs herdr-core" >&2; exit 2; }
[ -x "$app_cli" ] || { echo "needs the Herdr app at $app (HERDR_APP picks another)" >&2; exit 2; }

# Short on purpose: Unix socket paths have a ~104 byte limit on macOS.
w=$(mktemp -d /tmp/prs.XXXXXX)
w=$(cd "$w" && pwd -P)
# The app's home is inside the stage's home, as ~/.config/herdr-app is in yours: mods may only
# read files under home, and the sidebar keeps its avatars in the app's home.
mkdir -p "$w/bin" "$w/s" "$w/c" "$w/home/.config/herdr-app/mods" "$w/home/code/shop" "$w/home/code/api"
ln -s "$hc_bin" "$w/bin/herdr-core"
ln -s "$hc_bin" "$w/bin/hc"
ln -s "$app_cli" "$w/bin/herdr-app"
ln -s "$kit/bin/gh" "$w/bin/gh"
ln -s "$kit/bin/curl" "$w/bin/curl"

cat > "$w/env.sh" <<ENV
# The demo stage's environment (stage.sh).
export DEMO_WORK='$w' HOME='$w/home' ZDOTDIR='$w/home' SHELL=/bin/zsh
export PATH='$w/bin:/usr/bin:/bin:/usr/sbin:/sbin'
export XDG_STATE_HOME='$w/s' XDG_CONFIG_HOME='$w/c'
export HC_SESSION=prsdemo HERDR_APP_HOME='$w/home/.config/herdr-app' HERDR_TELEMETRY=0
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
unset GH_TOKEN GITHUB_TOKEN GH_HOST HC_TERMINAL_ID HC_TERMINAL_SOCKET CLAUDE_CONFIG_DIR TERM_PROGRAM TERM_PROGRAM_VERSION
unset REX_SESSION REX_BLOCK REX_SERVER REX_CLIENT REX_HOME REX_BIN_DIR
ENV
# shellcheck disable=SC1091
. "$w/env.sh"

# The shells Herdr starts, and the environment its mods' programs get, are the stage's: its
# home, and its bin first so the stand-in gh and curl answer. Every zsh start file says so,
# because macOS's /etc/zprofile reorders PATH between them.
for f in .zshenv .zprofile .zshrc; do
  printf 'export HOME="%s"\nexport PATH="%s"\n' "$HOME" "$PATH" > "$HOME/$f"
done
printf 'PROMPT="%%F{cyan}%%~%%f %%F{magenta}❯%%f "\nunsetopt beep\n' >> "$HOME/.zshrc"

herdr-core server start >/dev/null

# A home that has seen the welcome, with the side panels closed, and that reports nothing.
printf '{"frame.welcomed":"skipped","workspace.panels":[]}\n' > "$HERDR_APP_HOME/shared.json"
printf '{"telemetry":false,"sounds":{"enabled":false}}\n' > "$HERDR_APP_HOME/settings.json"
printf '{"state":"windowed","bounds":[80.0,60.0,1360.0,860.0]}\n' > "$HERDR_APP_HOME/window.json"
# And that has run this version before, so it doesn't announce an update.
version=$(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString)
printf '{"last_run":"%s","presented":[]}\n' "$version" > "$HERDR_APP_HOME/update-notes.json"

# The app: its home is the stage, and it finds the stage's core through HC_SESSION.
/usr/bin/open -n -a "$app"
i=0
until herdr-app status >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -lt 60 ] || { echo "the Herdr app didn't start" >&2; exit 1; }
  sleep 0.5
done
pgrep -n -f "$app_cli" > "$w/app.pid"
echo "$w"
