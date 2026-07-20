const { test } = require('node:test');
const assert = require('node:assert');
const { getToken } = require('../lib/auth');

test('getToken 解析 Bearer header', () => {
  assert.equal(getToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.equal(getToken({ headers: {} }), '');
  assert.equal(getToken({ headers: { authorization: 'abc123' } }), 'abc123');
});
