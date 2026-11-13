#!/bin/sh
# Installs the sidebar on a stage (stage.sh) and takes the README's pictures.
#
#   sh docs/demo/shots.sh <stage folder>
#
# preview.png: three repositories listed. docs/media/first-run.png: a sidebar with none yet,
# asking which to list, with suggestions from the stage's spaces. The app draws both itself
# (`herdr-app shot`), so no screen recording is involved.
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

# Seed the block's list the way a layout can: props, until someone edits it in the sidebar.
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
set_props main-prs '{"block": "prs", "repos": ["acme/web", "acme/api", "acme/docs"]}'
sleep 4
shoot "$repo_root/preview.png"

# The first run: a block with nothing listed opens on the panel.
herdr-app do layout.clone --name main-prs --as first-run >/dev/null
sleep 1
set_props first-run '{"block": "first-run"}'
sleep 4
shoot "$repo_root/docs/media/first-run.png"
herdr-app do layout.switch --name main-prs >/dev/null
