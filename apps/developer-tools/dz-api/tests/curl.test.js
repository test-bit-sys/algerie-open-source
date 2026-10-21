import { describe, it, expect } from 'vitest';
import { parseCurl, looksLikeCurl } from '../src/core/curl.js';
import { generateCode } from '../src/core/codegen.js';
import { normalizeRequest } from '../src/core/model.js';

const headerList = (r) => r.headers.map((h) => [h.key, h.value]);
const pairsOf = (list) => list.map((p) => [p.key, p.value]);

describe('looksLikeCurl', () => {
  it('accepts curl commands with or without a prompt', () => {
    expect(looksLikeCurl('curl https://example.com')).toBe(true);
    expect(looksLikeCurl('  $ curl -X POST https://example.com')).toBe(true);
    expect(looksLikeCurl('curl.exe https://example.com')).toBe(true);
    expect(looksLikeCurl('curl \\\n  https://example.com')).toBe(true);
  });

  it('rejects other text', () => {
    expect(looksLikeCurl('https://example.com')).toBe(false);
    expect(looksLikeCurl('curly braces')).toBe(false);
    expect(looksLikeCurl('wget https://example.com')).toBe(false);
    expect(looksLikeCurl('')).toBe(false);
    expect(looksLikeCurl(null)).toBe(false);
  });
});

describe('parseCurl: errors', () => {
  it('throws for text that is not a curl command', () => {
    expect(() => parseCurl('wget https://example.com')).toThrow(/curl/);
    expect(() => parseCurl('')).toThrow();
  });

  it('throws when there is no URL', () => {
    expect(() => parseCurl('curl -H "Accept: x"')).toThrow(/No URL/);
  });

  it('throws on unterminated quotes', () => {
    expect(() => parseCurl("curl 'https://example.com")).toThrow(/Unterminated/);
    expect(() => parseCurl('curl "https://example.com')).toThrow(/Unterminated/);
  });

  it('throws when an option is missing its value', () => {
    expect(() => parseCurl('curl https://example.com -H')).toThrow(/-H/);
  });
});

describe('parseCurl: basics', () => {
  it('parses a plain GET', () => {
    const r = parseCurl('curl https://example.com/users');
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://example.com/users');
    expect(r.headers).toEqual([]);
    expect(r.body.mode).toBe('none');
    expect(r.auth.type).toBe('none');
  });

  it('strips a shell prompt', () => {
    expect(parseCurl('$ curl https://example.com').url).toBe('https://example.com');
  });

  it('fills params from the URL query', () => {
    const r = parseCurl("curl 'https://example.com/s?q=a%20b&page=2&flag'");
    expect(pairsOf(r.params)).toEqual([
      ['q', 'a%20b'],
      ['page', '2'],
      ['flag', ''],
    ]);
    expect(r.params.every((p) => p.id && p.enabled)).toBe(true);
  });

  it('accepts the URL anywhere and via --url', () => {
    expect(parseCurl('curl -H "A: b" https://example.com/x -L').url).toBe('https://example.com/x');
    expect(parseCurl('curl --url https://example.com/y -s').url).toBe('https://example.com/y');
  });

  it('prefers a positional with a scheme when an unknown option eats an argument', () => {
    expect(parseCurl('curl --some-new-flag value https://example.com').url).toBe('https://example.com');
  });

  it('gives rows ids so the result normalizes cleanly', () => {
    const r = parseCurl('curl -H "A: 1" -d "x=1" https://example.com');
    expect(r.headers[0].id).toBeTruthy();
    expect(r.body.urlencoded[0].id).toBeTruthy();
    const n = normalizeRequest(r);
    expect(n.method).toBe('POST');
    expect(n.headers[0].id).toBe(r.headers[0].id);
    expect(n.body.urlencoded[0].key).toBe('x');
  });

  it('stops at a pipe', () => {
    const r = parseCurl("curl -s https://example.com | jq '.items'");
    expect(r.url).toBe('https://example.com');
  });
});

