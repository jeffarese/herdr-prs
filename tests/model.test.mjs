import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../mods/github-prs/model.js";

const run = (name, conclusion, startedAt, extra = {}) => ({
  __typename: "CheckRun", name, workflowName: "CI", status: "COMPLETED", conclusion, startedAt,
  completedAt: startedAt.replace(/:00Z$/, ":30Z"), detailsUrl: `https://ci.example/${name}/${startedAt}`, ...extra,
});
const pr = (number, rollup, extra = {}) => ({
  number, title: `Change ${number}`, url: `https://github.com/o/r/pull/${number}`, isDraft: false,
  author: { login: "ana", is_bot: false }, headRefName: `feat/${number}`, baseRefName: "main",
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-12T10:00:00Z", reviewDecision: "APPROVED",
  mergeable: "MERGEABLE", statusCheckRollup: rollup, reviewRequests: [], ...extra,
});

test("a cancelled run replaced by a newer one doesn't count as a failure", () => {
  const { list, superseded } = m.latestChecks([
    run("Go tests", "CANCELLED", "2026-11-12T10:00:00Z"),
    run("Go tests", "SUCCESS", "2026-11-12T10:05:00Z"),
    run("Lint", "SUCCESS", "2026-11-12T10:06:00Z"),
    run("Lint", "CANCELLED", "2026-11-12T10:01:00Z"),
  ]);
  assert.equal(superseded, 2);
  assert.deepEqual(list.map((c) => [c.name, c.state]), [["Go tests", "pass"], ["Lint", "pass"]]);
  assert.equal(m.overall(m.tally(list)), "passing");
});

test("the newest run decides, even when it fails after an earlier pass", () => {
  const { list } = m.latestChecks([
    run("Build", "SUCCESS", "2026-11-12T09:00:00Z"),
    run("Build", "FAILURE", "2026-11-12T10:00:00Z"),
  ]);
  assert.equal(list[0].state, "fail");
  assert.equal(list[0].word, "Failed");
});

test("a queued or running re-run wins over a finished run of the same check", () => {
  const { list } = m.latestChecks([
    run("Build", "FAILURE", "2026-11-12T10:00:00Z"),
    { __typename: "CheckRun", name: "Build", workflowName: "CI", status: "QUEUED", conclusion: "", startedAt: "0001-01-01T00:00:00Z" },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].state, "running");
  assert.equal(list[0].word, "Queued");
  assert.equal(list[0].started, null);
});

test("checks with the same name in different workflows stay apart", () => {
  const { list } = m.latestChecks([
    run("test", "SUCCESS", "2026-11-12T10:00:00Z"),
    run("test", "FAILURE", "2026-11-12T10:00:00Z", { workflowName: "Nightly" }),
  ]);
  assert.equal(list.length, 2);
});

test("status contexts: success passes, pending runs, error and failure fail", () => {
  const status = (context, state) => ({ __typename: "StatusContext", context, state, targetUrl: "https://x/" + context, startedAt: "2026-11-12T10:00:00Z" });
  const { list } = m.latestChecks([status("a", "SUCCESS"), status("b", "PENDING"), status("c", "ERROR"), status("d", "FAILURE")]);
  assert.deepEqual(Object.fromEntries(list.map((c) => [c.name, c.state])), { a: "pass", b: "running", c: "fail", d: "fail" });
  assert.equal(list.find((c) => c.name === "c").url, "https://x/c");
});

test("failures sort first, then running, passed and skipped", () => {
  const { list } = m.latestChecks([
    run("z skipped", "SKIPPED", "2026-11-12T10:00:00Z"),
    run("y passed", "SUCCESS", "2026-11-12T10:00:00Z"),
    run("x failed", "TIMED_OUT", "2026-11-12T10:00:00Z"),
    { __typename: "CheckRun", name: "w running", workflowName: "CI", status: "IN_PROGRESS", startedAt: "2026-11-12T10:00:00Z" },
    run("v neutral", "NEUTRAL", "2026-11-12T10:00:00Z"),
  ]);
  assert.deepEqual(list.map((c) => c.state), ["fail", "running", "pass", "skip", "skip"]);
});

test("a pull request whose checks were all skipped passes; one without checks has none", () => {
  const skipped = m.pullRequest(pr(1, [run("a", "SKIPPED", "2026-11-12T10:00:00Z")]), "me");
  assert.equal(skipped.state, "passing");
  assert.equal(m.pullRequest(pr(2, []), "me").state, "none");
  assert.equal(m.pullRequest(pr(3, null), "me").state, "none");
});

