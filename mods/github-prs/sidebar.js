// Sidebars belong to the layout, not to any one mod. A sidebar is the outermost column (or lone
// block) beside the tabs that holds a mod: Herdr's `sidebar` on the left, `sidebar-right` on the
// right, a panel column inside the work area. Mods stack inside it as panels, and folding to a
// rail resizes the sidebar, never a panel, so every panel in it goes narrow together.
// A mod with a fold button can copy this file as is (mods can't import each other).

/** The id Herdr's own sidebar uses, and the one a right sidebar gets when a mod makes it. */
export const LEFT = "sidebar";
export const RIGHT = "sidebar-right";

const holdsTabs = (n) => Boolean(n?.content?.tab) || (n?.children ?? []).some(holdsTabs);

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

/** The sidebar holding the node `test` matches: the outermost node on its path that sits in a row
 *  and doesn't hold the tabs. The node itself when it is a lone block at the edge; null when it is
 *  in no row (a floating block, a pane) or the layout isn't known. */
export function sidebarOf(root, test) {
  const path = pathTo(root, test);
  if (!path) return null;
  for (let i = 1; i < path.length; i++) {
    if (path[i - 1].type === "row" && !holdsTabs(path[i])) return path[i];
  }
  return null;
}

/** Where the width to expand back to is kept, shared by every mod in that sidebar. Herdr's own
 *  sidebar keeps it under `sidebar.width`, as its fold button does. */
export const widthKey = (id) => (id === LEFT ? "sidebar.width" : `sidebar.width.${id}`);

/** The rail width for a sidebar: Herdr's left one leaves room for macOS's window buttons. */
export function railWidth(id, platform, rail) {
  if (id === LEFT) return platform === "macos" ? 76 : 44;
  return rail;
}
