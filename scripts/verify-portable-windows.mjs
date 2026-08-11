#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';

const bundleRoot = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  throw new Error('Usage: node scripts/verify-portable-windows.mjs <extracted-bundle-root>');
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Portable runtime verification requires Windows x64 (got ${process.platform}/${process.arch})`);
}

const bundledNode = join(bundleRoot, 'node', 'node.exe');
const cliPath = join(bundleRoot, 'camofox.cmd');
const packageJson = JSON.parse(readFileSync(join(bundleRoot, 'app', 'package.json'), 'utf8'));
const impitNativeBinary = join(
  bundleRoot,
  'app',
  'node_modules',
  'impit-win32-x64-msvc',
  'impit-node.win32-x64-msvc.node',
);
const betterSqliteNativeBinary = join(
  bundleRoot,
  'app',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
const mplLicense = join(bundleRoot, 'licenses', 'MPL-2.0.txt');
const apacheLicense = join(bundleRoot, 'licenses', 'Apache-2.0.txt');

if (!existsSync(bundledNode) || !existsSync(cliPath)) {
  throw new Error('Portable bundle is missing the bundled Node runtime or camofox.cmd launcher');
}
if (!existsSync(impitNativeBinary)) {
  throw new Error('Portable bundle is missing impit-win32-x64-msvc native runtime support');
}
if (!existsSync(betterSqliteNativeBinary)) {
  throw new Error('Portable bundle is missing better-sqlite3 Windows x64 native runtime support');
}
if (!existsSync(mplLicense) || !existsSync(apacheLicense)) {
  throw new Error('Portable bundle is missing required third-party license texts');
}
if (realpathSync.native(process.execPath).toLowerCase() !== realpathSync.native(bundledNode).toLowerCase()) {
  throw new Error(`Verification is not running on bundled Node: ${process.execPath}`);
}

function portableEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase();
    if (normalized === 'path') delete env[key];
    if (normalized === 'camofox_api_key') delete env[key];
    if (normalized === 'camofox_admin_key') delete env[key];
    if (normalized === 'camofox_auth_mode') delete env[key];
  }
  env.Path = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  env.CAMOFOX_AUTH_MODE = 'disabled';
  env.CAMOFOX_HEADLESS = 'true';
  env.CAMOFOX_HOST = '127.0.0.1';
  return { ...env, ...extra };
}

function runCli(args, env, { allowFailure = false } = {}) {
  const commandShell = process.env.ComSpec
    ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const commandLine = `call ${quote(cliPath)} ${args.map(quote).join(' ')}`;
  const result = spawnSync(commandShell, ['/d', '/s', '/c', commandLine], {
    cwd: bundleRoot,
    env,
    encoding: 'utf8',
    timeout: 90_000,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(
      `camofox.cmd ${args.join(' ')} failed: ${result.error?.message ?? `exit ${result.status}`}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error('Unable to allocate a local verification port');
  return port;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitUntilStopped(url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(750) });
    } catch {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Server remained reachable after stop command');
}

const localPagePort = await getFreePort();
const serverPort = await getFreePort();
const localPageServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>Welcome</title></head><body><main><h1>Welcome</h1><p>Ready.</p></main></body></html>');
});
await new Promise((resolvePromise, reject) => {
  localPageServer.once('error', reject);
  localPageServer.listen(localPagePort, '127.0.0.1', resolvePromise);
});

const env = portableEnvironment({ PORT: String(serverPort) });
const baseUrl = `http://127.0.0.1:${serverPort}`;
let daemonStarted = false;

try {
  const requireFromApp = createRequire(join(bundleRoot, 'app', 'package.json'));
  const Database = requireFromApp('better-sqlite3');
  const database = new Database(':memory:');
  database.close();
  requireFromApp('impit');

  const versionResult = runCli(['--version'], env);
  if (versionResult.stdout.trim() !== packageJson.version) {
    throw new Error(`Portable CLI version mismatch: expected ${packageJson.version}, got ${versionResult.stdout.trim()}`);
  }

  runCli(['server', 'start', '--background'], env);
  daemonStarted = true;

  const health = await fetchJson(`${baseUrl}/health`);
  if (health.ok !== true || health.running !== true) {
    throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
  }

  const userId = 'visitor';
  const sessionKey = 'main';
  const created = await fetchJson(`${baseUrl}/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionKey }),
  });
  if (typeof created.tabId !== 'string' || !created.tabId) {
    throw new Error(`Tab creation did not return a tabId: ${JSON.stringify(created)}`);
  }

  const localUrl = `http://127.0.0.1:${localPagePort}/`;
  const navigated = await fetchJson(`${baseUrl}/tabs/${encodeURIComponent(created.tabId)}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, url: localUrl }),
  });
  if (navigated.ok !== true || !String(navigated.url).startsWith(localUrl)) {
    throw new Error(`Navigation did not reach the local page: ${JSON.stringify(navigated)}`);
  }

  const snapshot = await fetchJson(
    `${baseUrl}/tabs/${encodeURIComponent(created.tabId)}/snapshot?userId=${encodeURIComponent(userId)}`,
  );
  if (typeof snapshot.snapshot !== 'string' || snapshot.snapshot.length === 0) {
    throw new Error(`Snapshot payload was empty: ${JSON.stringify(snapshot)}`);
  }

  const closed = await fetchJson(`${baseUrl}/tabs/${encodeURIComponent(created.tabId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (closed.ok !== true) throw new Error(`Tab close failed: ${JSON.stringify(closed)}`);

  runCli(['server', 'stop'], env);
  daemonStarted = false;
  await waitUntilStopped(`${baseUrl}/health`);

  const portableStateDir = join(bundleRoot, 'data', 'home', '.camofox');
  const camoufoxExe = join(
    bundleRoot,
    'data',
    'home',
    'AppData',
    'Local',
    'camoufox',
    'camoufox',
    'Cache',
    'camoufox.exe',
  );
  if (!existsSync(portableStateDir) || !existsSync(camoufoxExe)) {
    throw new Error('Portable state or bundled Camoufox engine escaped the expected data directory');
  }

  console.log(`PASS bundled Node: ${process.execPath}`);
  console.log('PASS Windows x64 native dependencies load with bundled Node');
  console.log('PASS third-party license bundle');
  console.log(`PASS CLI version: ${packageJson.version}`);
  console.log(`PASS health: ${baseUrl}/health`);
  console.log('PASS local browser flow: create -> navigate -> snapshot -> close');
  console.log('PASS server stop and portable data directory');
} finally {
  if (daemonStarted) runCli(['server', 'stop'], env, { allowFailure: true });
  await new Promise((resolvePromise) => localPageServer.close(resolvePromise));
}
