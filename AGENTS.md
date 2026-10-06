# Network access

1. **Do NOT port forward Gordonite or its assistant/MCP endpoints.** Use the existing WireGuard VPN for external access. Keep Gordonite accessible through the home network and WireGuard.
2. **Alternative external access is a future consideration only.** We may consider something like `cloudflared` later. Do not configure a tunnel, public endpoint, or alternative external-access method unless the user explicitly requests it.

# Documentation

Document meaningful implementation changes, imports, deployments, checks, and known limitations as you work. Keep setup and recovery instructions current. Never record passwords, assistant tokens, private keys, or personal note contents in committed documentation.
