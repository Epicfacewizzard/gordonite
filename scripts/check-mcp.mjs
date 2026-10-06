import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({name:'gordonite-check',version:'1'});
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:[process.cwd()+'/mcp/server.js','--config',process.env.LOCALAPPDATA+'/Gordonite/mcp.json'],stderr:'pipe'}));
 console.log('Tools:',(await client.listTools()).tools.map(t=>t.name).join(', '));
 const r=await client.callTool({name:'ping',arguments:{}});
 console.log('Ping:', JSON.stringify(r));
} finally {await client.close();}
