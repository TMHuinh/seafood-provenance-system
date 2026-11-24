const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const path = require('node:path')

test('readiness polling keeps Node alive through a timeout and consumes the response', async () => {
  const helper = path.resolve(__dirname, '../integration/local-stack.js')
  const script = `
    const { ready } = require(${JSON.stringify(helper)});
    let requests = 0, consumed = 0;
    global.fetch = async (_url, options) => {
      requests++;
      if (requests === 1) return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      });
      return { ok: true, arrayBuffer: async () => { consumed++; return new ArrayBuffer(0); } };
    };
    ready('http://127.0.0.1/health').then(() => console.log(JSON.stringify({ requests, consumed })));
  `
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['-e', script], { timeout: 10000 })
  assert.equal(stderr, '')
  assert.ok(stdout.trim(), 'Child must finish readiness before exiting successfully')
  assert.deepEqual(JSON.parse(stdout.trim()), { requests: 2, consumed: 1 })
})
