// This app's own hidden render test; never attaches to a user browser profile.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rpc-render-"));
process.env.CODEX_RPC_HOME = path.join(temp, "rpc");
process.env.CODEX_HOME = path.join(temp, "codex");
app.setPath("userData", path.join(temp, "electron-profile"));
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
    const now = Date.now(), sessionId = "render-demo-chat";
    const chatTotals = {
      ...emptyStats(), tokens: 142800, input: 120000, output: 22800,
      reasoning: 8000, cached: 75000, prompts: 14, toolCalls: 32,
      activeSeconds: 1260, cost: 0.1848, linesAdded: 218, linesRemoved: 47,
      tools: { exec_command: 18, apply_patch: 14 },
    };
    writeJSON("sessions.json", {
      schemaVersion: 1, updatedAt: now, sessions: {
        [sessionId]: {
          id: sessionId, source: "codex", model: "o4-mini", usageKnown: true,
          startedAt: now - 1800000, totals: chatTotals,
          recentTools: [{ name: "apply_patch", callId: "finished-patch", startedAt: now - 15000, endedAt: now - 12000, durationMs: 3000 }],
        },
      },
    });
    const state = {
      status: "working",
      sessionId,
      source: "codex",
      project: "codex-rpc",
      task: "Build live chat analytics",
      taskSource: "session-name",
      model: "o4-mini",
      tokens: 142800,
      usage: { total: 142800, input: 120000, output: 22800, reasoning: 8000, cached: 75000 },
      contextWindow: 200000,
      lastUsage: { total: 24000 },
      activeTools: [{ name: "exec_command", callId: "running-command", startedAt: now - 3000 }],
      recentTools: [{ name: "read_file", callId: "finished-read", startedAt: now - 8000, endedAt: now - 7500, durationMs: 500 }],
      tool: "applying a patch",
      startedAt: now - 420000,
      updatedAt: now,
    };
    writeJSON("state.json", state);
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
        backgroundThrottling: false,
      },
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    await window.loadURL(`http://127.0.0.1:${dashboard.address().port}`);
    const js = (source) => window.webContents.executeJavaScript(source).catch((error) => {
      throw new Error(`${error.message}\nRenderer check: ${source}`);
    });
    const output = path.resolve(__dirname, "../docs");
    fs.mkdirSync(output, { recursive: true });
    const capture = async (name) => {
      await wait(250); // Let sidebar/theme CSS transitions finish before capture.
      window.webContents.invalidate();
      await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
    };
    const reload = async () => {
      await window.loadURL(`http://127.0.0.1:${dashboard.address().port}`);
      await window.webContents.insertCSS("* { transition: none !important; animation: none !important; scroll-behavior: auto !important; }");
      await until(() => js("document.querySelector('#connection').textContent==='Live on this device'"));
    };
    const key = async (keyCode, modifiers = []) => {
      // Hidden BrowserWindows cannot receive native focus. Dispatch to the
      // focused DOM node to exercise the drawer's keyboard handlers directly.
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(keyCode)},shiftKey:${modifiers.includes("shift")},bubbles:true,cancelable:true}))`);
      await wait(50);
    };
    // Hidden compositor animation clocks are not reliable; verify stable end
    // states while leaving native GIF animation untouched.
    await window.webContents.insertCSS("* { transition: none !important; animation: none !important; scroll-behavior: auto !important; }");
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
    assert.equal(config().presence.stats, "chat");
    assert.equal(await js("document.querySelector('#chat-heading').textContent"), state.task);
    assert.equal(await js("document.querySelector('#chat-tokens').textContent"), "22.8K");
    assert.equal(await js("document.querySelector('#chat-prompts').textContent"), "14");
    assert.equal(await js("document.querySelector('#chat-tools-count').textContent"), "32");
    assert.equal(await js("document.querySelector('#chat-cache-label').textContent"), "62.5%");
    assert.match(await js("document.querySelector('#chat-context-label').textContent"), /12\.0%/);
    assert.match(await js("document.querySelector('#chat-active-tools').textContent"), /exec_command/);
    assert.match(await js("document.querySelector('#chat-recent-tools').textContent"), /apply_patch.*read_file/);
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    assert.equal(await js("document.documentElement.dataset.theme"), "dark");
    await js("document.querySelector('#theme-toggle').click()");
    assert.equal(await js("document.documentElement.dataset.theme"), "light");
    assert.equal(await js("localStorage.getItem('codex-rpc-theme')"), "light");
    await reload();
    assert.equal(await js("document.documentElement.dataset.theme"), "light");
    await capture("dashboard-light.png");
    await js("document.querySelector('#theme-toggle').focus()");
    assert.equal(await js("document.activeElement.id"), "theme-toggle");
    assert.equal(await js("document.activeElement.tagName"), "BUTTON");
    await js("document.activeElement.click()");
    await until(() => js("document.documentElement.dataset.theme==='dark'"));
    assert.equal(await js("localStorage.getItem('codex-rpc-theme')"), "dark");
    await reload();
    assert.equal(await js("document.documentElement.dataset.theme"), "dark");
    await js("document.querySelector('#sidebar-toggle').click()");
    assert.equal(await js("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), "false");
    assert.equal(await js("localStorage.getItem('codex-rpc-sidebar-collapsed')"), "true");
    await reload();
    assert.equal(await js("document.body.classList.contains('sidebar-collapsed')"), true);
    assert.equal(await js("document.querySelector('#sidebar').inert"), true);
    await js("document.querySelector('#sidebar-toggle').focus()");
    assert.equal(await js("document.activeElement.tagName"), "BUTTON");
    await js("document.activeElement.click()");
    assert.equal(await js("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), "true");
    assert.equal(await js("localStorage.getItem('codex-rpc-sidebar-collapsed')"), "false");
    assert.equal(await js("getComputedStyle(document.querySelector('#sidebar')).visibility"), "visible");
    assert.equal(await js("Math.round(document.querySelector('#sidebar').getBoundingClientRect().left)"), 0);
    await capture("dashboard.png");
    await js("document.querySelector('.chat-panel').scrollIntoView({block:'center'})");
    await wait(100);
    await capture("chat.png");
    await js("document.querySelector('#settings-tab-0').focus()");
    await key("ArrowDown");
    assert.equal(await js("document.activeElement.id"), "settings-tab-1");
    assert.equal(await js("document.querySelector('#settings-content').getAttribute('aria-labelledby')"), "settings-tab-1");
    await key("End");
    assert.equal(await js("document.activeElement.id"), "settings-tab-6");
    await key("Home");
    assert.equal(await js("document.activeElement.id"), "settings-tab-0");
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
    await js("Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='Presence').click()");
    for (const mode of ["cost", "chat"]) {
      await js(`(()=>{const field=document.querySelector('[data-key="presence.stats"]'); field.value=${JSON.stringify(mode)};field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()})()`);
      await until(() => config().presence.stats === mode);
      await until(() => js("document.querySelector('#save-status').textContent==='Saved on this device.'"));
    }
    await reload();
    assert.equal(await js("document.querySelector('[data-key=\"presence.stats\"]').value"), "chat");
    await js(
      "Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='Codex Pet Assets').click(); document.querySelector('#settings').scrollIntoView({behavior:'instant'})",
    );
    await wait(100);
    assert.ok(await js("document.querySelector('#settings-content').getBoundingClientRect().top < innerHeight - 200"));
    await until(() => js("document.querySelector('#connection').textContent==='Live on this device'"));
    await capture("settings.png");
    const before = await js("document.querySelector('#tokens').textContent");
    await js(
      "document.querySelector('#range').value='7d';document.querySelector('#range').dispatchEvent(new Event('change'))",
    );
    await until(
      async () =>
        (await js("document.querySelector('#tokens').textContent")) !== before,
    );
    assert.equal(await js("document.querySelector('#chat-tokens').textContent"), "22.8K");
    await js("document.querySelector('#heatmap button[title]').click()");
    assert.match(
      await js("document.querySelector('#day-detail').textContent"),
      /tokens/,
    );
    writeJSON("state.json", {
      ...state,
      status: "waiting",
      activeTools: [],
      model: "o4-mini",
      updatedAt: Date.now(),
    });
    await until(() =>
      js("document.querySelector('#live-status').textContent==='waiting'"),
    );
    await until(() => js("document.querySelector('#chat-active-tools').textContent==='No tools running'"));
    await js(
      "Array.from(document.querySelectorAll('.tabs button')).find(b=>b.textContent==='Privacy').click(); const field=document.querySelector('[data-key=privacy]'); field.value='private';field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()",
    );
    await until(() => config().privacy === "private");
    await until(() => js("document.querySelector('#chat-heading').textContent==='Private conversation'"));
    await js("document.querySelector('#toggle-presence').click()");
    await until(() => config().enabled === false);
    window.setSize(430, 950);
    await js("scrollTo({top:0,behavior:'instant'})");
    await wait(100);
    assert.equal(await js("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), "false");
    assert.equal(await js("document.querySelector('#sidebar').inert"), true);
    assert.equal(await js("document.querySelector('#sidebar').getAttribute('aria-hidden')"), "true");
    await js("document.querySelector('#sidebar-toggle').focus()");
    await js("document.activeElement.click()");
    assert.equal(await js("document.body.classList.contains('sidebar-open')"), true);
    assert.equal(await js("document.querySelector('#main-content').inert"), true);
    assert.equal(await js("document.activeElement.id"), "sidebar-close");
    assert.equal(await js("document.querySelector('#sidebar-overlay').hidden"), false);
    await js("document.querySelector('#sidebar .brand').focus()");
    await key("Tab", ["shift"]);
    assert.equal(await js("document.activeElement.classList.contains('sidebar-card-link')"), true);
    await key("Tab");
    assert.equal(await js("document.activeElement.classList.contains('brand')"), true);
    await capture("navigation-mobile.png");
    await key("Escape");
    assert.equal(await js("document.querySelector('#main-content').inert"), false);
    assert.equal(await js("document.activeElement.id"), "sidebar-toggle");
    assert.equal(await js("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), "false");
    await js("document.querySelector('#sidebar-toggle').click();document.querySelector('#sidebar nav a[href=\"#settings\"]').click()");
    assert.equal(await js("document.querySelector('#sidebar-toggle').getAttribute('aria-expanded')"), "false");
    assert.equal(await js("document.querySelector('#sidebar nav a[href=\"#settings\"]').getAttribute('aria-current')"), "location");
    assert.equal(await js("document.activeElement.id"), "settings");
    await js("document.querySelector('#sidebar-toggle').click();document.querySelector('#sidebar-overlay').click();scrollTo({top:0,behavior:'instant'})");
    assert.equal(await js("document.querySelector('#sidebar').inert"), true);
    await js("document.querySelector('#settings-tab-0').click()");
    await key("ArrowRight");
    assert.equal(await js("document.activeElement.id"), "settings-tab-1");
    await js("scrollTo({top:0,behavior:'instant'})");
    assert.equal(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    await capture("mobile.png");
    window.setSize(430, 1300);
    await js("scrollTo({top: document.querySelector('.chat-panel').getBoundingClientRect().top + scrollY - document.querySelector('.topbar').offsetHeight - 16, behavior:'instant'})");
    await wait(100);
    assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true);
    await capture("chat-mobile.png");
    assert.deepEqual(errors, []);
    console.log(
      "Verified dark/light theme persistence, keyboard/mobile navigation, desktop sidebar persistence, responsive layout, per-chat metrics/tools/context, chat-mode persistence, 7 tabs, settings save, range isolation, heatmap, SSE, privacy and pause. Screenshots in docs/.",
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
    app.exit(process.exitCode || 0);
  });