test("authors, bots, conflicts, mine and asked-of-me", () => {
  const bot = m.pullRequest(pr(4, [], { author: { login: "app/renovate", is_bot: true }, mergeable: "CONFLICTING" }), "me");
  assert.equal(bot.author, "renovate");
  assert.equal(bot.bot, true);
  assert.equal(bot.conflicts, true);
  const mine = m.pullRequest(pr(5, [], { author: { login: "me" } }), "me");
  assert.equal(mine.mine, true);
  const asked = m.pullRequest(pr(6, [], { reviewRequests: [{ __typename: "User", login: "me" }] }), "me");
  assert.equal(asked.requested, true);
  assert.equal(m.pullRequest(pr(7, []), "").mine, false);
});

test("sections: failing, running, passing, no checks; most recently updated first, drafts included", () => {
  const prs = m.parse(JSON.stringify([
    pr(10, [run("a", "SUCCESS", "2026-11-12T10:00:00Z")], { updatedAt: "2026-11-10T00:00:00Z" }),
    pr(11, [run("a", "FAILURE", "2026-11-12T10:00:00Z")]),
    pr(12, [run("a", "SUCCESS", "2026-11-12T10:00:00Z")], { isDraft: true, updatedAt: "2026-11-13T00:00:00Z" }),
    pr(13, [run("a", "SUCCESS", "2026-11-12T10:00:00Z")], { updatedAt: "2026-11-11T00:00:00Z" }),
    pr(14, []),
    pr(15, [{ __typename: "CheckRun", name: "a", workflowName: "CI", status: "IN_PROGRESS", startedAt: "2026-11-12T10:00:00Z" }]),
  ]), "me");
  const out = m.sections(prs);
  assert.deepEqual(out.map((s) => [s.id, s.prs.map((p) => p.number)]), [
    ["failing", [11]], ["running", [15]], ["passing", [12, 13, 10]], ["none", [14]],
  ]);
  assert.equal(m.nextDelay(prs), m.DELAY.running);
  assert.equal(m.nextDelay(prs.filter((p) => p.state !== "running")), m.DELAY.settled);
  assert.deepEqual(m.stateCounts(prs), { failing: 1, running: 1, passing: 3, none: 1 });
});

test("search matches number, title, author and branch, every word", () => {
  const prs = m.parse(JSON.stringify([
    pr(20, [], { title: "Fix the login page", headRefName: "fix/LE-97_login" }),
    pr(21, [], { title: "Canvas drafts", author: { login: "bo" } }),
  ]), "me");
  const numbers = (q) => m.sections(prs, q).flatMap((s) => s.prs.map((p) => p.number));
  assert.deepEqual(numbers("login"), [20]);
  assert.deepEqual(numbers("le-97"), [20]);
  assert.deepEqual(numbers("#21"), [21]);
  assert.deepEqual(numbers("bo canvas"), [21]);
  assert.deepEqual(numbers("bo login"), []);
});

test("filters: mine, waiting for review, drafts, with counts", () => {
  const prs = m.parse(JSON.stringify([
    pr(30, [], { author: { login: "me" }, reviewDecision: "REVIEW_REQUIRED" }),
    pr(31, [], { reviewDecision: "REVIEW_REQUIRED" }),
    pr(32, [], { reviewDecision: "APPROVED", reviewRequests: [{ login: "me" }] }),
    pr(33, [], { isDraft: true, reviewDecision: "REVIEW_REQUIRED" }),
    pr(34, [], { reviewDecision: "APPROVED" }),
  ]), "me");
  const numbers = (f) => m.sections(prs, "", f).flatMap((s) => s.prs.map((p) => p.number)).sort();
  assert.deepEqual(numbers("mine"), [30]);
  assert.deepEqual(numbers("review"), [31, 32]);
  assert.deepEqual(numbers("drafts"), [33]);
  assert.deepEqual(m.counts(prs), { all: 5, ready: 4, mine: 1, review: 2, drafts: 1 });
  assert.deepEqual(numbers("ready"), numbers("all").filter((n) => n !== 33));
});

