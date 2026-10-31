// Isolated render/integration test for this application's own Pet Studio.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rpc-pet-render-'));
process.env.CODEX_RPC_HOME = path.join(temp, 'rpc');
process.env.CODEX_HOME = path.join(temp, 'codex');
app.setPath('userData', path.join(temp, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
let server, window;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label = 'render condition') {
  for (let i = 0; i < 400; i++) { if (await fn()) return; await wait(50); }
  throw Error('Timed out waiting for ' + label);
}
app.whenReady().then(async () => {
  const { serve } = await import('../src/server.js');
  const { config, writeJSON } = await import('../src/store.js');
  const { encodePNG } = await import('../src/assets/png.js');
  writeJSON('config.json', { ...config(), chatgpt: { enabled: false } });
  server = await serve(0);
  const origin = 'http://127.0.0.1:' + server.address().port;
  window = new BrowserWindow({ width: 1440, height: 1100, show: false, backgroundColor: '#202124', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const js = expression => window.webContents.executeJavaScript(expression, true);
  const screenshot = async name => { await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); fs.writeFileSync(path.join(__dirname, '../docs', name), (await window.webContents.capturePage()).toPNG()); };
  await window.loadURL(origin + '/assets/pet/animation-gallery.html');
  await until(() => js("document.querySelector('#pet-select').options.length===2 && !document.querySelector('#use-pet').disabled"), 'local library');
  await js("window.studioErrors=[];addEventListener('error',e=>{if(e.message)studioErrors.push(e.message)});addEventListener('unhandledrejection',e=>studioErrors.push(String(e.reason)));void 0");
  assert.equal(await js("document.querySelector('#pet-brief').value"), '');
  assert.match(await js("document.querySelector('#pet-prompt').value"), /CHARACTER IMAGE I attached/);
  assert.match(await js("document.querySelector('#pet-prompt').value"), /1536 × 1344/);
  await js("document.querySelector('#pet-select').value='codex-bloom';document.querySelector('#pet-select').dispatchEvent(new Event('change'))");
  assert.equal(config().pet.id, 'codex'); // Browsing does not change presence.
  assert.match(await js("document.querySelector('#preview-image').getAttribute('src')"), /codex-bloom\/coding\.gif$/);
  assert.equal(await js("getComputedStyle(document.querySelector('#preview-image')).imageRendering"), 'auto');
  assert.equal(await js("document.querySelector('#preview-fps').textContent"), '10 fps');
  assert.equal(await js("document.querySelector('#preview-duration').textContent"), '19.0s');
  assert.match(await js("document.querySelector('#preview-description').textContent"), /Codex Bloom’s supplied coding animation/);
  assert.ok(!(await js("document.querySelector('#preview-description').textContent")).includes('articulated paws'));
  await js("document.querySelector('#use-pet').click()");
  await until(() => config().pet.id === 'codex-bloom', 'built-in selection');
  await until(() => js("document.querySelector('#pet-library-status').textContent.startsWith('Codex Bloom selected') && !document.querySelector('#use-pet').disabled"), 'built-in selection acknowledgement');
  await js("document.querySelector('#reduce-motion').checked=true;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'))");
  assert.equal(await js("[...document.querySelectorAll('.scene-image')].every(image=>image.getAttribute('src').endsWith('.png'))"), true);
  await js("document.querySelector('#reduce-motion').checked=false;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'));document.querySelector('#pet-library').scrollIntoView({behavior:'instant',block:'start'})");
  await screenshot('pet-library.png');

  // A small valid8x7sheet is deliberately normalized by the production importer.
  const width = 256, height = 224, rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < 7; row++) for (let column = 0; column < 8; column++) {
    for (let y = 6; y < 29; y++) for (let x = 7; x < 25; x++) {
      const offset = ((row * 32 + y) * width + column * 32 + x) * 4;
      rgba.set([100 + row * 16, 150 + column * 8, 220 - row * 10, 255], offset);
    }
  }
  const png = encodePNG(width, height, rgba).toString('base64');
  const putFile = async (data, name, type) => js(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(data)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));document.querySelector('#pet-import-files').files=transfer.files;document.querySelector('#pet-import-files').dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await js(`window.referenceFetches=[];window.referenceOriginalFetch=window.fetch;window.fetch=(...args)=>{referenceFetches.push(String(args[0]));return referenceOriginalFetch(...args)};(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'character-reference.png',{type:'image/png'}));document.querySelector('#pet-reference').files=transfer.files;document.querySelector('#pet-reference').dispatchEvent(new Event('change'));})()`);
  await until(() => js("!document.querySelector('#reference-preview-wrap').hidden"), 'local reference preview');
  assert.deepEqual(await js('window.referenceFetches'), []);
  await js("window.fetch=window.referenceOriginalFetch;document.querySelector('#clear-reference').click();void 0");
  await putFile(png, 'paper-fox.png', 'image/png');
  await until(() => js("!document.querySelector('#import-pet-button').disabled"), 'staged PNG');
  await js("document.querySelector('#pet-import-name').value='Paper Fox';document.querySelector('#pet-import-name').dispatchEvent(new Event('input'));document.querySelector('#import-pet-button').click()");
  await until(() => js("document.querySelector('#import-status').textContent.startsWith('Imported Paper Fox')"), 'PNG import');
  assert.equal(await js("document.querySelectorAll('#import-state-previews figure').length"), 7);
  assert.equal(config().pet.id, 'codex-bloom');
  const importedId = await js("document.querySelector('#pet-select').value");
  assert.match(importedId, /^pet-/);
  assert.equal(await js("document.querySelector('#use-pet').disabled"), true);
  assert.equal(await js("document.querySelector('#pet-hosting').hidden"), false);
  await js("document.querySelector('#pet-host-url').value='https://localhost/pet/';document.querySelector('#pet-host-url').dispatchEvent(new Event('input'));document.querySelector('#use-pet').click()");
  await until(() => js("document.querySelector('#pet-library-status').dataset.error==='true'"), 'unsafe host rejection');
  assert.equal(config().pet.id, 'codex-bloom');
  await js("document.querySelector('#pet-host-url').value='https://example.com/pets/paper-fox/';document.querySelector('#pet-host-url').dispatchEvent(new Event('input'));document.querySelector('#use-pet').click()");
  await until(() => config().pet.id === importedId, 'hosted custom selection');
  await until(() => js("document.querySelector('#pet-library-status').textContent.startsWith('Paper Fox selected') && !document.querySelector('#use-pet').disabled"), 'custom selection acknowledgement');
  assert.equal(config().pet.baseUrl, 'https://example.com/pets/paper-fox/');
  await js("document.querySelector('#reduce-motion').checked=true;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'))");
  assert.equal(await js("[...document.querySelectorAll('#import-state-previews img')].every(image=>image.getAttribute('src').endsWith('.png'))"), true);
  await js("document.querySelector('#reduce-motion').checked=false;document.querySelector('#reduce-motion').dispatchEvent(new Event('change'));document.querySelector('#import-state-previews').scrollIntoView({behavior:'instant',block:'end'})");
  await screenshot('pet-import.png');
  window.setSize(430, 1050);
  await js("document.querySelector('#import-pet').scrollIntoView({behavior:'instant',block:'start'})");
  assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true);
  await screenshot('pet-import-mobile.png');
  window.setSize(1440, 1100);
  const pack = await js("fetch(document.querySelector('#export-pet').href).then(r=>r.json())");
  assert.equal(pack.format, 'gif-pack'); assert.ok(pack.files.length >= 7);
  assert.deepEqual(await js("fetch(document.querySelector('#download-pet-assets').href).then(async r=>({status:r.status,signature:[...new Uint8Array(await r.arrayBuffer()).slice(0,4)]}))"), { status: 200, signature: [80, 75, 3, 4] });
  const jsonData = Buffer.from(JSON.stringify(pack)).toString('base64');
  await js("document.querySelector('#clear-import').click();document.querySelector('#pet-import-name').value='Literal <img src=x onerror=window.importXSS=1>'");
  await putFile(jsonData, 'paper-fox.pet.json', 'application/json');
  await until(() => js("!document.querySelector('#import-pet-button').disabled"), 'portable pack selection');
  await js("document.querySelector('#import-pet-button').click()");
  await until(() => js("document.querySelector('#import-status').textContent.startsWith('Imported Literal')"), 'portable pack import');
  assert.equal(await js("document.querySelector('#pet-select').selectedOptions[0].textContent.includes('<img')"), true);
  assert.equal(await js("window.importXSS===undefined && !document.querySelector('#pet-select img')"), true);
  assert.equal(config().pet.id, importedId); // Roundtrip preview never auto-activates.
  const count = await js("document.querySelector('#pet-select').options.length");
  await js("document.querySelector('#clear-import').click()");
  await putFile(Buffer.from('not a PNG').toString('base64'), 'broken.png', 'image/png');
  await until(() => js("!document.querySelector('#import-pet-button').disabled"), 'malformed file staging');
  await js("document.querySelector('#import-pet-button').click()");
  await until(() => js("document.querySelector('#import-status').dataset.error==='true' && !document.querySelector('#import-pet').hasAttribute('aria-busy')"), 'malformed import rejection');
  assert.equal(await js("document.querySelector('#pet-select').options.length"), count);
  assert.equal(config().pet.id, importedId);
  window.setSize(430, 1050);
  await js("document.querySelector('#import-pet').scrollIntoView({behavior:'instant',block:'start'})");
  assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true);
  assert.deepEqual(await js('window.studioErrors'), []);
  window.webContents.session.webRequest.onBeforeRequest({ urls: [origin + '/api/*'] }, (_details, callback) => callback({ cancel: true }));
  await window.loadURL(origin + '/assets/pet/animation-gallery.html');
  await until(() => js("document.querySelector('#pet-library-status').textContent.includes('Run codex-rpc serve')"), 'standalone browsing fallback');
  assert.equal(await js("document.querySelector('#use-pet').disabled && document.querySelector('#import-pet-button').disabled"), true);
  await js("document.querySelector('#pet-select').value='codex-bloom';document.querySelector('#pet-select').dispatchEvent(new Event('change'))");
  assert.match(await js("document.querySelector('#preview-image').getAttribute('src')"), /codex-bloom\/coding\.gif$/);
  assert.equal(await js("document.querySelector('#use-pet').disabled"), true);
  console.log('Verified Pet Studio reference prompt, both built-ins, explicit selection, PNG import and seven state previews, public-host validation, portable pack roundtrip, hosting ZIP, malformed-file rejection, literal names, reduced motion, offline browsing fallback, local-only reference preview and mobile layout. Screenshots in docs/.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  window?.destroy(); await server?.closeDashboard();
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
