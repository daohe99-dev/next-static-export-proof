import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const checks = [];
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NO_UPDATE_CHECK: '1' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push({ name, passed: true });
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function run(args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
  return { child, done, getOutput: () => output };
}

async function within(promise, ms, processToStop) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          processToStop.kill();
          reject(new Error('Local proof process timed out'));
        }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

let server;
try {
  const next = './node_modules/next/dist/bin/next';
  const build = run([next, 'build']);
  const built = await within(build.done, 180_000, build.child);
  if (built.code !== 0) throw new Error(`Synthetic build failed:\n${built.output}`);
  check('Next14.2.30 static export builds successfully', built.code === 0);

  for (const name of ['index.html', 'about.html', '404.html']) {
    check(`Export contains ${name}`, (await fs.stat(new URL(`out/${name}`, import.meta.url))).isFile());
  }

  const wrong = run([next, 'start', '-p', String(await freePort())]);
  const wrongResult = await within(wrong.done, 15_000, wrong.child);
  const expectedError = '"next start" does not work with "output: export" configuration';
  check('Original next start failure reproduced', wrongResult.code !== 0 && wrongResult.output.includes(expectedError));

  // No --listen flag: verify the same PORT-env entrypoint used by Dockerfile.
  const port = await freePort();
  server = run(['./node_modules/serve/build/main.js', 'out', '--config', '../serve.json', '--no-clipboard', '--no-port-switching'], { PORT: String(port) });
  const base = `http://127.0.0.1:${port}`;
  let home;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1_000) });
      home = { status: response.status, text: await response.text() };
      break;
    } catch {
      if (server.child.exitCode !== null) throw new Error(`Static server exited: ${server.getOutput()}`);
      await pause(100);
    }
  }
  check('Pinned static server honors runtime PORT and serves home', home?.status === 200 && home.text.includes('STATIC_HOME_PROOF'));

  const about = await fetch(`${base}/about`);
  check('Direct deep route /about serves its own exported HTML', about.status === 200 && (await about.text()).includes('STATIC_ABOUT_PROOF'));

  for (const extension of ['css', 'js']) {
    const path = home.text.match(new RegExp(`(?:href|src)="([^"?]+\\.${extension})"`))?.[1];
    assert.ok(path?.startsWith('/_next/'), `Expected generated ${extension} asset`);
    const response = await fetch(base + path);
    const actual = Buffer.from(await response.arrayBuffer());
    const expected = await fs.readFile(new URL(`out${path}`, import.meta.url));
    check(`Generated ${extension} asset serves exact exported bytes`, response.status === 200 && hash(actual) === hash(expected));
  }

  const missing = await fetch(`${base}/missing-route`);
  const missingBody = await missing.text();
  check('Unknown route returns custom404, without SPA fallback', missing.status === 404 && missingBody.includes('STATIC_NOT_FOUND_PROOF') && !missingBody.includes('STATIC_HOME_PROOF'));
  const missingAsset = await fetch(`${base}/_next/static/missing.js`);
  check('Missing JS asset returns404, not a200 home page', missingAsset.status === 404);
  const directory = await fetch(`${base}/_next/static/`);
  check('Directory browsing is disabled', directory.status === 404);

  const address = Object.values(os.networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address;
  let networkBind = 'No non-loopback IPv4 interface available; not tested';
  if (address) {
    const response = await fetch(`http://${address}:${port}/about`, { signal: AbortSignal.timeout(3_000) });
    check('Static server accepts a local non-loopback IPv4 connection', response.status === 200 && (await response.text()).includes('STATIC_ABOUT_PROOF'));
    // The host's interface address is intentionally not saved in public evidence.
    networkBind = 'PASS; address omitted';
  }

  const result = {
    verified_at_utc: new Date().toISOString(),
    fixture_only: true,
    next: '14.2.30', serve: '14.2.6', node: process.version,
    original_error: expectedError,
    checks, passed: checks.length, failed: 0,
    network_bind: networkBind,
    docker_image_built_or_run: false,
    railway_deployment_tested: false,
    owner_data_used: false,
    cash_spent_sgd: 0,
  };
  await fs.writeFile(new URL('proof-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (server) {
    server.child.kill();
    await within(server.done, 5_000, server.child);
  }
}