describe('parseCurl: quoting', () => {
  it('handles single quotes literally', () => {
    const r = parseCurl(`curl -H 'X-A: "$HOME" \\n' https://example.com`);
    expect(headerList(r)).toEqual([['X-A', '"$HOME" \\n']]);
  });

  it('handles the close-escape-reopen single quote idiom', () => {
    const r = parseCurl(`curl --data-raw 'it'\\''s' https://example.com`);
    expect(r.body.raw).toBe("it's");
  });

  it('handles double quotes with escapes', () => {
    const r = parseCurl('curl -H "X-A: a \\"b\\" \\$c \\\\ \\d" https://example.com');
    expect(headerList(r)).toEqual([['X-A', 'a "b" $c \\ \\d']]);
  });

  it("handles $'...' ANSI-C quoting", () => {
    const r = parseCurl("curl --data-raw $'line1\\nline2\\t\\x41\\u00e9\\'q\\'' https://example.com");
    expect(r.body.raw).toBe("line1\nline2\tA\u00e9'q'");
  });

  it('handles backslash escapes outside quotes', () => {
    const r = parseCurl('curl https://example.com/a\\ b -H X-A:\\ 1');
    expect(r.url).toBe('https://example.com/a b');
    expect(headerList(r)).toEqual([['X-A', '1']]);
  });

  it('keeps empty quoted arguments', () => {
    const r = parseCurl("curl -X POST --data-raw '' https://example.com");
    expect(r.method).toBe('POST');
    expect(r.body.mode).toBe('raw');
    expect(r.body.raw).toBe('');
  });

  it('keeps newlines inside quotes', () => {
    const r = parseCurl("curl -H 'Content-Type: application/json' -d '{\n  \"a\": 1\n}' https://example.com");
    expect(r.body.raw).toBe('{\n  "a": 1\n}');
  });
});

describe('parseCurl: line continuations', () => {
  it('handles bash backslash-newline (LF and CRLF, trailing blanks)', () => {
    const text = "curl -X PUT \\\n  'https://example.com' \\\r\n  -H 'A: 1' \\  \n  -H 'B: 2'";
    const r = parseCurl(text);
    expect(r.method).toBe('PUT');
    expect(r.url).toBe('https://example.com');
    expect(headerList(r)).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
  });

  it('handles PowerShell backtick continuations', () => {
    const r = parseCurl('curl.exe `\n  -H "A: 1" `\r\n  https://example.com');
    expect(r.url).toBe('https://example.com');
    expect(headerList(r)).toEqual([['A', '1']]);
  });

  it('handles Windows cmd caret escapes and continuations', () => {
    const text = [
      'curl ^"https://example.com/api?x=1^" ^',
      '  -H ^"accept: */*^" ^',
      '  -H ^"content-type: application/json^" ^',
      '  --data-raw ^"^{^\\^"name^\\^":^\\^"a b^\\^"^}^" ^',
      '  --compressed',
    ].join('\r\n');
    const r = parseCurl(text);
    expect(r.url).toBe('https://example.com/api?x=1');
    expect(headerList(r)).toEqual([
      ['accept', '*/*'],
      ['content-type', 'application/json'],
    ]);
    expect(r.body.mode).toBe('raw');
    expect(r.body.rawType).toBe('json');
    expect(JSON.parse(r.body.raw)).toEqual({ name: 'a b' });
    expect(r.method).toBe('POST');
  });

  it('handles cmd caret continuation without caret-quotes', () => {
    const r = parseCurl('curl "https://example.com" ^\n  -H "A: 1"');
    expect(r.url).toBe('https://example.com');
    expect(headerList(r)).toEqual([['A', '1']]);
  });
});

