import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, props, theme, settings, run, notify, window, appHome, shared, setShared, spaces } from "herdr";
import { exists, mkdir, unlink } from "fs/promises";
import {
  DELAY, FILTERS, VIEWS, parse, listArgs, explain, nextDelay, sections, counts, stateCounts,
  duration, clock, took, opener, avatarFile, initials, strip, tags, size, isStale,
  parseRepo, uniqueRepos, sameRepo, repoKey, configured, shortName, inScope, repoCounts, problems,
  chosenMode, withTeams, modeKey, teamsKey, INTRO_KEY, searchArgs, parseSearch, reposOf,
} from "./model.js";

const ART = "mods/github-prs/";
const glyph = (name, size = 14) => svg(`${ART}${name}.svg`).size(size).flex_none();
// Downloaded avatars. A hidden folder: Herdr reloads a mod when a file in it changes, but not a
// hidden one, and an image is only drawn once its download has finished.
const AVATARS = `${ART}.avatars/`;
const SQUARE = 6;
const SQUARE_GAP = 2;
const CHIPS_WIDE = 390;
// Rough widths for fitting tags into the second line without measuring text.
const CHAR = 5.6;
const PILL_PAD = 10;
// Checks read as red, amber and green. Herdr's own "done" is blue in some themes, so passing
// uses the theme's terminal green.
const tone = (t, key) => (key === "pass" ? t.ansi2 ?? t.done : t[key] ?? t.muted);
// Below this width the sidebar is a rail of counts.
const RAIL = 170;
const WIDE = 340;
const NARROW = 52;
const STATE_WORD = { failing: "Checks failing", running: "Checks running", passing: "Checks passing", none: "No checks" };
// At most this many suggestions in the repository panel, and this many space folders asked about.
const SUGGEST = 8;
const SPACE_FOLDERS = 12;
const EMPTY = { ready: "Every open pull request is a draft", mine: "Nothing of yours is open", review: "Nothing is waiting for review", drafts: "No open drafts" };
// What "me" lists under, beside the repositories: one search covers every repository.
const ME = "@me";
const ABOUT = {
  me: "Pull requests you opened or were asked to review, from every repository.",
  repos: "Every open pull request in the repositories you pick.",
};
// Per-copy conveniences only (folded sections, the width to expand back to). Storage can be missing or throw.
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ } },
};

