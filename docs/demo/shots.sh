#!/bin/sh
# Installs the sidebar on a stage (stage.sh) and takes the README's pictures.
#
#   sh docs/demo/shots.sh <stage folder>
#
# preview.png: yours, the sidebar's default, from every repository. docs/media/what-to-list.png:
# the panel where that's chosen, set to repositories with none picked yet, and suggestions from
# the stage's spaces. The app draws both itself (`herdr-app shot`), so no screen recording is
# involved.
set -eu
kit=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$kit/../.." && pwd)
w=${1:?usage: shots.sh <stage folder>}
# shellcheck disable=SC1091
. "$w/env.sh"
mkdir -p "$repo_root/docs/media"

# The app draws a new frame only while its window can be seen, so the stage's comes to the
# front for each picture.
shoot() { # shoot <file>
  osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $(cat "$w/app.pid")) to true" >/dev/null
  sleep 3
  herdr-app shot "$1" >/dev/null
}

# Two spaces, in folders that are clones as far as the stand-in gh is concerned.
# Their terminals draw a prompt and don't echo: the window takes the keyboard for each
# picture, and keys typed meanwhile shouldn't show up in it.
prompt='stty -echo; clear; printf "\033[36m%s\033[0m \033[35m❯\033[0m " "~/code/$(basename "$PWD")"; exec cat >/dev/null'
herdr-app do space.new --folder "$HOME/code/shop" --argv "[\"sh\",\"-c\",$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$prompt")]" >/dev/null
herdr-app do space.new --folder "$HOME/code/api" --argv "[\"sh\",\"-c\",$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$prompt")]" >/dev/null
sleep 1

python3 "$repo_root/scripts/install.py"
sleep 1

# Set the block's props, as a layout can, and widen it.
set_props() { # set_props <layout> <props json>
  python3 - "$HERDR_APP_HOME/layouts/$1.json" "$2" <<'PY'
import json, sys
path, props = sys.argv[1], json.loads(sys.argv[2])
layout = json.load(open(path))
def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)
block = next(n for n in walk(layout) if n.get("id") == "prs")
block["content"]["props"] = props
block["size"] = {"px": 380}
json.dump(layout, open(path, "w"), indent=2)
PY
}
# Yours: what a new sidebar lists, with nothing to set up.
set_props main-prs '{"block": "prs"}'
sleep 4
shoot "$repo_root/preview.png"

# The panel: a block told to list repositories, with none picked, opens on it.
herdr-app do layout.clone --name main-prs --as choose >/dev/null
sleep 1
set_props choose '{"block": "choose", "mode": "repos"}'
sleep 4
shoot "$repo_root/docs/media/what-to-list.png"
herdr-app do layout.switch --name main-prs >/dev/null