test("errors become something to do", () => {
  assert.match(m.explain("To get started with GitHub CLI, please run:  gh auth login", "o/r"), /gh auth login/);
  assert.match(m.explain("GraphQL: Could not resolve to a Repository with the name 'o/r'.", "o/r"), /Can't see o\/r/);
  assert.match(m.explain("spawn gh ENOENT", "o/r"), /isn't installed/);
  assert.equal(m.explain("\nsomething odd\nmore", "o/r"), "something odd");
  assert.match(m.explain("", "o/r"), /without saying why/);
  assert.throws(() => m.parse("{}", "me"), /list of pull requests/);
});

test("durations, clock and openers", () => {
  assert.equal(m.duration(10_000), "<1m");
  assert.equal(m.duration(5 * 60_000), "5m");
  assert.equal(m.duration(3 * 3_600_000), "3h");
  assert.equal(m.duration(47 * 3_600_000), "47h");
  assert.equal(m.duration(3 * 86_400_000), "3d");
  assert.equal(m.duration(21 * 86_400_000), "3w");
  assert.match(m.clock(Date.now()), /^\d\d:\d\d$/);
  assert.equal(m.took({ started: 0 }, 1), "");
  assert.equal(m.took({ started: 1_000, finished: 61_000 + 1_000, state: "pass" }, 0), "1m");
  assert.equal(m.took({ started: 1_000, finished: null, state: "running" }, 1_000 + 120_000), "2m");
  assert.deepEqual(m.opener("macos", "u"), ["open", ["u"]]);
  assert.deepEqual(m.opener("linux", "u"), ["xdg-open", ["u"]]);
  assert.deepEqual(m.opener("windows", "u"), ["cmd", ["/c", "start", "", "u"]]);
  assert.deepEqual(m.listArgs("o/r").slice(0, 4), ["pr", "list", "--repo", "o/r"]);
});

test("avatar files stay inside their folder, and initials stand in for them", () => {
  assert.equal(m.avatarFile("Trapped"), "trapped.png");
  assert.equal(m.avatarFile("../x"), "__x.png");
  assert.equal(m.initials("aikido-autofix"), "AA");
  assert.equal(m.initials("trapped"), "TR");
  assert.equal(m.initials("dependabot[bot]"), "DE");
  assert.equal(m.initials(""), "?");
});

test("the check strip keeps the first checks and counts the rest", () => {
  const checks = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(m.strip(checks, 6), { shown: checks, more: 0 });
  assert.deepEqual(m.strip(checks, 4), { shown: [1, 2, 3], more: 3 });
});

const NOW = Date.parse("2026-11-13T12:00:00Z");
const labels = (raw, viewer = "me") => m.tags(m.pullRequest(raw, viewer), NOW).map((t) => t.label);

test("size tags count the lines added and removed", () => {
  const sized = (additions, deletions) => m.size(m.pullRequest(pr(1, [], { additions, deletions, changedFiles: 3 }), "")).label;
  assert.deepEqual([sized(3, 2), sized(50, 10), sized(300, 50), sized(600, 0), sized(5605, 1)], ["XS", "S", "M", "L", "XL"]);
  assert.equal(m.size(m.pullRequest(pr(1, [], { additions: 6, deletions: 4, changedFiles: 1 }), "")).tip, "Size S: +6 −4 lines, 1 file");
});

test("tags: stale, new, ready to merge, behind, auto-merge, your review, most important first", () => {
  const green = [run("a", "SUCCESS", "2026-11-12T10:00:00Z")];
  assert.deepEqual(labels(pr(1, green, { mergeStateStatus: "CLEAN" })), ["Ready to merge"], "replaces Approved");
  assert.deepEqual(labels(pr(1, green, { mergeStateStatus: "BLOCKED" })), ["Approved"]);
  assert.deepEqual(labels(pr(1, [], { updatedAt: "2026-11-01T00:00:00Z", reviewDecision: "REVIEW_REQUIRED" })), ["Stale", "Needs review"]);
  assert.deepEqual(labels(pr(1, [], { createdAt: "2026-11-13T09:00:00Z", isDraft: true })), ["New", "Draft"]);
  assert.deepEqual(labels(pr(1, [], { mergeStateStatus: "BEHIND", autoMergeRequest: { mergeMethod: "SQUASH" }, reviewDecision: "REVIEW_REQUIRED",
    reviewRequests: [{ login: "me" }] })), ["Your review", "Behind", "Auto-merge", "Needs review"]);
  assert.deepEqual(labels(pr(1, [], { mergeable: "CONFLICTING", reviewDecision: "CHANGES_REQUESTED" })), ["Conflicts", "Changes requested"]);
  assert.deepEqual(labels(pr(1, [], { reviewRequests: [{ login: "me" }], author: { login: "me" }, reviewDecision: null })), [], "your own isn't yours to review");
});

test("a repository is read from owner/name, a GitHub link or a clone URL", () => {
  for (const text of ["cli/cli", " cli/cli ", "https://github.com/cli/cli", "github.com/cli/cli/pull/12", "https://www.github.com/cli/cli.git",
    "git@github.com:cli/cli.git", "ssh://git@github.com/cli/cli", "https://github.com/cli/cli?tab=readme"]) {
    assert.equal(m.parseRepo(text), "cli/cli", text);
  }
  assert.equal(m.parseRepo("my-org/my.repo_2"), "my-org/my.repo_2");
  for (const text of ["", "cli", "cli/", "/cli", "-cli/cli", "cli/../x", "a b/c", "https://gitlab.com/a/b", "o/.."]) {
    assert.equal(m.parseRepo(text), null, text);
  }
});

test("the stored list wins over the layout's props once there is one, even empty", () => {
  assert.deepEqual(m.configured(undefined, { repo: "a/b" }), ["a/b"]);
  assert.deepEqual(m.configured(undefined, { repos: ["a/b", "A/B", "c/d", "nope"] }), ["a/b", "c/d"]);
  assert.deepEqual(m.configured(undefined, {}), []);
  assert.deepEqual(m.configured(["x/y"], { repo: "a/b" }), ["x/y"]);
  assert.deepEqual(m.configured([], { repo: "a/b" }), [], "removing every repository doesn't bring the prop's back");
  assert.equal(m.repoKey("prs"), "github-prs.repos.prs");
  assert.equal(m.repoKey(undefined), "github-prs.repos.prs");
});

test("a repository goes by its name unless another owner has one of the same name", () => {
  assert.equal(m.shortName("acme/api", ["acme/api", "acme/web"]), "api");
  assert.equal(m.shortName("acme/api", ["acme/api", "other/api"]), "acme/api");
  assert.equal(m.shortName("acme/api"), "api");
});

test("several repositories: rows know theirs, and the scope narrows the list", () => {
  const prs = [
    m.pullRequest(pr(1, [], { updatedAt: "2026-11-12T10:00:00Z" }), "me", "acme/api"),
    m.pullRequest(pr(1, [], { updatedAt: "2026-11-12T09:00:00Z", isDraft: true }), "me", "acme/web"),
    m.pullRequest(pr(2, []), "me", "acme/web"),
  ];
  assert.deepEqual(prs.map((p) => p.id), ["acme/api#1", "acme/web#1", "acme/web#2"]);
  const ids = (scope, query = "") => m.sections(prs, query, "all", scope).flatMap((s) => s.prs).map((p) => p.id);
  assert.deepEqual(ids("all").sort(), ["acme/api#1", "acme/web#1", "acme/web#2"]);
  assert.deepEqual(ids("ACME/WEB").sort(), ["acme/web#1", "acme/web#2"]);
  assert.deepEqual(ids("all", "web").sort(), ["acme/web#1", "acme/web#2"], "search matches the repository");
  assert.deepEqual(m.repoCounts(prs, ["acme/api", "acme/web"], "ready"), { "acme/api": 1, "acme/web": 1 });
  assert.equal(m.problems(["A", "B", "A"]), "A\nB");
});

test("a sidebar lists yours unless it chose repositories, or already has some", () => {
  assert.equal(m.chosenMode(undefined, {}, undefined), "me", "a new sidebar");
  assert.equal(m.chosenMode(undefined, {}, ["a/b"]), "repos", "one that picked repositories before there was a choice");
  assert.equal(m.chosenMode(undefined, { repos: ["a/b"] }, undefined), "repos", "one the layout seeds");
  assert.equal(m.chosenMode(undefined, {}, []), "me", "one that had removed every repository");
  assert.equal(m.chosenMode(undefined, { mode: "me", repo: "a/b" }, undefined), "me", "the layout says which");
  assert.equal(m.chosenMode("repos", { mode: "me" }, []), "repos", "the sidebar's choice wins");
  assert.equal(m.chosenMode("nonsense", {}, undefined), "me");
  assert.equal(m.modeKey(undefined), "github-prs.mode.prs");
  assert.equal(m.withTeams(undefined, {}), false);
  assert.equal(m.withTeams(undefined, { teams: true }), true);
  assert.equal(m.withTeams(false, { teams: true }), false);
});

test("yours are found light, then looked up by id with everything a row needs", () => {
  const find = m.findArgs(false);
  assert.deepEqual(find.slice(0, 3), ["api", "graphql", "-f"]);
  assert.ok(find.includes("mine=is:pr is:open archived:false author:@me"));
  assert.ok(find.includes("asked=is:pr is:open archived:false user-review-requested:@me"));
  assert.ok(m.findArgs(true).includes("asked=is:pr is:open archived:false review-requested:@me"));
  assert.doesNotMatch(m.FIND, /mergeStateStatus|statusCheckRollup/, "the search itself asks only for ids");
  const details = m.detailsArgs(["PR_kwDOa1", 'PR_x"]) { viewer { login } } #', "PR_kwDOb2"]).at(-1);
  assert.match(details, /nodes\(ids: \["PR_kwDOa1", "PR_kwDOb2"\]\)/, "only ids shaped like GitHub's go into the query");
  assert.match(details, /mergeStateStatus/);
});

// A pull request as GraphQL gives it by id.
const found = (repo, number, extra = {}) => ({
  id: `PR_${repo.replace("/", "_")}_${number}`, number, title: `Change ${number}`, url: `https://github.com/${repo}/pull/${number}`, isDraft: false,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-12T10:00:00Z", headRefName: `feat/${number}`, baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", additions: 3, deletions: 1, changedFiles: 1,
  author: { __typename: "User", login: "ana" }, repository: { nameWithOwner: repo }, autoMergeRequest: null,
  reviewRequests: { nodes: [] }, commits: { nodes: [] }, ...extra,
});
// The light search's answer, and a details call's.
const search = (mine, asked, errors) => JSON.stringify({ data: { viewer: { login: "me" },
  mine: { nodes: mine.map((n) => n && { id: n.id }) }, asked: { nodes: asked.map((n) => n && { id: n.id }) } }, errors });
const nodes = (list, errors) => JSON.stringify({ data: { nodes: list }, errors });
// Both steps, the way the sidebar takes them.
function look(mine, asked, teams = false) {
  const hits = m.parseFound(search(mine, asked));
  const got = m.parseDetails(nodes([...mine, ...asked].filter(Boolean)));
  return m.yours(hits, new Map(got.nodes.map((n) => [n.id, n])), teams);
}

test("the details become the same pull requests a repository's list gives", () => {
  const checks = { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
    { __typename: "CheckRun", name: "Build", status: "COMPLETED", conclusion: "CANCELLED", startedAt: "2026-11-12T10:00:00Z",
      completedAt: "2026-11-12T10:01:00Z", detailsUrl: "https://ci/1", checkSuite: { workflowRun: { workflow: { name: "CI" } } } },
    { __typename: "CheckRun", name: "Build", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-12T10:05:00Z",
      completedAt: "2026-11-12T10:06:00Z", detailsUrl: "https://ci/2", checkSuite: { workflowRun: { workflow: { name: "CI" } } } },
    { __typename: "CheckRun", name: "Vercel", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-12T10:05:00Z",
      completedAt: "2026-11-12T10:05:00Z", detailsUrl: "https://v", checkSuite: { workflowRun: null } },
    { __typename: "StatusContext", context: "deploy", state: "PENDING", targetUrl: "https://d", createdAt: "2026-11-12T10:07:00Z" },
  ] } } } }] };
  const web = found("acme/web", 1, { author: { __typename: "User", login: "me" }, commits: checks, autoMergeRequest: { enabledAt: "x" } });
  const api = found("acme/api", 2, { author: { __typename: "Bot", login: "renovate" }, reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] } });
  const prs = look([web, null], [api, web]);
  assert.deepEqual(prs.map((p) => p.id), ["acme/web#1", "acme/api#2"], "each once, yours first; unreadable results left out");
  const [mine, theirs] = prs;
  assert.equal(mine.mine, true);
  assert.equal(mine.autoMerge, true);
  assert.equal(mine.superseded, 1, "the cancelled run a newer one replaced");
  assert.deepEqual(mine.checks.map((c) => [c.workflow, c.name, c.state]), [["", "deploy", "running"], ["CI", "Build", "pass"], ["", "Vercel", "pass"]]);
  assert.equal(mine.checks[0].started, Date.parse("2026-11-12T10:07:00Z"), "a status's time is when it was posted");
  assert.equal(mine.state, "running");
  assert.equal(theirs.bot, true);
  assert.equal(theirs.author, "renovate");
  assert.equal(theirs.requested, true);
  // Details that didn't come back leave that pull request out.
  assert.deepEqual(m.yours(m.parseFound(search([web], [api])), new Map([[api.id, api]])).map((p) => p.id), ["acme/api#2"]);
});