describe('parseCurl: method flags', () => {
  it('reads -X, --request and the attached -XPOST form', () => {
    expect(parseCurl('curl -X delete https://e.com').method).toBe('DELETE');
    expect(parseCurl('curl --request PATCH https://e.com').method).toBe('PATCH');
    expect(parseCurl('curl -XPOST https://e.com').method).toBe('POST');
  });

  it('handles combined short flags', () => {
    expect(parseCurl('curl -sSL https://e.com').method).toBe('GET');
    expect(parseCurl('curl -sSLX PUT https://e.com').method).toBe('PUT');
    const r = parseCurl('curl -sH "A: 1" https://e.com');
    expect(headerList(r)).toEqual([['A', '1']]);
  });

  it('defaults to POST with data or form, and -X wins', () => {
    expect(parseCurl('curl -d a=1 https://e.com').method).toBe('POST');
    expect(parseCurl('curl -F a=1 https://e.com').method).toBe('POST');
    expect(parseCurl('curl -X PUT -d a=1 https://e.com').method).toBe('PUT');
  });

  it('uses HEAD for -I and --head', () => {
    expect(parseCurl('curl -I https://e.com').method).toBe('HEAD');
    expect(parseCurl('curl --head https://e.com').method).toBe('HEAD');
    expect(parseCurl('curl -sI https://e.com').method).toBe('HEAD');
  });

  it('ignores switches that do not affect the request', () => {
    const r = parseCurl('curl -L -k -s -v -i --compressed --location --insecure -o out.txt -m 10 --connect-timeout 5 https://e.com');
    expect(r.url).toBe('https://e.com');
    expect(r.method).toBe('GET');
    expect(r.headers).toEqual([]);
  });
});

describe('parseCurl: headers and header-like flags', () => {
  it('reads -H and --header, keeping Authorization as a header', () => {
    const r = parseCurl('curl -H "Authorization: Bearer abc" --header "X-Trace:  t1 " https://e.com');
    expect(headerList(r)).toEqual([
      ['Authorization', 'Bearer abc'],
      ['X-Trace', 't1'],
    ]);
    expect(r.auth.type).toBe('none');
  });

  it('reads "Name;" as an empty header and skips "Name:" removals', () => {
    const r = parseCurl('curl -H "X-Empty;" -H "Accept:" https://e.com');
    expect(headerList(r)).toEqual([['X-Empty', '']]);
  });

  it('maps -A, -e and -b to headers', () => {
    const r = parseCurl('curl -A "agent/1" -e "https://ref.example/;auto" -b "a=1" --cookie "b=2" -b cookies.txt https://e.com');
    expect(headerList(r)).toEqual([
      ['User-Agent', 'agent/1'],
      ['Referer', 'https://ref.example/'],
      ['Cookie', 'a=1; b=2'],
    ]);
    const long = parseCurl('curl --user-agent ua --referer https://r https://e.com');
    expect(headerList(long)).toEqual([
      ['User-Agent', 'ua'],
      ['Referer', 'https://r'],
    ]);
  });
});

