// node --experimental-strip-types --test src/lib/api/demo/clientConvo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectConversation, maskPhone } from './clientConvo.ts';

const body = 'Hi, call me at 615-555-0142 or (615) 555 0142 about the roof on Maple Street, my name is Dana Whitfield.';
const intents = ['meeting_request', 'positive_inquiry', 'question', 'objection', 'referral', 'out_of_office', 'not_interested', 'unsubscribe', 'wrong_person', 'bounce', 'unclassified'];
const MASKED = '(•••) •••-0142';

test('no row carries a 7+ digit run, or any of the message text, whatever the body says', () => {
  for (const intent of intents) for (const channel of ['email', 'linkedin', 'form']) {
    const row = projectConversation('c1', 'Dana W.', '+16155550142', { channel, receivedAt: '2026-10-20T10:00:00Z', intent, handledAt: null, body });
    const text = JSON.stringify(row);
    // The timestamp has digits by design. Every text field a client reads must have no run of 7 or more digits, even split by spaces, dots or dashes.
    for (const v of [row.name, row.maskedPhone ?? '', row.summary]) {
      assert.doesNotMatch(v.replace(/•/g, '').replace(/[\s().-]/g, ''), /\d{7,}/, `${intent}/${channel}: ${text}`);
    }
    assert.equal(row.maskedPhone, MASKED);
    for (const w of ['615-555', 'roof', 'Maple', 'Whitfield', 'call me']) assert.ok(!text.includes(w), `${w} leaked: ${text}`);
    assert.ok(!('body' in row) && !('subject' in row) && !('intent' in row));
  }
});

test('the phone shows its last four digits only; short or missing numbers show nothing', () => {
  assert.equal(maskPhone('+16155550142'), MASKED);
  assert.equal(maskPhone('555'), null);
  assert.equal(maskPhone(null), null);
});

test('status follows handledAt', () => {
  const base = { channel: 'form', receivedAt: 'x', intent: 'question' };
  assert.equal(projectConversation('c', 'n', null, { ...base, handledAt: null }).status, 'open');
  assert.equal(projectConversation('c', 'n', null, { ...base, handledAt: 'y' }).status, 'handled');
});
