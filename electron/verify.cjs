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
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await wait(50);
  }
  throw Error("Render condition timed out");
}
app
  .whenReady()
  .then(async () => {
    const { writeJSON, readJSON, config } = await import("../src/store.js"),
      { liveSessionFile } = await import("../src/live.js"),
      { recapFile } = await import("../src/recaps.js"),
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
      presence: { ...config().presence, stats: "chat" },
      chatgpt: { enabled: false },
    });
    writeJSON("aggregate.json", {
      schemaVersion: 1,
      updatedAt: Date.now(),
      totals,
      days,
      streak: streaks(days),
    });
    const now = Date.now(), sessionId = "render-demo-chat", secondId = "render-pinned-chat";
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
        [secondId]: {
          id: secondId, source: "codex", model: "o3", usageKnown: true,
          startedAt: now - 600000, lastActivityAt: now - 1000,
          totals: { ...emptyStats(), tokens: 50800, input: 42000, output: 8800, prompts: 3, toolCalls: 3, cost: 0.14 },
          recentTools: [],
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
    writeJSON(liveSessionFile(sessionId, "codex"), state);
    const pinnedState = {
      ...state, sessionId: secondId, model: "o3", task: "Verify pinned conversation", tokens: 50800,
      usage: { total: 50800, input: 42000, output: 8800, reasoning: 1200, cached: 20000 },
      updatedAt: now - 1000,
      activeTools: [{ name: "read_file", callId: "pin-running", startedAt: now - 2000, file: "src/current.js", arguments: "DO_NOT_RENDER_RAW" }],
      recentTools: [
        { name: "build_project", callId: "pin-done", status: "completed", startedAt: now - 15000, endedAt: now - 12500, durationMs: 2500, exitCode: 0, file: "src/completed.js", output: "DO_NOT_RENDER_RAW" },
        { name: "run_tests", callId: "pin-failed", status: "failed", startedAt: now - 9000, endedAt: now - 8000, durationMs: 1000, exitCode: 2, file: "test/failed.js", arguments: "DO_NOT_RENDER_RAW", output: "DO_NOT_RENDER_RAW" },
      ],
    };
    writeJSON(liveSessionFile(secondId, "codex"), pinnedState);
    const recap = (id, values) => ({ id: `${id}:turn-one`, sessionId: id, turnId: "turn-one", source: "codex", model: "o4-mini", startedAt: now - 25000, endedAt: now - 12500, outcome: "completed", outputTokens: 4500, reasoningTokens: 1000, toolCalls: 8, activeDurationMs: 10000, elapsedMs: 12500, linesAdded: null, linesRemoved: null, filesTouched: 1, files: ["src/recap-private.js"], ...values });
    const mainRecaps = { schemaVersion: 1, sessionId, source: "codex", turns: [recap(sessionId)] };
    const pinRecaps = { schemaVersion: 1, sessionId: secondId, source: "codex", turns: [
      recap(secondId, { outputTokens: 900, toolCalls: 3, model: '<img src=x onerror="window.RECAP_XSS=true">' }),
      recap(secondId, { id: `${secondId}:turn-two`, turnId: "turn-two", outcome: "aborted", outputTokens: 250, toolCalls: 1, elapsedMs: 6000, model: "o3", endedAt: now - 30000 }),
      recap(secondId, { id: `${secondId}:turn-three`, turnId: "turn-three", outcome: "failed", outputTokens: null, reasoningTokens: null, toolCalls: 0, elapsedMs: 2000, model: "o3", endedAt: now - 45000 }),
    ] };
    writeJSON(recapFile(sessionId), mainRecaps);
    writeJSON(recapFile(secondId), pinRecaps);
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
    const reload = async (stable = true) => {
      await window.loadURL(`http://127.0.0.1:${dashboard.address().port}`);
      if (stable) await window.webContents.insertCSS("* { transition: none !important; animation: none !important; scroll-behavior: auto !important; }");
      await until(() => js("document.querySelector('#connection').textContent==='Live on this device'"));
    };
    const key = async (keyCode, modifiers = []) => {
      // Hidden BrowserWindows cannot receive native focus. Dispatch to the
      // focused DOM node to exercise the drawer's keyboard handlers directly.
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(keyCode)},shiftKey:${modifiers.includes("shift")},bubbles:true,cancelable:true}))`);
      await wait(50);
    };
    await until(() => js("document.querySelector('#connection').textContent==='Live on this device'"));
    if (await js("document.documentElement.dataset.motion==='reduced'")) await js("document.querySelector('#motion-toggle').click()");
    await js("document.querySelector('#motion-toggle').focus()");
    assert.equal(await js("document.activeElement.tagName"), "BUTTON");
    await js("document.activeElement.click()");
    assert.equal(await js("document.documentElement.dataset.motion"), "reduced");
    assert.equal(await js("localStorage.getItem('codex-rpc-motion')"), "reduced");
    await until(() => js("document.querySelector('#pet').getAttribute('src').endsWith('.svg') && document.querySelector('#status-badge').getAttribute('src').endsWith('.png')"));
    assert.equal(await js("getComputedStyle(document.querySelector('.pixel-signal i')).animationName"), "none");
    assert.equal(await js("getComputedStyle(document.querySelector('#settings-content')).animationName"), "none");
    assert.equal(await js("document.querySelector('.pixel-signal').getAttribute('aria-hidden')"), "true");
    await reload(false);
    assert.equal(await js("document.documentElement.dataset.motion"), "reduced");
    assert.equal(await js("document.querySelector('#motion-toggle').getAttribute('aria-pressed')"), "true");
    await js("document.querySelector('#motion-toggle').click()");
    await until(() => js("document.querySelector('#pet').getAttribute('src').endsWith('.gif') && document.querySelector('#status-badge').getAttribute('src').endsWith('.gif')"));
    await reload(false);
    assert.equal(await js("document.documentElement.dataset.motion"), "full");
    assert.equal(await js("localStorage.getItem('codex-rpc-motion')"), "full");
    await js("window.petSourceChanges=0;window.petObserver=new MutationObserver(records=>{window.petSourceChanges+=records.filter(r=>r.attributeName==='src').length});window.petObserver.observe(document.querySelector('#pet'),{attributes:true})");
    writeJSON("daemon.json", { connected: true, updatedAt: Date.now() });
    await until(() => js("document.querySelector('#daemon').textContent.includes('Discord connected')"));
    writeJSON("daemon.json", { connected: false, updatedAt: Date.now() });
    await until(() => js("document.querySelector('#daemon').textContent.includes('Discord offline')"));
    assert.equal(await js("window.petSourceChanges"), 0);
    await js("window.petObserver.disconnect()");
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
    assert.match(await js("document.querySelector('#turn-recaps').textContent"), /4\.5K output tokens.*8 tools.*12\.5s.*completed/);
    assert.ok(!(await js("document.querySelector('#turn-recaps').textContent")).includes("120K"));
    // Choosing a conversation is a draft. Only the explicit button changes
    // shared Discord selection, and a newer event must not steal that pin.
    const secondKey = JSON.stringify(["codex", secondId]);
    await js(`document.querySelector('#chat-picker').value=${JSON.stringify(secondKey)};document.querySelector('#chat-picker').dispatchEvent(new Event('change'))`);
    assert.equal(readJSON("selection.json").sessionId, undefined);
    assert.equal(await js("document.querySelector('#chat-tokens').textContent"), "22.8K");
    assert.match(await js("document.querySelector('#chat-pin-status').textContent"), /not pinned yet/);
    assert.equal(await js("document.querySelector('#pin-chat').disabled"), false);
    await js("document.querySelector('#pin-chat').click()");
    await until(() => readJSON("selection.json").sessionId === secondId);
    await until(() => js("document.querySelector('#chat-tokens').textContent==='8.8K'"));
    assert.equal(await js("document.querySelector('#chat-heading').textContent"), pinnedState.task);
    await until(() => js("document.querySelector('#turn-recaps').textContent.includes('900 output tokens')"));
    assert.ok(!(await js("document.querySelector('#turn-recaps').textContent")).includes("4.5K"));
    assert.match(await js("document.querySelector('#turn-recaps').textContent"), /Output not reported/);
    assert.equal(await js("document.querySelector('#turn-recaps img')===null && !window.RECAP_XSS"), true);
    assert.match(await js("document.querySelector('#turn-recaps').textContent"), /<img src=x/);
    pinRecaps.turns[0].model = "o3";
    writeJSON(recapFile(secondId), pinRecaps);
    writeJSON("state.json", { ...state, updatedAt: Date.now() });
    await until(() => js("!document.querySelector('#turn-recaps').textContent.includes('<img')"));
    writeJSON(recapFile(secondId), { ...pinRecaps, turns: [] });
    writeJSON("state.json", { ...state, updatedAt: Date.now() });
    await until(() => js("document.querySelector('#turn-recaps').textContent.includes('Finish a turn')"));
    fs.rmSync(path.join(process.env.CODEX_RPC_HOME, recapFile(secondId)));
    assert.equal(await js("fetch('/api/recaps').then(r=>r.json()).then(data=>data.rows.length)"), 0);
    writeJSON(recapFile(secondId), pinRecaps);
    writeJSON("state.json", { ...state, updatedAt: Date.now() });
    await until(() => js("document.querySelectorAll('#turn-recaps .recap-row').length===3"));
    assert.ok((await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.details)")).includes(pinnedState.task));
    await until(() => js("document.querySelectorAll('#tool-timeline .timeline-row').length===3"));
    assert.match(await js("document.querySelector('#tool-timeline').textContent"), /Completed.*exit 0/);
    assert.match(await js("document.querySelector('#tool-timeline').textContent"), /Failed.*exit 2/);
    assert.match(await js("document.querySelector('#tool-timeline').textContent"), /src\/completed\.js/);
    assert.equal(await js("document.querySelector('#tool-timeline').textContent.includes('DO_NOT_RENDER_RAW')"), false);
    const runningBefore = await js("[...document.querySelectorAll('.timeline-row')].find(r=>r.querySelector('.running')).querySelector('.timeline-duration').textContent");
    await until(async () => (await js("[...document.querySelectorAll('.timeline-row')].find(r=>r.querySelector('.running')).querySelector('.timeline-duration').textContent")) !== runningBefore);
    writeJSON("state.json", { ...state, updatedAt: Date.now() });
    await wait(150);
    assert.equal(await js("document.querySelector('#chat-tokens').textContent"), "8.8K");
    assert.equal(await js("fetch('/api/chat').then(r=>r.json()).then(c=>c.id)"), secondId);
    await reload();
    assert.equal(await js("document.querySelector('#chat-picker').value"), secondKey);
    assert.equal(await js("document.querySelector('#chat-tokens').textContent"), "8.8K");
    await js("document.querySelector('.tool-timeline').scrollIntoView({block:'center'})");
    await capture("timeline.png");
    await js("document.querySelector('.turn-recaps').scrollIntoView({block:'center'})");
    await capture("recaps.png");
    window.setSize(430, 1050);
    await wait(100);
    await js("document.querySelector('.tool-timeline').scrollIntoView({block:'center'})");
    assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true);
    await capture("timeline-mobile.png");
    await js("document.querySelector('.turn-recaps').scrollIntoView({block:'center'})");
    assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true);
    await capture("recaps-mobile.png");
    window.setSize(1440, 1100);
    writeJSON("config.json", { ...config(), privacy: "private" });
    await until(() => js("document.querySelector('#chat-heading').textContent==='Private conversation'"));
    await until(() => js("!document.querySelector('#tool-timeline').textContent.includes('src/completed.js')"));
    assert.equal(await js("fetch('/api/timeline').then(r=>r.json()).then(t=>t.rows.every(row=>!('file' in row)&&!('arguments' in row)&&!('output' in row)))"), true);
    assert.equal(await js("fetch('/api/recaps').then(r=>r.json()).then(t=>t.rows.every(row=>row.files===null))"), true);
    writeJSON("config.json", { ...config(), privacy: "public" });
    await until(() => js("document.querySelector('#chat-heading').textContent==='Verify pinned conversation'"));
    await js("document.querySelector('#unpin-chat').click()");
    await until(() => !readJSON("selection.json").sessionId);
    await until(() => js("document.querySelector('#chat-tokens').textContent==='22.8K'"));
    assert.equal(await js("document.querySelector('#chat-heading').textContent"), state.task);
    assert.equal(await js("document.querySelector('#chat-picker').value"), "");
    assert.ok((await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.details)")).includes(state.task));
    await js("scrollTo({top:0,behavior:'instant'})");
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
    // Exercise the new default through real hooks in the disposable home;
    // earlier assertions deliberately retain the legacy chat-card fixture.
    const { applyEvent } = await import("../src/hook.js");
    const workspace = path.join(temp, "telemetry-workspace");
    fs.mkdirSync(workspace);
    require("node:child_process").execFileSync("git", ["init", "-q", "-b", "feature/telemetry-private"], { cwd: workspace });
    const telemetryId = "render-telemetry-chat", telemetryEpoch = Date.now();
    const emit = (type, extra = {}, ago = 0) => applyEvent({ type, sessionId: telemetryId, model: "o3", cwd: workspace, timestamp: telemetryEpoch - ago, ...extra });
    writeJSON("config.json", { ...config(), enabled: true, privacy: "public", presence: { ...config().presence, stats: "telemetry", timer: "operation" }, buttons: [{ label: "Ignored button", url: "https://example.com" }] });
    emit("turn-start", {}, 20000);
    const thinkingBefore = readJSON("state.json").thinkingStartedAt;
    emit("token_count", { payload: { type: "token_count", info: { total_token_usage: { input_tokens: 90000, output_tokens: 7200, reasoning_output_tokens: 1200 } } } }, 19000);
    assert.equal(readJSON("state.json").thinkingStartedAt, thinkingBefore);
    window.setSize(1440, 1100);
    await reload();
    await until(() => js("document.querySelector('#live-action').textContent.startsWith('Pondering solution...')"));
    assert.equal(await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.timestamps.start)"), Math.floor(thinkingBefore / 1000));
    assert.equal(await js("fetch('/api/presence').then(r=>r.json()).then(a=>'buttons' in a)"), false);
    assert.equal(await js("document.querySelector('[data-key=\"presence.stats\"]').value"), "telemetry");
    assert.equal(await js("document.querySelector('[data-key=\"presence.timer\"]').value"), "operation");
    const patch = "*** Begin Patch\n*** Update File: src/telemetry-client.js\n@@\n-TELEMETRY_SECRET_BODY\n+replacement\n+extra\n*** Add File: src/telemetry-helper.js\n+helper\n*** End Patch";
    emit("function_call", { callId: "telemetry-patch", tool: "apply_patch", payload: { type: "function_call", name: "apply_patch", call_id: "telemetry-patch", arguments: JSON.stringify({ patch }) } }, 15000);
    await until(() => js("document.querySelector('#live-model').textContent.includes('(+3 / -1)')"));
    assert.match(await js("document.querySelector('#live-action').textContent"), /Writing code across 2 files/);
    const stateAPI = await js("fetch('/api/state').then(r=>r.json())");
    assert.equal(stateAPI.visualState, "patching");
    assert.equal(stateAPI.currentFileCount, 2);
    assert.equal(stateAPI.linesAdded, 3);
    assert.equal(stateAPI.linesRemoved, 1);
    assert.ok(!JSON.stringify(stateAPI).includes("TELEMETRY_SECRET_BODY"));
    assert.equal(await js("document.querySelector('#pet').getAttribute('src')"), "/assets/pet/codex-pet-patching.gif");
    for (const timer of ["session", "operation"]) {
      await js(`(()=>{const field=document.querySelector('[data-key="presence.timer"]');field.value=${JSON.stringify(timer)};field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()})()`);
      await until(() => config().presence.timer === timer);
      const expected = timer === "session" ? readJSON("state.json").startedAt : readJSON("state.json").operationStartedAt;
      assert.equal(await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.timestamps.start)"), Math.floor(expected / 1000));
    }
    await js("document.querySelector('#settings-tab-2').click()");
    await js("(()=>{const field=document.querySelector('[data-key=\"assets.patching\"]');field.value='anim_patch_large';field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()})()");
    await until(() => config().assets.patching === "anim_patch_large");
    assert.equal(await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.assets.large_image)"), "anim_patch_large");
    assert.equal(await js("document.querySelector('#pet').getAttribute('src')"), "/assets/pet/codex-pet-patching.gif");
    // A custom URL within our own repository still selects that exact artwork.
    await js("(()=>{const field=document.querySelector('[data-key=\"assets.patching\"]');field.value='https://raw.githubusercontent.com/alphasayshello/codex-rpc/main/assets/pet/codex-pet-idle.gif';field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()})()");
    await until(() => js("document.querySelector('#pet').getAttribute('src')==='/assets/pet/codex-pet-idle.gif'"));
    assert.match(await js("fetch('/api/presence').then(r=>r.json()).then(a=>a.assets.large_image)"), /codex-pet-idle.gif$/);
    await js("(()=>{const field=document.querySelector('[data-key=\"assets.patching\"]');field.value='anim_patch_large';field.dispatchEvent(new Event('change'));document.querySelector('#settings-form').requestSubmit()})()");
    await until(() => js("document.querySelector('#pet').getAttribute('src')==='/assets/pet/codex-pet-patching.gif'"));
    await js("scrollTo({top:0,behavior:'instant'})");
    await capture("telemetry.png");
    window.setSize(430, 1050);
    await js("scrollTo({top:0,behavior:'instant'})");
    assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true);
    await capture("telemetry-mobile.png");
    window.setSize(1440, 1100);
    writeJSON("config.json", { ...config(), privacy: "private" });
    await until(() => js("!document.querySelector('#live-model').textContent.includes('telemetry-client.js')"));
    const privatePatch = await js("Promise.all(['/api/state','/api/chat','/api/presence','/api/timeline'].map(url=>fetch(url).then(r=>r.json())))");
    assert.ok(!JSON.stringify(privatePatch).includes("telemetry-client.js"));
    assert.ok(!JSON.stringify(privatePatch).includes("telemetry-helper.js"));
    assert.ok(!JSON.stringify(privatePatch).includes("feature/telemetry-private"));
    emit("function_call_output", { callId: "telemetry-patch", payload: { type: "function_call_output", call_id: "telemetry-patch", output: "SECRET PATCH OUTPUT" } }, 14000);
    writeJSON("config.json", { ...config(), privacy: "public" });
    emit("function_call", { callId: "telemetry-shell", tool: "exec_command", payload: { type: "function_call", name: "exec_command", call_id: "telemetry-shell", arguments: JSON.stringify({ cmd: "API_TOKEN=TELEMETRY_SECRET_TOKEN npm test --token=TELEMETRY_SECRET_TOKEN /private/operand" }) } }, 10000);
    await until(() => js("document.querySelector('#live-model').textContent.includes('Running: npm test')"));
    assert.equal(readJSON("state.json").commandSummary, "npm test");
    assert.ok(!JSON.stringify(readJSON("state.json")).includes("TELEMETRY_SECRET_TOKEN"));
    writeJSON("config.json", { ...config(), privacy: "private" });
    await until(() => js("!document.querySelector('#live-model').textContent.includes('npm test')"));
    assert.ok(!JSON.stringify(await js("Promise.all(['/api/state','/api/presence'].map(url=>fetch(url).then(r=>r.json())))")).includes("npm test"));
    writeJSON("config.json", { ...config(), privacy: "public" });
    const stages = [["idle", "idle"], ["thinking", "thinking"], ["writing", "writing"], ["patching", "patching"], ["error", "error"], ["success", "done"]];
    for (const reduced of [false, true]) {
      if (await js("document.documentElement.dataset.motion==='reduced'") !== reduced) await js("document.querySelector('#motion-toggle').click()");
      for (let i = 0; i < stages.length; i++) {
        const [type, visual] = stages[i];
        emit(type, {}, 8000 - i * 500 - (reduced ? 3500 : 0));
        const route = `/assets/pet/codex-pet-${visual}.${reduced ? "svg" : "gif"}`;
        await until(() => js(`document.querySelector('#pet').getAttribute('src')===${JSON.stringify(route)}`)).catch(async error => {
          const observed = await js("Promise.all([Promise.resolve(document.querySelector('#pet').getAttribute('src')),fetch('/api/state').then(r=>r.json()).then(s=>({status:s.status,visual:s.visualState})),fetch('/api/presence').then(r=>r.json()).then(p=>p?.assets.large_image)])");
          throw new Error(`${error.message}: expected ${route}; observed ${JSON.stringify(observed)}`);
        });
        assert.equal(await js("fetch('/api/state').then(r=>r.json()).then(s=>s.visualState)"), visual);
        assert.equal(await js(`fetch(${JSON.stringify(route)}).then(r=>r.status)`), 200);
      }
    }
    writeJSON("state.json", { ...readJSON("state.json"), eventTime: Date.now() - 20000, updatedAt: Date.now() });
    await until(() => js("document.querySelector('#pet').getAttribute('src')==='/assets/pet/codex-pet-idle.svg'"));
    assert.equal(await js("fetch('/api/state').then(r=>r.json()).then(s=>s.visualState)"), "idle");
    // All new scenes travel through the actual local API and asset routes.
    const catalog = await js("fetch('/api/animations').then(r=>r.json())");
    assert.equal(catalog.animations.length, 20); // 19 scenes plus legacy working.
    assert.equal(new Set(catalog.animations.map(scene => scene.id)).size, 20);
    assert.ok(catalog.animations.some(scene => scene.id === "idle-cozy"));
    const routes = catalog.animations.flatMap(scene => ["gif", "svg"].map(format => `/assets/pet/codex-pet-${scene.id}.${format}`));
    const served = await js(`Promise.all(${JSON.stringify(routes)}.map(async route=>{const response=await fetch(route);const bytes=new Uint8Array(await response.arrayBuffer());return {route,status:response.status,type:response.headers.get('content-type'),prefix:new TextDecoder().decode(bytes.slice(0,100))}}))`);
    for (const response of served) {
      assert.equal(response.status, 200, response.route);
      if (response.route.endsWith(".gif")) { assert.equal(response.type, "image/gif"); assert.match(response.prefix, /^GIF8[79]a/); }
      else { assert.equal(response.type, "image/svg+xml"); assert.ok(response.prefix.includes("<svg")); }
    }
    // Choosing artwork changes the settings draft, never the persisted config
    // until the existing Save changes action is used.
    await js("document.querySelector('#settings-tab-2').click()");
    assert.equal(await js("document.querySelectorAll('.animation-option').length"), 19);
    assert.equal(await js("document.querySelector('#animation-target').value"), "writing");
    const oldWriting = config().assets.writing;
    const chosenURL = catalog.baseURL + "codex-pet-reading.gif?v=smooth-1";
    await js("document.querySelector('.animation-option[data-animation=reading]').click()");
    assert.equal(await js("document.querySelector('[data-key=\"assets.writing\"]').value"), chosenURL);
    assert.equal(config().assets.writing, oldWriting);
    assert.match(await js("document.querySelector('#save-status').textContent"), /Save changes to apply/);
    await js("document.querySelector('#settings-form').requestSubmit()");
    await until(() => config().assets.writing === chosenURL);
    emit("writing");
    await until(() => js("document.querySelector('#pet').getAttribute('src')==='/assets/pet/codex-pet-reading.svg'"));
    await reload();
    await js("document.querySelector('#settings-tab-2').click()");
    assert.equal(await js("document.querySelector('[data-key=\"assets.writing\"]').value"), chosenURL);
    assert.equal(await js("document.querySelector('.animation-option[data-animation=reading]').getAttribute('aria-pressed')"), "true");
    assert.equal(await js("[...document.querySelectorAll('.animation-option img')].every(image=>image.getAttribute('src').endsWith('.svg'))"), true);
    await js("document.querySelector('#motion-toggle').click()");
    await until(() => js("[...document.querySelectorAll('.animation-option img')].every(image=>image.getAttribute('src').endsWith('.gif'))"));
    await until(() => js("document.querySelector('#pet').getAttribute('src')==='/assets/pet/codex-pet-reading.gif'"));
    // The full animation studio remains local: controls, filters, keyboard
    // navigation, copy feedback and motion/background preferences are real DOM.
    await window.loadURL(`http://127.0.0.1:${dashboard.address().port}/assets/pet/animation-gallery.html`);
    await until(() => js("document.querySelectorAll('.scene-card').length===19 && document.querySelector('#preview-image').complete && document.querySelector('#preview-image').naturalWidth>0"));
    assert.equal(await js("document.querySelector('#scene-count').textContent"), "19 scenes");
    await js("document.querySelector('[data-filter=bonus]').click()");
    assert.equal(await js("document.querySelectorAll('.scene-card:not([hidden])').length"), 12);
    await js("document.querySelector('[data-filter=core]').click()");
    assert.equal(await js("document.querySelectorAll('.scene-card:not([hidden])').length"), 7);
    await js("document.querySelector('[data-filter=all]').click();document.querySelector('#family-filter').value='research';document.querySelector('#family-filter').dispatchEvent(new Event('change'))");
    assert.equal(await js("[...document.querySelectorAll('.scene-card:not([hidden])')].every(card=>card.dataset.family==='research')"), true);
    assert.ok(await js("document.querySelectorAll('.scene-card:not([hidden])').length>0"));
    await js("document.querySelector('#family-filter').value='all';document.querySelector('#family-filter').dispatchEvent(new Event('change'));document.querySelector('#scene-search').value='no-such-scene-xyz';document.querySelector('#scene-search').dispatchEvent(new Event('input'))");
    assert.equal(await js("document.querySelectorAll('.scene-card:not([hidden])').length"), 0);
    assert.equal(await js("document.querySelector('#empty-scenes').hidden"), false);
    await js("document.querySelector('#scene-search').value='';document.querySelector('#scene-search').dispatchEvent(new Event('input'));document.querySelector('.scene-card[data-scene=testing]').click()");
    assert.equal(await js("document.querySelector('#preview-title').textContent"), "Testing");
    assert.equal(await js("document.querySelector('#download-gif').getAttribute('href')"), "codex-pet-testing.gif");
    assert.equal(await js("document.querySelector('#download-svg').getAttribute('href')"), "codex-pet-testing.svg");
    assert.match(await js("document.querySelector('#asset-url').value"), /codex-pet-testing\.gif\?v=smooth-1$/);
    await js("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.testCopiedAsset=value}}});document.querySelector('#copy-url').click()");
    await until(() => js("document.querySelector('#copy-status').textContent.includes('GIF URL copied')"));
    assert.equal(await js("window.testCopiedAsset"), await js("document.querySelector('#asset-url').value"));
    await js("document.querySelector('.scene-card[data-scene=testing]').focus()");
    await key("End");
    assert.equal(await js("document.activeElement.dataset.scene"), "idle-cozy");
    await key("Home");
    assert.equal(await js("document.activeElement.dataset.scene"), "idle");
    await js("document.querySelector('#reduce-motion').checked=false;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'))");
    if (await js("document.querySelector('#play-toggle').textContent==='Play animations'")) await js("document.querySelector('#play-toggle').click()");
    assert.match(await js("document.querySelector('#preview-image').getAttribute('src')"), /\.gif$/);
    await js("document.querySelector('#play-toggle').click()");
    assert.match(await js("document.querySelector('#preview-image').getAttribute('src')"), /\.svg$/);
    await js("document.querySelector('#play-toggle').click();document.querySelector('#reduce-motion').checked=true;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'))");
    assert.equal(await js("document.querySelector('#play-toggle').disabled"), true);
    assert.equal(await js("[...document.querySelectorAll('.scene-image')].every(image=>image.getAttribute('src').endsWith('.svg'))"), true);
    for (const background of ["light", "checkerboard", "dark"]) {
      await js(`document.querySelector('#background-select').value=${JSON.stringify(background)};document.querySelector('#background-select').dispatchEvent(new Event('change'))`);
      assert.equal(await js("document.body.dataset.background"), background);
    }
    await window.loadURL(`http://127.0.0.1:${dashboard.address().port}/assets/pet/animation-gallery.html`);
    await until(() => js("document.querySelector('#reduce-motion').checked"));
    assert.equal(await js("document.querySelector('#play-toggle').disabled"), true);
    assert.equal(await js("document.body.dataset.background"), "dark");
    // Capture the full-motion hero from the actual top of the document, then
    // show the complete bonus collection so distinct scenes remain visible.
    await js("document.querySelector('[data-filter=all]').click();document.querySelector('#family-filter').value='all';document.querySelector('#family-filter').dispatchEvent(new Event('change'));document.querySelector('#scene-search').value='';document.querySelector('#scene-search').dispatchEvent(new Event('input'));document.querySelector('#background-select').value='dark';document.querySelector('#background-select').dispatchEvent(new Event('change'));document.querySelector('#reduce-motion').checked=false;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'));document.querySelector('.scene-card[data-scene=writing]').click()");
    if (await js("document.querySelector('#play-toggle').textContent==='Play animations'")) await js("document.querySelector('#play-toggle').click()");
    assert.equal(await js("[...document.querySelectorAll('.scene-image')].every(image=>image.getAttribute('src').endsWith('.gif'))"), true);
    window.setSize(1440, 1100);
    await js("scrollTo({top:0,behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await js("scrollY"), 0);
    await capture("pet-studio.png");
    window.setSize(430, 1050);
    await js("scrollTo({top:0,behavior:'instant'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true);
    assert.equal(await js("scrollY"), 0);
    await capture("pet-studio-mobile.png");
    window.setSize(1440, 1100);
    await js("scrollTo({top:document.querySelector('.scene-section[data-section=bonus]').getBoundingClientRect().top+scrollY-20,behavior:'instant'})");
    await until(() => js("[...document.querySelectorAll('.scene-card[data-kind=bonus] img')].every(image=>image.complete&&image.naturalWidth>0)"));
    assert.equal(await js("[...document.querySelectorAll('.scene-card[data-kind=bonus]')].every(card=>{const box=card.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight})"), true);
    await capture("pet-collection.png");
    assert.deepEqual(errors, []);
    console.log(
      "Verified actual-hook file/diff/command telemetry, stable thinking and operation/session timers, 20 GIF and 20 SVG asset routes, 19-scene gallery controls and settings picker, six canonical lifecycle states, asset keys, privacy and button suppression; output-only recaps, motion persistence, stable mascot across SSE, pin isolation, safe timeline, themes, keyboard/mobile navigation, responsive layout, settings, heatmap and pause. Screenshots in docs/.",
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
