import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { buildGallery } from '../src/assets/gallery.js';
import { states, visualStates, bonusStates } from '../src/assets/generate-pet-gifs.js';
import { effectDescriptions } from '../src/assets/pixel-effects.js';
const gallery = () => buildGallery({ states, visualStates, bonusStates, effectDescriptions });

function fixture({ embedded = true, saved = {} } = {}) {
  const listeners = new Map(), store = new Map(Object.entries(saved)), writes = [], nodes = new Map(), observations = [];
  let librarySelected = 'codex', libraryCalls = 0;
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = {}; this.children = []; this.value = ''; this.hidden = false; this.isConnected = true; this.srcWrites = []; this.listeners = new Map(); this.rect = { top: 20, left: 20, bottom: 180, right: 180, width: 160, height: 160 }; }
    get src() { return this.attributes.src; } set src(value) { this.srcWrites.push(value); this.attributes.src = value; }
    getAttribute(name) { return this.attributes[name] ?? null; } setAttribute(name,value) { this.attributes[name] = String(value); } removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type,handler) { this.listeners.set(type,handler); }
    append(...children) { for(const child of children) { child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    querySelector() { return null; }
    querySelectorAll(selector) { const descendants = this.children.flatMap(child => [child,...child.querySelectorAll('*')]); return selector === 'img' ? descendants.filter(child => child.tagName === 'IMG') : descendants; }
    closest(selector) { if(selector !== '[hidden]') return null; for(let node = this;node;node=node.parentNode) if(node.hidden) return node; return null; }
    getBoundingClientRect() { return this.rect; }
    focus() {} select() {} scrollIntoView() {}
  }
  const get = selector => { if(!nodes.has(selector)) nodes.set(selector,new Element(selector.includes('image')?'img':'div')); return nodes.get(selector); };
  const cards = ['writing','thinking','idle'].map((state,index) => { const card = new Element('button'); card.dataset = { scene:state,label:state,kind:'core',family:'work',fps:'20',duration:'4',recommended:state,description:state };card.attributes['aria-pressed'] = String(index === 0);return card; });
  const hero = get('#preview-image'); hero.dataset.scene = 'writing'; hero.attributes.src = 'codex-pet-writing.gif';
  const cardImages = cards.map((card,index) => { const image=new Element('img');image.dataset.scene=card.dataset.scene;image.attributes.src='codex-pet-'+card.dataset.scene+'.gif';if(index>0) image.rect={...image.rect,top:1200,bottom:1360};image.parentNode=card;return image; });
  get('#family-filter').value='all'; get('#reference-preview-wrap').hidden=true; get('#import-file-previews').hidden=true;get('#import-state-previews').hidden=true;
  const document = { documentElement:{dataset:{theme:'dark'}},body:{dataset:{background:'dark'}},baseURI:'http://127.0.0.1:47474/assets/pet/animation-gallery.html',hidden:false,
    querySelector:get,
    querySelectorAll(selector) { if(selector === '.scene-card') return cards;if(selector === '.scene-image, #import-state-previews img, .import-file-previews img[data-animated-source]') return [hero,...cardImages,...get('#import-state-previews').querySelectorAll('img'),...get('#import-file-previews').querySelectorAll('img').filter(image => image.dataset.animatedSource)];return []; },
    addEventListener(type,handler) { listeners.set('document:'+type,handler); },createElement(tag) { return new Element(tag); } };
  const parent = {}, window = { parent,addEventListener(type,handler) { listeners.set('window:'+type,handler); } };
  class Observer {
    constructor(callback) { this.callback=callback;this.targets=new Set();observations.push(this); }
    observe(target) { this.targets.add(target); } unobserve(target) { this.targets.delete(target); }
    intersect(target,visible) { this.callback([{target,isIntersecting:visible,intersectionRatio:visible?1:0}]); }
  }
  const animations=Object.fromEntries(cards.map(card=>[card.dataset.scene,{path:'/assets/pet/codex-pet-'+card.dataset.scene+'.gif',previewPath:'/assets/pet/codex-pet-'+card.dataset.scene+'.svg',url:'https://example.com/'+card.dataset.scene+'.gif'}]));
  class Reader { readAsDataURL(file) { this.result=file.data;queueMicrotask(()=>this.onload()); } }
  class LocalURL extends URL { static createObjectURL() { return 'blob:layout-fixture'; } }
  vm.runInNewContext(gallery().js,{document,window,location:{protocol:'http:',hostname:'127.0.0.1',origin:'http://127.0.0.1:47474',search:embedded?'?embed=1':''},localStorage:{getItem:key=>store.get(key)??null,setItem(key,value){store.set(key,value);writes.push({key,value});}},URL:LocalURL,URLSearchParams,Blob,FileReader:Reader,IntersectionObserver:Observer,innerWidth:1280,innerHeight:800,matchMedia:()=>({matches:false,addEventListener(){}}),fetch:async()=>{ libraryCalls++; return {ok:true,json:async()=>({pets:[{id:'codex',name:'Classic',builtin:true,animations},{id:'codex-bloom',name:'Bloom',builtin:true,animations}],selected:librarySelected})}; },navigator:{clipboard:{writeText:async()=>{}}}});
  const send = data => listeners.get('window:message')({origin:'http://127.0.0.1:47474',source:parent,data:{type:'codex-rpc:appearance',theme:'dark',motion:'full',active:true,...data}});
  const ready = () => new Promise(resolve => setImmediate(resolve));
  return { document,window,parent,listeners,store,writes,get,cards,hero,cardImages,observer:observations[0],send,ready,setLibrarySelected(id) { librarySelected = id; },get libraryCalls() { return libraryCalls; },async fire(selector,type,event={}) { await get(selector).listeners.get(type)?.({target:get(selector),...event});await ready(); } };
}

