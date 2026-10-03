import type { Node } from "@babylonjs/core/node";

/**
 * Hides a changing group of nodes and shows them again without disturbing nodes something else had
 * hidden: it only ever re-enables what it disabled itself. (Toggling `setEnabled` never recompiles a
 * shader, so whole areas can be switched off while the player is elsewhere.)
 */
export class NodeHider {
  private hidden = new Set<Node>();

  /** Hide exactly these nodes: the enabled ones among them are disabled; what this hider hid before and is not listed is shown again. */
  hideOnly(nodes: Iterable<Node>) {
    const want = new Set(nodes);
    for (const n of [...this.hidden])
      if (!want.has(n)) {
        this.hidden.delete(n);
        if (!n.isDisposed()) n.setEnabled(true);
      }
    for (const n of want)
      if (!this.hidden.has(n) && !n.isDisposed() && n.isEnabled(false)) {
        n.setEnabled(false);
        this.hidden.add(n);
      }
  }

  /** Show everything this hider hid. */
  showAll() {
    this.hideOnly([]);
  }

  /** Something else now decides about `node` (e.g. a wall that broke while hidden): never re-enable it. */
  forget(node: Node) {
    this.hidden.delete(node);
  }

  /** Nodes hidden by this hider now. */
  get size() {
    return this.hidden.size;
  }
}
