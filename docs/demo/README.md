# The README's pictures

[preview.png](../../preview.png) and [what-to-list.png](../media/what-to-list.png) show the real
sidebar in the real Herdr app, on the showcase stage: a made-up Herdr world that every mod's
README is pictured in (`~/workspace/herdr/herdr-showcase`, its `BRIEF.md` and `README.md`).
Nothing in them comes from a real repository, project or person.

**Real:** the Herdr app, herdr-core, this repository's mod as its working tree has it, and the
other mods around it, in one layout.

**Made up:** Sam, who works at Acme, his spaces and agents on two machines, the servers, the
toasts, and GitHub. The kit's `bin/gh` (grown from this folder's [bin/gh](bin/gh)) answers the
calls the sidebar makes with Acme's repositories (`acme/shop`, `acme/api`, `acme/web`,
`acme/docs`, `acme/design-system`), people and pull requests, timed relative to now, and its
`bin/curl` draws the avatars. Nothing contacts GitHub.

## The scene

The kit builds the stage and plays the default scene: the shop space's Claude Code in front, the
right sidebar shared by this sidebar, the stats and the running list, and two toasts. Then it
runs [showcase.sh](showcase.sh), this mod's hook, which changes the stage's copy of the layout:

- **preview.png:** the sidebar lists yours, as a new one does, and is 585 pt tall, so all
  seven pull requests show with their sections unfolded: Failing, Running, Passing and No
  checks. The stats take 165 pt in their compact form, and the running list the rest, with its
  servers above the toasts. Nothing is dimmed.
- **what-to-list.png** (`showcase.sh <stage> what-to-list`): the same block, under a new block
  name, told to list repositories with none picked yet, so it opens on its What to list panel
  with suggestions from the stage's spaces. The picture is the block, cut out of the right
  sidebar.

## Take them again

From this repository's root, with the showcase kit in `~/workspace/herdr/herdr-showcase`
(`SHOWCASE_KIT` names another place):

```sh
sh docs/demo/showcase-shots.sh
```

[showcase-shots.sh](showcase-shots.sh) builds a stage with `SHOWCASE_VPN=0` (the VPN switch
left out, as for every public README) and this hook, takes preview.png, sets the What to list
scene and takes its crop of the right sidebar (`PANEL_CROP`, in pixels of the 3200-wide
picture), then takes the stage down, also when something fails. Each picture goes through the
kit's `shoot.sh`, which waits until the keyboard and mouse have been still for a minute and
brings the stage's window to the front for about a second and a half, so a run takes a few
minutes.

To work on a scene by hand, keep a stage up:

```sh
kit=~/workspace/herdr/herdr-showcase
w=$(SHOWCASE_VPN=0 SHOWCASE_HOOK=$PWD/docs/demo/showcase.sh sh $kit/stage.sh)
sh docs/demo/showcase.sh "$w" what-to-list    # or without the scene name: preview.png's
sh $kit/shoot.sh "$w" /tmp/look.png
sh $kit/stage.sh --down "$w"
```

## The older stage

[stage.sh](stage.sh), [shots.sh](shots.sh) and [record.sh](record.sh) built this repository's
own stage (one app with two shell spaces and Herdr's shipped layout) and took the earlier
pictures. They still run, but no README picture comes from them now.
