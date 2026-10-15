# Deployment

The app is one container: a Node 24 process serving the API and the built web client, with one data
folder (`/data`) holding the SQLite database and the automatic backups.

The Dockerfile was built on the owner's CasaOS server on 2026-10-06. That installation uses
port **8082**, image `gordonite:0.1.0`, and `/DATA/AppData/gordonite/data` for persistent storage.
The generic examples below use different names and port 8080; retain the existing configuration
when updating an installed app. See [the deployment record](DEPLOYMENT-2026-10-06.md) for the
owner's exact paths, checks, and rollback procedure.

## 1. Plain Docker Compose

On the server (SSH):

```bash
git clone <this repo> personal-hq && cd personal-hq
mkdir -p data && sudo chown 1000:1000 data          # the container runs as uid 1000
docker compose up -d --build
docker compose logs -f                              # expect: "Personal HQ 0.1.0 listening on http://0.0.0.0:8080"
```

Open `http://<server-ip>:8080`. Edit `docker-compose.yml` for `HOME_TZ` and the backup/trash settings
(listed in the README), then `docker compose up -d` again. Upgrading is `git pull && docker compose up -d --build`;
the database lives in `./data`, outside the container, and is migrated automatically on start (it refuses
to open a database from a *newer* version rather than damage it).

## 2. CasaOS

CasaOS runs ordinary Docker containers, so the data folder is just a host path.

1. SSH to the server and build the image (CasaOS imports images, it does not build them):

   ```bash
   git clone <this repo> personal-hq && cd personal-hq
   docker build -t personal-hq:0.1.0 .
   sudo mkdir -p /DATA/AppData/personal-hq/data
   sudo chown -R 1000:1000 /DATA/AppData/personal-hq
   ```

2. CasaOS web UI → **App Store → Custom Install → Import**, paste [`deploy/casaos-compose.yml`](../deploy/casaos-compose.yml),
   adjust `HOME_TZ` if needed, install.
3. The app appears on the dashboard; the web UI is on port 8080.

The metadata block (`x-casaos`) follows CasaOS's compose extension but was not verified against your CasaOS
version; if the import dialog complains, delete the `x-casaos` sections and install without them. They
only add the icon/title.

### Permissions

The container runs as uid/gid 1000, not root. If the data folder is owned by someone else the app stops at
startup with `Cannot write to /data ...`. Fix with `sudo chown -R 1000:1000 <data folder>`, or change the
`user:` line to the owner of the folder.

### Updating on CasaOS

```bash
cd personal-hq && git pull && docker build -t personal-hq:0.1.0 .
```

then recreate the app container using the same CasaOS settings and data-folder mount. A plain restart
(`docker restart personal-hq`) keeps the old image and does not apply the rebuild. If you manage this
installation with Compose, run `docker compose -f deploy/casaos-compose.yml up -d --force-recreate`
after building instead. Keep the existing data-folder mount. Take a manual backup first
(Data & backups → Back up now). Before an update that changes the database or the files, also keep a **bundle**
(Data & backups → Download everything, or `docker exec gordonite node server/cli.js bundle`): it holds the files too,
which the database backup does not, and `verify-bundle` checks it on its own.

## First-run checks

1. `docker logs personal-hq` shows the listening line and, within a few seconds, `[backup] hq-auto-… verified`
   (the first automatic backup).
2. Open the app, write a line in `daily-jots`, wait for **Saved on server**.
3. `docker restart personal-hq`, reload: the note is still there. (Data survives restarts.)
4. `docker rm -f personal-hq` and recreate it from the same compose file: the note is still there.
   (Data survives container replacement, because it is in the host folder.)
5. `ls <data folder>/backups` contains a backup file.

## HTTPS and a stable address

**Why this matters for this app:** it works over plain `http://` through your VPN (the VPN already
encrypts the traffic), but the browser keeps the phone-side store of unsent edits *per address*. If the
address changes (IP, hostname, `http` vs `https`), edits that were waiting under the old address are not
visible under the new one. So choose one stable name once, ideally with HTTPS, and always use it. HTTPS
also lets Chrome treat the storage as persistent, which makes eviction less likely.

First, make the address itself stable: reserve the server's IP in your router (DHCP reservation) and use a
name, not the IP.

Pick whichever matches your VPN:

### A. Tailscale (simplest if your VPN is Tailscale)

Enable *MagicDNS* and *HTTPS Certificates* in the Tailscale admin console, then on the server:

```bash
sudo tailscale serve --bg 8080
tailscale serve status        # shows https://<machine>.<tailnet>.ts.net  -> proxy to 127.0.0.1:8080
```

That name and its real certificate are stable and only reachable inside your tailnet. Use it as the
address on the phone. (Command syntax varies a little between Tailscale versions; `tailscale serve --help`.)