describe('parseCurl: auth', () => {
  it('maps -u and --user to basic auth', () => {
    const r = parseCurl('curl -u alice:s3cr:et https://e.com');
    expect(r.auth.type).toBe('basic');
    expect(r.auth.basic).toEqual({ username: 'alice', password: 's3cr:et' });
    const noPass = parseCurl('curl --user bob https://e.com');
    expect(noPass.auth.basic).toEqual({ username: 'bob', password: '' });
  });

  it('maps --aws-sigv4 with --user to AWS Signature auth, not Basic', () => {
    const r = parseCurl('curl --aws-sigv4 "aws:amz:eu-west-1:s3" --user "AKID:SECRET" https://bucket.s3.amazonaws.com/key');
    expect(r.auth.type).toBe('awsv4');
    expect(r.auth.awsv4).toMatchObject({ accessKey: 'AKID', secretKey: 'SECRET', region: 'eu-west-1', service: 's3' });
    const short = parseCurl('curl --aws-sigv4 aws:amz -u K:S https://sts.amazonaws.com');
    expect(short.auth.awsv4).toMatchObject({ accessKey: 'K', secretKey: 'S', region: 'us-east-1', service: '' });
  });

  it('warns that Digest, NTLM and Negotiate credentials became Basic auth', () => {
    for (const flag of ['--digest', '--ntlm', '--negotiate']) {
      const r = parseCurl(`curl ${flag} -u alice:pw https://e.com`);
      expect(r.auth.basic).toEqual({ username: 'alice', password: 'pw' });
      expect(r.warnings).toEqual([expect.stringMatching(/Basic/)]);
    }
    expect(parseCurl('curl -u alice:pw https://e.com').warnings).toEqual([]);
    expect(parseCurl('curl --digest https://e.com').warnings).toEqual([]);
  });

  it('maps --oauth2-bearer to bearer auth', () => {
    const r = parseCurl('curl --oauth2-bearer tok https://e.com');
    expect(r.auth.type).toBe('bearer');
    expect(r.auth.bearer.token).toBe('tok');
  });
});

describe('parseCurl: data', () => {
  it('joins multiple -d values with &', () => {
    const r = parseCurl('curl -d a=1 --data b=2 --data-raw c=3 --data-binary d=4 --data-ascii e=5 https://e.com');
    expect(r.body.mode).toBe('urlencoded');
    expect(pairsOf(r.body.urlencoded)).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
      ['d', '4'],
      ['e', '5'],
    ]);
  });

  it('decodes urlencoded values per form rules', () => {
    const r = parseCurl("curl -d 'name=John+Smith&city=New%20York&bad=%zz&flag' https://e.com");
    expect(pairsOf(r.body.urlencoded)).toEqual([
      ['name', 'John Smith'],
      ['city', 'New York'],
      ['bad', '%zz'],
      ['flag', ''],
    ]);
  });

  it('encodes --data-urlencode values', () => {
    const r = parseCurl("curl --data-urlencode 'q=a b&c' --data-urlencode '=x/y' --data-urlencode 'plain text' https://e.com -H 'Content-Type: text/plain'");
    expect(r.body.mode).toBe('raw');
    expect(r.body.raw).toBe('q=a%20b%26c&x%2Fy&plain%20text');
  });

  it('round-trips --data-urlencode through urlencoded rows', () => {
    const r = parseCurl("curl --data-urlencode 'msg=hello world & more' https://e.com");
    expect(pairsOf(r.body.urlencoded)).toEqual([['msg', 'hello world & more']]);
  });

  it('treats JSON-looking data as raw JSON', () => {
    const r = parseCurl(`curl -d '{"a":[1,2]}' https://e.com`);
    expect(r.body.mode).toBe('raw');
    expect(r.body.rawType).toBe('json');
    expect(r.body.raw).toBe('{"a":[1,2]}');
  });

  it('follows the Content-Type header', () => {
    const json = parseCurl(`curl -H 'Content-Type: application/vnd.api+json' -d 'not json' https://e.com`);
    expect([json.body.mode, json.body.rawType]).toEqual(['raw', 'json']);
    const xml = parseCurl(`curl -H 'content-type: text/xml' -d '<a>1</a>' https://e.com`);
    expect([xml.body.mode, xml.body.rawType]).toEqual(['raw', 'xml']);
    const html = parseCurl(`curl -H 'Content-Type: text/html' -d '<p>' https://e.com`);
    expect(html.body.rawType).toBe('html');
    const text = parseCurl(`curl -H 'Content-Type: text/plain' -d 'a=1' https://e.com`);
    expect([text.body.mode, text.body.rawType]).toEqual(['raw', 'text']);
    const form = parseCurl(`curl -H 'Content-Type: application/x-www-form-urlencoded' -d '{"a":1}' https://e.com`);
    expect(form.body.mode).toBe('urlencoded');
  });

  it('falls back to raw text for other data', () => {
    const r = parseCurl("curl -d 'just some text' https://e.com");
    expect([r.body.mode, r.body.rawType, r.body.raw]).toEqual(['raw', 'text', 'just some text']);
  });

  it('handles --json', () => {
    const r = parseCurl(`curl --json '{"a":1}' https://e.com`);
    expect(r.method).toBe('POST');
    expect([r.body.mode, r.body.rawType, r.body.raw]).toEqual(['raw', 'json', '{"a":1}']);
    expect(headerList(r)).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ]);
    const custom = parseCurl(`curl --json '[1]' -H 'Accept: text/plain' https://e.com`);
    expect(headerList(custom)).toEqual([
      ['Accept', 'text/plain'],
      ['Content-Type', 'application/json'],
    ]);
  });

  it('turns a lone @file data argument into a binary body', () => {
    const r = parseCurl("curl --data-binary @./dir/payload.bin -H 'Content-Type: application/octet-stream' https://e.com");
    expect(r.body.mode).toBe('binary');
    expect(r.body.binary).toEqual({ ref: '', name: 'payload.bin', size: 0, type: 'application/octet-stream' });
    expect(parseCurl('curl --data-raw @literal https://e.com').body.raw).toBe('@literal');
  });

  it('maps -T to a PUT with a binary body', () => {
    const r = parseCurl("curl -T 'C:\\files\\report.pdf' https://e.com/upload");
    expect(r.method).toBe('PUT');
    expect(r.body.mode).toBe('binary');
    expect(r.body.binary.name).toBe('report.pdf');
  });
});

