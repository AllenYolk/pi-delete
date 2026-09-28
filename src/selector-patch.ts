import { SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { planCascade } from "./descendants.ts";
import { deleteSessionFiles } from "./delete-sessions.ts";

/** Paired with ctrl+d (delete one) so the cascade reads as its shift variant.
 *  Terminals without the kitty keyboard protocol cannot distinguish the two and
 *  send plain ctrl+d, which falls through to Pi's single delete — fewer files
 *  removed, never more. */
const CASCADE_KEY = "shift+ctrl+d";
const INSTALLED = Symbol.for("pi-delete.selectorCascade");

/** Instance members this patch drives. They are internals of an exported class,
 *  not a public contract, so every one is verified before the patch takes over a
 *  keystroke; a mismatch falls back to native behavior instead of half-working. */
const REQUIRED_FIELDS = ["sessionList", "header", "requestRender", "scope"] as const;

interface Selector {
  mode?: string;
  scope: "current" | "all";
  currentSessions: { path: string }[] | null;
  allSessions: { path: string }[] | null;
  header: { setStatusMessage(msg: { type: string; message: string } | null, ms?: number): void };
  requestRender(): void;
  refreshSessionsAfterMutation?(): Promise<void>;
  sessionList: {
    getSelectedSessionPath(): string | undefined;
    isCurrentSessionPath(path: string): boolean;
    setSessions(sessions: unknown[], showCwd: boolean): void;
  };
}

function usable(target: unknown): target is Selector {
  const s = target as Record<string, unknown> | null;
  if (!s) return false;
  for (const field of REQUIRED_FIELDS) if (s[field] === undefined || s[field] === null) return false;
  const list = s.sessionList as Record<string, unknown>;
  return (
    typeof s.requestRender === "function" &&
    typeof (s.header as Record<string, unknown>).setStatusMessage === "function" &&
    typeof list.getSelectedSessionPath === "function" &&
    typeof list.isCurrentSessionPath === "function" &&
    typeof list.setSessions === "function"
  );
}

function label(path: string, sessions: { path: string; name?: string; firstMessage?: string }[]): string {
  const session = sessions.find((s) => s.path === path);
  const text = session?.name ?? session?.firstMessage ?? "session";
  return text.replace(/\s+/g, " ").slice(0, 24);
}

async function runCascade(selector: Selector, targets: string[], sessions: { path: string }[]): Promise<void> {
  const failures = await deleteSessionFiles(targets);
  const failed = new Set(failures.map((f) => f.path));
  const gone = new Set(targets.filter((p) => !failed.has(p)));

  const drop = <T extends { path: string }>(list: T[] | null) =>
    list ? list.filter((s) => !gone.has(s.path)) : list;
  selector.currentSessions = drop(selector.currentSessions);
  selector.allSessions = drop(selector.allSessions);

  const showCwd = selector.scope === "all";
  const remaining = (showCwd ? selector.allSessions : selector.currentSessions) ?? [];
  selector.sessionList.setSessions(remaining, showCwd);

  const message = failures.length
    ? `Deleted ${gone.size}, failed ${failures.length}: ${failures[0]?.error.slice(0, 60)}`
    : `Deleted ${gone.size} session${gone.size === 1 ? "" : "s"}`;
  selector.header.setStatusMessage({ type: failures.length ? "error" : "info", message }, 4000);

  await selector.refreshSessionsAfterMutation?.();
  selector.requestRender();
  void sessions;
}

/**
 * Add cascade delete to Pi's session picker. Returns a disposer, or undefined
 * when the host does not match what this patch expects.
 */
export function installSelectorCascade(report: (message: string) => void): (() => void) | undefined {
  const proto = SessionSelectorComponent?.prototype as unknown as
    | Record<string | symbol, unknown>
    | undefined;
  if (typeof proto?.handleInput !== "function") {
    report("session picker does not expose handleInput; cascade delete disabled");
    return undefined;
  }
  if (proto[INSTALLED]) return undefined;

  const original = proto.handleInput as (this: unknown, data: unknown) => unknown;
  // One pending confirmation per selector instance; never keeps a selector alive.
  const pending = new WeakMap<object, string>();
  let reportedMismatch = false;

  proto[INSTALLED] = true;
  proto.handleInput = function (this: Record<string, unknown>, data: unknown) {
    if (this.mode === "rename" || !matchesKey(data as never, CASCADE_KEY as never)) {
      // Any other key abandons a half-finished confirmation.
      pending.delete(this);
      return original.call(this, data);
    }
    if (!usable(this)) {
      if (!reportedMismatch) {
        reportedMismatch = true;
        report("session picker internals changed; cascade delete disabled");
      }
      return original.call(this, data);
    }

    const selector = this as unknown as Selector;
    const selected = selector.sessionList.getSelectedSessionPath();
    if (!selected) return undefined;

    const pool = (selector.scope === "all" ? selector.allSessions : selector.currentSessions) ?? [];
    const plan = planCascade(pool as never, selected, (path) =>
      selector.sessionList.isCurrentSessionPath(path),
    );
    if (plan.blocked) {
      selector.header.setStatusMessage(
        { type: "error", message: "Cannot delete the currently active session" },
        3000,
      );
      selector.requestRender();
      return undefined;
    }

    if (pending.get(this) === selected) {
      pending.delete(this);
      void runCascade(selector, plan.targets, pool);
      return undefined;
    }

    pending.set(this, selected);
    // The picker already highlights the row and draws its subtree, so the
    // prompt only has to say how far the delete reaches; the header truncates
    // to one line.
    const extra = plan.targets.length - 1;
    const tail = extra ? `+ ${extra} descendant${extra === 1 ? "" : "s"}` : "(no descendants)";
    const kept = plan.skipped ? " (active session kept)" : "";
    selector.header.setStatusMessage(
      {
        type: "error",
        message: `Delete "${label(selected, pool as never)}" ${tail}?${kept} ${CASCADE_KEY} confirms`,
      },
      8000,
    );
    selector.requestRender();
    return undefined;
  };

  return () => {
    proto.handleInput = original;
    delete proto[INSTALLED];
  };
}
