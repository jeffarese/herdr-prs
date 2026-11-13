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

function setup({ list = LIST, code = 0, stderr = "", given = { repo: "o/r" }, width = 340, store = {}, folders = [], repos = {}, lists = {}, failing = [], cached = [], curl = 0, stored = { filter: JSON.stringify("all") } } = {}) {
  const execs = [];
  const commands = [];
  const notes = [];
  const timers = [];
  const tasks = [];
  const removed = [];
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
  return { view, cx, input, repoInput: inputs[1], execs, commands, notes, timers, storage, settle, removed, store };
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

test("with no repositories it opens on the panel and suggests the spaces' and recent ones", async () => {
  const h = setup({ given: {}, folders: [{ folder: "/code/shop", repo: "acme/shop" }, { folder: "/code/api", repo: "acme/api" }] });
  await h.settle();
  assert.equal(h.execs.filter((e) => e[1] === "pr").length, 0, "nothing to list, nothing asked");
  const root = h.view.render();
  assert.ok(find(root, "setup"));
  assert.ok(texts(root).includes("Choose repositories"));
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
  assert.ok(texts(h.view.render()).includes("Choose repositories"), "back to the first-time panel");
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
