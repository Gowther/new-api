'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzePost, buildRemark } = require('./linux-do-newapi-extractor.user.js');

const KEY = 'sk-' + 'a'.repeat(64);
const OTHER_KEY = 'sk-' + 'b'.repeat(64);
const GO_URL = 'https://opencode.ai/zen/go';

test('remarks default to classic new-api while honoring an explicit type', () => {
  const prefix = 'https://linux.do/t/example/123\nhttps://linux.do/u/alice/activity\n';
  for (const [type, path] of [
    [undefined, '/console/log'],
    ['', '/console/log'],
    ['newapi-default', '/usage-logs/common'],
    ['sub2api', '/usage'],
  ]) {
    assert.equal(
      buildRemark('https://linux.do/t/example/123', 'alice', 'https://upstream.example', false, type),
      prefix + 'https://upstream.example' + path,
    );
  }
});

test('fills the Go URL when an OpenCode title accompanies a key without a URL', () => {
  for (const title of ['OpenCode', '分享OPENCODE密钥', 'Open Code Go', 'open-code', 'open_code']) {
    const rows = analyzePost({ title, text: KEY });
    assert.equal(rows.length, 1, title);
    assert.equal(rows[0].key, KEY);
    assert.equal(rows[0].url, GO_URL, title);
    assert.equal(rows[0].official, false);
    assert.equal(rows[0].vendor, 'OpenCode Go');
  }
});

test('leaves an unknown key URL empty when the title does not identify OpenCode', () => {
  for (const title of [undefined, '', 'Shared API keys']) {
    const rows = analyzePost({ title, text: KEY });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, '');
  }
});

test('uses extracted body, link, JSON and encoded URLs ahead of the title', () => {
  const bodyUrl = 'https://upstream.example';
  const json = JSON.stringify({ base_url: bodyUrl + '/v1', api_key: KEY });
  for (const post of [
    { text: bodyUrl + '/v1\n' + KEY },
    { text: KEY, linkUrls: [bodyUrl + '/v1'] },
    { text: json, codeBlocks: [json] },
    { text: Buffer.from(json).toString('base64') },
  ]) {
    const rows = analyzePost({ ...post, title: 'OpenCode Go' });
    assert.equal(rows.find((row) => row.key === KEY)?.url, bodyUrl);
    assert.equal(rows.some((row) => row.url === GO_URL), false);
  }
});

test('does not infer Go for another key when the body already contains a decoded URL', () => {
  const encoded = Buffer.from(JSON.stringify({ base_url: 'https://upstream.example', api_key: KEY })).toString('base64');
  const rows = analyzePost({ title: 'OpenCode', text: encoded + '\n' + OTHER_KEY });
  assert.equal(rows.find((row) => row.key === KEY)?.url, 'https://upstream.example');
  assert.equal(rows.find((row) => row.key === OTHER_KEY)?.url, '');
});

test('keeps the known gateway for a LinuxDo Hub key in an OpenCode topic', () => {
  const key = 'ah-' + 'a'.repeat(64);
  const rows = analyzePost({ title: 'OpenCode', text: key });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, 'https://hub.linux.do');
  assert.equal(rows[0].vendor, 'LinuxDo Hub');
});

test('fills Go for an encoded key whose decoded content contains no URL', () => {
  const rows = analyzePost({ title: 'OpenCode', text: Buffer.from(KEY).toString('base64') });
  assert.equal(rows.find((row) => row.key === KEY)?.url, GO_URL);
});
