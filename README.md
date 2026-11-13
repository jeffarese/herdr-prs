# herdr-prs

[![CI](https://github.com/jeffarese/herdr-prs/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffarese/herdr-prs/actions/workflows/ci.yml)

A mod for the [Herdr](https://herdr.dev) desktop app: a right-hand sidebar with your open pull
requests, grouped by the state of their checks. By default it lists the ones you opened and the
ones waiting on your review, from every repository. It can list every open pull request of the
repositories you pick instead.

![The Herdr window with the pull request sidebar on the right, titled Your pull requests, 7. Tabs for All, api, docs and web sit under the title. The list is grouped into Failing (1), Running (3), Passing (1) and No checks (1). Each row shows the repository and number, such as api#1203, the title, how long ago it was updated, the author's avatar, tags such as M, New, Needs review, Your review, Ready to merge and Auto-merge, and one small colored square per check. Your own pull requests have an accent line on their left.](preview.png)

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
[GitHub CLI](https://cli.github.com) (`gh`) signed in. The mod runs `gh` itself, so it sees exactly what `gh` can see, private repositories
included. It stores no token.

## What it lists

A new sidebar lists **yours**: every open pull request you opened, and every one that asks for
your review, in any repository `gh` can see. There's nothing to set up. It starts listing at
once, and until you close it, a note at the top says what it shows and how to change it.

The **sliders button** in the header opens **What to list**, where you choose between the two:

![The sidebar's panel, titled What to list. Two choices, each with a round button: Yours, "Pull requests you opened or were asked to review, from every repository", and Repositories, "Every open pull request in the repositories you pick", which is chosen. Below them, a box takes owner/name or a GitHub link, with an Add button, and under "Suggested: your spaces and recent pushes" are acme/shop, acme/api, acme/web, acme/docs, acme/design-system and sam/dotfiles, each with a plus.](docs/media/what-to-list.png)

- **Yours:** the pull requests you opened, and the ones whose review was asked of you by name.
  **Include reviews asked of your teams** adds those asked of any team you're in, with a Team
  review tag. It starts off, because with code owners in a large organization, team requests
  can run to hundreds. A review request ends when you submit your review, so a pull request
  you've reviewed leaves the list until someone asks you again.
- **Repositories:** every open pull request of the repositories you pick, whoever opened it.
  **Type** `owner/name`, or paste any GitHub link to the repository or something in it (a pull
  request, a file), or a clone URL, and press Enter. The sidebar checks with `gh` that the
  repository exists and that you can see it, and keeps GitHub's exact name. **Or click a
  suggestion:** the repositories of the folders open in your Herdr spaces, then the ones you
  pushed to most recently. Rename a repository with ✎ (it keeps its place in the list), or
  stop listing one with ×. With none picked yet, the panel stays open until you add one.

Switching keeps what the other choice had: the repositories you picked are still there when you
switch back. Esc or **Done** goes back to the list. A sidebar that listed repositories before
this choice existed keeps listing them.

The choice and the list of repositories are saved in Herdr's shared state, so they survive
restarts and every copy of the sidebar sees a change at once. Each sidebar block keeps its own
(the block's `block` prop names it), so one layout can list yours and another a team's
repositories.

## What it shows

- **Repository tabs:** with more than one repository, tabs under the title narrow the list to
  one of them (click it again for All). Each shows how many pull requests it has under the
  chosen filter. When the sidebar lists yours, the tabs are the repositories they're in, and
  come and go with them. In the All tab, rows name their repository (`web#482`).
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
  Changes requested, Your review (you were asked), Team review (a team you're in was asked,
  when yours include them), Ready to merge (approved, checks passing,
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
  waiting for a review or asking you or your team for one) and **Drafts**. Clicking the active chip goes
  back to All. Below 390 px only the active chip shows its count; the others show theirs on
  hover.
- **Refresh:** every 30 seconds while any checks are running, otherwise every 2 minutes. You
  can also use the ↻ button, whose tooltip shows when the list was last updated. Yours take one
  call for every repository. Picked repositories are all asked at once, and if one fails (a
  typo, lost access), a banner says what to do, its tab shows a red mark, and the others keep
  listing. If GitHub leaves part of an answer out (an organization that limits what `gh` can
  read), the banner says so, and the rest is listed.
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

A layout can also place the block itself, and say what it starts with:

```json
{ "id": "prs", "type": "block", "size": { "px": 340 }, "min": 44, "max": 560, "background": "chrome",
  "content": { "mod": "github-prs", "props": { "block": "prs", "mode": "repos", "repos": ["cli/cli"], "title": "optional" } } }
```

Props only set the start: once someone chooses in the sidebar, the sidebar's choice wins.

- `mode`: `me` (yours, from every repository) or `repos` (the repositories picked). Without
  it, a block that has `repos` lists them, and any other lists yours.
- `repos` (or a single `repo`) seeds the list of repositories.
- `teams`: `true` starts yours with the reviews asked of your teams included.
- `title` replaces the header's title: Your pull requests, or Pull requests when several
  repositories are picked.

## What it runs

Everything goes through programs you already have; the mod makes no other network requests.

- For yours, one `gh api graphql` call that runs two of GitHub's searches:
  `is:pr is:open archived:false author:@me`, and the same with `user-review-requested:@me`
  (`review-requested:@me` with your teams). It asks for the fields `gh pr list` asks for, and
  says who you are.
- For picked repositories, `gh pr list` for each one, `gh api user` once to learn your login,
  and `gh repo view` to check a repository you add.
- For the suggestions, once per sidebar: `gh repo view` in each local space's folder, and
  `gh api user/repos` for your recently pushed repositories.
- `curl` downloads each author's avatar once (`github.com/<login>.png`; for a GitHub App's
  bot, `gh api apps/<slug>` gives the app's logo) into `mods/github-prs/.avatars/` in Herdr's
  home. Initials show until a download finishes, or if one fails. Delete the folder to fetch
  fresh avatars.
- `open` (macOS), `xdg-open` (Linux) or `start` (Windows) for links.

## Known limits

- **Remote spaces:** suggestions come from spaces on this computer only.
- **100 at a time:** `gh pr list` is asked for at most 100 open pull requests per repository,
  and each of the two searches for yours returns at most 100.
- **Search lag:** yours come from GitHub's search, which can take a minute to see a pull
  request that was just opened, or a review that was just asked for.
- **Archived repositories** are left out of yours, as GitHub's own lists leave them out.
- **Reordering:** the panel adds, renames and removes repositories, but doesn't reorder them.
  Remove one and add it again to move it to the end.
- **Windows and Linux:** the installer is a shell script that needs `python3`; the mod itself
  is untested outside macOS.

## Development

```sh
npm test                          # 50 Node tests: model and view
herdr-app check mods/github-prs   # Herdr's own checker
sh docs/demo/record.sh            # the pictures, on a synthetic stage
```

- **`mods/github-prs/model.js`** is the data: check dedup, states, sections, filters, tags,
  repository parsing, which way a sidebar lists, and the search for yours. It imports nothing from Herdr, so Node can test it.
- **`mods/github-prs/main.js`** draws the sidebar and runs `gh`, with Herdr's `herdr` and
  `gpui-kit` modules. `tests/view.test.mjs` runs it against an in-memory builder.
- **`scripts/install.py`** puts the block in the layout.
- **[docs/demo](docs/demo)** builds the stage the pictures were taken on. Nothing in them is real.

## License

[MIT](LICENSE)
