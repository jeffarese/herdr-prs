// Pure data for the pull request sidebar: no Herdr or GPUI calls, so Node tests can load it.

export const FIELDS = [
  "number", "title", "url", "isDraft", "author", "headRefName", "baseRefName",
  "createdAt", "updatedAt", "reviewDecision", "mergeable", "statusCheckRollup", "reviewRequests",
  "mergeStateStatus", "autoMergeRequest", "additions", "deletions", "changedFiles",
].join(",");

// GitHub's own limits: an owner is letters, digits and single hyphens; a name adds dots and underscores.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** "owner/name" from what a person types or pastes: owner/name, a github.com link (to the repo
 *  or anything in it) or a clone URL. Null when it isn't one. */
export function parseRepo(text) {
  let value = String(text ?? "").trim();
  value = value.replace(/^git@github\.com:/i, "").replace(/^(?:https?:\/\/|ssh:\/\/git@)?(?:www\.)?github\.com\//i, "");
  const [owner, rawName] = value.split(/[/?#]/);
  const name = (rawName ?? "").replace(/\.git$/i, "");
  if (!OWNER.test(owner ?? "") || !NAME.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

/** The list without repeats (GitHub names ignore case) or anything that isn't a repository. */
export function uniqueRepos(list) {
  const seen = new Set();
  const out = [];
  for (const item of list ?? []) {
    const repo = parseRepo(item);
    if (!repo || seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    out.push(repo);
  }
  return out;
}

export const sameRepo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Where a sidebar keeps its list: Herdr's shared state, one list per layout block. */
export const repoKey = (block) => `github-prs.repos.${block || "prs"}`;

/** The repositories a sidebar lists. Once someone has edited the list in the sidebar, that list
 *  wins, even when it's empty; until then the layout's props (`repos`, or one `repo`) seed it. */
export function configured(stored, given) {
  if (Array.isArray(stored)) return uniqueRepos(stored);
  const seed = Array.isArray(given?.repos) ? given.repos : given?.repo ? [given.repo] : [];
  return uniqueRepos(seed);
}

// Two ways to fill a sidebar. "me": your pull requests from every repository, the ones you opened
// and the ones waiting on your review. "repos": every open pull request of the repositories picked.
export const MODES = ["me", "repos"];
export const modeKey = (block) => `github-prs.mode.${block || "prs"}`;
// Whether "me" counts review requests made to a team you're in, not only to you by name.
export const teamsKey = (block) => `github-prs.teams.${block || "prs"}`;
// Set once the first-run note about "me" has been read, for every sidebar.
export const INTRO_KEY = "github-prs.intro";

/** How a sidebar lists pull requests. A choice made in the sidebar wins, then the layout's `mode`
 *  prop. Without either, a sidebar that has repositories (chosen before there was a choice, or
 *  seeded by the layout) keeps listing them, and any other lists yours. */
export function chosenMode(stored, given, storedRepos) {
  if (MODES.includes(stored)) return stored;
  if (MODES.includes(given?.mode)) return given.mode;
  return configured(storedRepos, given).length ? "repos" : "me";
}

/** Whether "me" includes review requests made to your teams: the sidebar's choice, else the
 *  layout's `teams` prop. Off by default: in a large organization they can be hundreds. */
export const withTeams = (stored, given) => (typeof stored === "boolean" ? stored : given?.teams === true);

/** The name a repository goes by in the sidebar: its name, or owner/name when two share one. */
export function shortName(repo, all = []) {
  const name = String(repo).split("/").pop();
  const clash = all.some((other) => !sameRepo(other, repo) && sameRepo(String(other).split("/").pop(), name));
  return clash ? repo : name;
}

/** The repositories some pull requests are in, once each, by name and then owner: the tabs of
 *  a sidebar that lists yours, which come and go with the pull requests. */
export function reposOf(prs) {
  const key = (repo) => repo.toLowerCase().split("/").reverse().join("/");
  return uniqueRepos(prs.map((p) => p.repo)).sort((a, b) => key(a).localeCompare(key(b)));
}

// No activity for this long and a pull request is stale; opened this recently and it's new.
export const STALE = 7 * 24 * 3600_000;
export const FRESH = 24 * 3600_000;

// Lines changed (added + removed) at which each size starts, as size-labelling bots count them.
export const SIZES = [
  { label: "XS", min: 0, color: "muted" },
  { label: "S", min: 10, color: "muted" },
  { label: "M", min: 100, color: "muted" },
  { label: "L", min: 500, color: "working" },
  { label: "XL", min: 1000, color: "blocked" },
];

// Poll often while checks run, gently otherwise. Hidden copies keep polling, so not too often.
export const DELAY = { running: 30_000, settled: 120_000, error: 60_000 };

export const SECTIONS = [
  { id: "failing", label: "Failing", color: "blocked" },
  { id: "running", label: "Running", color: "working" },
  { id: "passing", label: "Passing", color: "pass" },
  { id: "none", label: "No checks", color: "muted" },
];

// The first is where a new sidebar starts.
export const FILTERS = [["ready", "Ready to review"], ["all", "All"], ["mine", "Mine"], ["review", "Review"], ["drafts", "Drafts"]];
// Filters that are a way of looking at the whole list rather than a search: they leave folded
// sections folded, and the sidebar remembers them like any other choice.
export const VIEWS = new Set(["all", "ready"]);

const SEVERITY = { fail: 0, running: 1, pass: 2, skip: 3 };
const QUIET = new Set(["SKIPPED", "NEUTRAL", "STALE"]);
const WORDS = {
  SUCCESS: "Passed", FAILURE: "Failed", CANCELLED: "Cancelled", TIMED_OUT: "Timed out",
  ACTION_REQUIRED: "Action required", STARTUP_FAILURE: "Failed to start", ERROR: "Error",
  SKIPPED: "Skipped", NEUTRAL: "Neutral", STALE: "Stale", QUEUED: "Queued", IN_PROGRESS: "In progress",
  WAITING: "Waiting", PENDING: "Pending", REQUESTED: "Requested", EXPECTED: "Expected",
};

// GitHub writes "0001-01-01T00:00:00Z" for a time that hasn't happened yet.
export function time(value) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const isStatus = (c) => c?.__typename === "StatusContext" || (c?.context != null && c?.name == null);

/** A check's state: "fail", "running", "pass" or "skip" (skipped and neutral). */
export function checkState(c) {
  if (isStatus(c)) {
    if (c.state === "SUCCESS") return "pass";
    if (c.state === "PENDING" || c.state === "EXPECTED") return "running";
    return "fail";
  }
  if (c.status && c.status !== "COMPLETED") return "running";
  if (c.conclusion === "SUCCESS") return "pass";
  if (QUIET.has(c.conclusion)) return "skip";
  return "fail";
}

/** The latest run of each check. A workflow that ran twice on one commit (a re-run, or a run
 *  cancelled by a newer one) leaves both in GitHub's rollup, which then counts the cancelled
 *  copy as a failure; only the newest run of each name says where the pull request stands. */
export function latestChecks(rollup) {
  const latest = new Map();
  let superseded = 0;
  for (const c of rollup ?? []) {
    const status = isStatus(c);
    const name = (status ? c.context : c.name) || "check";
    const workflow = status ? "" : c.workflowName || "";
    const key = `${status ? "status" : "run"}:${workflow}/${name}`;
    const state = checkState(c);
    const started = time(c.startedAt);
    const check = {
      key, name, workflow, state,
      word: WORDS[status ? c.state : state === "running" ? c.status : c.conclusion] ?? (status ? c.state : c.conclusion) ?? "",
      url: (status ? c.targetUrl : c.detailsUrl) || "",
      started, finished: time(c.completedAt),
      // A run still going is the newest one; otherwise the later start wins.
      rank: state === "running" ? Infinity : started ?? 0,
    };
    const previous = latest.get(key);
    if (previous) superseded++;
    if (!previous || check.rank >= previous.rank) latest.set(key, check);
  }
  const list = [...latest.values()].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { list, superseded };
}

export function tally(checks) {
  const n = { fail: 0, running: 0, pass: 0, skip: 0 };
  for (const c of checks) n[c.state]++;
  return n;
}

/** The pull request's state from its latest checks: any failure, else any running, else passing. */
export function overall(n) {
  if (n.fail) return "failing";
  if (n.running) return "running";
  return n.pass || n.skip ? "passing" : "none";
}

export const login = (author) => String(author?.login ?? "").replace(/^app\//, "");

/** One pull request. `asked` says which search found it, when one did: "you" for the review
 *  requests made to you by name, "team" for those that include your teams. */
export function pullRequest(raw, viewer, repo = "", asked = "") {
  const { list, superseded } = latestChecks(raw.statusCheckRollup);
  const counts = tally(list);
  const author = login(raw.author);
  const reviewers = raw.reviewRequests ?? [];
  const direct = Boolean(viewer) && reviewers.some((r) => r?.login === viewer);
  // Found by the search that includes teams, without naming you: asked of a team you're in.
  const viaTeam = asked === "team" && !direct;
  return {
    id: `${repo}#${raw.number}`,
    repo,
    number: raw.number,
    title: raw.title ?? "",
    url: raw.url ?? "",
    draft: Boolean(raw.isDraft),
    author,
    bot: Boolean(raw.author?.is_bot) || String(raw.author?.login ?? "").startsWith("app/"),
    branch: raw.headRefName ?? "",
    base: raw.baseRefName ?? "",
    created: time(raw.createdAt),
    updated: time(raw.updatedAt),
    review: raw.reviewDecision || null,
    conflicts: raw.mergeable === "CONFLICTING",
    // CLEAN, BEHIND, BLOCKED, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT or UNKNOWN.
    merge: raw.mergeStateStatus || "",
    autoMerge: raw.autoMergeRequest != null,
    added: Number(raw.additions) || 0,
    removed: Number(raw.deletions) || 0,
    files: Number(raw.changedFiles) || 0,
    mine: Boolean(viewer) && author === viewer,
    requested: direct || asked === "you",
    viaTeam,
    teams: viaTeam ? reviewers.filter((r) => r?.__typename === "Team" && r.name).map((r) => r.name) : [],
    checks: list,
    superseded,
    counts,
    state: overall(counts),
  };
}

/** The file an author's avatar is cached in: a login can't reach outside the folder. */
export const avatarFile = (login) => `${String(login).toLowerCase().replace(/[^a-z0-9._-]/g, "_").replace(/^\.+/, "_")}.png`;

/** Up to two letters that stand in for an avatar until it has downloaded. */
export function initials(login) {
  const words = String(login ?? "").replace(/\[bot\]$/, "").split(/[-_.\s]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** The checks a row draws as squares, at most `max`; the rest become a "+n" count. Checks
 *  arrive failures first, so the ones left out are passed or skipped. */
export function strip(checks, max) {
  if (checks.length <= max) return { shown: checks, more: 0 };
  const room = Math.max(0, max - 1);
  return { shown: checks.slice(0, room), more: checks.length - room };
}

export function parse(stdout, viewer, repo = "") {
  const raw = JSON.parse(stdout);
  if (!Array.isArray(raw)) throw new Error("gh returned something other than a list of pull requests");
  return raw.map((p) => pullRequest(p, viewer, repo));
}

export const listArgs = (repo) => ["pr", "list", "--repo", repo, "--state", "open", "--limit", "100", "--json", FIELDS];

// "me" asks in two steps. A light search finds your pull requests and those waiting on your
// review, by id; then their details come by id, a few at a time. Asked for inside the search, the
// details of a hundred pull requests take GitHub past its 10-second limit, and it answers 502:
// mergeStateStatus costs the most, and review requests to teams easily number a hundred.
export const FIND = `query($mine: String!, $asked: String!) {
  viewer { login }
  mine: search(query: $mine, type: ISSUE, first: 100) { nodes { ... on PullRequest { id } } }
  asked: search(query: $asked, type: ISSUE, first: 100) { nodes { ... on PullRequest { id } } }
}`;

// The fields `gh pr list --json FIELDS` asks for, as gh asks for them.
const DETAILS = `id number title url isDraft createdAt updatedAt headRefName baseRefName
  reviewDecision mergeable mergeStateStatus additions deletions changedFiles
  author { __typename login }
  repository { nameWithOwner }
  autoMergeRequest { enabledAt }
  reviewRequests(first: 50) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion startedAt completedAt detailsUrl checkSuite { workflowRun { workflow { name } } } }
    ... on StatusContext { context state targetUrl createdAt }
  } } } } } }`;

// Pull requests per call for their details, and calls at once. Ten take GitHub 2 to 7 seconds.
export const BATCH = 10;
export const PARALLEL = 4;

// Open pull requests only, and none from archived repositories, as GitHub's own lists do.
const OPEN = "is:pr is:open archived:false";

/** The light search for "me". `review-requested` includes requests made to your teams;
 *  `user-review-requested` only those made to you by name. */
export const findArgs = (teams) => ["api", "graphql", "-f", `query=${FIND}`,
  "-f", `mine=${OPEN} author:@me`, "-f", `asked=${OPEN} ${teams ? "review-requested" : "user-review-requested"}:@me`];

// A node id, as GitHub writes them (PR_kwDO…). Checked before one goes into a query.
const NODE_ID = /^[A-Za-z0-9_=-]{1,200}$/;

/** The details of some pull requests, by id. */
export const detailsArgs = (ids) => ["api", "graphql", "-f",
  `query=query { nodes(ids: [${ids.filter((id) => NODE_ID.test(id)).map((id) => `"${id}"`).join(", ")}]) { ... on PullRequest { ${DETAILS} } } }`];

/** A pull request from GraphQL, in the shape `gh pr list --json` gives (gh flattens checks the
 *  same way), so the rest of the sidebar doesn't know where it came from. */
export function fromGraphQL(node) {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return {
    ...node,
    author: node.author ? { login: node.author.login, is_bot: node.author.__typename === "Bot" } : null,
    reviewRequests: (node.reviewRequests?.nodes ?? []).map((r) => r?.requestedReviewer).filter(Boolean),
    statusCheckRollup: contexts.filter(Boolean).map((c) => (c.__typename === "StatusContext"
      ? { __typename: c.__typename, context: c.context, state: c.state, targetUrl: c.targetUrl, startedAt: c.createdAt }
      : { __typename: c.__typename, name: c.name, workflowName: c.checkSuite?.workflowRun?.workflow?.name ?? "",
        status: c.status, conclusion: c.conclusion, startedAt: c.startedAt, completedAt: c.completedAt, detailsUrl: c.detailsUrl })),
  };
}

// `gh api graphql` exits 1 when part of an answer failed, and still prints the rest.
function json(stdout) {
  try { return JSON.parse(stdout); } catch { return null; }
}
const messages = (body) => [...new Set((body?.errors ?? []).map((e) => String(e?.message ?? "").trim()).filter(Boolean))];

/** The light search's answer: who you are, the ids of yours (`mine`) and of those asking for
 *  your review (`asked`), and what GitHub couldn't answer. Null when nothing came back. */
export function parseFound(stdout) {
  const body = json(stdout);
  const data = body?.data;
  if (!data?.mine && !data?.asked) return null;
  // A null node is one the token can't read.
  const ids = (key) => (data[key]?.nodes ?? []).map((n) => n?.id).filter((id) => NODE_ID.test(id ?? ""));
  return { viewer: data.viewer?.login ?? "", mine: ids("mine"), asked: ids("asked"), errors: messages(body) };
}

/** One batch of details: the pull requests GitHub could read, and what it said about the rest.
 *  Null when nothing came back. */
export function parseDetails(stdout) {
  const body = json(stdout);
  if (!Array.isArray(body?.data?.nodes)) return null;
  // A null node is one the token can't read; one without a repository isn't a pull request.
  return { nodes: body.data.nodes.filter((n) => n?.id && n.repository?.nameWithOwner), errors: messages(body) };
}

/** Yours, from what the search found and the details that came back for it (by id): each once,
 *  yours first. */
export function yours(found, details, teams = false) {
  const out = new Map();
  for (const [key, asked] of [["mine", ""], ["asked", teams ? "team" : "you"]]) {
    for (const id of found[key]) {
      const node = details.get(id);
      if (node && !out.has(id)) out.set(id, pullRequest(fromGraphQL(node), found.viewer, node.repository.nameWithOwner, asked));
    }
  }
  return [...out.values()];
}

/** `items` in groups of `size`. */
export function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `work` on every item, at most `limit` at a time. */
export async function pool(items, limit, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}

/** Whether GitHub gave up on a query: past its time limit, its gateway answers 502 or 504. */
export const tooSlow = (text) => /HTTP 50[24]|Bad Gateway|Gateway Time-?out|timed? ?out/i.test(String(text ?? ""));

// GitHub lets an account use about a minute of its servers' time a minute through GraphQL, and
// counts the time its answers take. A refresh waits at least this many times as long as its
// calls took, so a sidebar keeps to a quarter of that, however much it lists.
export const PACE = 4;
export const paced = (delay, spent) => Math.max(delay, Math.round((Number(spent) || 0) * PACE));

/** What went wrong, in words a person can act on. `repo` names the repository that was asked
 *  about, when one was. */
export function explain(text, repo = "") {
  const message = String(text ?? "").trim();
  if (/auth login|not logged|authentication|HTTP 401|bad credentials/i.test(message)) return "GitHub CLI isn't signed in. Run gh auth login in a terminal.";
  if (/SAML|single sign-on|OAuth App access restrictions/i.test(message)) return "An organization limits what gh can read: authorize GitHub CLI for its single sign-on, or ask an owner to approve it.";
  if (repo && /could not resolve to a repository|HTTP 404|not found/i.test(message)) return `Can't see ${repo}. Check the name and your access.`;
  if (/ENOENT|no such file|not installed|cannot start|can't start|failed to start|command not found/i.test(message)) return "The GitHub CLI (gh) isn't installed, or isn't on Herdr's PATH.";
  if (tooSlow(message)) return "GitHub didn't answer in time.";
  if (/could not resolve host|network|connection/i.test(message)) return "Can't reach GitHub. Check the connection.";
  return message.split("\n").find(Boolean)?.slice(0, 200) || "gh failed without saying why.";
}

/** The banner's text: each different problem once, since a sign-in problem is every repository's. */
export function problems(errors) {
  return [...new Set(errors)].join("\n");
}

export function nextDelay(prs) {
  return prs.some((p) => p.state === "running") ? DELAY.running : DELAY.settled;
}

const matches = (pr, words) => {
  const hay = `#${pr.number} ${pr.title} ${pr.author} ${pr.branch} ${pr.base} ${pr.repo}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

const FILTER = {
  all: () => true,
  ready: (p) => !p.draft,
  mine: (p) => p.mine,
  // Waiting on a reviewer: open for review, not ours, and either asked of us (or of our team) or
  // still unreviewed.
  review: (p) => !p.draft && !p.mine && (p.requested || p.viaTeam || p.review === "REVIEW_REQUIRED"),
  drafts: (p) => p.draft,
};

/** The pull requests of one repository, or of all of them ("all"). */
export const inScope = (prs, scope) => (!scope || scope === "all" ? prs : prs.filter((p) => sameRepo(p.repo, scope)));

/** How many pull requests each repository has under a filter, by repository. */
export function repoCounts(prs, repos, filter = "all") {
  const keep = FILTER[filter] ?? FILTER.all;
  return Object.fromEntries(repos.map((repo) => [repo, prs.filter((p) => sameRepo(p.repo, repo) && keep(p)).length]));
}

export function counts(prs) {
  return Object.fromEntries(Object.entries(FILTER).map(([id, keep]) => [id, prs.filter(keep).length]));
}

export function stateCounts(prs) {
  const n = { failing: 0, running: 0, passing: 0, none: 0 };
  for (const p of prs) n[p.state]++;
  return n;
}

/** Sections in Failing, Running, Passing, No checks order, empty ones left out; the most
 *  recently updated first within each. */
export function sections(prs, query = "", filter = "all", scope = "all") {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const keep = FILTER[filter] ?? FILTER.all;
  const shown = inScope(prs, scope).filter((p) => keep(p) && matches(p, words))
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0) || b.number - a.number);
  return SECTIONS.map((s) => ({ ...s, prs: shown.filter((p) => p.state === s.id) })).filter((s) => s.prs.length);
}

/** "<1m", "4m", "2h", "3d", "5w". */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 60_000) return "<1m";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 14 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

/** "06:41": a clock time never goes stale between refreshes, where "2m ago" would. */
export function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** How long a check ran, or has been running. */
export function took(check, now) {
  if (!check.started) return "";
  const end = check.finished ?? (check.state === "running" ? now : null);
  return end ? duration(end - check.started) : "";
}

export const REVIEW = {
  APPROVED: { label: "Approved", color: "pass" },
  CHANGES_REQUESTED: { label: "Changes requested", color: "blocked" },
  REVIEW_REQUIRED: { label: "Needs review", color: "muted" },
};

/** How big a change is, from the lines it adds and removes. */
export function size(pr) {
  const lines = pr.added + pr.removed;
  const found = [...SIZES].reverse().find((s) => lines >= s.min) ?? SIZES[0];
  const files = pr.files ? `, ${pr.files} ${pr.files === 1 ? "file" : "files"}` : "";
  return { ...found, tip: `Size ${found.label}: +${pr.added} −${pr.removed} lines${files}` };
}

export const isStale = (pr, now) => Boolean(pr.updated) && now - pr.updated >= STALE;

/** The row's tags, most important first, so the ones that don't fit are the least missed.
 *  `outline` tags are quiet; the rest are filled with their color. */
export function tags(pr, now) {
  const ready = !pr.draft && pr.review === "APPROVED" && pr.merge === "CLEAN" && pr.state === "passing";
  const review = REVIEW[pr.review];
  return [
    pr.conflicts && { id: "conflicts", label: "Conflicts", color: "blocked", tip: "Has conflicts with its base branch" },
    !pr.draft && pr.review === "CHANGES_REQUESTED" && { id: "changes", label: "Changes requested", color: "blocked", tip: "A reviewer asked for changes" },
    !pr.draft && !pr.mine && pr.requested && { id: "yours", label: "Your review", color: "accent", tip: "Your review was requested" },
    !pr.draft && !pr.mine && !pr.requested && pr.viaTeam && { id: "team", label: "Team review", color: "accent", outline: true,
      tip: `A team you're in was asked to review${pr.teams.length ? ` (asked: ${pr.teams.join(", ")})` : ""}` },
    ready && { id: "ready", label: "Ready to merge", color: "pass", tip: "Approved, checks passing and up to date" },
    pr.merge === "BEHIND" && { id: "behind", label: "Behind", color: "working", outline: true, tip: `Behind ${pr.base || "its base"}: needs an update before merging` },
    pr.autoMerge && { id: "auto", label: "Auto-merge", color: "accent", outline: true, tip: "Merges by itself once it can" },
    isStale(pr, now) && { id: "stale", label: "Stale", color: "working", tip: `No activity for ${duration(now - pr.updated)}` },
    !isStale(pr, now) && Boolean(pr.created) && now - pr.created < FRESH && { id: "new", label: "New", color: "accent", tip: `Opened ${duration(now - pr.created)} ago` },
    pr.draft && { id: "draft", label: "Draft", color: "muted", outline: true, tip: "Draft" },
    !pr.draft && !ready && review && review.color !== "blocked" && { id: "review", label: review.label, color: review.color, outline: review.color === "muted", tip: review.label },
  ].filter(Boolean);
}

/** The command that opens a link in the system browser. */
export function opener(platform, url) {
  if (platform === "windows") return ["cmd", ["/c", "start", "", url]];
  if (platform === "linux") return ["xdg-open", [url]];
  return ["open", [url]];
}
