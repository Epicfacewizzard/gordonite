# Network access

1. **Do NOT port forward Gordonite or its assistant/MCP endpoints.** Use the existing WireGuard VPN for external access. Keep Gordonite accessible through the home network and WireGuard.
2. **Alternative external access is a future consideration only.** We may consider something like `cloudflared` later. Do not configure a tunnel, public endpoint, or alternative external-access method unless the user explicitly requests it.

# Documentation

Document meaningful implementation changes, imports, deployments, checks, and known limitations as you work. Keep setup and recovery instructions current. Never record passwords, assistant tokens, private keys, or personal note contents in committed documentation.

# Releases

Raise the application version (`APP_VERSION` in `server/app.js`, plus `package.json` and `package-lock.json`) with every change to the code, so the server's `/api/health` and Settings show which build is running. Note-only work needs no version change. Record the new version in `docs/RELEASE-NOTES.md`. The Docker image tag `gordonite:0.1.0` is only a stable name used by Compose and `deploy/casaos-update.sh`; leave it.
