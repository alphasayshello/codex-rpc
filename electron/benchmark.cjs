// Isolated synthetic benchmark; never reads or changes the user's RPC data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.env.CODEX_RPC_BENCH_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rpc-bench-'));
process.env.CODEX_RPC_HOME = path.join(temp, 'rpc');
process.env.CODEX_HOME = path.join(temp, 'codex');
app.setPath('userData', path.join(temp, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const load = name => import(pathToFileURL(path.join(root, 'src', name)).href);
let server, window;
app.whenReady().then(async () => {
  const { config, writeJSON } = await load('store.js');
  const { emptyStats, mergeStats, streaks } = await load('scanner.js');
  const days = {}, totals = emptyStats(), sessions = {};
  for (let i = 0; i < 365; i++) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const s = { ...emptyStats(), tokens: 20000 + i * 10, output: 3000, prompts: 8, toolCalls: 24, activeSeconds: 1800, cost: .12, tools: { exec_command: 16, apply_patch: 8 }, languages: { JavaScript: 8 } };
    days[day] = s; mergeStats(totals, s);
  }
  totals.activeHours = totals.activeSeconds / 3600;
  for (let i = 0; i < 200; i++) sessions[`bench-${i}`] = { id: `bench-${i}`, source: 'codex', model: 'o4-mini', usageKnown: true, lastActivityAt: Date.now() - i * 60000, totals: { ...emptyStats(), output: 3000, tokens: 20000 } };
  writeJSON('config.json', { ...config(), privacy: 'public', chatgpt: { enabled: false } });
  writeJSON('aggregate.json', { totals, days, streak: streaks(days), updatedAt: Date.now() });
  writeJSON('sessions.json', { sessions, updatedAt: Date.now() });
  const state = { sessionId: 'bench-0', source: 'codex', task: 'Synthetic benchmark', taskSource: 'session-name', project: 'benchmark', status: 'working', model: 'o4-mini', usage: { input: 17000, output: 3000, total: 20000 }, startedAt: Date.now(), updatedAt: Date.now() };
  writeJSON('state.json', state);
  server = await (await load('server.js')).serve(0);
  window = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  let requests = [], collecting = false;
  window.webContents.session.webRequest.onCompleted({ urls: ['http://127.0.0.1/*'] }, detail => { if (collecting && new URL(detail.url).pathname.startsWith('/api/')) requests.push(new URL(detail.url).pathname); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}`);
  const js = code => window.webContents.executeJavaScript(code);
  for (let i = 0; i < 200 && !(await js("document.querySelector('#chat-output').textContent==='3K' || document.querySelector('#chat-output').textContent==='3k'")); i++) await wait(50);
  // Settle initial SSE and the directory watcher's first polling pass.
  await wait(1300);
  await js("window.benchRemoved=0;window.benchCell=document.querySelector('#heatmap button');new MutationObserver(rows=>{for(const row of rows)window.benchRemoved+=row.removedNodes.length}).observe(document.querySelector('#heatmap'),{childList:true})");
  const idleStart = process.cpuUsage();
  await wait(3000);
  const idleCpu = process.cpuUsage(idleStart);
  collecting = true;
  const durations = [], cpuStart = process.cpuUsage();
  for (let i = 1; i <= 12; i++) {
    const target = 3000 + i * 1000;
    const start = performance.now();
    state.usage = { ...state.usage, output: target, total: 17000 + target }; state.updatedAt = Date.now();
    writeJSON('state.json', state);
    for (let j = 0; j < 200; j++) {
      const done = await js(`document.querySelector('#chat-output').textContent.toLowerCase()===${JSON.stringify(`${3 + i}k`)}`);
      if (done) break;
      if (j === 199) throw Error('Benchmark update timed out');
      await wait(10);
    }
    durations.push(performance.now() - start);
    await wait(180);
  }
  collecting = false;
  const cpu = process.cpuUsage(cpuStart);
  const renderer = app.getAppMetrics().find(value => value.type === 'Tab');
  const result = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, fixture: { days: 365, sessions: 200, updates: 12 }, requests: requests.length, requestsPerUpdate: requests.length / 12, endpoints: [...new Set(requests)], removedHeatmapCells: await js('window.benchRemoved'), retainedFirstHeatmapCell: await js("window.benchCell===document.querySelector('#heatmap button')"), updateMeanMs: Math.round(durations.reduce((a,b)=>a+b,0)/durations.length), updateP95Ms: Math.round(durations.sort((a,b)=>a-b)[Math.ceil(durations.length*.95)-1]), mainCpuMs: Math.round((cpu.user+cpu.system)/1000), idleMainCpuMsOver3s: Math.round((idleCpu.user+idleCpu.system)/1000), mainRssMiB: Math.round(process.memoryUsage().rss/1048576), rendererWorkingSetMiB: renderer ? Math.round(renderer.memory.workingSetSize/1024) : null };
  const out = process.env.CODEX_RPC_BENCH_OUTPUT;
  if (out) fs.writeFileSync(path.resolve(out), JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify(result, null, 2));
}).catch(error => { console.error(error); process.exitCode=1; }).finally(async () => { window?.destroy(); if (server) await new Promise(resolve=>server.closeDashboard(resolve)); fs.rmSync(temp,{recursive:true,force:true}); app.exit(process.exitCode || 0); });
