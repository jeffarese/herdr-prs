#!/bin/sh
# Install the pull request sidebar into the Herdr app, or update it.
#
#   ./install.sh            copy the mod in and add the sidebar to the layout Herdr shows
#   ./install.sh --remove   take the sidebar out of every layout and delete the mod
#
# Without a clone, the script fetches the rest itself:
#
#   curl -fsSL https://raw.githubusercontent.com/jeffarese/herdr-prs/main/install.sh | sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || pwd)

# Run from a pipe, or from a copy of this file alone: fetch the rest.
if [ ! -f "$here/scripts/install.py" ]; then
  tarball=${HERDR_PRS_TARBALL:-https://github.com/jeffarese/herdr-prs/archive/refs/heads/main.tar.gz}
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$tarball" | tar -xz -C "$tmp" --strip-components 1
  [ -f "$tmp/scripts/install.py" ] || { echo "Couldn't fetch the sidebar from $tarball" >&2; exit 1; }
  here=$tmp
fi

command -v python3 >/dev/null 2>&1 || { echo "The installer needs python3." >&2; exit 1; }
python3 "$here/scripts/install.py" "$@"
