// Meta inbound (SDR-PIVOT P6, ships off): signature, handshake, and the payload parser. The payloads below follow
// Meta's docs [VERIFY]; they are not captured payloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, verifyHandshake, parseMetaEvents } from '../src/services/meta.mjs';

const SECRET = 'app-secret-not-real';
const sign = (buf, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(buf).digest('hex')}`;

test('signature: only the exact raw bytes under our app secret pass', () => {
  const raw = Buffer.from('{"object":"instagram","entry":[]}');
  assert.equal(verifyMetaSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyMetaSignature(Buffer.from(`${raw} `), sign(raw), SECRET), false, 'one byte more');
  assert.equal(verifyMetaSignature(raw, sign(raw, 'other'), SECRET), false);
  assert.equal(verifyMetaSignature(raw, sign(raw).replace('sha256=', 'sha1='), SECRET), false);
  assert.equal(verifyMetaSignature(raw, sign(raw).toUpperCase(), SECRET), false);
  assert.equal(verifyMetaSignature(raw, undefined, SECRET), false);
  assert.equal(verifyMetaSignature(raw, sign(raw), ''), false, 'no secret configured: nothing passes');
  assert.equal(verifyMetaSignature(raw.toString(), sign(raw), SECRET), false, 'a re-serialized string is not the raw body');
});

test('handshake: the challenge comes back only for our verify token', () => {
  const q = (o) => ({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-123', 'hub.challenge': '1158201444', ...o });
  assert.equal(verifyHandshake(q(), 'vt-123'), '1158201444');
  assert.equal(verifyHandshake(q({ 'hub.verify_token': 'vt-124' }), 'vt-123'), null);
  assert.equal(verifyHandshake(q({ 'hub.mode': 'unsubscribe' }), 'vt-123'), null);
  assert.equal(verifyHandshake(q({ 'hub.challenge': '<script>' }), 'vt-123'), null, 'reflected text is never echoed');
  assert.equal(verifyHandshake(q(), ''), null);
});

test('parser: IG comments and DMs, FB comments and Messenger; our own echoes and odd entries are skipped', () => {
  const ig = { object: 'instagram', entry: [
    { id: '1789', time: 1759460000, changes: [
      { field: 'comments', value: { id: 'c1', text: 'how much is it??', from: { id: '555', username: 'jo.bakes' }, media: { id: 'm9' } } },
      { field: 'comments', value: { id: 'c2', text: 'Thanks for asking!', from: { id: '1789', username: 'us' }, media: { id: 'm9' } } },
      { field: 'comments', value: { id: 'c3', from: { id: '556' } } },
      { field: 'mentions', value: { media_id: 'm1' } },
    ], messaging: [
      { sender: { id: '777' }, recipient: { id: '1789' }, timestamp: 1759460100000, message: { mid: 'mid.1', text: 'Can we hop on a call?' } },
      { sender: { id: '1789' }, recipient: { id: '777' }, timestamp: 1759460200000, message: { mid: 'mid.2', text: 'Sure!', is_echo: true } },
      { sender: { id: '778' }, recipient: { id: '1789' }, message: { mid: 'mid.3', attachments: [{ type: 'image' }] } },
    ] },
  ] };
  const a = parseMetaEvents(ig);
  assert.deepEqual(a.map((e) => [e.channel, e.externalId, e.fromId, e.text]), [
    ['instagram_comment', 'c1', '555', 'how much is it??'],
    ['instagram_dm', 'mid.1', '777', 'Can we hop on a call?'],
  ]);
  assert.equal(a[0].threadId, 'm9');
  assert.equal(a[0].at.toISOString(), new Date(1759460000 * 1000).toISOString());
  const fb = { object: 'page', entry: [{ id: '42', time: 1759460000, changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '42_1', post_id: '42_9', message: 'Too pricey', from: { id: '9', name: 'Pat' }, created_time: 1759460050 } },
    { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: '42_2', post_id: '42_9' } },
    { field: 'feed', value: { item: 'reaction', verb: 'add' } },
  ], messaging: [{ sender: { id: '10' }, recipient: { id: '42' }, timestamp: 1759460300000, message: { mid: 'm.fb', text: 'Hi, info please' } }] }] };
  assert.deepEqual(parseMetaEvents(fb).map((e) => [e.channel, e.externalId, e.fromName ?? e.fromId]), [
    ['facebook_comment', '42_1', 'Pat'], ['messenger', 'm.fb', '10']]);
  for (const junk of [null, {}, { object: 'whatsapp_business_account', entry: [{ id: '1' }] }, { object: 'instagram', entry: 'x' }, { object: 'page', entry: [{}] }]) {
    assert.deepEqual(parseMetaEvents(junk), []);
  }
  const long = parseMetaEvents({ object: 'instagram', entry: [{ id: '1', changes: [{ field: 'comments', value: { id: 'c', text: 'x'.repeat(9000), from: { id: '2' } } }] }] });
  assert.equal(long[0].text.length, 5000);
});
