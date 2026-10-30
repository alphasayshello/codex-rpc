import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { estimateCost, modelPrice } from '../src/pricing.js';
import { scan } from '../src/scanner.js';
import { readJSON, writeJSON } from '../src/store.js';
import { sandbox, jsonl } from './helpers.js';
test('owner rates use most specific model; missing cache rates do not mean free tokens',()=>{
  assert.deepEqual(modelPrice('gpt-daybreak-blue-latest'),[4,20,0.4]);
  assert.deepEqual(modelPrice('gpt-5.4-mini-2026-01-01'),[0.75,4.5,0.075]);
  assert.equal(estimateCost('gpt-4',{input:1000000,output:0,cached:500000}),30);
  assert.equal(estimateCost('gpt-daybreak-blue-latest',{input:1000000,output:100000,cached:500000,reasoning:20000}),4.2);
  assert.equal(estimateCost('not-a-priced-model',{input:10,output:10}),null);
});
test('pricing changes invalidate unchanged history cache and recalculate estimates',async t=>{
  const {codex}=sandbox(t);
  jsonl(path.join(codex,'sessions/prices.jsonl'),[
    {type:'session_meta',timestamp:'2026-10-30T12:00:00Z',payload:{id:'prices'}},
    {type:'turn_context',timestamp:'2026-10-30T12:00:01Z',payload:{model:'gpt-daybreak-blue-latest'}},
    {type:'event_msg',timestamp:'2026-10-30T12:00:02Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,output_tokens:100}}}},
  ]);
  let result=await scan();assert.equal(result.filesScanned,1);assert.ok(result.totals.cost>0);
  result=await scan();assert.equal(result.filesReused,1);
  const cache=readJSON('scanner-cache.json');cache.pricingHash='previous-prices';
  for(const entry of Object.values(cache.files))entry.data.totals.cost=999;
  writeJSON('scanner-cache.json',cache);
  result=await scan();assert.equal(result.filesScanned,1);assert.equal(result.filesReused,0);assert.ok(result.totals.cost<1);
});
