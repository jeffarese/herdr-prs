#!/bin/sh
# Takes the README's pictures again, from nothing: builds a showcase stage with this mod's
# scene (showcase.sh), takes each picture with the kit's shoot.sh, and takes the stage down.
#
#   sh docs/demo/showcase-shots.sh
#
# preview.png                  the whole window, the pull request sidebar listing yours, the
#                              rest of the window dimmed
# docs/media/what-to-list.png  its What to list panel, cut out of the right sidebar
#
# Each picture waits until nobody has typed for a minute (shoot.sh), so a run takes a few
# minutes. SHOWCASE_KIT names the kit when it isn't in ~/workspace/herdr/herdr-showcase.
set -eu
here=$(cd "$(dirname "$0")" && pwd -P)
repo=$(cd "$here/../.." && pwd -P)
kit=${SHOWCASE_KIT:-$HOME/workspace/herdr/herdr-showcase}

w=
trap '[ -z "$w" ] || sh "$kit/stage.sh" --down "$w"' EXIT
trap 'exit 130' INT TERM HUP
w=$(SHOWCASE_TFVPN=0 SHOWCASE_HOOK="$here/showcase.sh" sh "$kit/stage.sh" </dev/null)
[ -n "$w" ] || { echo "showcase-shots: no stage" >&2; exit 1; }

shoot() { sh "$kit/shoot.sh" "$w" "$@"; }
scene() { sh "$here/showcase.sh" "$w" "$@"; }

# The hook has set the main scene already. The pull request block lit, the rest dimmed.
shoot "$w/preview-raw.png"
sh "$kit/spot.sh" "$w/preview-raw.png" "$repo/preview.png" right:1

# The right sidebar is 365 pt at zoom 0.9 from x 1271 pt; the pull request block is its top
# 585 pt (526 at zoom 0.9). The picture is that block, at 2x.
scene what-to-list
shoot "$repo/docs/media/what-to-list.png" --crop "${PANEL_CROP:-2544,0,656,1052}"