test('Studio uses the shared token sheet and generated assets stay reproducible',()=>{
  const built=gallery();assert.ok(built.html.indexOf('../ui/tokens.css')<built.html.indexOf('animation-gallery.css'));
  assert.match(built.css,/html\[data-embedded=true\] \.topbar/);assert.match(built.css,/--bg:var\(--ui-bg,#212121\)/);
  for(const [ext,value]of Object.entries(built))assert.equal(fs.readFileSync(new URL('../assets/pet/animation-gallery.'+ext,import.meta.url),'utf8'),value);
});

test('embedded appearance accepts only the same-origin parent, preserves drafts and never writes standalone preferences',async()=>{
  const f=fixture();await f.ready();assert.equal(f.document.documentElement.dataset.embedded,'true');
  f.get('#pet-brief').value='A quiet owl, matching my attached image';await f.fire('#pet-brief','input');const prompt=f.get('#pet-prompt').value;
  f.get('#pet-import-name').value='My owl draft';const files=[{name:'owl.png',size:12,data:'data:image/png;base64,aGVsbG8='}];f.get('#pet-import-files').files=files;await f.fire('#pet-import-files','change');assert.equal(f.get('#import-pet-button').disabled,false);
  for(const event of [{origin:'https://other.example',source:f.parent},{origin:'http://127.0.0.1:47474',source:{}}])f.listeners.get('window:message')({...event,data:{type:'codex-rpc:appearance',theme:'light',motion:'reduced',active:false}});
  assert.equal(f.document.documentElement.dataset.theme,'dark');assert.equal(f.document.documentElement.dataset.motion,'full');
  f.send({theme:'light',motion:'reduced',active:false});assert.equal(f.document.documentElement.dataset.theme,'light');assert.equal(f.document.documentElement.dataset.motion,'reduced');assert.equal(f.get('#reduce-motion').disabled,true);
  assert.ok([f.hero,...f.cardImages].every(image=>image.src.endsWith('.svg')));
  assert.equal(f.get('#pet-brief').value,'A quiet owl, matching my attached image');assert.equal(f.get('#pet-prompt').value,prompt);assert.equal(f.get('#pet-import-name').value,'My owl draft');assert.equal(f.get('#pet-import-files').files,files);assert.equal(f.get('#import-pet-button').disabled,false);assert.deepEqual(f.writes,[]);
  f.send({theme:'dark',motion:'full',active:true});assert.equal(f.document.documentElement.dataset.motion,'full');assert.equal(f.get('#play-toggle').disabled,false);assert.ok(f.hero.src.endsWith('.gif'));assert.deepEqual(f.writes,[]);
});

test('offscreen previews freeze, visible GIFs do not restart and route visibility preserves a local pause',async()=>{
  const f=fixture();await f.ready();const offscreen=f.cardImages[1];assert.ok(offscreen.src.endsWith('.svg'));assert.ok(f.hero.src.endsWith('.gif'));
  f.observer.intersect(offscreen,true);assert.ok(offscreen.src.endsWith('.gif'));const writes=offscreen.srcWrites.length;f.send({});f.send({});assert.equal(offscreen.srcWrites.length,writes);
  f.hero.attributes.src='/assets/pet/codex-pet-writing.gif';const before=f.hero.srcWrites.length;f.send({});assert.equal(f.hero.srcWrites.length,before);
  f.observer.intersect(offscreen,false);assert.ok(offscreen.src.endsWith('.svg'));
  f.send({active:false});assert.ok(f.hero.src.endsWith('.svg'));f.send({active:true});assert.ok(f.hero.src.endsWith('.gif'));
  await f.fire('#play-toggle','click');assert.ok(f.hero.src.endsWith('.svg'));assert.equal(f.store.get('codex-pet-studio-paused'),'true');assert.equal(f.store.has('codex-pet-gallery-paused'),false);
  f.send({active:false});f.send({active:true});assert.ok(f.hero.src.endsWith('.svg'));assert.equal(f.get('#play-toggle').textContent,'Play animations');
});

test('standalone/offline gallery ignores parent controls and keeps its original preference namespace',async()=>{
  const f=fixture({embedded:false});await f.ready();assert.equal(f.document.documentElement.dataset.embedded,'false');f.send({theme:'light',motion:'reduced',active:false});assert.equal(f.document.documentElement.dataset.theme,'dark');assert.equal(f.document.documentElement.dataset.motion,'full');
  await f.fire('#play-toggle','click');assert.equal(f.store.get('codex-pet-gallery-paused'),'true');assert.equal(f.store.has('codex-pet-studio-paused'),false);
  f.document.hidden=true;f.listeners.get('document:visibilitychange')();assert.ok(f.hero.src.endsWith('.svg'));
});


test('returning to embedded Studio refreshes live selection without resetting preview, hosting or import drafts',async()=>{
  const f=fixture();await f.ready();
  f.get('#pet-import-name').value='An unfinished owl';f.get('#pet-host-url').value='https://example.com/my-unsaved-folder/';f.get('#pet-brief').value='Soft feather details';await f.fire('#pet-brief','input');const prompt=f.get('#pet-prompt').value;
  const files=[{name:'owl.png',size:12,data:'data:image/png;base64,aGVsbG8='}];f.get('#pet-import-files').files=files;await f.fire('#pet-import-files','change');
  const writes=f.hero.srcWrites.length, calls=f.libraryCalls;
  f.send({active:false});f.setLibrarySelected('codex-bloom');f.send({active:true});f.send({active:false});f.send({active:true});
  assert.equal(f.libraryCalls,calls+1); // Repeated activation does not start concurrent refreshes.
  const resumedWrites=f.hero.srcWrites.length;
  await f.ready();await f.ready();
  assert.equal(f.get('#pet-select').value,'codex');assert.match(f.get('#pet-library-status').textContent,/Bloom is selected for Discord/);assert.equal(f.get('#use-pet').textContent,'Use on Discord');
  assert.equal(f.get('#pet-import-name').value,'An unfinished owl');assert.equal(f.get('#pet-host-url').value,'https://example.com/my-unsaved-folder/');assert.equal(f.get('#pet-prompt').value,prompt);assert.equal(f.get('#pet-import-files').files,files);assert.equal(f.get('#import-pet-button').disabled,false);
  const settledWrites=f.hero.srcWrites.length;assert.equal(settledWrites,resumedWrites);assert.ok(settledWrites>=writes);f.send({});await f.ready();assert.equal(f.hero.srcWrites.length,settledWrites);
});


test('selected GIF files use static previews for reduced motion and release observer references when cleared',async()=>{
  const f=fixture();await f.ready();const file={name:'writing.gif',size:12,data:'data:image/gif;base64,R0lGODlh'};f.get('#pet-import-files').files=[file];await f.fire('#pet-import-files','change');
  const image=f.get('#import-file-previews').querySelectorAll('img')[0];assert.ok(image);assert.ok(f.observer.targets.has(image));assert.equal(image.src,file.data);
  f.send({motion:'reduced'});assert.match(image.src,/^data:image\/svg\+xml/);f.send({motion:'full'});assert.equal(image.src,file.data);
  await f.fire('#clear-import','click');assert.ok(!f.observer.targets.has(image));assert.equal(f.get('#import-file-previews').children.length,0);
});
