# Remote builds: Windows, Linux, and other Macs

[← README](../README.md)

Your Mac can be the build worker for other machines. A small Node CLI sends authenticated jobs to the Mac's dashboard; Windows and Linux don't need Xcode, Bash, Apple credentials or EAS. The Mac keeps its signing credentials and runs **local** EAS builds. Remote jobs, source commits, requester names, logs and artifacts appear in the dashboard with the rest.

Install the client from npm (Node 22+):

```sh
npm install -g @fav-devs/macbuild
```

It runs no install scripts. On the Mac itself, keep using `install.sh`.

## Connect once and link folders

For a trusted personal laptop or server, pair the device once. On the Mac:

```sh
macbuild server device create --name my-laptop
```

This credential stays valid until revoked. It grants development builds of all projects registered on this Mac, including projects registered later; it does not grant OTA or store releases. Use `--projects parley,less` to restrict a device, or `--expires-days 30` for an expiry. Existing scoped CI tokens retain their original expiry and permissions. View connections in **Settings → Connected devices**, including access, last activity, expiry, and revocation. Last activity does not indicate that a device is online. You can also list trusted devices with `macbuild server device list` and revoke one with `macbuild server device revoke ID`.

Transfer the credential privately, then connect on the client using stdin (never a token argument):

```sh
macbuild connect home-mac https://your-mac.ts.net:8443 --token-stdin < private-token-file
macbuild list
cd /path/to/local/parley
macbuild link parley
macbuild
```

Delete the temporary credential file after connecting. For another app, enter its local folder and run `macbuild link APP_NAME`; no credential replacement is needed. `macbuild link PROJECT /path/to/folder --remote MAC_NAME` also works. The Mac must run a version supporting folder links. The local and Mac project Git origins must match.

Connections and folder links are saved privately on the client, outside your repositories. Links apply inside their folder and subfolders; the closest link wins. They select both the Mac and its registered project. `macbuild` or `macbuild build` then builds the linked project; `macbuild dev` opens that project's Mac dev server when the device has the `dev` scope. Use `macbuild links` to inspect links, `macbuild unlink` in the linked root to remove one, and `macbuild remote remove NAME` to remove a connection and its links. An explicit `--remote` overrides the linked Mac; supply a project name when choosing a different Mac.

Folder linking selects a project; builds still use matching, pushed Git commits, and dev servers still serve the Mac's working copy. It does not synchronize uncommitted files. Native compilation runs on the Mac.

## Connect a scoped CI client

1. On the Mac, complete the normal `macbuild setup --ui`, Expo login, signing setup, and project registration. Verify a local build works first. The dashboard must be reachable from the client over HTTPS, normally through Tailscale.
2. On the Mac, create a separately revocable token for each client. Start with development builds only:

   ```sh
   macbuild server token create --name windows-agent \
     --projects parley,less --profiles development --scopes read,build,cancel
   ```

   Add `dev` to the scopes to let the client start, stop and press keys in the Mac's dev servers. `read` alone lets it follow their logs.

   This prints a token **once**. Treat it as a password, transfer it privately, and never put it in chat, Git, or an agent prompt. The Mac stores only its hash. Tokens expire after 90 days by default (`--expires-days 1` through `365`). Administer them locally with `macbuild server token list` and `macbuild server token revoke ID`; revocation does not stop jobs already launched.
3. On Windows, put only the token value in a temporary private file, then run PowerShell:

   ```powershell
   Get-Content -Raw .\macbuild-token.txt | macbuild remote add home-mac https://your-mac.ts.net:8443 --token-stdin
   Remove-Item .\macbuild-token.txt
   macbuild doctor
   macbuild list
   ```

   Restrict the client config (`~/.config/macbuild/remotes.json`) to your Windows account using NTFS ACLs. On Unix it is written with mode `0600`. If PowerShell blocks npm's script shim, invoke `macbuild.cmd` instead. Use `macbuild remote list`, `remote use NAME`, or `remote remove NAME` to manage connections. `--remote NAME` overrides the default and `--local` explicitly selects the Mac worker. A failed remote connection **never** falls back to running locally.

For CI, inject `MACBUILD_SERVER_URL` and secret `MACBUILD_TOKEN` instead of storing a client config. Connections require valid HTTPS certificates; there is no insecure-TLS option. Plain HTTP is accepted only for loopback testing.

## Source and release gates

