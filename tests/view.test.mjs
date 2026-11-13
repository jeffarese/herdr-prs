// Exercise the real view and its handlers with an in-memory GPUI builder. This doesn't replace
// `herdr-app check` or a look at the app.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as model from "../mods/github-prs/model.js";

const LIST = [
  {
    number: 7, title: "Fix the build", url: "https://github.com/o/r/pull/7", isDraft: false, author: { login: "me" },
    headRefName: "fix/build", baseRefName: "main", updatedAt: "2026-11-12T10:00:00Z", reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE", reviewRequests: [],
    statusCheckRollup: [
      { __typename: "CheckRun", name: "Build", workflowName: "CI", status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-11-12T10:00:00Z", completedAt: "2026-11-12T10:02:00Z", detailsUrl: "https://ci/build" },
      { __typename: "CheckRun", name: "Docs", workflowName: "CI", status: "COMPLETED", conclusion: "SKIPPED", startedAt: "2026-11-12T10:00:00Z", completedAt: "2026-11-12T10:00:01Z", detailsUrl: "https://ci/docs" },
    ],
  },
  {
    number: 8, title: "Add canvas", url: "https://github.com/o/r/pull/8", isDraft: true, author: { login: "bo" },
    headRefName: "feat/canvas", baseRefName: "fix/build", updatedAt: "2026-11-12T09:00:00Z", reviewDecision: "APPROVED",
    mergeable: "CONFLICTING", reviewRequests: [], statusCheckRollup: [],
  },
];

// A pull request as GitHub's GraphQL gives it by id, from the shape `gh pr list` gives.
const node = (repo, p) => ({
  id: `PR_${repo.replace("/", "_")}_${p.number}`, number: p.number, title: p.title, url: p.url, isDraft: p.isDraft, createdAt: p.createdAt ?? null, updatedAt: p.updatedAt,
  headRefName: p.headRefName, baseRefName: p.baseRefName, reviewDecision: p.reviewDecision, mergeable: p.mergeable,
  mergeStateStatus: p.mergeStateStatus ?? null, additions: 0, deletions: 0, changedFiles: 0, autoMergeRequest: null,
  author: { __typename: p.author.is_bot ? "Bot" : "User", login: p.author.login.replace(/^app\//, "") }, repository: { nameWithOwner: repo },
  reviewRequests: { nodes: (p.reviewRequests ?? []).map((r) => ({ requestedReviewer: r })) },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: (p.statusCheckRollup ?? []).map(({ workflowName, ...c }) =>
    ({ ...c, checkSuite: { workflowRun: { workflow: { name: workflowName } } } })) } } } }] },
});
// Yours: your pull request in o/r, and one in acme/web that asks for your review.
const ASKED = { ...LIST[1], number: 3, isDraft: false, url: "https://github.com/acme/web/pull/3", reviewRequests: [{ __typename: "User", login: "me" }] };
// GitHub, for the search for yours. The light search answers the ids of `mine` and `asked` (and of
// `team` too, when it's asked for review-requested); a details call answers the nodes it names.
// `errors` go with the search's answer, `details(ids)` can answer a details call itself.
const query = (args) => args.find((a) => a.startsWith("query=")) ?? "";
const idsIn = (args) => JSON.parse(`[${query(args).match(/nodes\(ids: \[(.*?)\]\)/)?.[1] ?? ""}]`);
function github({ mine = [], asked = [], team = [], errors, details } = {}) {
  const all = new Map([...mine, ...asked, ...team].filter(Boolean).map((n) => [n.id, n]));
  return (args) => {
    if (query(args).includes("nodes(ids:")) {
      const ids = idsIn(args);
      return details?.(ids) ?? { code: 0, stdout: JSON.stringify({ data: { nodes: ids.map((id) => all.get(id) ?? null) } }), stderr: "" };
    }
    const teams = args.some((a) => a.startsWith("asked=") && a.includes(" review-requested:"));
    const ids = (list) => ({ nodes: list.map((n) => (n ? { id: n.id } : null)) });
    const data = { viewer: { login: "me" }, mine: ids(mine), asked: ids(teams ? [...asked, ...team] : asked) };
    return { code: errors ? 1 : 0, stdout: JSON.stringify({ data, ...(errors ? { errors } : {}) }), stderr: errors ? `gh: ${errors[0].message}` : "" };
  };
}
const YOURS = { mine: [node("o/r", LIST[0])], asked: [node("acme/web", ASKED)] };

