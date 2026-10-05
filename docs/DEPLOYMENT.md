# Deployment

The app is one container: a Node 24 process serving the API and the built web client, with one data
folder (`/data`) holding the SQLite database and the automatic backups.

> The Dockerfile and compose files in this repository were **not built or run** where they were written
> (no Docker was available). The application, its production entry point and static serving were tested
> directly. Treat the first deployment as a test, and check the points in "First-run checks" below.

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

then restart the app from the CasaOS dashboard (or `docker restart personal-hq`; if you changed the tag,
recreate the app). The data folder is untouched. Take a manual backup first (Data & backups → Back up now).

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
  `notes.yourdomain.com` → `http://<server-ip>:8080`, tick *Block Common Exploits* and *Websockets
  Support* (not needed, harmless), and on the SSL tab request a Let's Encrypt certificate using
  *DNS Challenge* with your DNS provider's API token.
* Or Caddy: see [`deploy/Caddyfile.example`](../deploy/Caddyfile.example).

Keep the app's own port (8080) off your router's port forwards. Access it only through the VPN.

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
Allow request bodies up to what you will import (the app itself accepts 100 MB by default).

## Backups on the server

Backups are written to `<data folder>/backups` (or `BACKUP_DIR`). To keep them on a different disk, mount
another folder at `/backups` and set `BACKUP_DIR=/backups`. How to copy them off the machine and how to
restore: [BACKUPS.md](BACKUPS.md).