test("a review asked of a team is told apart from one asked of you", () => {
  const team = { nodes: [{ requestedReviewer: { __typename: "Team", name: "Frontend" } }, { requestedReviewer: { __typename: "User", login: "bo" } }] };
  const [viaTeam, direct] = look([], [found("acme/web", 3, { reviewRequests: team }), found("acme/web", 4, {
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] } })], true);
  assert.deepEqual([viaTeam.requested, viaTeam.viaTeam, viaTeam.teams], [false, true, ["Frontend"]]);
  assert.deepEqual([direct.requested, direct.viaTeam], [true, false]);
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.deepEqual(m.tags(viaTeam, now).map((t) => t.label), ["Team review", "Needs review"]);
  assert.match(m.tags(viaTeam, now)[0].tip, /asked: Frontend/);
  assert.deepEqual(m.tags(direct, now).map((t) => t.label), ["Your review", "Needs review"]);
  const quiet = { ...viaTeam, review: null };
  assert.deepEqual(m.sections([quiet], "", "review").flatMap((s) => s.prs).map((p) => p.id), ["acme/web#3"], "a team's request waits on you too");
  // Without the teams option, everything the search for reviews found was asked of you by name.
  assert.equal(look([], [found("acme/web", 3)])[0].requested, true);
});

test("answers with holes keep what they have and say what's missing", () => {
  const saml = "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.";
  const hits = m.parseFound(search([found("acme/web", 1), null], [], [{ message: saml }, { message: saml }]));
  assert.deepEqual([hits.viewer, hits.mine, hits.asked, hits.errors], ["me", ["PR_acme_web_1"], [], [saml]], "each problem once");
  const got = m.parseDetails(nodes([found("acme/web", 1), null, { id: "I_issue" }], [{ message: "Something went wrong" }]));
  assert.deepEqual(got.nodes.map((n) => n.id), ["PR_acme_web_1"], "unreadable and non-pull-request nodes left out");
  assert.deepEqual(got.errors, ["Something went wrong"]);
  for (const bad of ["not json", "", JSON.stringify({ data: null, errors: [{ message: "boom" }] })]) {
    assert.equal(m.parseFound(bad), null);
    assert.equal(m.parseDetails(bad), null);
  }
  assert.match(m.explain(saml), /single sign-on/);
  assert.equal(m.explain("Not Found"), "Not Found", "no repository to blame");
  for (const slow of ["gh: HTTP 502", "gh: HTTP 504", "502 Bad Gateway", "timed out"]) {
    assert.ok(m.tooSlow(slow), slow);
    assert.equal(m.explain(slow), "GitHub didn't answer in time.");
  }
  assert.equal(m.tooSlow("gh: HTTP 500"), false);
});

test("details come in batches, a few calls at a time", async () => {
  assert.deepEqual(m.chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(m.chunks([], 10), []);
  let active = 0;
  let peak = 0;
  const done = [];
  await m.pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    done.push(n);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);
  await m.pool([], 4, async () => assert.fail("nothing to do"));
});

test("the longer GitHub takes, the longer until the next refresh", () => {
  assert.equal(m.paced(m.DELAY.running, 2_000), m.DELAY.running, "a quick answer keeps the usual pace");
  assert.equal(m.paced(m.DELAY.running, 50_000), 200_000, "fifty seconds of GitHub's time: next in two hundred");
  assert.equal(m.paced(m.DELAY.settled, undefined), m.DELAY.settled);
});

test("the repositories yours are in, by name", () => {
  const prs = ["zeta/api", "acme/web", "Acme/web", "acme/api"].map((repo, i) => ({ repo, number: i }));
  assert.deepEqual(m.reposOf(prs), ["acme/api", "zeta/api", "acme/web"]);
});
