// Visibility of a pull request panel and the layout containers around it.
const holdsTabs = (n) => Boolean(n?.content?.tab) || (n?.children ?? []).some(holdsTabs);

const stackActiveId = (stack) => stack?.active ?? (stack?.children ?? []).find((c) => c && !c.hidden && c.id != null)?.id;

// The nodes from the root down to the one `test` matches, or null.
function pathTo(node, test, path = []) {
  if (!node || typeof node !== "object") return null;
  const here = [...path, node];
  if (test(node)) return here;
  for (const child of node.children ?? []) {
    const found = pathTo(child, test, here);
    if (found) return found;
  }
  return null;
}

/** Whether `test` matches a block inside the layout tree. */
export function hasBlock(root, test) {
  return Boolean(pathTo(root, test));
}

/** Whether the block `test` matches is currently hidden by its own `hidden`, an ancestor, or an inactive stack tab. */
export function isHidden(root, test) {
  const path = pathTo(root, test);
  if (!path) return false;
  for (let i = 0; i < path.length; i++) {
    if (path[i]?.hidden === true) return true;
    if (i >= 1 && path[i - 1]?.type === "stack" && stackActiveId(path[i - 1]) !== path[i]?.id) return true;
  }
  return false;
}

/** Node ids to pass to `layout.hide` to hide the matched block and any container it empties. */
export function hideTargets(root, test, fallbackId = null) {
  const path = pathTo(root, test);
  if (!path) return fallbackId ? [fallbackId] : [];
  let targetIdx = path.length - 1;
  for (let k = targetIdx - 1; k >= 1; k--) {
    const parent = path[k];
    if (holdsTabs(parent)) break;
    if (parent.type === "stack" || (parent.children ?? []).length === 1) {
      if (parent.id) targetIdx = k;
    } else {
      break;
    }
  }
  const ids = [];
  if (path[targetIdx]?.id) ids.push(path[targetIdx].id);
  const newlyHidden = new Set([path[targetIdx]]);
  for (let i = targetIdx - 1; i >= 1; i--) {
    const anc = path[i];
    if (holdsTabs(anc)) break;
    const children = anc.children ?? [];
    const anyVisible = anc.type === "stack"
      ? false
      : children.some((c) => c && !c.hidden && !newlyHidden.has(c));
    if (!anyVisible) {
      if (anc.id) ids.push(anc.id);
      newlyHidden.add(anc);
    } else {
      break;
    }
  }
  return ids.length ? ids : fallbackId ? [fallbackId] : [];
}

/** Commands needed to make the matched block visible: `{ show: string[], select: { stack, child }[] }`. */
export function showTargets(root, test, fallbackId = null) {
  const path = pathTo(root, test);
  if (!path) return { show: fallbackId ? [fallbackId] : [], select: [] };
  const show = [];
  const select = [];
  for (let i = 1; i < path.length; i++) {
    if (path[i]?.hidden === true && path[i]?.id) show.push(path[i].id);
    if (path[i - 1]?.type === "stack" && path[i - 1]?.id && path[i]?.id) {
      if (stackActiveId(path[i - 1]) !== path[i].id) select.push({ stack: path[i - 1].id, child: path[i].id });
    }
  }
  if (!show.length && !select.length) {
    const id = path.at(-1)?.id ?? fallbackId;
    if (id) show.push(id);
  }
  return { show, select };
}
