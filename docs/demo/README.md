# The README's pictures

[preview.png](../../preview.png) and [first-run.png](../media/first-run.png) show the real
sidebar in the real Herdr app, on a stage that is synthetic from end to end. Nothing in them
comes from a real repository, project or person.

**Real:** the Herdr app, herdr-core, this repository's mod and its installer.

**Synthetic:**

- **GitHub.** [bin/gh](bin/gh) stands in for the GitHub CLI. It answers the calls the sidebar
  makes with made-up repositories (`acme/web`, `acme/api`, `acme/docs`), people and pull
  requests, timed relative to now. It never contacts GitHub, and logs each call to `gh.log`
  in the stage.
- **The avatars.** [bin/curl](bin/curl) draws a pattern for each author instead of
  downloading a picture.
- **The projects.** `~/code/shop` and `~/code/api` are empty folders that the stand-in `gh`
  treats as clones.
- **The app.** A second Herdr app whose home is in the stage, with its own herdr-core, the
  welcome already seen and usage reports off.

Nothing of yours is read or written, and your own spaces don't show.

## Take them again

```sh
sh docs/demo/record.sh
```

It needs the Herdr app, herdr-core and python3. The app draws the pictures itself
(`herdr-app shot`), so no screen recording permission is involved.

- **[stage.sh](stage.sh)** starts the core and the second app, and prints the stage's folder.
  `stage.sh --down <folder>` stops everything and deletes it.
- **[shots.sh](shots.sh)** opens two spaces, runs the installer, lists three repositories and
  takes the pictures.
- **[record.sh](record.sh)** runs both and takes the stage down.

Two things to know before you run it:

- **The second app's window comes to the front for each picture,** because the app only draws
  while its window can be seen. Keys you type meanwhile go to it; its terminals don't show them.
- **Starting the Herdr app installs an app update that was waiting,** as any start does.
