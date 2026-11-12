#!/usr/bin/env node
// One-command dev: start the server and the web app together, label their output, and print
// the URLs once both are ready (the Vite banner is easy to lose between server log lines).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

const COLORS = { server: '\u001b[36m', web: '\u001b[35m', reset: '\u001b[0m', bold: '\u001b[1m' };

const found = { api: null, web: null };
const children = [];
let stopping = false;

function printSummary() {
  if (!found.api || !found.web) return;
  const line = '─'.repeat(52);
  console.log(`\n${COLORS.bold}${line}`);
  console.log(`  界面（浏览器打开这个）  ${found.web}`);
  console.log(`  API（服务端）          ${found.api}`);
  console.log(`${line}${COLORS.reset}\n`);
}

function start(name, args) {
  const child = spawn('pnpm', args, { stdio: ['inherit', 'pipe', 'pipe'] });
  children.push(child);

  const forward = (stream) =>
    createInterface({ input: stream }).on('line', (line) => {
      // After Ctrl+C, pnpm prints an error for the children we just stopped; it is just noise.
      if (stopping) return;
      console.log(`${COLORS[name]}[${name}]${COLORS.reset} ${line}`);
      const plain = stripVTControlCharacters(line);
      if (name === 'web') {
        const url = plain.match(/Local:\s+(\S+)/)?.[1];
        if (url && !found.web) {
          found.web = url;
          printSummary();
        }
      } else {
        const url = plain.match(/listening on (\S+)/)?.[1];
        if (url && !found.api) {
          found.api = url;
          printSummary();
        }
      }
    });
  forward(child.stdout);
  forward(child.stderr);

  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(
      `${COLORS[name]}[${name}]${COLORS.reset} 已退出（${signal ?? `code ${code}`}），正在停止另一个进程`,
    );
    stop(code ?? 1);
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('server', ['--filter', '@orbit/server', 'dev']);
start('web', ['--filter', '@orbit/web', 'dev']);
