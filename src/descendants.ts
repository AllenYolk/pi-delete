import { realpathSync } from "node:fs";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

export interface DescendantEntry {
  session: SessionInfo;
  /** 1 for direct children, 2 for grandchildren, and so on. */
  depth: number;
}

/**
 * Resolve to the canonical (real) path, falling back to the raw value when the
 * target does not exist. Mirrors the host's own path canonicalization so
 * parent/child links compare equal across symlinks.
 */
export function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Collect every descendant of `rootPath`, depth-first. Cycles in
 * `parentSessionPath` terminate instead of recursing forever.
 */
export function collectDescendants(sessions: SessionInfo[], rootPath: string): DescendantEntry[] {
  const childrenByParent = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentSessionPath) continue;
    const parent = canonicalize(session.parentSessionPath);
    const siblings = childrenByParent.get(parent);
    if (siblings) siblings.push(session);
    else childrenByParent.set(parent, [session]);
  }

  const root = canonicalize(rootPath);
  const visited = new Set<string>([root]);
  const found: DescendantEntry[] = [];

  const walk = (parent: string, depth: number): void => {
    for (const session of childrenByParent.get(parent) ?? []) {
      const path = canonicalize(session.path);
      if (visited.has(path)) continue;
      visited.add(path);
      found.push({ session, depth });
      walk(path, depth + 1);
    }
  };
  walk(root, 1);

  return found;
}
