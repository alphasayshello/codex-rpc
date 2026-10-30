import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sandbox } from "./helpers.js";
import { dispatchEvent, drainEvents, queuedEventCount } from "../src/event-queue.js";
import { applyEvent, drainHookEvents } from "../src/hook.js";
import { config, writeJSON, readJSON } from "../src/store.js";
const cli = fileURLToPath(new URL("../bin/codex-rpc.js", import.meta.url));
test("contended events remain complete, nonblocking metadata until the owner drains them", t => {
  const {rpc}=sandbox(t);fs.mkdirSync(rpc,{recursive:true});
  fs.writeFileSync(path.join(rpc,"event-drain.lock"),JSON.stringify({pid:process.pid,nonce:"test-owner"}));
  const applied=[];const event={type:"tool-start",callId:"one",tool:"read_file"};
  assert.equal(dispatchEvent(event,value=>applied.push(value)),null);
  assert.equal(queuedEventCount(),1);assert.equal(applied.length,0);
  const queued=fs.readdirSync(path.join(rpc,"events")).find(name=>name.endsWith(".json"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(rpc,"events",queued))),event);
  fs.unlinkSync(path.join(rpc,"event-drain.lock"));
  assert.equal(drainEvents(value=>applied.push(value)).processed,1);assert.deepEqual(applied,[event]);
  assert.equal(queuedEventCount(),0);
});
test("dead leases recover, malformed records are discarded, and failed writes remain retryable",t=>{
  const {rpc}=sandbox(t);fs.mkdirSync(rpc,{recursive:true});
  const lock=path.join(rpc,"event-drain.lock");fs.writeFileSync(lock,"incomplete");fs.utimesSync(lock,new Date(0),new Date(0));
  dispatchEvent({type:"tool-start",callId:"recover"},()=>assert.fail("writers do not steal a lease"));
  assert.throws(()=>drainEvents(()=>{throw Error("temporary failure")}),/temporary failure/);
  assert.equal(queuedEventCount(),1);assert.equal(fs.existsSync(lock),false);
  const name=fs.readdirSync(path.join(rpc,"events"))[0];fs.writeFileSync(path.join(rpc,"events",name),"{");
  assert.equal(drainEvents(()=>assert.fail("malformed record applied")).processed,1);
  assert.equal(queuedEventCount(),0);
  assert.throws(()=>dispatchEvent({type:"tool-start",unexpected:"x".repeat(65536)},()=>{}),/64 KiB/);
});
test("parallel real CLI hooks retain every invocation through the serialized state writer",async t=>{
  const {env}=sandbox(t);writeJSON("config.json",{...config(),privacy:"public"});
  const stamp=Date.now();applyEvent({type:"turn-start",sessionId:"parallel-native",turnId:"turn",timestamp:stamp-100});
  await Promise.all(Array.from({length:24},(_,index)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,"hook",JSON.stringify({hook_event_name:"PreToolUse",session_id:"parallel-native",turn_id:"turn",tool_name:"Bash",tool_use_id:`call-${index}`,tool_input:{command:"npm test --secret DONT_PERSIST"}})],{env,windowsHide:true});
    let stderr="";child.stderr.on("data",chunk=>stderr+=chunk);child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error(stderr||`hook exit ${code}`)));
  })));
  while(queuedEventCount())drainHookEvents();
  const state=readJSON("state.json");assert.equal(state.observedToolCalls,24);assert.equal(state.activeTools.length,24);
  assert.equal(new Set(state.activeTools.map(tool=>tool.callId)).size,24);
  assert.ok(!JSON.stringify(state).includes("DONT_PERSIST"));assert.equal(queuedEventCount(),0);
});

test("contended private hooks spool only redacted metadata and honor the kill switch",t=>{
  const {rpc}=sandbox(t);writeJSON("config.json",{...config(),privacy:"private"});
  fs.writeFileSync(path.join(rpc,"event-drain.lock"),JSON.stringify({pid:process.pid,nonce:"private-owner"}));
  const event={hook_event_name:"PreToolUse",session_id:"private-chat",turn_id:"private-turn",tool_name:"Bash",tool_use_id:"private-call",cwd:"/secret-company/project-name",prompt:"SECRET_PROMPT",tool_input:{command:"npm test --token SECRET_TOKEN",file_path:"secret-company/file.js"}};
  assert.equal(applyEvent(event),null);assert.equal(queuedEventCount(),1);
  const filename=fs.readdirSync(path.join(rpc,"events"))[0];
  const bytes=fs.readFileSync(path.join(rpc,"events",filename),"utf8");
  for(const secret of ["SECRET_PROMPT","SECRET_TOKEN","secret-company","project-name","file.js","tool_input"])assert.ok(!bytes.includes(secret),secret);
  const metadata=JSON.parse(bytes);assert.equal(metadata.fileCount,1);assert.equal(metadata.tool,"bash");
  writeJSON("config.json",{...config(),enabled:false});applyEvent({...event,tool_use_id:"disabled-call"});assert.equal(queuedEventCount(),1);
  fs.unlinkSync(path.join(rpc,"event-drain.lock"));drainHookEvents();assert.equal(queuedEventCount(),0);assert.deepEqual(readJSON("state.json"),{});
});