### B. Your own domain + reverse proxy (works with any VPN, including plain WireGuard)

Use a name such as `notes.yourdomain.com`, a DNS record pointing at the server's *private* (LAN/VPN) IP
(public DNS may point at a private address), and a certificate obtained by **DNS challenge**, so nothing
has to be reachable from the internet.

* In CasaOS the easiest proxy is the **Nginx Proxy Manager** app: add a proxy host for
  `notes.yourdomain.com` → `http://<server-ip>:8080`, leave *Block Common Exploits* off (its URL filters
  can reject ordinary note searches), and on the SSL tab request a Let's Encrypt certificate using
  *DNS Challenge* with your DNS provider's API token.
* Or Caddy: see [`deploy/Caddyfile.example`](../deploy/Caddyfile.example).

Keep the app's own port (8080) off your router's port forwards. Access it only through the VPN.

### B1. Free DuckDNS name (option B without buying a domain)

Chosen by the owner on 2026-10-14 as the first try; it can be replaced by a bought domain later (see
"Changing the address later" below). DuckDNS gives a free name such as `<name>.duckdns.org`. The name points at
the server's **private** LAN address, so it only leads anywhere from the home network or through WireGuard. The
certificate comes from Let's Encrypt by DNS challenge: Let's Encrypt reads a TXT record at DuckDNS and never
connects to the server. No port forward, no tunnel.

What becomes public: the name itself (every certificate is listed in public Certificate Transparency logs) and the
private address `192.168.1.50` it resolves to. Your home's public IP is not involved.

1. **DuckDNS (done by the owner, in a browser).** Sign in at duckdns.org, add a subdomain, and in its *current
   ip* field enter the server's LAN address `192.168.1.50`, then *update ip*. Keep the account token private; it
   is needed once, in step 3, and must never go into this repository.
   **Do not install a DuckDNS updater** (container, CasaOS app, or router setting). Updaters write your public IP
   into the record, which is the opposite of what is wanted here.
2. **Check the name resolves.** On the laptop: `nslookup <name>.duckdns.org` → `192.168.1.50`. If the answer is
   blank on the home network but correct on mobile data, the router's DNS-rebinding protection is dropping
   private answers; add an exception for `<name>.duckdns.org` in the router's DNS settings.
3. **Reverse proxy: Nginx Proxy Manager from the CasaOS app store.** CasaOS's own dashboard normally uses
   port 80, so when installing map the container's port **443 → host 443**, its admin port **81 → host 81**, and
   its port **80 → an unused host port** (e.g. 8880; with a DNS challenge port 80 is not needed). Then in its
   admin page (`http://192.168.1.50:81`):
   * *Certificates → Add Certificate → Let's Encrypt via DNS* (v2.13 wording): domain `<name>.duckdns.org`,
     provider **DuckDNS**, credentials `dns_duckdns_token=<your token>`, propagation seconds `120`.
     (Request the single name only: DuckDNS holds one TXT record at a time, so a name plus a wildcard in one
     request fails.)
   * *Hosts → Proxy Hosts → Add*: domain `<name>.duckdns.org`, forward to `http` `192.168.1.50` port `8082`.
     On the SSL tab choose the certificate from the step above and turn on *Force SSL* and *HTTP/2*. Leave HSTS
     off while the address may still change.
   * Leave caching and *Block Common Exploits* off and set no short timeouts (see "Reverse proxy settings" below).
   Renewal is automatic.
4. **Check.** With the phone on WireGuard (or home Wi-Fi), open `https://<name>.duckdns.org`: a padlock, no
   warning, and Settings shows the same version as `http://192.168.1.50:8082`. With WireGuard off on mobile data,
   the page must **not** load; that confirms nothing is exposed.
5. **Move to the new address** as described in "Changing the address later".

**Done on 2026-10-15** as `gordonite.duckdns.org` with Nginx Proxy Manager v2.13.5 on the CasaOS server
(certificate valid to 2027-01-12, renewed automatically). From the laptop on the home network,
`https://gordonite.duckdns.org/api/health` answered `{"ok":true,"version":"0.6.0"}`. On the phone the notes load
over WireGuard, and with WireGuard off on mobile data the name does not load. (Current Chrome on Android shows a
"tune" icon instead of a padlock; tap it for "Connection is secure".) The installed home-screen app and the
assistant/MCP config still use `http://192.168.1.50:8082` until moved.

Nothing on the router's port forwards changes. Port 8082 keeps working on the LAN, so the old address stays
usable while you switch.

**Weak spot:** if DuckDNS's own DNS has an outage, the name stops resolving even though the server is fine. Use
`http://192.168.1.50:8082` meanwhile (its unsent edits are kept separately, see below).

