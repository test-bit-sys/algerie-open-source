import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findVariables, interpolate } from '../src/core/variables.js';
import { looksLikeCurl } from '../src/core/curl.js';
import { LANGUAGES, generateCode } from '../src/core/codegen.js';
import { parseStructured } from '../src/core/io/util.js';
import { splitUrl, paramsFromUrl } from '../src/core/url.js';

describe('DZ-API Studio Sovereign Engine Tests', () => {
  it('detects and interpolates environment variables in URL templates', () => {
    const template = 'https://{{baseUrl}}/v1/wilayas/{{code}}';
    const vars = findVariables(template);
    assert.equal(vars.length, 2);
    assert.equal(vars[0].name, 'baseUrl');
    assert.equal(vars[1].name, 'code');

    const envMap = { baseUrl: 'api.algerie.dz', code: '16' };
    const resolved = interpolate(template, (k) => envMap[k]);
    assert.equal(resolved, 'https://api.algerie.dz/v1/wilayas/16');
  });

  it('accurately identifies curl commands across Bash, cmd, and PowerShell syntax', () => {
    assert.equal(looksLikeCurl('curl -X GET https://api.algerie.dz'), true);
    assert.equal(looksLikeCurl('$ curl -H "Authorization: Bearer token" https://api.dz'), true);
    assert.equal(looksLikeCurl('PS C:\\> curl.exe -X POST https://api.dz/data'), true);
    assert.equal(looksLikeCurl('git commit -m "update"'), false);
    assert.equal(looksLikeCurl('npm run test'), false);
  });

  it('provides comprehensive code generator languages including Python, Rust, and cURL', () => {
    const ids = LANGUAGES.map(l => l.id);
    assert.ok(ids.includes('curl'));
    assert.ok(ids.includes('fetch'));
    assert.ok(ids.includes('python-requests'));
    assert.ok(ids.includes('rust-reqwest'));
    assert.ok(ids.includes('powershell'));
    assert.ok(ids.includes('go'));
    assert.ok(ids.includes('csharp-httpclient'));

    const sampleReq = {
      method: 'GET',
      url: 'https://api.algerie.dz/v1/ping',
      headers: [{ key: 'Accept', value: 'application/json' }],
      body: null,
    };
    const curlCode = generateCode('curl', sampleReq);
    assert.ok(curlCode.includes('curl'));
    assert.ok(curlCode.includes('https://api.algerie.dz/v1/ping'));
  });

  it('parses structured JSON documents safely without throwing', () => {
    const jsonStr = '{"wilaya": "Algiers", "code": 16, "active": true}';
    const parsed = parseStructured(jsonStr);
    assert.equal(parsed.wilaya, 'Algiers');
    assert.equal(parsed.code, 16);
    assert.equal(parsed.active, true);
  });

  it('splits URL components and extracts query parameters accurately', () => {
    const url = 'https://api.algerie.dz:8080/v1/search?category=finance&wilaya=16';
    const parts = splitUrl(url);
    assert.equal(parts.base, 'https://api.algerie.dz:8080/v1/search');
    assert.equal(parts.query, 'category=finance&wilaya=16');

    const params = paramsFromUrl(url);
    assert.equal(params.length, 2);
    assert.equal(params[0].key, 'category');
    assert.equal(params[0].value, 'finance');
    assert.equal(params[1].key, 'wilaya');
    assert.equal(params[1].value, '16');
  });
});
