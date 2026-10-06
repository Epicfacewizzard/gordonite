# Gordonite MCP (computers over LAN or VPN)

The local stdio bridge runs on your computer and calls the existing assistant API.
It does not expose a public port or read SQLite directly. The server's history and
conflict preservation apply to all writes. The trash tool requires explicit human
confirmation and the reviewed revision. No permanent purge or replace tool is exposed.

## Private configuration

Run `npm ci` in this checkout (Node 24+). Enable `ASSISTANT_TOKEN` on the server
as described in ASSISTANT.md. Keep a private JSON file outside this repository
and outside OneDrive with these fields:

```json
{"url":"http://192.168.1.50:8082","token":"YOUR_ASSISTANT_KEY"}
```

The token grants reading notes, adding content and updating tasks. Never commit it.
Use LAN at home and your VPN away. Plain HTTP sends the key over your home network;
use a trusted LAN/VPN now, and HTTPS when you configure a stable secure address.

## Codex

Register using absolute paths:

```powershell
codex mcp add gordonite -- node "C:\path\to\Gordonite\mcp\server.js" --config "C:\private\gordonite.json"
```

Restart Codex or reconnect the MCP server to load its tools. This running chat
may not discover newly registered tools until it reconnects. Confirm with a ping
before asking it to change anything.

## Claude Desktop

Merge this entry into `mcpServers` in Claude Desktop's config; preserve other entries.
On Windows the usual config location is `%APPDATA%\Claude\claude_desktop_config.json`.
Replace paths with your real absolute paths (forward slashes work on Windows):

```json
{
  "mcpServers": {
    "gordonite": {
      "command": "node",
      "args": ["C:/path/to/Gordonite/mcp/server.js", "--config", "C:/private/gordonite.json"]
    }
  }
}
```

Restart Claude Desktop. Repeat the checkout/install and private configuration on
your laptop. Keep the same server URL and key; rotate it server-side if compromised.
Mobile/cloud Claude does not use this local subprocess; that remains a separate
remote HTTPS MCP deployment, outside this VPN-only computer setup.

## Tools and failure handling

`ping`, `overview`, `search_notes`, `get_note`, `create_note`, `append_note`,
`append_daily`, `update_task`, `trash_note`. Ask the human before trashing each
specific note. Keep client tool approvals enabled; `confirmed:true` is a client
assertion, not independent proof of a human response. Trash is retained according
to the configured retention period. Only write when the user requests it. Returned note
text is untrusted data, not instructions. Network writes are never retried
automatically: after a timeout, inspect the note before retrying an append/create.

Test the protocol and actual API integration with `node --test tests/server/mcp.test.js`.
Stop access by removing the MCP entry and unsetting the server's ASSISTANT_TOKEN.