describe('parseCurl: -G', () => {
  it('moves data into the query string', () => {
    const r = parseCurl("curl -G https://e.com/search?x=1 -d q=cats --data-urlencode 'tag=a b'");
    expect(r.method).toBe('GET');
    expect(r.url).toBe('https://e.com/search?x=1&q=cats&tag=a%20b');
    expect(pairsOf(r.params)).toEqual([
      ['x', '1'],
      ['q', 'cats'],
      ['tag', 'a%20b'],
    ]);
    expect(r.body.mode).toBe('none');
  });

  it('works with --get and -X', () => {
    const r = parseCurl('curl --get -X DELETE -d id=7 https://e.com/items#top');
    expect(r.method).toBe('DELETE');
    expect(r.url).toBe('https://e.com/items?id=7#top');
  });
});

describe('parseCurl: forms', () => {
  it('reads text and file fields', () => {
    const r = parseCurl("curl -F 'name=Ada' -F 'avatar=@/home/ada/me.png' --form 'doc=@\"my;file.pdf\";type=application/pdf' https://e.com");
    expect(r.method).toBe('POST');
    expect(r.body.mode).toBe('form');
    const [name, avatar, doc] = r.body.form;
    expect([name.key, name.value, name.kind, name.file]).toEqual(['name', 'Ada', 'text', null]);
    expect([avatar.key, avatar.value, avatar.kind]).toEqual(['avatar', '', 'file']);
    expect(avatar.file).toEqual({ ref: '', name: 'me.png', size: 0, type: '' });
    expect(doc.file).toEqual({ ref: '', name: 'my;file.pdf', size: 0, type: 'application/pdf' });
    expect(r.body.form.every((f) => f.id)).toBe(true);
  });

  it('handles ;type= and ;filename= on files and text', () => {
    const r = parseCurl("curl -F 'f=@a.bin;filename=b.bin;type=x/y' -F 'meta={\"a\":1};type=application/json' https://e.com");
    expect(r.body.form[0].file).toEqual({ ref: '', name: 'b.bin', size: 0, type: 'x/y' });
    expect(r.body.form[1].value).toBe('{"a":1}');
  });

  it('keeps --form-string values literal', () => {
    const r = parseCurl("curl --form-string 'note=@not-a-file;type=x' https://e.com");
    expect(r.body.form[0].kind).toBe('text');
    expect(r.body.form[0].value).toBe('@not-a-file;type=x');
  });

  it('reads -F name=<file as a text field, since curl sends the file content as text', () => {
    const r = parseCurl("curl -F 'note=<notes.txt' -F 'a=1' https://e.com");
    expect(r.body.form.map((f) => [f.key, f.value, f.kind])).toEqual([
      ['note', '', 'text'],
      ['a', '1', 'text'],
    ]);
    expect(r.warnings).toEqual([expect.stringMatching(/"note".*notes\.txt/)]);
  });

  it('drops a copied multipart Content-Type header', () => {
    const r = parseCurl("curl -H 'Content-Type: multipart/form-data; boundary=----x' -H 'A: 1' -F a=1 https://e.com");
    expect(headerList(r)).toEqual([['A', '1']]);
  });
});

