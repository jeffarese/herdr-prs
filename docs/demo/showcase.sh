#!/bin/sh
# The pull request sidebar's scene on a showcase stage (~/workspace/herdr/herdr-showcase).
# scene.sh runs it after the default scene, with the stage folder:
#
#   w=$(SHOWCASE_TFVPN=0 SHOWCASE_HOOK=$PWD/docs/demo/showcase.sh sh ~/workspace/herdr/herdr-showcase/stage.sh)
#
# With no second argument: preview.png's scene. The sidebar lists yours (a new sidebar's
# default) and gets the room to show every section unfolded: Failing, Running, Passing and No
# checks. The stats and the running list share what's left of the right sidebar.
#
#   sh docs/demo/showcase.sh <stage> what-to-list
#
# docs/media/what-to-list.png's scene: the same block told to list repositories, with none
# picked yet, so it opens on its What to list panel with suggestions from the stage's spaces.
# Run it again without the argument to go back.
set -eu
w=${1:?usage: showcase.sh <stage folder> [what-to-list]}
# shellcheck disable=SC1091
. "$w/env.sh"

case ${2:-} in
  what-to-list) props='{"block": "pick", "mode": "repos"}' ;;
  '') props='{"block": "prs"}' ;;
  *) echo "showcase: unknown scene: $2" >&2; exit 2 ;;
esac

# The stage's copy of the layout: the prs block's props and its height at the top of the right
# sidebar, enough for all seven, then the stats in their compact form and the running list,
# whose servers show above the toasts. The app reads the file again.
python3 - "$HERDR_APP_HOME/layouts/$SC_LAYOUT.json" "$props" <<'PY'
import json, sys
path, props = sys.argv[1], json.loads(sys.argv[2])
layout = json.load(open(path))
def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)
nodes = {n.get("id"): n for n in walk(layout.get("root", layout))}
block = nodes["prs"]
block.pop("hidden", None)
block["content"]["props"] = props
block["size"] = {"px": 585}
nodes["stats-right"]["size"] = {"px": 165}
json.dump(layout, open(path, "w"), indent=2)
PY
# Time to read the layout, ask the stand-in gh and draw the avatars.
sleep 4