export default class PullRequests extends View {
  init(_props, cx) {
    // Herdr's per-copy parameters come from props(), not GPUI's init argument.
    this.given = props() ?? {};
    this.block = this.given.block || "prs";
    this.key = repoKey(this.block);
    // What was asked for (a repository, or ME) → its last good list, and → what went wrong the
    // last time it was asked for. A source in `partial` answered, but not all of it.
    this.lists = new Map();
    this.errors = new Map();
    this.partial = new Set();
    this.derived = null;
    this.loading = false;
    this.again = false;
    this.fetched = null;
    this.viewer = "";
    this.pending = null;
    this.query = "";
    // The chosen chip is kept; a new sidebar starts on the first, Ready to review.
    this.filter = store.get("filter", FILTERS[0][0]);
    if (!FILTERS.some(([id]) => id === this.filter)) this.filter = FILTERS[0][0];
    // "all", or the one repository the list is narrowed to.
    this.scope = store.get("scope", "all");
    this.hovered = null;
    this.width = Infinity;
    this.folded = new Set(store.get("folded", []));
    this.expanded = new Set();
    this.skipped = new Set();
    // login → "loading", "ready" or "none" (no picture: initials instead).
    this.avatars = new Map();
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search pull requests…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.scroll.scroll_to_item(0);
      cx.notify();
    });
    // The repository panel: open by choice, and by itself while there is nothing to list.
    this.setup = false;
    this.repoInput = InputState.new({ placeholder: "owner/name or a GitHub link" });
    this.repoInput.on("change", (_e, cx) => { if (this.addError) { this.addError = null; cx.notify(); } });
    this.repoInput.on("submit", (_e, cx) => this.addRepo(cx));
    this.adding = false;
    this.addError = null;
    this.editing = null;
    this.suggestions = null;
    this.suggesting = false;
    this.refresh(cx);
    // A sidebar that lists repositories and has none opens on the panel: look for suggestions.
    if (this.mode() === "repos" && !this.repos().length) this.suggest(cx);
  }

  // "me" (yours, from every repository) or "repos" (the ones picked). Like the list, the choice
  // lives in Herdr's shared state, so every copy of this block sees a change at once.
  mode() {
    return chosenMode(shared(modeKey(this.block)), this.layoutProps(), shared(this.key));
  }

  // Whether "me" includes the reviews asked of your teams.
  teams() {
    return withTeams(shared(teamsKey(this.block)), this.layoutProps());
  }

  // What a refresh asks for: the one search, or each repository.
  sources() {
    return this.mode() === "me" ? [ME] : this.repos();
  }

  // The repositories picked. The list lives in Herdr's shared state, so every copy of this block
  // sees an edit at once.
  repos() {
    return configured(shared(this.key), this.layoutProps());
  }

  // The repositories on screen, for tabs and row names: the ones picked, or the ones your pull
  // requests are in.
  shownRepos() {
    if (this.mode() === "repos") return this.repos();
    const list = this.lists.get(ME) ?? [];
    if (this.derived?.list !== list) this.derived = { list, repos: reposOf(list) };
    return this.derived.repos;
  }

  // The layout's props, read each time: editing the layout changes them under a running copy.
  layoutProps() {
    return props() ?? this.given;
  }

  saveRepos(list) {
    const repos = uniqueRepos(list);
    // Editing the list is choosing it: removing the last one doesn't turn the sidebar to yours.
    setShared(modeKey(this.block), "repos");
    // Adding the first one from the first-time panel keeps the panel open, for more.
    if (!this.repos().length && repos.length) this.setup = true;
    setShared(this.key, repos);
    for (const repo of [...this.lists.keys()]) {
      if (repo !== ME && !repos.some((r) => sameRepo(r, repo))) { this.lists.delete(repo); this.errors.delete(repo); this.partial.delete(repo); }
    }
    if (this.scope !== "all" && !repos.some((r) => sameRepo(r, this.scope))) this.setScope("all");
    return repos;
  }

  // Switching keeps the other way's settings, so the repositories picked are there to come back
  // to. The panel stays open: picking repositories, or the teams option, comes next.
  chooseMode(next, cx) {
    this.dismissIntro();
    const was = this.mode();
    setShared(modeKey(this.block), next);
    this.setup = true;
    if (next === was) { cx.notify(); return; }
    this.cancelEdit();
    this.setScope("all");
    if (next === "repos") this.suggest(cx);
    this.refresh(cx);
    cx.notify();
  }

  setTeams(on, cx) {
    setShared(teamsKey(this.block), on);
    this.refresh(cx);
    cx.notify();
  }

  // The first-run note in "me", until it's dismissed or the panel is opened: once for every sidebar.
  showIntro() {
    return this.mode() === "me" && !shared(INTRO_KEY);
  }

  dismissIntro() {
    if (!shared(INTRO_KEY)) setShared(INTRO_KEY, true);
  }

  // Every source's open pull requests, from the last good answer of each. null until the first
  // answer, so the list can say it's loading.
  get prs() {
    const sources = this.sources();
    if (!sources.some((s) => this.lists.has(s))) return null;
    return sources.flatMap((s) => this.lists.get(s) ?? []);
  }

  get error() {
    const sources = this.sources();
    return problems(sources.filter((s) => this.errors.has(s)).map((s) => this.errors.get(s))) || null;
  }

  // The scope, if its repository is still on screen.
  currentScope(repos = this.shownRepos()) {
    return this.scope !== "all" && repos.some((r) => sameRepo(r, this.scope)) ? this.scope : "all";
  }

  setScope(scope) {
    this.scope = scope;
    store.set("scope", scope);
    this.scroll.scroll_to_item(0);
  }

  // Clicking the chosen repository again goes back to all of them.
  chooseScope(scope, cx) {
    this.setScope(this.scope !== "all" && sameRepo(this.scope, scope) ? "all" : scope);
    cx.notify();
  }

  title(repos = this.shownRepos()) {
    const scope = this.currentScope(repos);
    if (scope !== "all") return shortName(scope, repos);
    if (this.layoutProps().title) return this.layoutProps().title;
    if (this.mode() === "me") return "Your pull requests";
    return repos.length === 1 ? shortName(repos[0]) : "Pull requests";
  }

  // One fetch at a time; each one schedules the next, sooner while checks are running.
  // All the sources are asked at once; one that fails keeps its last list and doesn't hold up
  // the others. A refresh asked for mid-fetch (a repository was just added) runs right after.
  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    this.pending?.cancel?.();
    this.pending = null;
    const sources = this.sources();
    if (!sources.length) {
      // Nothing to list: look again now and then, in case another copy got a list.
      this.pending = cx.timer.after(DELAY.settled, (cx) => this.refresh(cx));
      cx.notify();
      return;
    }
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      // The search says who you are in its own answer; a repository's list needs asking.
      if (!this.viewer && sources.some((s) => s !== ME)) this.viewer = await this.whoami();
      const answers = await Promise.all(sources.map((source) => (source === ME ? this.fetchMine() : this.fetch(source))));
      for (const [source, prs, error] of answers) {
        if (prs) this.lists.set(source, prs);
        if (error) this.errors.set(source, error); else this.errors.delete(source);
        if (prs && error) this.partial.add(source); else this.partial.delete(source);
      }
      if (answers.some(([, prs]) => prs)) this.fetched = Date.now();
      const failed = answers.some(([, prs]) => !prs);
      const ok = answers.flatMap(([, prs]) => prs ?? []);
      let delay = failed ? Math.min(DELAY.error, nextDelay(ok)) : nextDelay(ok);
      if (this.again) { this.again = false; delay = 0; }
      this.loading = false;
      this.pending = cx.timer.after(delay, (cx) => this.refresh(cx));
      cx.notify();
      await this.loadAvatars(cx);
    });
  }

  async fetch(repo) {
    try {
      const result = await exec("gh", listArgs(repo), { timeout: 60_000 });
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || `gh exited with ${result.code}`);
      return [repo, parse(result.stdout, this.viewer, repo), null];
    } catch (error) {
      return [repo, null, explain(error?.message ?? error, repo)];
    }
  }

  // Yours, from every repository: the pull requests you opened and those waiting on your review,
  // in one call. An answer with holes (an organization that limits what gh reads) is still listed.
  async fetchMine() {
    const teams = this.teams();
    try {
      const result = await exec("gh", searchArgs(teams), { timeout: 60_000 });
      const found = parseSearch(result.stdout, this.viewer, teams);
      if (!found) throw new Error(result.stderr || result.stdout || `gh exited with ${result.code}`);
      if (found.viewer) this.viewer = found.viewer;
      return [ME, found.prs, found.errors.length ? `Some pull requests couldn't be read. ${explain(found.errors[0])}` : null];
    } catch (error) {
      return [ME, null, explain(error?.message ?? error)];
    }
  }

  // Adds what the box holds, or saves an edit, once GitHub confirms the repository exists and
  // gives its exact name.
  addRepo(cx) {
    if (this.adding) return;
    const text = this.repoInput.value().trim();
    if (!text) return;
    const repo = parseRepo(text);
    this.addError = null;
    const others = this.repos().filter((r) => !this.editing || !sameRepo(r, this.editing));
    if (!repo) this.addError = "Type owner/name, like cli/cli, or paste a GitHub link.";
    else if (others.some((r) => sameRepo(r, repo))) this.addError = `${repo} is already listed.`;
    if (!repo || this.addError) { cx.notify(); return; }
    this.adding = true;
    this.addError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let exact = repo;
      try {
        const result = await exec("gh", ["repo", "view", repo, "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { timeout: 20_000 });
        if (result.code !== 0) throw new Error(result.stderr || result.stdout || `gh exited with ${result.code}`);
        exact = parseRepo(result.stdout.trim()) ?? repo;
      } catch (error) {
        this.addError = explain(error?.message ?? error, repo);
      }
      this.adding = false;
      if (!this.addError) {
        const now = this.repos();
        const at = this.editing ? now.findIndex((r) => sameRepo(r, this.editing)) : -1;
        const next = at >= 0 ? now.map((r, i) => (i === at ? exact : r)) : [...now, exact];
        if (this.editing && this.scope !== "all" && sameRepo(this.scope, this.editing)) this.setScope(exact);
        this.saveRepos(next);
        this.editing = null;
        this.repoInput.set_value("");
        this.refresh(cx);
      }
      cx.notify();
    });
  }

  addSuggestion(repo, cx) {
    this.saveRepos([...this.repos(), repo]);
    this.refresh(cx);
  }

  removeRepo(repo, cx) {
    if (this.editing && sameRepo(this.editing, repo)) this.cancelEdit();
    if (!this.saveRepos(this.repos().filter((r) => !sameRepo(r, repo))).length) this.suggest(cx);
    cx.notify();
  }

  editRepo(repo, cx) {
    this.editing = repo;
    this.addError = null;
    this.repoInput.set_value(repo);
    this.repoInput.focus?.();
    cx.notify();
  }

  cancelEdit() {
    this.editing = null;
    this.addError = null;
    this.repoInput.set_value("");
  }

  openSetup(open, cx) {
    this.setup = open;
    if (!open) this.cancelEdit();
    if (open) {
      this.dismissIntro();
      if (this.mode() === "repos") this.suggest(cx);
    }
    cx.notify();
  }

  // Suggestions for the panel: the repositories of the folders open in Herdr's spaces, then the
  // ones you pushed to most recently. Asked once per copy.
  suggest(cx) {
    if (this.suggestions || this.suggesting) return;
    this.suggesting = true;
    cx.spawn(async (cx) => {
      const folders = [...new Set((spaces?.() ?? []).filter((s) => !s.machine && s.folder).map((s) => s.folder))].slice(0, SPACE_FOLDERS);
      const lines = async (args, options) => {
        try {
          const result = await exec("gh", args, { timeout: 20_000, ...options });
          return result.code === 0 ? result.stdout.split("\n") : [];
        } catch {
          return [];
        }
      };
      const view = ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"];
      const [local, recent] = await Promise.all([
        Promise.all(folders.map((cwd) => lines(view, { cwd }))).then((all) => all.flat()),
        lines(["api", "user/repos?sort=pushed&per_page=20", "--jq", ".[].full_name"]),
      ]);
      this.suggestions = uniqueRepos([...local, ...recent]);
      this.suggesting = false;
      cx.notify();
    });
  }

  // Each author's picture, downloaded once and kept for later sessions.
  async loadAvatars(cx) {
    const wanted = new Map();
    for (const pr of this.prs ?? []) if (pr.author && !this.avatars.has(pr.author)) wanted.set(pr.author, pr.bot);
    if (!wanted.size) return;
    for (const login of wanted.keys()) this.avatars.set(login, "loading");
    const dir = `${appHome()}/${AVATARS}`;
    try { await mkdir(dir, { recursive: true }); } catch { /* the download says if it can't write */ }
    for (const [login, bot] of wanted) {
      this.avatars.set(login, (await this.download(`${dir}${avatarFile(login)}`, login, bot)) ? "ready" : "none");
      cx.notify();
    }
  }

  async download(file, login, bot) {
    try {
      if (await exists(file)) return true;
      let url = `https://github.com/${encodeURIComponent(login)}.png?size=64`;
      // A GitHub App's bot has no profile picture of its own; its app's logo is the avatar.
      if (bot) {
        const app = await exec("gh", ["api", `apps/${login}`, "--jq", ".id"], { timeout: 20_000 });
        const id = app.code === 0 ? app.stdout.trim() : "";
        if (!/^\d+$/.test(id)) return false;
        url = `https://avatars.githubusercontent.com/in/${id}?s=64`;
      }
      const got = await exec("curl", ["-sfL", "--max-time", "20", "-o", file, url], { timeout: 30_000 });
      if (got.code === 0) return true;
    } catch { /* initials instead */ }
    try { await unlink(file); } catch { /* nothing was written */ }
    return false;
  }

  async whoami() {
    try {
      const result = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 20_000 });
      return result.code === 0 ? result.stdout.trim() : "";
    } catch {
      return "";
    }
  }

  visit(url, cx) {
    if (!url) return;
    const [command, args] = opener(window?.()?.platform, url);
    cx.spawn(async () => {
      try {
        const result = await exec(command, args, { timeout: 15_000 });
        if (result.code !== 0) throw new Error(result.stderr);
      } catch {
        notify({ title: "Couldn't open the link", body: url, level: "error" });
      }
    });
  }

  toggle(set, key, cx, remember) {
    set.has(key) ? set.delete(key) : set.add(key);
    if (remember) store.set(remember, [...set]);
    cx.notify();
  }

  // Search and filters reveal what they match, even inside folded sections.
  isOpen(id) {
    return !this.folded.has(id) || Boolean(this.query.trim()) || !VIEWS.has(this.filter);
  }

  chooseFilter(filter, cx) {
    this.filter = this.filter === filter && filter !== "all" ? "all" : filter;
    store.set("filter", this.filter);
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  clearSearch(cx) {
    this.input.set_value?.("");
    this.query = "";
    cx.notify();
  }

  collapse() {
    if (Number.isFinite(this.width) && this.width >= RAIL) store.set("width", Math.round(this.width));
    run("layout.resize", { id: this.block, px: NARROW });
  }

  expand() {
    run("layout.resize", { id: this.block, px: Math.max(260, Number(store.get("width", WIDE)) || WIDE) });
  }

  iconButton(t, id, icon, tip, action, spinning = false) {
    const art = glyph(icon, 15);
    return div().id(id).size(26).flex_none().rounded(6).flex().items_center().justify_center()
      .role("button").accessibility_label(tip).tooltip(tip)
      .cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => action(cx))
      .child(spinning ? art.spin(900) : art);
  }

  // The pull request's state mark: a ring for running, a cross for failing, a tick for passing.
  stateMark(t, state, size = 15) {
    if (state === "failing" || state === "fail") return glyph("fail", size).text_color(t.blocked);
    if (state === "running") return glyph("spinner", size).text_color(t.working).spin(900);
    if (state === "passing" || state === "pass") return glyph("pass", size).text_color(tone(t, "pass"));
    if (state === "skip") return glyph("skip", size).text_color(t.dim);
    return div().size(size).flex_none().flex().items_center().justify_center()
      .child(div().size(Math.round(size / 2)).rounded(size).border(1.5).border_color(t.dim));
  }

  pill(t, text, color, outline = false, tip = "") {
    return div().flex_none().h(16).px(5).rounded(4).flex().items_center().text_size(10).font_medium()
      .text_color(color).when(outline, (el) => el.border(1).border_color(t.border)).when(!outline, (el) => el.bg(color + "1f"))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .child(text);
  }

  // How many squares the check strip draws at this width.
  squares() {
    return Math.max(5, Math.min(24, Math.floor((this.width - 230) / (SQUARE + SQUARE_GAP))));
  }

  // The second line's tags: the size first, then as many of the rest as fit beside the avatar
  // and the check squares, most important first. The ones left out become a "+n" with their names.
  tagPills(t, pr, now) {
    const big = size(pr);
    const all = tags(pr, now);
    const est = (label) => label.length * CHAR + PILL_PAD + 5;
    const max = this.squares();
    const strip = pr.checks.length ? Math.min(pr.checks.length, max) * (SQUARE + SQUARE_GAP) + (pr.checks.length > max ? 16 : 0) : 0;
    // List padding, row padding, state mark, avatar and gaps.
    let room = this.width - 12 - 14 - 23 - 21 - strip - 8 - est(big.label);
    const shown = [];
    for (const [i, tag] of all.entries()) {
      const reserve = i < all.length - 1 ? est("+9") : 0;
      if (est(tag.label) + reserve > room) break;
      shown.push(tag);
      room -= est(tag.label);
    }
    const hidden = all.slice(shown.length);
    return [
      this.pill(t, big.label, tone(t, big.color), true, big.tip),
      ...shown.map((tag) => this.pill(t, tag.label, tone(t, tag.color), Boolean(tag.outline), tag.tip)),
      hidden.length ? this.pill(t, `+${hidden.length}`, t.muted, true, hidden.map((tag) => tag.label).join(", ")) : null,
    ].filter(Boolean);
  }

  // The author's round picture, or their initials while it downloads (or if there is none).
  avatar(t, pr, size = 16) {
    const ready = this.avatars.get(pr.author) === "ready";
    const who = `${pr.author}${pr.bot ? " (bot)" : ""}`;
    return div().id(`avatar-${pr.id}`).size(size).flex_none().rounded_full().overflow_hidden()
      .tooltip(who).accessibility_label(who)
      .when(ready, (el) => el.child(image(`${AVATARS}${avatarFile(pr.author)}`).size_full().rounded_full()))
      .when(!ready, (el) => el.bg(t.raised).flex().items_center().justify_center()
        .text_size(Math.round(size * 0.45)).font_medium().text_color(t.muted).child(initials(pr.author)));
  }

  // One square per latest check, failures first: red failed, amber running, green passed,
  // an empty outline for skipped. As many as fit; the rest are a "+n" count.
  checkStrip(t, pr) {
    if (!pr.checks.length) return null;
    const { shown, more } = strip(pr.checks, this.squares());
    const n = pr.counts;
    const label = [n.fail && `${n.fail} failing`, n.running && `${n.running} running`, n.pass && `${n.pass} passed`, n.skip && `${n.skip} skipped`]
      .filter(Boolean).join(", ");
    const square = (c) => {
      const el = div().size(SQUARE).flex_none().rounded(1.5);
      if (c.state === "fail") return el.bg(t.blocked);
      if (c.state === "running") return el.bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1400 });
      if (c.state === "pass") return el.bg(tone(t, "pass"));
      return el.border(1).border_color(t.dim);
    };
    return h_flex().id(`strip-${pr.id}`).flex_none().gap(SQUARE_GAP).items_center().accessibility_label(label)
      .children(shown.map(square))
      .when(more > 0, (el) => el.child(div().ml(2).text_size(10).text_color(t.dim).child(`+${more}`)));
  }

  // In a list of several repositories, which one a row is from. Yours always say: the title
  // doesn't name a repository.
  prefix(pr) {
    const repos = this.shownRepos();
    const several = this.mode() === "me" || repos.length > 1;
    return several && this.currentScope(repos) === "all" ? shortName(pr.repo, repos) : "";
  }

  describe(pr, now) {
    const n = pr.counts;
    const tally = [n.fail && `${n.fail} failing`, n.running && `${n.running} running`, n.pass && `${n.pass} passed`, n.skip && `${n.skip} skipped`]
      .filter(Boolean).join(", ");
    return [
      `${pr.repo}#${pr.number} ${pr.title}`,
      [`${pr.author}${pr.bot ? " (bot)" : ""}`, pr.base ? `${pr.branch} → ${pr.base}` : pr.branch].filter(Boolean).join(" · "),
      [size(pr).tip, ...tags(pr, now).map((tag) => tag.label)].join(" · "),
      `${STATE_WORD[pr.state]}${tally ? `: ${tally}` : ""}`,
      pr.superseded ? `${pr.superseded} older ${pr.superseded === 1 ? "run" : "runs"} of the same checks not counted` : "",
      pr.updated ? `Updated ${duration(now - pr.updated)} ago` : "",
    ].filter(Boolean).join("\n");
  }

  row(t, pr, now) {
    const open = this.expanded.has(pr.id);
    const hovered = this.hovered === pr.id;
    const tip = this.describe(pr, now);
    const stale = isStale(pr, now);
    const link = div().id(`open-${pr.id}`).size(18).flex_none().rounded(4).flex().items_center().justify_center()
      .role("button").accessibility_label(`Open #${pr.number} on GitHub`).tooltip("Open on GitHub")
      .cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); this.visit(pr.url, cx); })
      .child(glyph("external", 12));
    return h_flex().id(`pr-${pr.id}`).flex_none().min_w(0).pl(8).pr(6).py(6).gap(8).items_start()
      .role("button").aria_selected(open).accessibility_label(tip).tooltip(tip)
      .rounded(6).border_l(2).border_color(pr.mine ? t.accent : t.chrome)
      .cursor_pointer().when(open, (el) => el.bg(t.selected)).when(!open, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((inside, cx) => {
        if (inside) this.hovered = pr.id;
        else if (this.hovered === pr.id) this.hovered = null;
        cx.notify();
      })
      .on_click((_e, cx) => this.toggle(this.expanded, pr.id, cx))
      .child(div().mt(1).flex_none().child(this.stateMark(t, pr.state)))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().h(18).min_w(0).gap(6).items_center()
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`${this.prefix(pr)}#${pr.number}`))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(pr.draft ? t.muted : t.foreground).child(pr.title))
          .when(hovered, (el) => el.child(link))
          .when(!hovered && Boolean(pr.updated), (el) => el.child(div().flex_none().text_size(10.5).text_color(stale ? t.working : t.dim).child(duration(now - pr.updated)))))
        .child(h_flex().h(16).min_w(0).gap(5).items_center()
          .child(this.avatar(t, pr))
          .child(h_flex().flex_1().min_w(0).gap(5).items_center().overflow_hidden().children(this.tagPills(t, pr, now)))
          .when(pr.checks.length > 0, (el) => el.child(this.checkStrip(t, pr)))));
  }

  checkRow(t, pr, check, now) {
    const failed = check.state === "fail";
    // Failures say how they failed; skipped and neutral checks need no time.
    const tail = failed ? check.word : check.state === "skip" ? "" : took(check, now);
    const tip = [check.workflow ? `${check.workflow} · ${check.name}` : check.name, [check.word, took(check, now)].filter(Boolean).join(" · "),
      check.url ? "Click to open the run" : ""].filter(Boolean).join("\n");
    return h_flex().id(`check-${pr.id}-${check.key}`).h(22).flex_none().min_w(0).px(6).gap(7).rounded(4).items_center()
      .role(check.url ? "button" : "list_item").accessibility_label(tip).tooltip(tip)
      .when(Boolean(check.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.visit(check.url, cx); }))
      .child(this.stateMark(t, check.state, 12))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(check.state === "skip" ? t.muted : t.foreground).child(check.name))
      .when(Boolean(tail), (el) => el.child(div().flex_none().text_size(10.5).text_color(failed ? t.blocked : t.dim).child(tail)));
  }

  textLink(t, id, text, action) {
    return div().id(id).flex_none().px(4).h(20).rounded(4).flex().items_center().text_size(11).text_color(t.muted)
      .role("button").accessibility_label(text).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
  }

  // Under an open row: where it merges, its latest checks (failures first), and links.
  details(t, pr, now) {
    const showSkipped = this.skipped.has(pr.id);
    const checks = pr.checks.filter((c) => c.state !== "skip" || showSkipped);
    const footer = h_flex().min_w(0).gap(2).pt(2).items_center()
      .child(this.textLink(t, `pr-link-${pr.id}`, "Open on GitHub", (cx) => this.visit(pr.url, cx)))
      .when(pr.checks.length > 0, (el) => el.child(this.textLink(t, `checks-link-${pr.id}`, "All checks", (cx) => this.visit(`${pr.url}/checks`, cx))))
      .when(pr.counts.skip > 0, (el) => el.child(this.textLink(t, `skipped-${pr.id}`,
        showSkipped ? "Hide skipped" : `${pr.counts.skip} skipped`, (cx) => this.toggle(this.skipped, pr.id, cx))));
    return v_flex().id(`details-${pr.id}`).flex_none().min_w(0).pl(28).pr(4).pb(8).gap(1)
      .child(div().min_w(0).truncate().px(6).pb(3).text_size(10.5).text_color(t.dim)
        .child(pr.base ? `${pr.branch} → ${pr.base}` : pr.branch))
      .children(checks.map((c) => this.checkRow(t, pr, c, now)))
      .when(!pr.checks.length, (el) => el.child(div().px(6).py(3).text_size(11).text_color(t.muted).child("No checks on the latest commit")))
      .child(footer);
  }

  section(t, section) {
    const open = this.isOpen(section.id);
    const n = section.prs.length;
    return h_flex().id(`section-${section.id}`).h(24).flex_none().pl(10).pr(8).gap(6).items_center()
      .role("button").accessibility_label(`${section.label}, ${n} pull ${n === 1 ? "request" : "requests"}, ${open ? "expanded" : "collapsed"}`)
      .cursor_pointer().rounded(5).text_size(10.5).font_medium()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(this.folded, section.id, cx, "folded"))
      .child(div().text_color(tone(t, section.color)).child(section.label))
      .child(div().text_color(t.dim).child(String(n)))
      .child(div().flex_1())
      .child(glyph(open ? "chevron-down" : "chevron-right", 10).text_color(t.dim));
  }

  search(t) {
    return h_flex().h(30).flex_none().mx(10).pl(9).pr(4).gap(7).rounded(7).bg(t.background).border(1).border_color(t.border).items_center()
      .child(glyph("search", 13).text_color(t.muted))
      .child(Input.new(this.input).accessibility_label("Search pull requests").flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))
      .when(Boolean(this.query), (el) => el.child(div().id("clear-search").size(20).flex_none().rounded(4).flex().items_center().justify_center()
        .role("button").accessibility_label("Clear search").tooltip("Clear search")
        .cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.clearSearch(cx)).child(glyph("x", 12))));
  }

  // Five chips with their counts need about 390 px; narrower, only the active chip shows its
  // count (the others say it on hover).
  chips(t, tally) {
    const tight = this.width < CHIPS_WIDE;
    return h_flex().h(34).flex_none().min_w(0).px(10).gap(3).items_center().overflow_hidden()
      .children(FILTERS.map(([id, label]) => {
        const on = this.filter === id;
        const count = `${tally[id]} pull ${tally[id] === 1 ? "request" : "requests"}`;
        return h_flex().id(`filter-${id}`).flex_none().h(24).px(7).gap(5).rounded(6).items_center()
          .role("button").aria_selected(on).accessibility_label(`${label}: ${count}`)
          .when(tight && !on, (el) => el.tooltip(count))
          .cursor_pointer().text_size(10.5).text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
          .on_click((_e, cx) => this.chooseFilter(id, cx)).child(label)
          .when(!tight || on, (el) => el.child(div().text_size(10).font_medium().text_color(t.dim).child(String(tally[id]))));
      }));
  }

  banner(t) {
    // An answer with holes is still today's list; only a failed one leaves an older list showing.
    const failed = this.sources().some((s) => this.errors.has(s) && !this.partial.has(s));
    const when = failed && this.prs && this.fetched ? ` Showing the list from ${clock(this.fetched)}.` : "";
    return h_flex().id("error").flex_none().mx(10).mb(6).px(9).py(7).gap(8).rounded(7).items_start().bg(t.blocked + "1f")
      .child(div().mt(1).flex_none().child(glyph("fail", 13).text_color(t.blocked)))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.foreground).child(`${this.error}${when}`))
      .child(this.textLink(t, "retry", "Retry", (cx) => this.refresh(cx)));
  }

  rail(t) {
    const n = stateCounts(sections(this.prs ?? [], "", this.filter, this.currentScope()).flatMap((s) => s.prs));
    const title = this.title();
    const what = /pull requests$/i.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : `${title} pull requests`;
    const item = (state, word) => n[state] ? v_flex().id(`rail-${state}`).flex_none().items_center().gap(3).py(4)
      .tooltip(`${n[state]} ${word}`).accessibility_label(`${n[state]} ${word}`)
      .child(this.stateMark(t, state, 15)).child(div().text_size(10.5).text_color(t.muted).child(String(n[state]))) : null;
    return [
      this.iconButton(t, "expand", "chevron-left", `Show ${what}`, () => this.expand()).mt(8),
      div().id("rail-repo").mt(4).flex_none().tooltip(`${title}: ${inScope(this.prs ?? [], this.currentScope()).length} open`).child(glyph("pr", 16).text_color(t.accent)),
      ...[item("failing", "failing"), item("running", "running"), item("passing", "passing")].filter(Boolean),
      this.error ? div().id("rail-error").flex_none().tooltip(this.error).child(glyph("fail", 13).text_color(t.blocked)) : null,
    ].filter(Boolean);
  }

  list(t, now) {
    const groups = sections(this.prs ?? [], this.query, this.filter, this.currentScope());
    const children = [];
    for (const section of groups) {
      children.push(this.section(t, section));
      if (!this.isOpen(section.id)) continue;
      for (const pr of section.prs) {
        children.push(this.row(t, pr, now));
        if (this.expanded.has(pr.id)) children.push(this.details(t, pr, now));
      }
    }
    if (children.length) return children;
    const me = this.mode() === "me";
    // Nothing open at all says so, whichever chip is on: a filter can't be what hid it.
    const none = Boolean(this.prs) && !inScope(this.prs, this.currentScope()).length;
    const message = !this.prs ? (this.loading ? "Loading pull requests…" : "")
      : none ? (me ? "Nothing of yours is open, and no review is waiting on you" : "No open pull requests")
      : this.query.trim() ? "No matching pull requests"
      : EMPTY[this.filter] ?? "No open pull requests";
    const hint = !this.prs ? ""
      : none ? (me && !this.teams() ? "Reviews asked of your teams aren't included. The sliders button changes that." : "")
      : this.query.trim() ? "Try a number, title, author or branch."
      : this.filter !== "all" ? "Choose All to see every open one." : "";
    return message ? [v_flex().px(14).py(24).gap(6)
      .child(div().text_size(12).child(message))
      .when(Boolean(hint), (el) => el.child(div().text_size(11).text_color(t.muted).child(hint)))] : [];
  }

  // The repositories as tabs under the header, when there are several: All, then each one.
  repoTabs(t, repos, prs) {
    const scope = this.currentScope(repos);
    const tally = repoCounts(prs, repos, this.filter);
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    const tab = (id, label, n, on, tip, failed, action) => h_flex().id(id).flex_none().h_full().px(6).gap(5).items_center()
      .role("tab").aria_selected(on).accessibility_label(failed ? `${tip}: ${failed}` : `${tip}: ${n} pull ${n === 1 ? "request" : "requests"}`)
      .tooltip(failed || tip).cursor_pointer().text_size(11).border_b(2).border_color(on ? t.accent : t.chrome)
      .text_color(on ? t.foreground : t.muted).when(!on, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => action(cx)).child(label)
      .child(failed ? glyph("fail", 10).text_color(t.blocked) : div().text_size(10).font_medium().text_color(t.dim).child(String(n)));
    return h_flex().id("repo-tabs").h(28).flex_none().min_w(0).px(8).gap(2).items_end().overflow_x_scroll()
      .role("tab_list").accessibility_label("Repositories")
      .child(tab("scope-all", "All", total, scope === "all", "Every repository", "", (cx) => { this.setScope("all"); cx.notify(); }))
      .children(repos.map((repo, i) => tab(`scope-${i}`, shortName(repo, repos), tally[repo] ?? 0, sameRepo(scope, repo), repo,
        this.lists.has(repo) || this.mode() === "me" ? "" : this.errors.get(repo) ?? "", (cx) => this.chooseScope(repo, cx))));
  }

  // The first time a sidebar lists yours: what it shows, and the way to the other choice. The
  // link makes that choice and opens the panel on it, where Yours is one click back.
  intro(t) {
    return h_flex().id("intro").flex_none().mx(10).mb(6).pl(10).pr(4).py(7).gap(6).rounded(7).items_start().bg(t.accent + "14")
      .role("note").accessibility_label(`${ABOUT.me} The sliders button changes what's listed.`)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(11.5).text_color(t.foreground).child(ABOUT.me))
        .child(div().id("intro-repos").flex_none().text_size(11).text_color(t.accent).cursor_pointer().role("button")
          .accessibility_label("List whole repositories instead").hover((s) => s.opacity(0.8))
          .on_click((_e, cx) => this.chooseMode("repos", cx)).child("List whole repositories instead")))
      .child(this.smallButton(t, "intro-close", "x", "Got it", (cx) => { this.dismissIntro(); cx.notify(); }));
  }

  smallButton(t, id, icon, tip, action) {
    return div().id(id).size(22).flex_none().rounded(5).flex().items_center().justify_center()
      .role("button").accessibility_label(tip).tooltip(tip)
      .cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(glyph(icon, 12));
  }

  // One of the two ways to list, as a radio button: a ring with a dot when chosen.
  modeOption(t, id, label, on) {
    return h_flex().id(`mode-${id}`).flex_none().min_w(0).px(10).py(8).gap(9).rounded(7).items_start()
      .role("radio_button").aria_selected(on).accessibility_label(`${label}: ${ABOUT[id]}`)
      .border(1).border_color(on ? t.accent : t.border)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => this.chooseMode(id, cx))
      .child(div().mt(1).size(14).flex_none().rounded_full().border(1.5).border_color(on ? t.accent : t.dim)
        .flex().items_center().justify_center()
        .when(on, (el) => el.child(div().size(6).rounded_full().bg(t.accent))))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12).font_medium().child(label))
        .child(div().text_size(11).text_color(t.muted).child(ABOUT[id])));
  }

  // The option of "me": the reviews asked of your teams, besides those asked of you.
  teamsOption(t) {
    const on = this.teams();
    const label = "Include reviews asked of your teams";
    return h_flex().id("teams").flex_none().min_w(0).px(10).py(7).gap(9).rounded(6).items_start()
      .role("check_box").aria_selected(on).accessibility_label(label)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.setTeams(!on, cx))
      .child(div().mt(1).size(14).flex_none().rounded(3).border(1.5).border_color(on ? t.accent : t.dim)
        .flex().items_center().justify_center()
        .when(on, (el) => el.bg(t.accent).child(glyph("check", 11).text_color(t.background))))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12).child(label))
        .child(div().text_size(11).text_color(t.muted).child(on
          ? "Requests to any team you're in are listed too, tagged Team review."
          : "Only reviews asked of you by name. In a large organization, team requests can run to hundreds.")));
  }

  // Where the sidebar is told what to list: yours, from every repository, or the repositories
  // picked. It opens from the header's button, and by itself when repositories are the choice
  // and none are picked. For repositories: a box to add one (or rename one), the list with edit
  // and remove, and suggestions.
  setupPanel(t, repos) {
    const mode = this.mode();
    const label = this.adding ? "Checking…" : this.editing ? "Save" : "Add";
    const heading = (text) => div().pt(6).text_size(10.5).font_medium().text_color(t.dim).child(text);
    const submit = h_flex().id("add-repo").h(22).flex_none().px(9).gap(5).rounded(5).items_center()
      .role("button").accessibility_label(this.editing ? `Save ${this.editing}` : "Add repository")
      .bg(t.solid ?? t.accent).text_color(t.solid_foreground ?? t.background).text_size(11).font_medium()
      .when(!this.adding, (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)))
      .on_click((_e, cx) => this.addRepo(cx))
      .when(this.adding, (el) => el.child(glyph("spinner", 11).spin(900)))
      .child(label);
    const field = h_flex().h(32).flex_none().pl(9).pr(5).gap(7).rounded(7).bg(t.background).border(1)
      .border_color(this.addError ? t.blocked : t.border).items_center()
      .child(glyph(this.editing ? "pencil" : "plus", 13).text_color(t.muted))
      .child(Input.new(this.repoInput).accessibility_label(this.editing ? `New name for ${this.editing}` : "Repository to add")
        .flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))
      .child(submit);
    const listed = repos.map((repo, i) => {
      const error = this.lists.has(repo) ? "" : this.errors.get(repo) ?? "";
      const n = this.lists.get(repo)?.length;
      const editing = Boolean(this.editing) && sameRepo(this.editing, repo);
      return h_flex().id(`repo-${i}`).h(30).flex_none().min_w(0).pl(8).pr(4).gap(8).rounded(6).items_center()
        .role("list_item").accessibility_label(error ? `${repo}: ${error}` : repo)
        .when(editing, (el) => el.bg(t.selected)).when(!editing, (el) => el.hover((s) => s.bg(t.hover)))
        .child(glyph(error ? "fail" : "pr", 13).text_color(error ? t.blocked : t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(12).child(repo))
        .child(div().id(`repo-state-${i}`).flex_none().text_size(10.5).text_color(error ? t.blocked : t.dim)
          .when(Boolean(error), (el) => el.tooltip(error))
          .child(error ? "Can't load" : n == null ? "" : `${n} open`))
        .child(this.smallButton(t, `edit-repo-${i}`, "pencil", `Rename ${repo}`, (cx) => this.editRepo(repo, cx)))
        .child(this.smallButton(t, `remove-repo-${i}`, "x", `Stop listing ${repo}`, (cx) => this.removeRepo(repo, cx)));
    });
    const offered = (this.suggestions ?? []).filter((r) => !repos.some((x) => sameRepo(x, r))).slice(0, SUGGEST);
    const suggestions = offered.map((repo, i) => h_flex().id(`suggest-${i}`).h(28).flex_none().min_w(0).pl(8).pr(8).gap(8).rounded(6).items_center()
      .role("button").accessibility_label(`Add ${repo}`).tooltip(`Add ${repo}`)
      .cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.addSuggestion(repo, cx))
      .child(glyph("plus", 13))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(repo)));
    const picking = mode === "repos";
    return v_flex().id("setup").flex_1().min_h(0).px(10).pt(2).pb(12).gap(4).overflow_y_scrollbar()
      .child(v_flex().px(4).pb(6).gap(4)
        .child(div().text_size(13).font_semibold().child("What to list"))
        .child(div().text_size(11.5).text_color(t.muted).child("Open pull requests, with the state of their checks. You can change this at any time.")))
      .child(v_flex().id("modes").flex_none().gap(6).role("radio_group").accessibility_label("What to list")
        .child(this.modeOption(t, "me", "Yours", mode === "me"))
        .child(this.modeOption(t, "repos", "Repositories", picking)))
      .child(div().h(6).flex_none())
      .when(!picking, (el) => el.child(this.teamsOption(t)))
      .when(picking, (el) => el.child(field)
        .when(Boolean(this.addError), (el) => el.child(div().px(4).text_size(11).text_color(t.blocked).child(this.addError)))
        .when(Boolean(this.editing), (el) => el.child(h_flex().px(4).gap(4).items_center().text_size(11).text_color(t.muted)
          .child(`Renaming ${this.editing}.`).child(this.textLink(t, "cancel-edit", "Cancel", (cx) => { this.cancelEdit(); cx.notify(); }))))
        .when(repos.length > 0, (el) => el.child(heading(`Listed · ${repos.length}`)).children(listed))
        .when(this.suggesting || offered.length > 0, (el) => el.child(heading("Suggested: your spaces and recent pushes")))
        .when(this.suggesting && !offered.length, (el) => el.child(h_flex().px(8).h(28).gap(8).items_center().text_size(11.5).text_color(t.muted)
          .child(glyph("spinner", 12).spin(900)).child("Looking for your repositories…")))
        .children(suggestions))
      .when(!picking || repos.length > 0, (el) => el.child(h_flex().pt(8).px(4).child(div().flex_1())
        .child(h_flex().id("setup-done").h(26).px(12).rounded(6).items_center().role("button").accessibility_label("Done")
          .cursor_pointer().bg(t.selected).text_size(11.5).font_medium().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.openSetup(false, cx)).child("Done"))));
  }

  render() {
    const t = /** @type {Record<string, import("gpui-kit").Color>} */ (theme());
    const compact = this.width < RAIL;
    const now = Date.now();
    const mode = this.mode();
    const me = mode === "me";
    // The repositories picked, and the ones on screen: the same, unless the sidebar lists yours.
    const picked = this.repos();
    const repos = this.shownRepos();
    const scope = this.currentScope(repos);
    const all = this.prs ?? [];
    const scoped = inScope(all, scope);
    // There's a list to show, or the panel is all there is: repositories are the choice, and none are picked.
    const listing = me || picked.length > 0;
    const setup = this.setup || !listing;
    const title = this.title(repos);
    // One repository on screen: the title opens its pull requests. Several: it names them. Yours:
    // it opens GitHub's own list of them.
    const one = scope !== "all" ? scope : !me && repos.length === 1 ? repos[0] : null;
    const link = one ? { url: `https://github.com/${one}/pulls`, tip: `${one} · open on GitHub`, label: `Open ${one} pull requests on GitHub` }
      : me ? { url: "https://github.com/pulls", tip: `${ABOUT.me}\nOpen on GitHub`, label: "Open your pull requests on GitHub" } : null;
    const tip = this.loading ? "Refreshing…" : this.fetched ? `Updated ${clock(this.fetched)} · Refresh` : "Refresh";
    const root = v_flex().id("github-prs").size_full().min_h(0).bg(t.chrome).text_color(t.foreground)
      .track_focus(this.handle)
      .on_size_change((size, cx) => {
        const width = size.width / Number(settings().zoom ?? 1);
        if (this.width !== width) { this.width = width; cx.notify(); }
      })
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (setup && this.editing) { this.cancelEdit(); cx.notify(); }
        else if (this.setup && listing) this.openSetup(false, cx);
        else if (this.query) this.clearSearch(cx);
        else return;
        cx.stop_propagation();
      });
    if (compact) return root.items_center().gap(6).children(this.rail(t));
    const header = h_flex().h(40).flex_none().pl(14).pr(8).gap(8).items_center()
      .child(glyph("pr", 15).text_color(t.accent))
      .child(div().id("repo").min_w(0).truncate().font_semibold().text_size(14)
        .when(Boolean(link), (el) => el.cursor_pointer().role("link").accessibility_label(link.label)
          .tooltip(link.tip).hover((s) => s.text_color(t.accent))
          .on_click((_e, cx) => this.visit(link.url, cx)))
        .when(!link && repos.length > 1, (el) => el.tooltip(repos.join("\n")))
        .child(title))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(this.prs && !setup ? String(scoped.length) : ""))
      .child(div().flex_1())
      .when(listing, (el) => el
        .child(this.iconButton(t, "repos", "sliders", this.setup ? "Back to the list" : "Choose what to list", (cx) => this.openSetup(!this.setup, cx))
          .when(this.setup, (b) => b.bg(t.selected).text_color(t.foreground)))
        .child(this.iconButton(t, "refresh", "refresh", tip, (cx) => this.refresh(cx), this.loading)))
      .child(this.iconButton(t, "collapse", "chevron-right", "Fold to a rail", () => this.collapse()));
    if (setup) return root.child(header).child(this.setupPanel(t, picked));
    return root.child(header)
      .when(repos.length > 1, (el) => el.child(this.repoTabs(t, repos, all)))
      .when(this.showIntro(), (el) => el.child(this.intro(t)))
      .child(this.search(t))
      .child(this.chips(t, counts(scoped)))
      .when(Boolean(this.error), (el) => el.child(this.banner(t)))
      .child(v_flex().id("pr-list").flex_1().min_h(0).px(6).pt(2).pb(12).overflow_y_scrollbar().track_scroll(this.scroll)
        .role("list").accessibility_label(me && !one ? "Your open pull requests and the reviews asked of you, by check state"
          : `Open pull requests in ${one ?? repos.join(", ")}, by check state`)
        .children(this.list(t, now)));
  }
}
