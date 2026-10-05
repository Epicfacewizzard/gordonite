// Development: API server (auto-restart) on :8080 and Vite on :5173 (proxying /api).
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const p = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...(name === 'server' ? { BACKUP_INTERVAL_HOURS: process.env.BACKUP_INTERVAL_HOURS ?? '0' } : {}) } });
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    process.exit(code ?? 1);
  });
  return p;
};
run('server', ['--watch', 'server/index.js']);
run('client', ['node_modules/vite/bin/vite.js', 'client', '--host']);
