# herdr-prs

[![CI](https://github.com/jeffarese/herdr-prs/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffarese/herdr-prs/actions/workflows/ci.yml)

A mod for the [Herdr](https://herdr.dev) desktop app: a right-hand sidebar with the open pull
requests of the GitHub repositories you pick, grouped by the state of their checks.

![The Herdr window with the Pull requests sidebar on the right. Tabs for All, web, api and docs sit under the title. The list is grouped into Failing (2), Running (3), Passing (4) and No checks (1). Each row shows the repository and number, such as web#482, the title, how long ago it was updated, the author's avatar, tags such as M, New, Needs review, Your review, Ready to merge, Conflicts and Behind, and one small colored square per check.](preview.png)

Your pull requests, the ones waiting on your review and the ones whose checks just broke, in
one list beside your terminals and agents, refreshed while you work. Click a row to see its
checks, click a check to open its run.

This is an unofficial mod. It is not affiliated with Herdr.

## Install

Ask your agent, in a terminal inside Herdr:

> Add the Herdr mod at github.com/jeffarese/herdr-prs

Or run the installer:

```sh
curl -fsSL https://raw.githubusercontent.com/jeffarese/herdr-prs/main/install.sh | sh
```

From a clone, `./install.sh` does the same, and `./install.sh --remove` takes it out.

It needs the Herdr app (tested with 0.1.15), `python3` for the installer, and the
[GitHub CLI](https://cli.github.com) (`gh`) signed in with access to the repositories you want
to see. The mod runs `gh` itself, so it sees exactly what `gh` can see, private repositories
included. It stores no token.

## Choosing repositories

The first time the sidebar shows, it asks which repositories to list:

![The sidebar's first-run panel, titled Choose repositories. A box takes owner/name or a GitHub link, with an Add button. Below it, under "Suggested: your spaces and recent pushes", are acme/shop, acme/api, acme/web, acme/docs, acme/design-system and sam/dotfiles, each with a plus.](docs/media/first-run.png)

- **Type** `owner/name`, or paste any GitHub link to the repository or something in it (a pull
  request, a file), or a clone URL, and press Enter. The sidebar checks with `gh` that the
  repository exists and that you can see it, and keeps GitHub's exact name.
- **Or click a suggestion.** The suggestions are the repositories of the folders open in your
  Herdr spaces, then the ones you pushed to most recently.

Add as many as you like. Later, the **sliders button** in the header opens the same panel:
rename a repository with ✎ (it keeps its place in the list), stop listing one with ×, or add
more. Esc or **Done** goes back to the list.

The list is saved in Herdr's shared state, so it survives restarts and every copy of the
sidebar sees an edit at once. Each sidebar block keeps its own list (the block's `block` prop
names it), so two layouts can watch different repositories.

## What it shows

- **Repository tabs:** with more than one repository, tabs under the title narrow the list to
  one of them (click it again for All). Each shows how many pull requests it has under the
  chosen filter. In the All tab, rows name their repository (`web#482`).
- **Sections by check state:** Failing, Running, Passing and No checks. Each section folds,
  and the sidebar remembers which ones you folded. Within each, the most recently updated come
  first.
- **Two lines per pull request:** its state mark, number, title and how long ago it was
  updated (amber once it's stale). Under that: the author's round avatar (hover it for the
  name), tags, and one square per check, failures first: red failed, amber running
  (pulsing), green passed, an empty outline for skipped. When more checks than fit, the last
  square becomes a `+n` count. A left accent marks your own pull requests.
- **Tags:** first the size, from lines added plus removed: XS (under 10), S (under 100),
  M (under 500), L (under 1000, amber) and XL (red). Then, most important first: Conflicts,
  Changes requested, Your review (you were asked), Ready to merge (approved, checks passing,
  up to date: it replaces Approved), Behind (its base moved on), Auto-merge, Stale (no
  activity for 7 days), New (opened in the last 24 hours), Draft, and Approved or Needs
  review. Tags that don't fit become a `+n` that names them on hover; the row's tooltip lists
  them all, with the size's line and file counts.
- **Click a row** to list its latest checks, failures first. Click a check to open its run.
  Skipped checks start folded. **Open on GitHub** and **All checks** open the pull request
  and its Checks tab. While you hover over a row, ↗ opens the pull request without unfolding
  it.
- **Search** by number, title, author, branch or repository. Every word you type must match.
  The chips filter the list: **Ready to review** (all but drafts, where a new sidebar
  starts), **All**, **Mine** (you're the author), **Review** (not a draft, not yours, and
  waiting for a review or asking you for one) and **Drafts**. Clicking the active chip goes
  back to All. Below 390 px only the active chip shows its count; the others show theirs on
  hover.
- **Refresh:** every 30 seconds while any checks are running, otherwise every 2 minutes. You
  can also use the ↻ button, whose tooltip shows when the list was last updated. All the
  repositories are asked at once. If one fails (a typo, lost access), a banner says what to
  do, its tab shows a red mark, and the others keep listing.
- **Rail:** › folds the sidebar to a 52 px rail with the failing, running and passing counts.
  ‹ unfolds it to the width it had before.

### How it counts checks

GitHub's own rollup marks a pull request as failing when a workflow ran twice on the same
commit and the first run was cancelled. This happens with concurrency groups and re-runs. The
sidebar keeps only the newest run of each check (by workflow and name), so a cancelled run
that a newer run replaced doesn't count. Hover over a row to see how many older runs were left
out. A pull request whose checks were all skipped counts as passing, as it does on GitHub.

## Where it goes

The installer adds a `prs` block at the right edge of the layout Herdr shows, so it combines
with other mods there. A personal layout is backed up once as `<name>.json.before-prs`.
Herdr's shipped layouts are read-only, so if one of those is showing, the installer asks Herdr
to clone `main` as `main-prs` (keeping your sidebar widths) and switches to it. Running the
installer again updates the mod and leaves the layout alone. A clone doesn't get Herdr's later
changes to `main`. `--remove` leaves the layouts in place, because other mods may be in them.
To go back to the shipped layout, run `herdr-app do layout.switch --name main`.

To hide or show the sidebar, run `herdr-app do layout.toggle --id prs`, or bind the toggle in
`~/.config/herdr-app/keys.json`:

```json
"cmd-shift-g": { "command": "layout.toggle", "args": { "id": "prs" } }
```

Editing `keys.json` makes the whole file yours: Herdr then stops adding new default shortcuts
to it.

A layout can also place the block itself, and seed its list:

```json
{ "id": "prs", "type": "block", "size": { "px": 340 }, "min": 44, "max": 560, "background": "chrome",
  "content": { "mod": "github-prs", "props": { "block": "prs", "repos": ["cli/cli"], "title": "optional" } } }
```

`repos` (or a single `repo`) only seeds the list: once you edit it in the sidebar, the
sidebar's list wins. `title` replaces "Pull requests" in the header when several repositories
are listed.

## What it runs

Everything goes through programs you already have; the mod makes no other network requests.

- `gh pr list` for each repository, `gh api user` once to learn your login, and
  `gh repo view` to check a repository you add.
- For the suggestions, once per sidebar: `gh repo view` in each local space's folder, and
  `gh api user/repos` for your recently pushed repositories.
- `curl` downloads each author's avatar once (`github.com/<login>.png`; for a GitHub App's
  bot, `gh api apps/<slug>` gives the app's logo) into `mods/github-prs/.avatars/` in Herdr's
  home. Initials show until a download finishes, or if one fails. Delete the folder to fetch
  fresh avatars.
- `open` (macOS), `xdg-open` (Linux) or `start` (Windows) for links.

## Known limits

- **Remote spaces:** suggestions come from spaces on this computer only.
- **100 per repository:** `gh pr list` is asked for at most 100 open pull requests each.
- **Reordering:** the panel adds, renames and removes repositories, but doesn't reorder them.
  Remove one and add it again to move it to the end.
- **Windows and Linux:** the installer is a shell script that needs `python3`; the mod itself
  is untested outside macOS.

## Development

```sh
npm test                          # 38 Node tests: model and view
herdr-app check mods/github-prs   # Herdr's own checker
sh docs/demo/record.sh            # the pictures, on a synthetic stage
```

- **`mods/github-prs/model.js`** is the data: check dedup, states, sections, filters, tags,
  repository parsing. It imports nothing from Herdr, so Node can test it.
- **`mods/github-prs/main.js`** draws the sidebar and runs `gh`, with Herdr's `herdr` and
  `gpui-kit` modules. `tests/view.test.mjs` runs it against an in-memory builder.
- **`scripts/install.py`** puts the block in the layout.
- **[docs/demo](docs/demo)** builds the stage the pictures were taken on. Nothing in them is real.

## License

[MIT](LICENSE)
