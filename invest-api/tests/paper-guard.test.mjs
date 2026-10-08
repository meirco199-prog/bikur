import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPaperAccount, assertPaperAccount } from '../scripts/paper-guard.mjs';

test('הגשר מקבל רק חשבון דמה (DU…) ומסרב לחשבון אמיתי', () => {
  assert.equal(isPaperAccount('DUT167879'), true);
  assert.equal(isPaperAccount('du123'), true);
  for (const bad of ['U29029974', 'U1234567', '', null, undefined, 12345, 'XDU1']) assert.equal(isPaperAccount(bad), false, String(bad));
  assert.equal(assertPaperAccount('DUT167879'), 'DUT167879');
  assert.throws(() => assertPaperAccount('U29029974'), /מסרב לעבוד מול חשבון אמיתי/);
});

test('אין עקיפה במשתנה סביבה, והגשר באמת משתמש בשומר', () => {
  const guard = readFileSync(new URL('../scripts/paper-guard.mjs', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../scripts/ibkr-bridge.mjs', import.meta.url), 'utf8');
  assert.ok(!/process\.env/.test(guard), 'השומר לא קורא משתני סביבה');
  assert.ok(!/ALLOW_LIVE/.test(bridge), 'אין דגל עקיפה בגשר');
  assert.ok(/assertPaperAccount\(acct\)/.test(bridge), 'הגשר קורא לשומר לפני כל פעולה על החשבון');
  assert.ok(bridge.indexOf('assertPaperAccount(acct)') < bridge.indexOf("worker('/agent/broker/pending')"), 'השומר רץ לפני משיכת הפקודות');
});
