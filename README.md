# @allenyolk/pi-delete

`/delete` removes the current Pi session and exits, the way codex CLI's `/delete` does. Sessions that were forked or spawned from it can go with it.

```text
 Delete session and exit?

 → Delete current session
   Cancel
```

When the session has descendants, the prompt grows a cascade option and the list of what it would take:

```text
 Delete session and exit?

 Cascade also removes:
   subagent B · 2 msgs
   subagent A · 2 msgs
     nested subagent under A · 2 msgs

 → Delete current session
   Delete current + 3 descendants
   Cancel
```

One prompt, no second confirmation. The listing sits above the choices because a count alone hides *which* sessions would go; once that is visible, asking twice adds nothing. The safe option is highlighted, and the cascade takes a deliberate move down to reach.

The cascade is what this exists for: a run that spawns five subagents leaves five session files behind, and deleting them one at a time through the picker is the tedium worth removing.

Sessions are identified by name or opening message, the way Pi's own picker does it, and indented by depth. A session you have named shows as `[named] <name>`, so deliberate work stands out. Pi cannot tell a subagent session apart from one you forked by hand — both record the same `parentSession` link — so read the list rather than trusting the count.

## Not the same as `pi-delete`

There is an unscoped [`pi-delete`](https://github.com/leeskies/pi-delete) by another author. Both register `/delete`; do not install both.

|  | `@allenyolk/pi-delete` (this) | `pi-delete` (leeskies) |
| --- | --- | --- |
| Delete current session | exits Pi | starts a fresh session |
| Cascade to descendants | yes | no |
| Delete another session by ID | no | yes, plus `pi --delete <id>` |
| No trash command available | falls back to permanent delete | refuses to delete |

Pick theirs for targeting sessions by ID from the CLI. Pick this one for the codex-style quit-and-delete, or to clear a subagent tree in one confirmation.

## Install

```sh
pi install npm:@allenyolk/pi-delete
```

Or from a checkout, without installing:

```sh
pi -e ./src/index.ts
```

## Behavior

Deletion happens during Pi's shutdown, after the session file's last write, so nothing recreates it on the way out. Files go to the `trash` CLI when it exists and are unlinked otherwise. A file that resists both is reported to stderr after exit; the remaining files are still deleted.

Cascade covers the whole descendant subtree at any depth, but only within the current project's session directory. A session forked into a different project keeps its own files — that separation is deliberate, so a cascade never reaches across projects.

Deleting only the current session leaves its children pointing at a file that is gone. Pi's session picker treats them as roots, which is the intended result.

`/delete` reports and does nothing for an ephemeral session (`--no-session`) or outside interactive mode.

## Scope

Pi's `/resume` picker deletes one session with `ctrl+d`. A cascade shortcut there is not possible from an extension: the picker consumes its own keys and exposes no hook, and extension shortcuts only reach the editor. Cascading from inside the picker needs a change to Pi itself.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

Tests cover descendant collection (including cycles in `parentSessionPath`) and the trash/unlink/report path.

`npm run sandbox` builds a throwaway profile with a four-session tree and prints the command to open Pi against it, so the interactive flow can be exercised without touching real sessions. The flow was verified this way against Pi 0.87.1: cascade delete, current-only delete, cancel, a leaf session with no cascade option, and an ephemeral session.

## License

MIT, copyright AllenYolk.
