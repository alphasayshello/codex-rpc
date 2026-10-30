import { test } from "node:test";
import assert from "node:assert/strict";
import { PresenceScheduler } from "../src/presence-scheduler.js";
const activity = (text) => ({ details: text });
function fixture(options = {}) {
  let now = 0;
  const sent = [], scheduler = new PresenceScheduler({ now: () => now, ...options });
  const send = async (payload) => { sent.push({ at: now, payload }); };
  return { scheduler, sent, send, advance: (ms) => { now += ms; } };
}

test("first publish is immediate; counter storms coalesce to the latest steady update", async () => {
  const { scheduler: s, sent, send, advance } = fixture();
  s.update(activity("initial"), "working");
  assert.equal(await s.flush(send), true);
  for (let i = 0; i < 1000; i++) {
    s.update(activity(`counter ${i}`), "working");
    assert.equal(await s.flush(send), false);
  }
  assert.equal(sent.length, 1);
  advance(14999);
  assert.equal(await s.flush(send), false);
  advance(1);
  assert.equal(await s.flush(send), true);
  assert.equal(sent[1].payload.details, "counter 999");
  assert.equal(await s.flush(send), false);
});

test("major transitions can use one spare token but never an unbounded burst", async () => {
  const { scheduler: s, sent, send, advance } = fixture();
  s.update(activity("idle"), "idle");
  await s.flush(send);
  s.update(activity("working"), "working");
  assert.equal(await s.flush(send), true);
  for (let i = 0; i < 100; i++) {
    s.update(activity(`major ${i}`), `major-${i}`);
    assert.equal(await s.flush(send), false);
  }
  assert.equal(sent.length, 2);
  advance(15000);
  await s.flush(send);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].payload.details, "major 99");
  assert.equal(sent[2].at, 15000);
});

test("latest minor observation after a major retains transition priority", async () => {
  const { scheduler: s, sent, send } = fixture();
  s.update(activity("idle"), "idle");
  await s.flush(send);
  s.update(activity("working old file"), "working");
  s.update(activity("working newest file"), "working");
  assert.equal(await s.flush(send), true);
  assert.equal(sent[1].payload.details, "working newest file");
});

test("returning to the acknowledged payload cancels obsolete buffered work", async () => {
  const { scheduler: s, sent, send, advance } = fixture();
  s.update(activity("stable"), "working");
  await s.flush(send);
  s.update(activity("obsolete"), "working");
  s.update(activity("stable"), "working");
  advance(15000);
  assert.equal(await s.flush(send), false);
  assert.equal(sent.length, 1);
});

test("pause clear bypasses budget once, cancels pending activity, resume/reconnect republishes", async () => {
  const { scheduler: s, sent, send } = fixture();
  s.update(activity("idle"), "idle"); await s.flush(send);
  s.update(activity("working"), "working"); await s.flush(send);
  s.update(activity("obsolete"), "thinking");
  assert.equal(await s.clear(send), true);
  assert.equal(sent.at(-1).payload, null);
  assert.equal(await s.clear(send), false);
  assert.equal(await s.flush(send), false);
  s.reset();
  s.update(activity("working"), "working");
  assert.equal(await s.flush(send), true);
  assert.equal(sent.at(-1).payload.details, "working");
  s.reset();
  s.update(activity("working"), "working");
  assert.equal(await s.flush(send), true);
});

test("failed sends retain ACK and latest pending state while attempts consume budget", async () => {
  const { scheduler: s, sent, send, advance } = fixture();
  s.update(activity("initial"), "idle"); await s.flush(send);
  const ack = s.acknowledged;
  s.update(activity("failed"), "working");
  await assert.rejects(s.flush(async () => { throw new Error("No ACK"); }), /No ACK/);
  assert.equal(s.acknowledged, ack);
  assert.equal(s.pending.payload.details, "failed");
  s.update(activity("latest"), "thinking");
  assert.equal(await s.flush(send), false);
  advance(15000);
  assert.equal(await s.flush(send), true);
  assert.equal(sent.at(-1).payload.details, "latest");
});

test("initial failures cannot flood attempts and synchronous errors do not stick in-flight", async () => {
  const { scheduler: s, send, advance } = fixture();
  let attempts = 0;
  const fail = () => { attempts++; throw new Error("sync failure"); };
  s.update(activity("first"), "working");
  await assert.rejects(s.flush(fail));
  await assert.rejects(s.flush(fail));
  for (let i = 0; i < 20; i++) assert.equal(await s.flush(fail), false);
  assert.equal(attempts, 2);
  assert.equal(s.acknowledged, undefined);
  advance(15000);
  assert.equal(await s.flush(send), true);
});

test("in-flight publishing keeps newer observations and clear follows its ACK", async () => {
  const { scheduler: s, sent, send } = fixture();
  let resolve;
  s.update(activity("old"), "working");
  const flight = s.flush(() => new Promise((done) => { resolve = done; }));
  await Promise.resolve();
  s.update(activity("new"), "thinking");
  assert.equal(await s.flush(send), false);
  const clear = s.clear(send);
  resolve();
  await flight;
  assert.equal(await clear, true);
  assert.deepEqual(sent.map((entry) => entry.payload), [null]);
  assert.equal(s.acknowledged, "null");
});

test("reset invalidates stale ACKs and configurable capacity/interval remain bounded", async () => {
  const { scheduler: s, sent, send, advance } = fixture({ capacity: 1, intervalMs: 20000 });
  s.update(activity("first"), "idle"); await s.flush(send);
  s.update(activity("major"), "working");
  advance(15000);
  assert.equal(await s.flush(send), false);
  advance(5000);
  assert.equal(await s.flush(send), true);
  assert.equal(sent.length, 2);
  assert.throws(() => s.setPolicy({ capacity: 99 }), /capacity/);
  assert.equal(s.capacity, 1);
  assert.throws(() => new PresenceScheduler({ intervalMs: 14999 }), /interval/);
  let resolve;
  advance(20000);
  s.update(activity("old connection"), "thinking");
  const old = s.flush(() => new Promise((done) => { resolve = done; }));
  await Promise.resolve();
  s.reset();
  s.update(activity("new connection"), "working");
  resolve(); await old;
  assert.equal(s.acknowledged, undefined);
  assert.equal(await s.flush(send), true);
  assert.equal(sent.at(-1).payload.details, "new connection");
});
