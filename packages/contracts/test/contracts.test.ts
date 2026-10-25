import assert from 'node:assert/strict';
import test from 'node:test';
import { commissionForAdFee, formatCny, referralForCommission } from '../src/index.ts';

test('普通档按广告费的 0.32% 计算佣金', () => {
  assert.equal(commissionForAdFee(100_000, 'NORMAL'), 320);
  assert.equal(commissionForAdFee(20_000, 'NORMAL'), 64);
});

test('福利档按广告费的 5% 计算佣金', () => {
  assert.equal(commissionForAdFee(100_000, 'WELFARE'), 5_000);
});

test('直属上级返佣向下取整到分', () => {
  assert.equal(referralForCommission(64), 12);
  assert.equal(referralForCommission(320), 64);
});

test('金额按整数分格式化为人民币', () => {
  assert.equal(formatCny('1234567'), '¥12,345.67');
  assert.equal(formatCny(-320), '-¥3.20');
});
