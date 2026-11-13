#!/usr/bin/env python3
"""Install the github-prs mod as a right sidebar in the layout Herdr shows.

Herdr's own layouts are read-only, so if one of those is showing, the sidebar goes into a copy of
`main` called `main-prs`. A personal layout is backed up first. Running this again updates the mod
and keeps the layout. The sidebar lists your pull requests from every repository; its sliders
button switches it to the repositories you pick.
`--remove` takes the sidebar out of every layout and deletes the mod.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parent.parent
APP_HOME = Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app"))
MOD = "github-prs"
LAYOUT = "main-prs"
BLOCK = "prs"
TITLE = "Pull requests"
IGNORE = shutil.ignore_patterns("*.d.ts", "jsconfig.json", "*.error")


def herdr(app, *args, check=True):
    return subprocess.run([app, *args], check=check, timeout=60, capture_output=True, text=True)


def ours(folder):
    try:
        return json.loads((folder / "mod.json").read_text()).get("title") == TITLE and (folder / "model.js").exists()
    except (OSError, ValueError):
        return False


def walk(node, parent=None):
    yield node, parent
    for child in node.get("children", []):
        yield from walk(child, node)


def shipped():
    try:
        names = {k[len("layout:"):] for k in json.loads((APP_HOME / "installed.json").read_text()) if k.startswith("layout:")}
    except (OSError, ValueError):
        names = set()
    return names or {"main", "terminals", "win98"}


def find(node, node_id):
    if node.get("id") == node_id:
        return node
    for child in node.get("children", []):
        match = find(child, node_id)
        if match:
            return match
    return None


def write_json(path, value):
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def install_mod(app):
    herdr(app, "check", str(SOURCE / "mods" / MOD))
    dest = APP_HOME / "mods" / MOD
    if dest.exists() and not ours(dest):
        sys.exit(f"{dest} exists and isn't this mod. Nothing was changed.")
    shutil.copytree(SOURCE / "mods" / MOD, dest, ignore=IGNORE, dirs_exist_ok=True)
    herdr(app, "check", str(dest))


def make_layout(app):
    name = json.loads(herdr(app, "status").stdout).get("layout") or "main"
    cloned = False
    if name in shipped():
        name, path = LAYOUT, APP_HOME / "layouts" / f"{LAYOUT}.json"
        if not path.exists():
            # The app's own clone keeps the person's clicks (sidebar width, folded panels).
            if herdr(app, "do", "layout.clone", "--name", "main", "--as", LAYOUT, check=False).returncode != 0:
                layout = json.loads((APP_HOME / "layouts/main.json").read_text())
                version = herdr(app, "--version").stdout.strip().split()[-1]
                layout["cloned_from"] = {"name": "main", "version": version}
                write_json(path, layout)
            for _ in range(50):
                if path.exists():
                    break
                time.sleep(0.1)
            cloned = True
    path = APP_HOME / "layouts" / f"{name}.json"
    before = path.read_text()
    layout = json.loads(before)
    if layout.get("type") != "row":
        sys.exit(f"{path} doesn't have a row at its root, so there is no right edge to add to.")
    if cloned:
        shutil.copyfile(SOURCE / "layouts" / f"{LAYOUT}.svg", APP_HOME / "layouts" / f"{LAYOUT}.svg")
        layout["preview"] = f"layouts/{LAYOUT}.svg"
    block = find(layout, BLOCK)
    if block is None:
        layout["children"].append({
            "id": BLOCK, "type": "block", "size": {"px": 340}, "min": 44, "max": 560, "background": "chrome",
            "content": {"mod": MOD, "props": {"block": BLOCK}},
        })
    if layout != json.loads(before):
        backup = path.with_name(f"{path.name}.before-prs")
        if not cloned and not backup.exists():
            backup.write_text(before)
        write_json(path, layout)
        # Herdr watches layouts asynchronously; give its catalog a moment to see the file.
        time.sleep(1)
    herdr(app, "do", "layout.switch", "--name", name)
    return name


def remove(app):
    # Other mods may share these layouts, so only the sidebar's block comes out; the layouts stay.
    for path in (APP_HOME / "layouts").glob("*.json"):
        try:
            layout = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        found = [(n, p) for n, p in walk(layout) if p and n.get("content", {}).get("mod") == MOD]
        for node, parent in found:
            parent["children"].remove(node)
        if found:
            write_json(path, layout)
            print(f"Took the pull request sidebar out of {path.stem}.")
    dest = APP_HOME / "mods" / MOD
    if dest.exists() and ours(dest):
        shutil.rmtree(dest)
    print(f"Removed the {MOD} mod.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="take the sidebar out of every layout and delete the mod")
    args = parser.parse_args()
    app = shutil.which("herdr-app")
    if not app or not (APP_HOME / "layouts/main.json").exists():
        sys.exit("Start Herdr once before installing.")
    if args.remove:
        return remove(app)
    install_mod(app)
    name = make_layout(app)
    print(f"Installed. Herdr shows {name} with the pull request sidebar on the right, listing yours from every repository.")
    print("To list whole repositories instead, use its sliders button.")
    print("Back to Herdr's layout: herdr-app do layout.switch --name main")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"Installation stopped: {' '.join(error.cmd[1:3])} failed: {(error.stderr or error.stdout or '').strip()}")
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        sys.exit(f"Installation stopped: {error}")