### Changing the address later

The server side is a new proxy host and certificate, and both names can run side by side. On the phone each
address is a separate app with its own store of unsent edits, so:

1. Open Gordonite at the **old** address and wait until the badge says everything is saved on the server.
2. Open the **new** address and install it (*Add to Home screen* / *Install app*).
3. Remove the old home-screen icon.
4. Update anything else that holds the address, e.g. the `url` in the assistant/MCP config ([MCP.md](MCP.md)).

### C. Local CA (no domain)

Caddy's `tls internal` (see the example file) creates a private certificate authority. HTTPS then works
once you install that root certificate on the phone (Android: *Settings → Security → Encryption &
credentials → Install a certificate → CA certificate*). More fiddly than A or B; fine if you don't want a domain.

### D. Plain HTTP over the VPN

Works; use a fixed name or IP and never change it. Chrome shows "Not secure"; storage persistence is not
requested successfully; "Add to Home screen" creates a plain shortcut.

### Authentication

There is none, by design: the VPN is the gate. If you want a second layer, enable HTTP basic auth in
Nginx Proxy Manager / Caddy in front of the app.

### Reverse proxy settings

Nothing special: it is plain request/response HTTP. Do not enable response caching for `/api/`.
Allow request bodies up to what you will import or upload (the app itself accepts 100 MB by default, for imports
and for a single attached file). A file can take minutes over a slow link, so do not set a short proxy timeout.

### Files

Photos, PDFs and other attached files are stored in `<data folder>/files` (or `FILES_DIR`). Keep it on the same
mounted volume as the database so it survives container replacement, and back it up with the database: **the
SQLite backups do not contain the files** (see [ATTACHMENTS.md](ATTACHMENTS.md#backups)). The image installs one
small runtime dependency (`heic-convert`, about 10 MB) to turn iPhone HEIC photos into JPEG; the build needs
network access for that once. Schema v6 is applied automatically on first start. To go back to an app version
before files existed, restore the database backup taken before the update (an older app refuses a newer schema).

## Backups on the server

Backups are written to `<data folder>/backups` (or `BACKUP_DIR`). To keep them on a different disk, mount
another folder at `/backups` and set `BACKUP_DIR=/backups`. How to copy them off the machine and how to
restore: [BACKUPS.md](BACKUPS.md). Bundles (the database and every stored file in one verified zip, written by
`node server/cli.js bundle`) go in `<backups>/bundles/`; the files themselves stay in `FILES_DIR`, which may be a
different folder from the database.

## Selected Obsidian notes

Run `node scripts/import-vault.js <vault-path> http://192.168.1.50:8082` to prepare a transfer; add `--apply` to merge it. The selected folders are 00 Inbox, 05 People, 10 School and 20 CSS. Hidden folders, agent instructions and symlinks are excluded. Stable IDs prevent duplicates. Existing notes are kept; differing source content is preserved as an import version. The server makes a verified pre-import backup, and the script keeps a server export and source Markdown in ignored data/vault-transfer-* locally. Unsupported Markdown is preserved as readable plain text where possible; this is not a complete Obsidian migration. Copy backups outside the home server as described in BACKUPS.md. Private vault contents must never be committed to Git.

## Updating the running CasaOS install (one command)

From a normal PowerShell window on a computer on the home network or VPN, in the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-casaos.ps1
```

Add `-DryRun` to build the release archive and stop before touching the server. The script refuses to run with
uncommitted changes (the release is the last commit), runs the unit tests, copies a `git archive` of that commit and
`deploy/casaos-update.sh` to `/home/gordon/gordonite/releases/` over SSH (server password: copy, log in, sudo), and
the server script then: verifies the archive hash, takes a verified backup through the app, tags the running image
`gordonite:rollback-before-<commit>`, builds `gordonite:<commit>`, retags it `gordonite:0.1.0`, recreates the existing
Compose service without changing its settings, and checks health, the new mood route, the logo and that the
assistant key is still set. Nothing secret is stored or printed. See `DEPLOYMENT-2026-10-06.md` for the manual steps
it automates and for rollback. A database upgrade (like schema v5) cannot be undone by the old image: restore the
backup taken at the start as well.

### Updating from the server's own terminal (nothing to copy)

If you are logged in to the server (SSH or the CasaOS terminal), the repository is public, so the server can fetch the
code itself. Type this one line (it is the same update, run from a fresh clone of GitHub's latest `main`):

```bash
cd ~/gordonite/releases && rm -rf boot && git clone -q https://github.com/Epicfacewizzard/gordonite.git boot && bash boot/deploy/casaos-update.sh
```

It asks for the sudo password once and prints numbered steps (`== 1/7 ...`), so a failure shows which step it was.