function setup({ list = LIST, code = 0, stderr = "", given = { repo: "o/r" }, width = 340, store = {}, folders = [], repos = {}, lists = {}, failing = [], cached = [], curl = 0, stored = { filter: JSON.stringify("all") }, search = github(YOURS) } = {}) {
  const execs = [];
  const commands = [];
  const notes = [];
  const timers = [];
  const tasks = [];
  const removed = [];
  // GraphQL calls in flight at once, at most.
  const load = { active: 0, peak: 0 };
  const el = () => {
    const data = { nodes: [], props: {} };
    const proxy = new Proxy(data, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "child") data.nodes.push(args[0]);
        else if (key === "children") data.nodes.push(...args[0]);
        else if (key === "when") { if (args[0]) args[1](proxy); }
        else data.props[key] = args.length === 1 ? args[0] : args;
        return proxy;
      };
    } });
    return proxy;
  };
  const makeInput = () => ({ handlers: {}, text: "", on(event, callback) { this.handlers[event] = callback; }, value() { return this.text; }, set_value(v) { this.text = v; }, focus() {} });
  // The search box is made first, the repository box second.
  const inputs = [];
  const input = makeInput();
  const cx = {
    notify() {}, stop_propagation() {}, focus_handle() { return { focus() {} }; },
    spawn(body) { tasks.push(body(cx)); return { cancel() {} }; },
    timer: { after(ms, fn) { const t = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(t); return t; } },
  };
  const storage = { data: { ...stored }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } };
  const imports = {
    View: class {}, div: el, svg: el, image: (path) => { const node = el(); node.props.src = path; return node; }, h_flex: el, v_flex: el,
    InputState: { new: () => { const made = inputs.length ? makeInput() : input; inputs.push(made); return made; } }, Input: { new: el }, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    exec: async (command, args, options = {}) => {
      execs.push([command, ...args]);
      if (command === "gh" && args[1]?.startsWith("apps/")) return { code: 0, stdout: "4242\n", stderr: "" };
      if (command === "gh" && args[1]?.startsWith("user/repos")) return { code: 0, stdout: "acme/api\nacme/web\n", stderr: "" };
      if (command === "gh" && args[0] === "repo" && args[1] === "view") {
        const asked = args[2]?.startsWith("--") ? folders.find((f) => f.folder === options.cwd)?.repo : args[2];
        const known = asked && !failing.includes(asked) && (repos[asked.toLowerCase()] ?? asked);
        return known ? { code: 0, stdout: `${known}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository" };
      }
      if (command === "gh" && args[0] === "pr" && lists[args[3]]) return { code: 0, stdout: JSON.stringify(lists[args[3]]), stderr: "" };
      if (command === "gh" && args[0] === "pr" && failing.includes(args[3])) return { code: 1, stdout: "", stderr: "HTTP 404: Not Found" };
      if (command === "gh" && args[0] === "api" && args[1] === "graphql") {
        load.peak = Math.max(load.peak, ++load.active);
        await null;
        await null;
        load.active--;
        return search(args);
      }
      if (command === "gh" && args[0] === "api") return { code: 0, stdout: "me\n", stderr: "" };
      if (command === "gh") return { code, stdout: code ? "" : JSON.stringify(list), stderr };
      if (command === "curl") return { code: curl, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
    props: () => given, shared: (key) => store[key], setShared: (key, value) => { store[key] = value; },
    spaces: () => folders.map((f) => ({ folder: f.folder, machine: null })), theme: () => new Proxy({}, { get: () => "#aabbcc" }), settings: () => ({ zoom: 1 }),
    run: (name, args) => commands.push({ name, args }), notify: (n) => notes.push(n), window: () => ({ platform: "macos" }),
    localStorage: storage,
    appHome: () => "/app", exists: async (path) => cached.includes(path), mkdir: async () => {}, unlink: async (path) => removed.push(path),
    ...model,
  };
  const source = readFileSync(new URL("../mods/github-prs/main.js", import.meta.url), "utf8")
    .replace(/^import [\s\S]*?;$/gm, "").replace("export default class", "return class");
  const View = new Function(...Object.keys(imports), source)(...Object.values(imports));
  const view = new View();
  view.init({}, cx);
  view.width = width;
  const settle = async () => { while (tasks.length) await tasks.shift(); };
  return { view, cx, input, repoInput: inputs[1], execs, commands, notes, timers, storage, settle, removed, store, load };
}

function find(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.id === id) return node;
  for (const child of node.nodes ?? []) { const match = find(child, id); if (match) return match; }
  return null;
}
function texts(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const child of node.nodes ?? []) texts(child, out);
  return out;
}

test("loads the repo's open pull requests with gh and groups them by check state", async () => {
  const h = setup({ given: { repo: "o/r" } });
  await h.settle();
  assert.deepEqual(h.execs[0], ["gh", "api", "user", "--jq", ".login"]);
  assert.deepEqual(h.execs[1].slice(0, 4), ["gh", "pr", "list", "--repo"]);
  assert.equal(h.execs[1][4], "o/r");
  const root = h.view.render();
  const words = texts(root);
  assert.ok(words.includes("Failing") && words.includes("No checks"));
  assert.ok(words.includes("r"), "the repo's short name is the title");
  assert.ok(find(root, "pr-o/r#7") && find(root, "pr-o/r#8"));
  // Settled checks: the next look is the gentle one.
  assert.equal(h.timers.at(-1).ms, model.DELAY.settled);
});

test("clicking a row shows its checks; a check opens its run, skipped ones fold", async () => {
  const h = setup();
  await h.settle();
  let root = h.view.render();
  find(root, "pr-o/r#7").props.on_click(null, h.cx);
  root = h.view.render();
  const build = find(root, "check-o/r#7-run:CI/Build");
  assert.ok(build, "the failing check is listed");
  assert.equal(find(root, "check-o/r#7-run:CI/Docs"), null, "skipped checks start folded");
  build.props.on_click(null, h.cx);
  await h.settle();
  assert.deepEqual(h.execs.at(-1), ["open", "https://ci/build"]);
  find(root, "skipped-o/r#7").props.on_click(null, h.cx);
  root = h.view.render();
  assert.ok(find(root, "check-o/r#7-run:CI/Docs"));
  assert.ok(texts(root).includes("fix/build → main"));
});

test("the hover button opens the pull request without unfolding it", async () => {
  const h = setup();
  await h.settle();
  let root = h.view.render();
  find(root, "pr-o/r#8").props.on_hover(true, h.cx);
  root = h.view.render();
  find(root, "open-o/r#8").props.on_click(null, h.cx);
  await h.settle();
  assert.deepEqual(h.execs.at(-1), ["open", "https://github.com/o/r/pull/8"]);
  assert.equal(find(h.view.render(), "details-o/r#8"), null);
});

test("filters and search narrow the list; folded sections remember", async () => {
  const h = setup();
  await h.settle();
  let root = h.view.render();
  find(root, "filter-mine").props.on_click(null, h.cx);
  root = h.view.render();
  assert.ok(find(root, "pr-o/r#7"));
  assert.equal(find(root, "pr-o/r#8"), null);
  find(root, "filter-mine").props.on_click(null, h.cx); // the active chip goes back to All
  h.input.text = "canvas";
  h.input.handlers.change(null, h.cx);
  root = h.view.render();
  assert.equal(find(root, "pr-o/r#7"), null);
  assert.ok(find(root, "pr-o/r#8"));
  h.input.text = "";
  h.input.handlers.change(null, h.cx);
  find(h.view.render(), "section-failing").props.on_click(null, h.cx);
  assert.equal(find(h.view.render(), "pr-o/r#7"), null);
  assert.equal(h.storage.data.folded, JSON.stringify(["failing"]));
});

test("a gh failure shows what to do and retries sooner", async () => {
  const h = setup({ code: 1, stderr: "To get started with GitHub CLI, please run:  gh auth login" });
  await h.settle();
  const root = h.view.render();
  assert.ok(find(root, "error"));
  assert.ok(texts(root).some((s) => s.includes("gh auth login")));
  assert.equal(h.timers.at(-1).ms, model.DELAY.error);
});

test("refresh doesn't stack fetches, and replaces the scheduled one", async () => {
  const h = setup();
  h.view.refresh(h.cx); // still loading: ignored
  await h.settle();
  assert.equal(h.execs.filter((e) => e[1] === "pr").length, 1);
  const scheduled = h.timers.at(-1);
  find(h.view.render(), "refresh").props.on_click(null, h.cx);
  assert.equal(scheduled.cancelled, true);
  await h.settle();
  assert.equal(h.execs.filter((e) => e[1] === "pr").length, 2);
  assert.equal(h.execs.filter((e) => e[1] === "api").length, 1, "the viewer is asked once");
});

test("a narrow column is a rail that expands back to its remembered width", async () => {
  const h = setup();
  await h.settle();
  find(h.view.render(), "collapse").props.on_click(null, h.cx);
  assert.deepEqual(h.commands.at(-1), { name: "layout.resize", args: { id: "prs", px: 52 } });
  h.view.width = 52;
  const rail = h.view.render();
  assert.ok(find(rail, "rail-failing"));
  assert.equal(find(rail, "pr-list"), null);
  find(rail, "expand").props.on_click(null, h.cx);
  assert.deepEqual(h.commands.at(-1), { name: "layout.resize", args: { id: "prs", px: 340 } });
});

test("authors show as round avatars, downloaded once; initials until then or if there is none", async () => {
  const bot = { ...LIST[1], number: 9, author: { login: "app/aikido-autofix", is_bot: true } };
  const h = setup({ list: [...LIST, bot], cached: ["/app/mods/github-prs/.avatars/me.png"] });
  assert.deepEqual(texts(find(h.view.render(), "avatar-o/r#7") ?? {}), []);
  await h.settle();
  const curls = h.execs.filter((e) => e[0] === "curl");
  assert.deepEqual(curls.map((e) => e.at(-1)), ["https://github.com/bo.png?size=64", "https://avatars.githubusercontent.com/in/4242?s=64"]);
  assert.deepEqual(curls[0].slice(-3, -1), ["-o", "/app/mods/github-prs/.avatars/bo.png"]);
  assert.ok(h.execs.some((e) => e[0] === "gh" && e[2] === "apps/aikido-autofix"), "a bot's avatar is its app's logo");
  const root = h.view.render();
  assert.equal(find(root, "avatar-o/r#7").nodes[0].props.src, "mods/github-prs/.avatars/me.png");
  assert.equal(find(root, "avatar-o/r#9").nodes[0].props.src, "mods/github-prs/.avatars/aikido-autofix.png");
  assert.ok(!texts(root).includes("me"), "the author's name is no longer written out");
  assert.equal(find(root, "avatar-o/r#7").props.tooltip, "me");
  // A second refresh doesn't download again.
  find(root, "refresh").props.on_click(null, h.cx);
  await h.settle();
  assert.equal(h.execs.filter((e) => e[0] === "curl").length, 2);
});

test("a failed download leaves initials and no half-written file", async () => {
  const h = setup({ curl: 22 });
  await h.settle();
  const root = h.view.render();
  assert.deepEqual(texts(find(root, "avatar-o/r#8")), ["BO"]);
  assert.ok(h.removed.includes("/app/mods/github-prs/.avatars/bo.png"));
});

test("checks show as one square each, failures first, with a count for the rest", async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    __typename: "CheckRun", name: `Job ${String(i).padStart(2, "0")}`, workflowName: "CI", status: "COMPLETED",
    conclusion: i === 5 ? "FAILURE" : i < 20 ? "SUCCESS" : "SKIPPED", startedAt: "2026-11-12T10:00:00Z", completedAt: "2026-11-12T10:01:00Z",
  }));
  const h = setup({ list: [{ ...LIST[0], statusCheckRollup: many }, LIST[1]] });
  await h.settle();
  const root = h.view.render();
  const row = find(root, "strip-o/r#7");
  const squares = row.nodes.filter((n) => n.props.size === 6);
  assert.equal(squares.length, 12, "as many as fit at 340 px, the last slot kept for the count");
  assert.ok(squares.every((s) => s.props.bg && !s.props.border), "a failure and passes shown, skipped ones counted");
  assert.ok(texts(row).includes("+18"));
  assert.equal(row.props.accessibility_label, "1 failing, 19 passed, 10 skipped");
  assert.equal(find(root, "strip-o/r#8"), null, "no checks, no squares");
});

test("tags that don't fit become a +n count that names them", async () => {
  const busy = { ...LIST[0], number: 9, mergeable: "CONFLICTING", reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BEHIND",
    autoMergeRequest: {}, updatedAt: "2026-10-01T00:00:00Z", additions: 900, deletions: 200, changedFiles: 12, author: { login: "bo" } };
  const h = setup({ list: [busy], width: 300 });
  await h.settle();
  const row = find(h.view.render(), "pr-o/r#9");
  const words = texts(row);
  assert.ok(words.includes("XL"), "the size is always shown");
  assert.ok(words.includes("Conflicts"), "the most important tag fits");
  const more = words.find((w) => /^\+\d+$/.test(w) && w !== "+1");
  assert.ok(more, `a count of the rest: ${words.join(" | ")}`);
  assert.match(row.props.tooltip, /Size XL: \+900 −200 lines, 12 files · Conflicts · Changes requested · Behind · Auto-merge · Stale/);
});

test("the Ready to review chip leaves drafts out, keeps folds, and is remembered", async () => {
  const h = setup();
  await h.settle();
  find(h.view.render(), "section-none").props.on_click(null, h.cx); // fold No checks
  find(h.view.render(), "filter-ready").props.on_click(null, h.cx);
  let root = h.view.render();
  assert.ok(find(root, "pr-o/r#7"));
  assert.equal(find(root, "pr-o/r#8"), null, "the draft is left out");
  assert.equal(h.storage.data.filter, JSON.stringify("ready"));
  assert.equal(find(root, "filter-ready").props.accessibility_label, "Ready to review: 1 pull request");
  find(root, "filter-drafts").props.on_click(null, h.cx);
  assert.ok(find(h.view.render(), "pr-o/r#8"), "the Drafts chip shows them");
  // A new sidebar starts on Ready to review; one that chose a chip starts on it.
  for (const stored of [{}, { filter: JSON.stringify("ready") }]) {
    const again = setup({ list: [LIST[1]], stored });
    await again.settle();
    root = again.view.render();
    assert.ok(texts(root).includes("Every open pull request is a draft"));
    find(root, "filter-ready").props.on_click(null, again.cx); // the active chip goes back to All
    assert.ok(find(again.view.render(), "pr-o/r#8"));
  }
  assert.equal(setup({ stored: { filter: JSON.stringify("gone") } }).view.filter, "ready");
  assert.equal(setup({ stored: { filter: JSON.stringify("mine") } }).view.filter, "mine");
});

test("a narrow sidebar shows only the active chip's count", async () => {
  const h = setup({ width: 340, stored: {} });
  await h.settle();
  let root = h.view.render();
  assert.deepEqual(texts(find(root, "filter-ready")), ["Ready to review", "1"]);
  assert.deepEqual(texts(find(root, "filter-all")), ["All"]);
  assert.equal(find(root, "filter-all").props.tooltip, "2 pull requests");
  h.view.width = 420;
  root = h.view.render();
  assert.deepEqual(texts(find(root, "filter-all")), ["All", "2"]);
});

test("listing repositories with none picked opens on the panel and suggests the spaces' and recent ones", async () => {
  const h = setup({ given: { mode: "repos" }, folders: [{ folder: "/code/shop", repo: "acme/shop" }, { folder: "/code/api", repo: "acme/api" }] });
  await h.settle();
  assert.equal(h.execs.filter((e) => e[0] === "gh" && (e[1] === "pr" || e[2] === "graphql")).length, 0, "nothing to list, nothing asked");
  const root = h.view.render();
  assert.ok(find(root, "setup"));
  assert.ok(texts(root).includes("What to list"));
  assert.equal(find(root, "mode-repos").props.aria_selected, true);
  assert.equal(find(root, "repos"), null, "no list to go back to");
  assert.equal(find(root, "search"), null);
  assert.equal(find(root, "setup-done"), null, "nothing to go back to");
  const offered = [0, 1, 2, 3].map((i) => find(root, `suggest-${i}`)).filter(Boolean).map((n) => texts(n).at(-1));
  assert.deepEqual(offered, ["acme/shop", "acme/api", "acme/web"], "spaces first, no repeats");
  find(root, "suggest-1").props.on_click(null, h.cx);
  assert.deepEqual(h.store["github-prs.repos.prs"], ["acme/api"]);
  await h.settle();
  assert.deepEqual(h.execs.filter((e) => e[1] === "pr").map((e) => e[4]), ["acme/api"]);
  const after = h.view.render();
  assert.ok(find(after, "setup"), "the panel stays open for more");
  assert.equal(find(after, "suggest-2"), null, "an added suggestion leaves the list");
  find(after, "setup-done").props.on_click(null, h.cx);
  assert.ok(find(h.view.render(), "pr-list"));
});

test("typing a repository adds it with GitHub's exact name; bad input says why", async () => {
  const h = setup({ repos: { "acme/api": "Acme/API" }, failing: ["gone/away"] });
  await h.settle();
  find(h.view.render(), "repos").props.on_click(null, h.cx);
  h.repoInput.text = "not a repo";
  h.repoInput.handlers.submit(null, h.cx);
  assert.match(h.view.addError, /owner\/name/);
  h.repoInput.text = "https://github.com/O/R/pull/3";
  h.repoInput.handlers.submit(null, h.cx);
  assert.match(h.view.addError, /already listed/);
  h.repoInput.text = "gone/away";
  h.repoInput.handlers.submit(null, h.cx);
  await h.settle();
  assert.match(h.view.addError, /Can't see gone\/away/);
  assert.deepEqual(h.view.repos(), ["o/r"]);
  h.repoInput.text = "https://github.com/acme/api/pulls";
  find(h.view.render(), "add-repo").props.on_click(null, h.cx);
  await h.settle();
  assert.equal(h.view.addError, null);
  assert.deepEqual(h.store["github-prs.repos.prs"], ["o/r", "Acme/API"]);
  assert.equal(h.repoInput.text, "", "the box empties for the next one");
  assert.ok(h.execs.some((e) => e[1] === "pr" && e[4] === "Acme/API"), "the new one is fetched at once");
});

test("a listed repository can be renamed in place and removed", async () => {
  const h = setup({ store: { "github-prs.repos.prs": ["o/r", "acme/web"] } });
  await h.settle();
  h.view.openSetup(true, h.cx);
  let root = h.view.render();
  find(root, "edit-repo-0").props.on_click(null, h.cx);
  assert.equal(h.repoInput.text, "o/r");
  assert.ok(texts(h.view.render()).includes("Save"));
  h.repoInput.text = "o/renamed";
  h.repoInput.handlers.submit(null, h.cx);
  await h.settle();
  assert.deepEqual(h.store["github-prs.repos.prs"], ["o/renamed", "acme/web"], "same place in the list");
  assert.equal(h.view.editing, null);
  find(h.view.render(), "remove-repo-1").props.on_click(null, h.cx);
  assert.deepEqual(h.store["github-prs.repos.prs"], ["o/renamed"]);
  find(h.view.render(), "remove-repo-0").props.on_click(null, h.cx);
  assert.deepEqual(h.store["github-prs.repos.prs"], []);
  assert.equal(h.store["github-prs.mode.prs"], "repos", "removing the last one doesn't switch to yours");
  root = h.view.render();
  assert.equal(find(root, "mode-repos").props.aria_selected, true, "back to picking repositories");
  assert.equal(find(root, "setup-done"), null);
});

test("several repositories list together, with tabs, and one failing doesn't hide the rest", async () => {
  const web = [{ ...LIST[0], number: 7, url: "https://github.com/acme/web/pull/7" }];
  const h = setup({ store: { "github-prs.repos.prs": ["o/r", "acme/web", "acme/gone"] }, lists: { "acme/web": web }, failing: ["acme/gone"] });
  await h.settle();
  assert.deepEqual(h.execs.filter((e) => e[1] === "pr").map((e) => e[4]).sort(), ["acme/gone", "acme/web", "o/r"]);
  let root = h.view.render();
  assert.ok(find(root, "pr-o/r#7") && find(root, "pr-acme/web#7"), "same number, two repositories");
  assert.ok(texts(root).includes("web#7"), "rows name their repository");
  assert.ok(find(root, "error"), "the failing one says so");
  assert.ok(texts(find(root, "error")).some((s) => s.includes("acme/gone")));
  assert.ok(find(root, "repo-tabs"));
  assert.equal(h.timers.at(-1).ms, model.DELAY.error, "and is asked again sooner");
  find(root, "scope-1").props.on_click(null, h.cx);
  root = h.view.render();
  assert.equal(find(root, "pr-o/r#7"), null);
  assert.ok(find(root, "pr-acme/web#7"));
  assert.ok(texts(root).includes("#7") && texts(root).includes("web"), "one repository: plain numbers, its name as the title");
  assert.equal(h.storage.data.scope, JSON.stringify("acme/web"));
  find(root, "scope-1").props.on_click(null, h.cx);
  assert.equal(h.view.scope, "all", "clicking the chosen tab again shows them all");
});

const graphql = (h) => h.execs.filter((e) => e[0] === "gh" && e[2] === "graphql");
// The light searches, and the calls for details by id.
const finds = (h) => graphql(h).filter((e) => e.some((a) => a.startsWith("asked=")));
const lookups = (h) => graphql(h).filter((e) => !e.some((a) => a.startsWith("asked=")));
const asked = (call) => call.find((a) => a.startsWith("asked="));

test("a new sidebar lists yours from every repository at once, and says so the first time", async () => {
  const h = setup({ given: {} });
  await h.settle();
  assert.equal(finds(h).length, 1, "one search covers every repository");
  assert.ok(finds(h)[0].includes("mine=is:pr is:open archived:false author:@me"));
  assert.equal(asked(finds(h)[0]), "asked=is:pr is:open archived:false user-review-requested:@me", "reviews asked of you by name");
  assert.deepEqual(lookups(h).map(idsIn), [["PR_o_r_7", "PR_acme_web_3"]], "then their details, by id");
  assert.equal(h.execs.filter((e) => e[1] === "pr" || e[2] === "user").length, 0, "no repository list, and the search says who you are");
  let root = h.view.render();
  assert.equal(find(root, "setup"), null, "nothing to set up");
  assert.ok(texts(root).includes("Your pull requests"));
  assert.ok(find(root, "pr-o/r#7") && find(root, "pr-acme/web#3"));
  assert.ok(texts(root).includes("r#7") && texts(root).includes("web#3"), "rows name their repository");
  assert.ok(texts(find(root, "pr-acme/web#3")).includes("Your review"));
  assert.equal(find(root, "pr-o/r#7").props.border_l, undefined, "your own rows have no accent line");
  assert.deepEqual([texts(find(root, "scope-0"))[0], texts(find(root, "scope-1"))[0]], ["r", "web"], "tabs for the repositories they're in");
  find(root, "repo").props.on_click(null, h.cx);
  await h.settle();
  assert.deepEqual(h.execs.at(-1), ["open", "https://github.com/pulls"], "the title opens GitHub's own list");
  // The first-run note, until it's dismissed.
  assert.ok(find(root, "intro"));
  find(root, "intro-close").props.on_click(null, h.cx);
  assert.equal(h.store["github-prs.intro"], true);
  root = h.view.render();
  assert.equal(find(root, "intro"), null);
  assert.equal(find(root, "repos").props.tooltip, "Choose what to list");
  // The note's link makes the other choice, and opens the panel on it.
  const other = setup({ given: {} });
  await other.settle();
  find(other.view.render(), "intro-repos").props.on_click(null, other.cx);
  assert.equal(other.store["github-prs.mode.prs"], "repos");
  assert.equal(other.store["github-prs.intro"], true);
  root = other.view.render();
  assert.equal(find(root, "mode-repos").props.aria_selected, true);
  assert.ok(find(root, "add-repo"));
});

test("a sidebar that already lists repositories keeps listing them", async () => {
  const h = setup({ given: {}, store: { "github-prs.repos.prs": ["o/r"] } });
  await h.settle();
  assert.equal(graphql(h).length, 0);
  assert.deepEqual(h.execs.filter((e) => e[1] === "pr").map((e) => e[4]), ["o/r"]);
  const root = h.view.render();
  assert.equal(find(root, "intro"), null, "no note about the other way");
  h.view.openSetup(true, h.cx);
  assert.equal(find(h.view.render(), "mode-repos").props.aria_selected, true);
  // A layout can say which, whatever it seeds.
  const told = setup({ given: { mode: "me", repos: ["o/r"] } });
  await told.settle();
  assert.equal(finds(told).length, 1);
  assert.equal(told.execs.filter((e) => e[1] === "pr").length, 0);
});

test("the panel switches between yours and repositories, and keeps the repositories for later", async () => {
  const h = setup({ given: {}, folders: [{ folder: "/code/shop", repo: "acme/shop" }] });
  await h.settle();
  find(h.view.render(), "repos").props.on_click(null, h.cx);
  assert.equal(h.store["github-prs.intro"], true, "the panel is open: the note has done its job");
  let root = h.view.render();
  assert.ok(find(root, "setup"));
  assert.equal(find(root, "mode-me").props.aria_selected, true);
  assert.ok(find(root, "teams") && !find(root, "add-repo"), "yours: the teams option, no repository box");
  find(root, "mode-repos").props.on_click(null, h.cx);
  assert.equal(h.store["github-prs.mode.prs"], "repos");
  await h.settle();
  root = h.view.render();
  assert.equal(find(root, "mode-repos").props.aria_selected, true);
  assert.ok(find(root, "add-repo") && !find(root, "teams"));
  assert.equal(find(root, "setup-done"), null, "nothing picked yet: no list to go back to");
  assert.equal(find(root, "repos"), null);
  assert.equal(texts(find(root, "suggest-0")).at(-1), "acme/shop");
  find(root, "suggest-0").props.on_click(null, h.cx);
  await h.settle();
  assert.deepEqual(h.execs.filter((e) => e[1] === "pr").map((e) => e[4]), ["acme/shop"]);
  find(h.view.render(), "setup-done").props.on_click(null, h.cx);
  root = h.view.render();
  assert.ok(find(root, "pr-list"));
  assert.ok(texts(root).includes("shop"), "one repository: its name is the title");
  // And back: the search runs again, and the repositories wait for the next switch.
  h.view.openSetup(true, h.cx);
  find(h.view.render(), "mode-me").props.on_click(null, h.cx);
  await h.settle();
  assert.equal(h.store["github-prs.mode.prs"], "me");
  assert.deepEqual(h.store["github-prs.repos.prs"], ["acme/shop"]);
  assert.equal(finds(h).length, 2);
  find(h.view.render(), "setup-done").props.on_click(null, h.cx);
  assert.ok(find(h.view.render(), "pr-o/r#7"));
});

test("the teams option asks for every review request and tags the ones a team got", async () => {
  const team = { ...ASKED, number: 5, url: "https://github.com/acme/web/pull/5", reviewDecision: null,
    reviewRequests: [{ __typename: "Team", name: "Frontend" }] };
  const h = setup({ given: {}, search: github({ ...YOURS, team: [node("acme/web", team)] }) });
  await h.settle();
  h.view.openSetup(true, h.cx);
  const option = find(h.view.render(), "teams");
  assert.equal(option.props.aria_selected, false, "off by default");
  option.props.on_click(null, h.cx);
  assert.equal(h.store["github-prs.teams.prs"], true);
  await h.settle();
  assert.equal(asked(finds(h).at(-1)), "asked=is:pr is:open archived:false review-requested:@me");
  h.view.openSetup(false, h.cx);
  const root = h.view.render();
  const row = find(root, "pr-acme/web#5");
  assert.ok(texts(row).includes("Team review"));
  assert.match(row.props.tooltip, /Team review/);
  assert.ok(texts(find(root, "pr-acme/web#3")).includes("Your review"), "a request to you by name stays yours");
  assert.equal(find(root, "filter-review").props.accessibility_label, "Review: 2 pull requests");
});

// Many review requests, as teams bring: number 100 and up, in acme/big.
const many = (n) => Array.from({ length: n }, (_, i) => node("acme/big", { ...ASKED, number: 100 + i, url: `https://github.com/acme/big/pull/${100 + i}` }));

test("a hundred of yours come by id, ten a call and four calls at a time", async () => {
  const asks = many(45);
  const h = setup({ given: {}, search: github({ mine: YOURS.mine, asked: asks }) });
  await h.settle();
  assert.deepEqual(lookups(h).map((e) => idsIn(e).length), [10, 10, 10, 10, 6]);
  assert.equal(h.load.peak, model.PARALLEL);
  assert.equal(h.view.prs.length, 46);
  assert.equal(find(h.view.render(), "error"), null);
});

test("a batch GitHub gives up on is asked again in halves; one that still fails keeps what it had", async () => {
  const asks = many(12);
  let refusing = (ids) => ids.length > 5;
  const slow = { code: 1, stdout: "", stderr: "gh: HTTP 502" };
  const h = setup({ given: {}, search: github({ mine: [], asked: asks, details: (ids) => (refusing(ids) ? slow : undefined) }) });
  await h.settle();
  // 10 and 2; the 10 failed, and came back as 5 and 5.
  assert.deepEqual(lookups(h).map((e) => idsIn(e).length), [10, 2, 5, 5]);
  assert.equal(h.view.prs.length, 12);
  assert.equal(find(h.view.render(), "error"), null, "nothing was missing in the end");
  // Next time the second half of the first batch can't be read at all: its pull requests keep
  // the details they had, and the banner says some couldn't be read.
  refusing = (ids) => ids.length > 5 || ids.includes("PR_acme_big_107");
  find(h.view.render(), "refresh").props.on_click(null, h.cx);
  await h.settle();
  assert.equal(h.view.prs.length, 12, "none of them went missing");
  const banner = texts(find(h.view.render(), "error")).join(" ");
  assert.match(banner, /Some pull requests couldn't be read\. GitHub didn't answer in time\./);
  assert.doesNotMatch(banner, /Showing the list from/);
});

test("an answer with holes lists what came back and says what's missing; a failed one says what to do", async () => {
  const saml = "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.";
  const h = setup({ given: {}, search: github({ mine: [node("o/r", LIST[0]), null], asked: [], errors: [{ message: saml }] }) });
  await h.settle();
  let root = h.view.render();
  assert.ok(find(root, "pr-o/r#7"));
  const banner = texts(find(root, "error")).join(" ");
  assert.match(banner, /Some pull requests couldn't be read\. .*single sign-on/);
  assert.doesNotMatch(banner, /Showing the list from/, "the list is today's");
  assert.equal(h.timers.at(-1).ms, model.DELAY.settled);
  const signedOut = setup({ given: {}, search: () => ({ code: 1, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" }) });
  await signedOut.settle();
  root = signedOut.view.render();
  assert.ok(texts(find(root, "error")).some((s) => s.includes("gh auth login")));
  assert.equal(signedOut.timers.at(-1).ms, model.DELAY.error);
  // Found, but no details came back for any of them: that's a failure, not an empty list.
  const lost = setup({ given: {}, search: github({ ...YOURS, details: () => ({ code: 1, stdout: "", stderr: "gh: HTTP 504" }) }) });
  await lost.settle();
  root = lost.view.render();
  assert.equal(lost.view.prs, null);
  assert.ok(texts(find(root, "error")).some((s) => s.includes("GitHub didn't answer in time")));
  assert.equal(lost.timers.at(-1).ms, model.DELAY.error);
});

test("with nothing of yours open, the list says so, whichever chip is on", async () => {
  const h = setup({ given: {}, stored: {}, search: github({}) });
  await h.settle();
  assert.equal(lookups(h).length, 0, "nothing found, nothing to look up");
  const words = texts(h.view.render());
  assert.ok(words.includes("Nothing of yours is open, and no review is waiting on you"));
  assert.ok(words.some((w) => /Reviews asked of your teams aren't included/.test(w)));
  assert.equal(find(h.view.render(), "repo-tabs"), null);
});
