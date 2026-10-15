# Status check — 2026-10-11

This checkout is on `work-from-other-session` at `6a5876b`, rather than current main. Its October 6 handover is not a reliable account of later work. An existing local change in `mcp/server.js` was preserved.

The locally cached `origin/main` points to `40d1d8b`. Its release notes record an October 7 CasaOS deployment of `b7553b4`, including the configurable Dashboard and layout, mood tracker, branding/icons, tag dragging, and expanded vault import. The deployment upgraded the database from schema v4 to v5; its documented rollback requires a pre-upgrade database backup as well as the old image. See the release notes on that revision for recovery details.

The owner reports a later 0.4-series release. This has not been independently verified: fetching GitHub failed to connect, the direct local HTTP check was denied by socket permissions, and MCP ping reported that Gordonite was unreachable. The cached main source still reports application version 0.1.0; it must not be taken as proof of the live version.

Before calendar implementation, obtain the latest source and release documentation and verify the running version. No source branch was switched, application code changed, calendar data accessed, or deployment performed during this check. Keep network access on LAN/WireGuard.

## Later connectivity diagnosis

The owner confirmed failures on this Windows computer with WireGuard off. Read-only checks outside the sandbox showed an active Wi-Fi IPv4 address on `192.168.15.0/24`, a responsive gateway at `192.168.15.1`, and a default IPv4 route through that gateway. Google HTTPS succeeded over IPv6 but timed out over IPv4; Discord and Riot HTTPS also timed out over IPv4. The configured IPv6 DNS resolver returned Discord IPv4 addresses, whereas DNS requests to `1.1.1.1` timed out. These observations indicate a failing external IPv4 path, but do not yet distinguish a computer filter from router or ISP trouble. Do not disable working IPv6 based on the attached troubleshooting guide.

The documented Gordonite address is on a different subnet (`192.168.1.50`); no dedicated IPv4 route to that home subnet was present. Restore the existing WireGuard connection for home-server access when away. No adapter, DNS, router, firewall, or VPN settings were changed. The owner reported seeing the previously attempted task in the app; do not retry the append without checking for duplicates.
