import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from './helpers.js';
import { config, validateConfig } from '../src/store.js';
import { buildActivity, getVisualState } from '../src/presence.js';
import { workspaceBranch } from '../src/workspace.js';
const now = 1700000100000;
const chat = { model: 'o4-mini', output: 22800, tokens: 9000000, prompts: 6 };
test('live editing uses operation diff metadata, output-only counters and no buttons', t => {
  sandbox(t); const c = {...config(), privacy:'public', buttons:[{label:'Ignore me',url:'https://example.com'}]};
  const state={status:'working',tool:'apply_patch',project:'codex-rpc',file:'src/client.js',currentFiles:['src/client.js','test/client.js'],currentFileCount:2,linesAdded:42,linesRemoved:12,operationStartedAt:now-32000,startedAt:now-900000};
  const p=buildActivity(state,{},c,chat,now);
  assert.equal(p.details,'Writing code across 2 files');
  assert.match(p.state,/Editing src\/client.js \(\+42 \/ -12\).*22.8k output tokens/);
  assert.match(p.assets.large_image,/codex-pet-patching/);
  assert.equal(p.timestamps.start,(now-32000)/1000); assert.equal(p.buttons,undefined);
  const long = buildActivity({...state,file:'src/'+ 'long-folder/'.repeat(20)+'client.js'}, {}, c, chat, now);
  assert.match(long.state, /client.js \(\+42 \/ -12\).*22.8k output tokens/);
  assert.ok(long.state.length <= 128);
  const priv=buildActivity(state,{}, {...c,privacy:'private'},chat,now);
  assert.ok(!JSON.stringify(priv).includes('client.js')); assert.match(priv.state,/Editing files/);
});
test('thinking timer, bash summary, idle branch and safe missing-metadata fallbacks', t => {
  sandbox(t);const c={...config(),privacy:'public'};
  let p=buildActivity({status:'thinking',thinkingStartedAt:now-65000}, {}, c, chat,now);
  assert.equal(p.details,'Pondering solution... (Elapsed: 1:05)');
  p=buildActivity({status:'working',tool:'exec_command',commandSummary:'npm test'}, {}, c, chat,now);
  assert.match(p.state,/^Running: npm test/);
  p=buildActivity({status:'idle',project:'codex-rpc',branch:'feature/pets'}, {}, c, chat,now);
  assert.equal(p.details,'Session idle');
  assert.match(p.state,/^Idle in codex-rpc \(feature\/pets\)/);
  p=buildActivity({status:'working',tool:'read_file',project:'codex-rpc'}, {}, c, {...chat,output:null},now);
  assert.equal(p.details,'Working in codex-rpc');assert.ok(!p.state.includes('9000000'));
  const session=buildActivity({status:'thinking',thinkingStartedAt:now-10000,startedAt:now-100000}, {}, {...c,presence:{...c.presence,timer:'session'}},chat,now);
  assert.equal(session.timestamps.start,(now-100000)/1000);
});
test('tool scenes, approval waiting and bounded success settle independently of token updates',t=>{
  sandbox(t); const c=config();
  for(const [s,expected] of [[{status:'idle'},'idle'],[{status:'thinking'},'thinking'],[{status:'working',tool:'shell'},'terminal'],[{status:'working',tool:'apply_patch'},'patching'],[{status:'waiting',waitingReason:'error'},'error'],[{status:'waiting',waitingReason:'approval'},'waiting']])assert.equal(getVisualState(s,c,now),expected);
  assert.equal(getVisualState({status:'waiting',waitingReason:'done',eventTime:now-1000},c,now),'done');
  assert.equal(getVisualState({status:'waiting',waitingReason:'done',eventTime:now-16000},c,now),'idle');
});
test('asset keys and custom legacy URLs remain usable with advanced scenes',t=>{
  sandbox(t);let c=validateConfig({...config(),assets:{...config().assets,patching:'anim_patch_large'}});
  assert.equal(buildActivity({status:'working',tool:'apply_patch'},{},c,chat,now).assets.large_image,'anim_patch_large');
  c={...config(),assets:{...config().assets,working:'https://example.com/custom.gif'}};
  assert.equal(buildActivity({status:'working',tool:'apply_patch'},{},c,chat,now).assets.large_image,'https://example.com/custom.gif');
});
test('branch metadata resolves repositories/worktrees/detached HEAD and fails quietly',t=>{
  const {temp}=sandbox(t);const project=path.join(temp,'project');fs.mkdirSync(path.join(project,'.git'),{recursive:true});fs.mkdirSync(path.join(project,'src'));
  fs.writeFileSync(path.join(project,'.git/HEAD'),'ref: refs/heads/feature/pixels\n');assert.equal(workspaceBranch(path.join(project,'src')),'feature/pixels');
  fs.writeFileSync(path.join(project,'.git/HEAD'),'a'.repeat(40));assert.equal(workspaceBranch(project),'detached@aaaaaaa');
  const tree=path.join(temp,'tree');fs.mkdirSync(tree);fs.writeFileSync(path.join(tree,'.git'),`gitdir: ${path.join(project,'.git')}\n`);assert.equal(workspaceBranch(tree),'detached@aaaaaaa');
  assert.equal(workspaceBranch('relative'),null); assert.equal(workspaceBranch(path.join(temp,'missing')),null);
});

test('conceptual uppercase lifecycle aliases are accepted; inherited object keys are not events', async t => {
  sandbox(t);const {normalizeEvent}=await import('../src/hook.js');
  for(const [type,status,visual] of [['SLEEPING','idle','idle'],['PLANNING','thinking','thinking'],['CODING','working','writing'],['DIFF_APPLYING','working','patching'],['STUCK','waiting','error'],['SUCCESS','waiting','done']]) {
    const e=normalizeEvent({type}); assert.equal(e.status,status);assert.equal(e.visualState,visual);
  }
  assert.equal(normalizeEvent({type:'constructor'}),null);
  assert.equal(normalizeEvent({type:'__proto__'}),null);
});
