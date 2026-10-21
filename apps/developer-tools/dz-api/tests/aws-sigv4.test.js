import { describe, it, expect } from 'vitest';
import { signAwsV4, canonicalPath, canonicalQuery, amzDate, uriEncode } from '../src/core/aws-sigv4.js';

// Example from the AWS General Reference "Signature Version 4 signing process".
const creds = { accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'iam', date: new Date('2015-08-30T12:36:00Z') };

describe('AWS Signature Version 4', () => {
  it('matches the published example', async () => {
    const out = await signAwsV4(
      { method: 'GET', url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08', headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded; charset=utf-8' }], body: null },
      creds,
    );
    expect(out.canonicalRequest).toBe(
      [
        'GET',
        '/',
        'Action=ListUsers&Version=2010-05-08',
        'content-type:application/x-www-form-urlencoded; charset=utf-8',
        'host:iam.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'content-type;host;x-amz-date',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n'),
    );
    expect(out.signature).toBe('5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
    expect(out.headers[0]).toEqual({
      key: 'Authorization',
      value: 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    });
  });

  it('adds session token and S3 payload hash headers', async () => {
    const out = await signAwsV4({ method: 'PUT', url: 'https://bucket.s3.amazonaws.com/a b.txt', headers: [], body: 'hi' }, { ...creds, service: 's3', sessionToken: 'tok' });
    const keys = out.headers.map((h) => h.key);
    expect(keys).toEqual(['Authorization', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Amz-Content-Sha256']);
    expect(out.canonicalRequest.split('\n')[1]).toBe('/a%20b.txt');
    expect(out.headers[0].value).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
  });

  it('builds canonical paths and queries', () => {
    expect(canonicalPath('/my%20doc/x', 'execute-api')).toBe('/my%2520doc/x');
    expect(canonicalPath('/my%20doc/x', 's3')).toBe('/my%20doc/x');
    expect(canonicalQuery('?b=2&a=z&a=y&c')).toBe('a=y&a=z&b=2&c=');
    expect(uriEncode("a b!*'()")).toBe('a%20b%21%2A%27%28%29');
    expect(amzDate(new Date('2020-01-02T03:04:05.678Z'))).toBe('20200102T030405Z');
  });

  it('requires credentials', async () => {
    await expect(signAwsV4({ method: 'GET', url: 'https://x', headers: [], body: null }, { accessKey: '', secretKey: '' })).rejects.toThrow(/access key/);
  });
});

describe('AWS auth in the request pipeline', async () => {
  const { resolveRequest, signResolved, guessAwsService } = await import('../src/core/prepare.js');
  const { request } = await import('../src/core/model.js');

  it('guesses the service from the host', () => {
    expect(guessAwsService('https://my-bucket.s3.us-west-2.amazonaws.com/x')).toBe('s3');
    expect(guessAwsService('https://dynamodb.us-east-1.amazonaws.com/')).toBe('dynamodb');
    expect(guessAwsService('https://abc123defg.execute-api.eu-west-1.amazonaws.com/prod')).toBe('execute-api');
    expect(guessAwsService('https://example.com')).toBe('execute-api');
    expect(guessAwsService('https://monitoring.us-east-1.amazonaws.com/')).toBe('monitoring');
    expect(guessAwsService('https://s3-us-west-2.amazonaws.com/b')).toBe('s3');
    expect(guessAwsService('https://sts.us-gov-west-1.amazonaws.com/')).toBe('sts');
    expect(guessAwsService('https://iam.amazonaws.com/')).toBe('iam');
  });

  it('signs when the request is sent, unless an Authorization header is set', async () => {
    const r = request({ method: 'POST', url: 'https://sqs.us-east-1.amazonaws.com/', body: { mode: 'raw', raw: '{}', rawType: 'json' }, auth: { type: 'awsv4', awsv4: { accessKey: 'AK', secretKey: 'SK', region: 'us-east-1' } } });
    const { resolved } = resolveRequest(r, {});
    expect(resolved.signing.service).toBe('sqs');
    const signed = await signResolved(resolved, new Map());
    expect(signed.headers.find((h) => h.key === 'Authorization').value).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/sqs\/aws4_request/);
    const manual = request({ ...r, headers: [{ key: 'Authorization', value: 'mine' }] });
    expect(resolveRequest(manual, {}).resolved.signing).toBeNull();
  });

  it('sends the exact multipart bytes it signed', async () => {
    const { buildBody } = await import('../src/core/prepare.js');
    const r = request({ method: 'PUT', url: 'https://b.s3.us-east-1.amazonaws.com/k', body: { mode: 'form', form: [{ key: 'a', value: '1', enabled: true }] }, auth: { type: 'awsv4', awsv4: { accessKey: 'AK', secretKey: 'SK', region: 'us-east-1' } } });
    const { resolved } = resolveRequest(r, {});
    const signed = await signResolved(resolved, new Map());
    const sent = buildBody(signed.body, new Map());
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', sent))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(signed.headers.find((h) => h.key.toLowerCase() === 'x-amz-content-sha256').value).toBe(hash);
    const type = signed.headers.find((h) => h.key.toLowerCase() === 'content-type').value;
    expect(new TextDecoder().decode(sent)).toContain(type.split('boundary=')[1]);
  });
});
