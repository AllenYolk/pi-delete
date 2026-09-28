import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import * as Pi from "@earendil-works/pi-coding-agent";
import { collectDescendants, type DescendantEntry } from "./descendants.ts";

/** Delete one file, preferring `trash` so the removal stays recoverable.
 *  Returns an error message when the file survives both attempts. */
export async function deleteSessionFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  const args = path.startsWith("-") ? ["--", path] : [path];
  const trash = spawnSync("trash", args, { encoding: "utf-8" });
  if (trash.status === 0 || !existsSync(path)) return undefined;
  try {
    await unlink(path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** One line per session: indented by depth, identified the way Pi's own picker
 *  does it — by name or opening message, not by UUID filename. */
function describe({ session, depth }: DescendantEntry): string {
  const label = session.name
    ? `[named] ${session.name}`
    : (session.firstMessage || "(empty)").replace(/\s+/g, " ").slice(0, 60);
  return `${"  ".repeat(depth)}${label} · ${session.messageCount} msgs`;
}

export default function sessionDelete(pi: Pi.ExtensionAPI): void {
  let pending: string[] = [];

  pi.on("session_shutdown", async () => {
    const targets = pending;
    pending = [];
    const failures: string[] = [];
    for (const path of targets) {
      const error = await deleteSessionFile(path);
      if (error) failures.push(`  ${path}: ${error}`);
    }
    if (failures.length > 0) {
      console.error(
        `pi-delete: ${failures.length} file(s) could not be deleted:\n${failures.join("\n")}`,
      );
    }
  });

  pi.registerCommand("delete", {
    description: "Delete the current session and exit",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/delete needs an interactive session", "error");
        return;
      }
      const current = ctx.sessionManager.getSessionFile();
      if (!current) {
        ctx.ui.notify("Ephemeral session — nothing on disk to delete", "info");
        return;
      }

      const sessions = await Pi.SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
      const descendants = collectDescendants(sessions, current);

      const deleteCurrent = "Delete current session";
      const deleteTree = `Delete current + ${descendants.length} descendant${descendants.length === 1 ? "" : "s"}`;
      const cancel = "Cancel";
      // The listing rides on the prompt rather than a second confirmation: what
      // the count alone hides is *which* sessions go, and that has to be visible
      // before the choice, not after it.
      const prompt =
        descendants.length > 0
          ? `Delete session and exit?\n\nCascade also removes:\n${descendants.map(describe).join("\n")}`
          : "Delete session and exit?";
      const choice = await ctx.ui.select(
        prompt,
        descendants.length > 0 ? [deleteCurrent, deleteTree, cancel] : [deleteCurrent, cancel],
      );
      if (choice === undefined || choice === cancel) return;

      pending =
        choice === deleteTree
          ? [current, ...descendants.map((d) => d.session.path)]
          : [current];
      ctx.shutdown();
    },
  });
}