Run from the app's local Git checkout on the client:

```sh
macbuild source
macbuild commits parley --ref main
git add src/the-file-you-changed.ts
git commit -m "Fix keyboard layout"
macbuild push --confirm-push
macbuild parley --profile development --wait --json
```

- **No automatic staging, committing, or pushing.** `push --confirm-push` pushes the clean current branch without force; rejected or divergent pushes remain rejected. Use Git for commit selection and history review.
- By default, dirty files, unpushed HEAD commits, and a local HEAD that differs from origin block a job. `--ref main --allow-dirty` intentionally builds only that pushed source, excluding local changes. Detached HEAD needs an explicit `--ref`.
- Client and server origins must identify the same HTTPS/SSH repository. The server fetches origin, verifies the exact commit is reachable from an origin branch, and rejects a moved branch. It always queues the pinned SHA, never the Mac's dirty working copy. No source ZIPs, arbitrary shell commands, or remote project-path registration are accepted.
- Tokens have explicit project, profile, and action allowlists. Scopes are `read`, `build`, `update`, `submit`, `cancel`, and `dev` (start, stop and press keys in the Mac's dev servers). Use `read` alongside mutation scopes for monitoring. Trusted devices can allow all registered projects; scoped CI tokens require explicit project allowlists. Profile permissions remain explicit.
- To require GitHub CI, add `--required-checks "tests,typecheck"` when issuing a token. The Mac's authenticated `gh` must be able to read check runs/statuses. Each named check must succeed for the exact SHA. Missing, pending, failed, or unreadable checks block queueing. This checks reported results, not branch-protection or workflow-author trust; configure those in GitHub as well.
- OTA/store releases additionally require `--confirm-release` and the relevant token scope. For example, issue a separate release token with `--profiles production --scopes read,build,update,submit`. macbuild never requests an Apple password from the remote client; first-time credentials and unexpected signing prompts must be resolved on the Mac.

```sh
macbuild update parley --profile production --channel production \
  --environment production --platform ios --ref main \
  --message "Fix keyboard suggestions" --confirm-release
macbuild submit BUILD_ID --confirm-release
macbuild builds parley
macbuild show BUILD_ID
macbuild log BUILD_ID --tail 100
macbuild wait BUILD_ID --follow --timeout 1800
macbuild download BUILD_ID --output ./app.ipa
macbuild cancel BUILD_ID
```

Remote job commands return JSON and queue without waiting unless `--wait` is passed. `wait` returns exit `0` for success/skipped, `1` for failed/cancelled, or `124` for timeout. Disconnecting or reaching a wait timeout does not cancel the Mac job. Downloading never overwrites an existing file. Store submission can reuse a retained artifact built from pushed source; no rebuild is needed. Remote OTA and submissions retain the existing separate upload queue.

Creation requests have persisted per-token idempotency keys. To safely retry after losing a response, reuse the reported `--request-id` with identical arguments; a different payload is rejected. A successful retry returns the existing job. Keep job history for the retry period; deleting history removes this record. Mutation attempts by authenticated clients are logged to `~/.config/macbuild/remote-server.json.audit.jsonl`, without raw tokens. Review and rotate this log as needed.

**Network trust:** this is a personal, trusted-tailnet worker, not a public multi-tenant build service. Remote token scopes apply to `/api/remote/v1`; the existing dashboard remains trusted-tailnet access. Anyone allowed to reach the dashboard directly has its existing UI capabilities, independent of token scopes. Use Tailscale ACLs and do not share dashboard access with untrusted users. Authorized repository code executes on the Mac with the worker's account permissions; tokens are not an execution sandbox.

## Remote MCP for agents

Configure the agent on the client with a stdio MCP server after connecting its remote. Set the MCP working directory to the app's checkout:

```json
{
  "mcpServers": {
    "macbuild": {
      "command": "macbuild",
      "args": ["--remote", "home-mac", "mcp"]
    }
  }
}
```

Tools include `projects`, `commits`, `source`, `build`, `update`, `submit`, `builds`, `show`, `log`, `wait`, and `cancel`, plus the [dev server tools](dev-servers.md). Build tools use the client's working directory and the same source gates as the CLI. Release tools require `confirmRelease: true` **and** token permission; agents must obtain the user's release request rather than infer approval. A long `wait` does not block other MCP requests. The existing local `macbuild mcp` remains available with `--local` on the Mac.
