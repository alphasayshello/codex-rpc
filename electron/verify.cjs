// This app's own hidden render test; never attaches to a user browser profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-render-"));
process.env.CODEX_RPC_HOME = path.join(temp, "rpc");
process.env.CODEX_HOME = path.join(temp, "codex");
let dashboard, window;
app.commandLine.appendSwitch("disable-gpu");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await wait(50);
  }
  throw Error("Render condition timed out");
}
app
  .whenReady()
  .then(async () => {
    const { writeJSON, config } = await import("../src/store.js"),
      { emptyStats, mergeStats, streaks } = await import("../src/scanner.js");
    const days = {},
      totals = emptyStats();
    for (let i = 0; i < 365; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const n = (i * 37 + 23) % 101;
      if (n < 23 && i > 8) continue;
      const s = emptyStats();
      s.tokens = (n + 3) * 4000;
      s.input = Math.round(s.tokens * 0.85);
      s.output = s.tokens - s.input;
      s.prompts = Math.ceil(n / 8);
      s.sessions = Math.ceil(n / 19);
      s.toolCalls = n;
      s.activeSeconds = n * 120;
      s.cost = (s.tokens / 1e6) * 2.8;
      s.tools = {
        shell: n,
        apply_patch: Math.ceil(n * 0.7),
        read_file: Math.ceil(n * 0.4),
      };
      s.languages = {
        JavaScript: n,
        TypeScript: Math.ceil(n * 0.6),
        Python: Math.ceil(n * 0.3),
        Markdown: Math.ceil(n * 0.1),
      };
      s.sources = { codex: Math.ceil(n * 0.8), chatgpt: Math.ceil(n * 0.2) };
      for (let h = 7; h < 21; h++)
        s.hours[h] = Math.round(Math.sin(((h - 7) / 14) * Math.PI) * n);
      days[d.toISOString().slice(0, 10)] = s;
      mergeStats(totals, s);
    }
    totals.activeHours = totals.activeSeconds / 3600;
    writeJSON("config.json", {
      ...config(),
      privacy: "public",
      chatgpt: { enabled: false },
    });
    writeJSON("aggregate.json", {
      schemaVersion: 1,
      updatedAt: Date.now(),
      totals,
      days,
      streak: streaks(days),
    });
    writeJSON("state.json", {
      status: "working",
      source: "codex",
      project: "codex-rpc",
      task: "Build codex-rpc with live presence and analytics",
      model: "o4-mini",
      tokens: 142800,
      tool: "applying a patch",
      startedAt: Date.now() - 420000,
      updatedAt: Date.now(),
    });
    const { serve } = await import("../src/server.js");
    dashboard = await serve(0);
    const errors = [];
    window = new BrowserWindow({
      width: 1440,
      height: 1100,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await window.loadURL(`http://127.0.0.1:${dashboard.address().port}`);
    const js = (source) => window.webContents.executeJavaScript(source);
    await until(() =>
      js(
        "document.querySelector('#connection').textContent==='Live on this device'",
      ),
    );
    assert.equal(
      await js("document.querySelectorAll('.tabs button').length"),
      7,
    );
    assert.ok(await js("document.querySelector('#tokens').textContent!=='0'"));
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    const output = path.resolve(__dirname, "../docs");
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "dashboard.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    for (const tab of [
      "Presence",
      "Discord",
      "Codex Pet Assets",
      "Timing",
      "Daemon Controls",
      "Privacy",
      "Stats",
    ]) {
      await js(
        `Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent===${JSON.stringify(tab)}).click()`,
      );
      assert.ok(
        await js(
          "document.querySelector('#settings-content').textContent.length>10",
        ),
      );
    }
    await js(
      "Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='Codex Pet Assets').click(); document.querySelector('#settings').scrollIntoView()",
    );
    await wait(100);
    fs.writeFileSync(
      path.join(output, "settings.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const before = await js("document.querySelector('#tokens').textContent");
    await js(
      "document.querySelector('#range').value='7d';document.querySelector('#range').dispatchEvent(new Event('change'))",
    );
    await until(
      async () =>
        (await js("document.querySelector('#tokens').textContent")) !== before,
    );
    await js("document.querySelector('#heatmap button[title]').click()");
    assert.match(
      await js("document.querySelector('#day-detail').textContent"),
      /tokens/,
    );
    writeJSON("state.json", {
      status: "waiting",
      model: "o4-mini",
      updatedAt: Date.now(),
    });
    await until(() =>
      js("document.querySelector('#live-status').textContent==='waiting'"),
    );
    await js(
      "Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='Privacy').click(); const field=document.querySelector('[data-key=privacy]'); field.value='private';field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()",
    );
    await until(() => config().privacy === "private");
    await js("document.querySelector('#toggle-presence').click()");
    await until(() => config().enabled === false);
    window.setSize(430, 950);
    await js("scrollTo(0,0)");
    await wait(100);
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    fs.writeFileSync(
      path.join(output, "mobile.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(errors, []);
    console.log(
      "Verified desktop/mobile layout, 7 tabs, settings save, range control, heatmap, SSE and pause. Screenshots in docs/.",
    );
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    window?.destroy();
    dashboard?.closeDashboard();
    fs.rmSync(temp, { recursive: true, force: true });
    app.quit();
  });