describe('parseCurl: round trip with the curl generator', () => {
  const cases = [
    {
      name: 'GET with headers and query',
      resolved: {
        method: 'GET',
        url: 'https://api.example.com/users?page=2&q=a%20b',
        headers: [
          { key: 'Accept', value: 'application/json' },
          { key: 'X-Quote', value: `it's "fine" $HOME` },
        ],
        body: null,
      },
    },
    {
      name: 'POST JSON',
      resolved: {
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        body: { mode: 'raw', text: `{\n  "name": "O'Brien",\n  "tags": ["a", "b"]\n}`, contentType: 'application/json' },
      },
    },
    {
      name: 'PATCH plain text',
      resolved: {
        method: 'PATCH',
        url: 'https://api.example.com/notes/1',
        headers: [{ key: 'Content-Type', value: 'text/plain' }],
        body: { mode: 'raw', text: 'line 1\nline 2 with \\ and \'quotes\'', contentType: 'text/plain' },
      },
    },
    {
      name: 'urlencoded',
      resolved: {
        method: 'POST',
        url: 'https://api.example.com/login',
        headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
        body: {
          mode: 'urlencoded',
          fields: [
            { key: 'user', value: 'a b&c' },
            { key: 'weird key=', value: '100%' },
          ],
        },
      },
    },
    {
      name: 'multipart form',
      resolved: {
        method: 'POST',
        url: 'https://api.example.com/upload',
        headers: [{ key: 'Authorization', value: 'Bearer t' }],
        body: {
          mode: 'form',
          fields: [
            { key: 'title', value: 'Hello; world', kind: 'text' },
            { key: 'file', value: '', kind: 'file', fileName: 'photo.png' },
          ],
        },
      },
    },
  ];

  for (const { name, resolved } of cases) {
    it(name, () => {
      const parsed = parseCurl(generateCode('curl', resolved));
      expect(parsed.method).toBe(resolved.method);
      expect(parsed.url).toBe(resolved.url);
      expect(headerList(parsed)).toEqual(resolved.headers.map((h) => [h.key, h.value]));
      const b = resolved.body;
      if (!b) expect(parsed.body.mode).toBe('none');
      else if (b.mode === 'raw') {
        expect(parsed.body.mode).toBe('raw');
        expect(parsed.body.raw).toBe(b.text);
      } else if (b.mode === 'urlencoded') {
        expect(parsed.body.mode).toBe('urlencoded');
        expect(pairsOf(parsed.body.urlencoded)).toEqual(b.fields.map((f) => [f.key, f.value]));
      } else if (b.mode === 'form') {
        expect(parsed.body.mode).toBe('form');
        expect(parsed.body.form.map((f) => [f.key, f.kind, f.kind === 'file' ? f.file.name : f.value])).toEqual(
          b.fields.map((f) => [f.key, f.kind, f.kind === 'file' ? f.fileName : f.value]),
        );
      }
    });
  }

  it('GET with a body keeps its method', () => {
    const resolved = { method: 'GET', url: 'https://e.com/q', headers: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', text: '{}', contentType: 'application/json' } };
    const parsed = parseCurl(generateCode('curl', resolved));
    expect(parsed.method).toBe('GET');
    expect(parsed.body.raw).toBe('{}');
  });

  it('HEAD survives', () => {
    expect(parseCurl(generateCode('curl', { method: 'HEAD', url: 'https://e.com', headers: [] })).method).toBe('HEAD');
  });
});

describe('cURL path variables', () => {
  it('lists /:name segments as path variables', () => {
    expect(parseCurl('curl https://x.test/users/:id/posts/:postId').pathVars.map((p) => p.key)).toEqual(['id', 'postId']);
  });
});

describe('cURL quoting styles', () => {
  it('treats ^" inside single quotes as text, not Windows cmd escapes', () => {
    const r = parseCurl(`curl -X POST https://x.com -H 'Content-Type: application/json' -d '{"re":"^"}'`);
    expect(r.url).toBe('https://x.com');
    expect(r.headers.map((h) => h.key)).toContain('Content-Type');
    expect(r.body.raw).toBe('{"re":"^"}');
  });
  it('reads bash commands with ^" inside double quotes or $\'...\' strings', () => {
    const dq = parseCurl(`curl https://x.com -H 'X-A: b' -d "re=^"`);
    expect(headerList(dq)).toEqual([['X-A', 'b']]);
    expect(pairsOf(dq.body.urlencoded)).toEqual([['re', '^']]);
    const ansi = parseCurl(`curl 'https://x.com' --data-raw $'{"name":"O\\'Brien","re":"^"}'`);
    expect(ansi.url).toBe('https://x.com');
    expect(JSON.parse(ansi.body.raw)).toEqual({ name: "O'Brien", re: '^' });
  });
  it('still reads Chrome cmd commands', () => {
    const r = parseCurl('curl ^"https://x.com/a^" -H ^"Accept: */*^"');
    expect(r.url).toBe('https://x.com/a');
  });
});

describe('--data-urlencode names', () => {
  it('splits at = before @ like curl', () => {
    expect(parseCurl(`curl https://x.test --data-urlencode 'user@x=1 2'`).body.urlencoded.map((f) => [f.key, f.value])).toEqual([['user@x', '1 2']]);
  });
});

describe('more curl options', () => {
  it('skips the values of newer options and reads --expand- options', () => {
    expect(parseCurl('curl --keepalive-cnt 3 https://x.test/a').url).toBe('https://x.test/a');
    const r = parseCurl(`curl https://x.test --expand-data '{{body}}' --expand-header 'X-A: {{a}}'`);
    expect(r.body.raw).toBe('{{body}}');
    expect(r.headers.find((h) => h.key === 'X-A').value).toBe('{{a}}');
  });
});

describe('several commands pasted together', () => {
  // Chrome's "Copy all as cURL" in its cmd and bash flavors.
  const cmdAll = [
    'curl ^"https://a.com/login^" ^\n  -H ^"content-type: application/json^" ^\n  --data-raw ^"^{^\\^"u^\\^":^\\^"x^\\^"^}^"',
    'curl ^"https://b.com/other^" ^\n  -H ^"x-other: 1^" ^\n  --data-raw ^"z=1^"',
  ].join(' &\r\n');
  const bashAll = [
    "curl 'https://a.com/login' \\\n  -H 'content-type: application/json' \\\n  --data-raw '{\"u\":\"x\"}'",
    "curl 'https://b.com/other' \\\n  -H 'x-other: 1' \\\n  --data-raw 'z=1'",
  ].join(' ;\n');
  const many = /more than one curl command/;

  it('reads only the first one and says so', () => {
    for (const text of [cmdAll, bashAll]) {
      const r = parseCurl(text);
      expect(r.url).toBe('https://a.com/login');
      expect(headerList(r)).toEqual([['content-type', 'application/json']]);
      expect(r.body.raw).toBe('{"u":"x"}');
      expect(r.warnings).toEqual([expect.stringMatching(many)]);
    }
    expect(parseCurl("curl https://a.com && curl https://b.com").warnings).toEqual([expect.stringMatching(many)]);
  });

  it('ends a command at an unquoted ; | or & even inside a word', () => {
    expect(parseCurl('curl https://x.com/a; echo done').url).toBe('https://x.com/a');
    expect(parseCurl('curl https://x.com/a|jq .').url).toBe('https://x.com/a');
    expect(parseCurl('curl https://x.com/a&& echo ok').url).toBe('https://x.com/a');
    expect(parseCurl('curl https://x.com/a &').url).toBe('https://x.com/a');
    expect(parseCurl("curl 'https://x.com/a;b|c&d'").url).toBe('https://x.com/a;b|c&d');
    expect(parseCurl('curl https://x.com/a\\;b').url).toBe('https://x.com/a;b');
    expect(parseCurl('curl ^"https://x.com/a?b=1^&c=2^" | more').url).toBe('https://x.com/a?b=1&c=2');
    expect(parseCurl('curl https://x.com/a; echo done').warnings).toEqual([]);
  });

  it('keeps an unquoted & between query parameters, as people paste URLs', () => {
    expect(parseCurl('curl https://x.com/a?b=1&c=2').url).toBe('https://x.com/a?b=1&c=2');
  });
});

describe('PowerShell commands', () => {
  it("reads curl.exe with '...' strings, where \\\" reaches curl as a quote", () => {
    const r = parseCurl("curl.exe -X POST https://x.com/api `\n  -H 'Content-Type: application/json' `\n  -d '{\\\"name\\\":\\\"a\\\"}'");
    expect(r.url).toBe('https://x.com/api');
    expect(headerList(r)).toEqual([['Content-Type', 'application/json']]);
    expect(r.body.raw).toBe('{"name":"a"}');
    expect(parseCurl(`curl.exe https://x.com -d '{"a":1}'`).body.raw).toBe('{"a":1}');
    expect(parseCurl(`curl.exe https://x.com -H 'X-A: it''s'`).headers[0].value).toBe("it's");
  });

  it('reads "..." strings with backtick escapes', () => {
    const r = parseCurl('curl.exe -X POST https://x.com/api `\n  -H "Content-Type: application/json" `\n  -d "{`"name`":`"a`"}"');
    expect(r.body.raw).toBe('{"name":"a"}');
    expect(parseCurl('curl.exe https://x.com -d "a`tb""c"').body.raw).toBe('a\tb"c');
  });

  it('reads curl.exe written for cmd, with \\" inside "...", as cmd does', () => {
    expect(parseCurl('curl.exe -H "Content-Type: application/json" -d "{\\"a\\":1}" https://example.com/x').body.raw).toBe('{"a":1}');
  });

  it('recognizes PowerShell by its prompt or backtick continuations', () => {
    expect(parseCurl("PS C:\\> curl https://x.com -d '{\\\"a\\\":1}'").body.raw).toBe('{"a":1}');
    expect(parseCurl("curl https://x.com `\n  -d 'it''s'").body.raw).toBe("it's");
    // Bash keeps '' as an empty string and \" in single quotes as written.
    expect(parseCurl("curl https://x.com -d 'it''s'").body.raw).toBe('its');
    expect(parseCurl("curl https://x.com -d '{\\\"a\\\":1}'").body.raw).toBe('{\\"a\\":1}');
  });

  it('stops at a command separator', () => {
    const r = parseCurl('curl.exe https://x.com/a; curl.exe https://x.com/b');
    expect(r.url).toBe('https://x.com/a');
    expect(r.warnings).toEqual([expect.stringMatching(/more than one curl command/)]);
  });
});
