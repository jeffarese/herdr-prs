#!/bin/sh
# Takes the README's pictures again: builds the stage, takes the pictures and takes the stage
# down.
#
#   sh docs/demo/record.sh
set -eu
kit=$(cd "$(dirname "$0")" && pwd)
w=$(sh "$kit/stage.sh")
trap 'sh "$kit/stage.sh" --down "$w"' EXIT
sh "$kit/shots.sh" "$w"
