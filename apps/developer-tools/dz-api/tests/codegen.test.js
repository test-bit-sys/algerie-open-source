import { describe, it, expect } from 'vitest';
import { generateCode, LANGUAGES } from '../src/core/codegen.js';
import { parseCurl } from '../src/core/curl.js';
import { resolveRequest } from '../src/core/prepare.js';
import { request } from '../src/core/model.js';

const getReq = {
  method: 'GET',
  url: 'https://api.example.com/users?page=1',
  headers: [{ key: 'Accept', value: 'application/json' }],
  body: null,
};

const jsonReq = {
  method: 'POST',
  url: 'https://api.example.com/users',
  headers: [{ key: 'Content-Type', value: 'application/json' }],
  body: { mode: 'raw', text: '{"name":"O\'Brien","note":"say \\"hi\\""}', contentType: 'application/json' },
};

// Quotes, backslashes, shell and template metacharacters, a newline and non-ASCII text.
const TRICKY = 'it\'s "q" \\ $HOME `cmd` ${x} #{y} \\(z) é\nnext';
const trickyReq = {
  method: 'PUT',
  url: 'https://api.example.com/notes/1',
  headers: [{ key: 'X-Note', value: 'a\'b"c$d' }],
  body: { mode: 'raw', text: TRICKY, contentType: 'text/plain' },
};

const urlencodedReq = {
  method: 'POST',
  url: 'https://api.example.com/login',
  headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
  body: {
    mode: 'urlencoded',
    fields: [
      { key: 'user', value: 'a b&c' },
      { key: 'pass', value: 'p=1' },
    ],
  },
};

const formReq = {
  method: 'POST',
  url: 'https://api.example.com/upload',
  headers: [
    { key: 'Content-Type', value: 'multipart/form-data; boundary=stale' },
    { key: 'Authorization', value: 'Bearer tok' },
  ],
  body: {
    mode: 'form',
    fields: [
      { key: 'title', value: 'Hello', kind: 'text' },
      { key: 'avatar', value: '', kind: 'file', fileName: 'photo.png' },
    ],
  },
};

const binaryReq = {
  method: 'PUT',
  url: 'https://api.example.com/blob',
  headers: [{ key: 'Content-Type', value: 'image/png' }],
  body: { mode: 'binary', fileName: 'image.png', contentType: 'image/png' },
};

const graphqlReq = {
  method: 'POST',
  url: 'https://api.example.com/graphql',
  headers: [{ key: 'Content-Type', value: 'application/json' }],
  body: { mode: 'graphql', query: 'query { me { id } }', variables: '{"a": 1}' },
};

const ALL = [getReq, jsonReq, trickyReq, urlencodedReq, formReq, binaryReq, graphqlReq];

/** Parses the single-quoted shell words of a generated command (no expansions needed for our output). */
function shellWords(cmd) {
  const words = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && cmd[i + 1] === '\n') {
      i++;
      continue;
    }
    if (c === ' ' || c === '\n') {
      if (has) words.push(cur);
      cur = '';
      has = false;
    } else if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      cur += cmd.slice(i + 1, end);
      has = true;
      i = end;
    } else if (c === '\\') {
      cur += cmd[++i];
      has = true;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

describe('header values', () => {
  it('drops whitespace around values, which Python Requests rejects', () => {
    const code = generateCode('python-requests', { method: 'GET', url: 'https://e.com', headers: [{ key: 'X-Lead', value: ' lead\n' }] });
    expect(code).toContain("'X-Lead': 'lead',");
  });
});

describe('LANGUAGES', () => {
  it('lists at least 14 languages with unique ids and known syntaxes', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(LANGUAGES.map((l) => l.id)).size).toBe(LANGUAGES.length);
    const syntaxes = ['shell', 'javascript', 'python', 'go', 'php', 'java', 'csharp', 'ruby', 'rust', 'swift', 'powershell', 'text'];
    for (const l of LANGUAGES) {
      expect(typeof l.label).toBe('string');
      expect(syntaxes).toContain(l.syntax);
    }
  });

  it('generates non-empty code for every language and request shape', () => {
    for (const l of LANGUAGES) {
      for (const req of ALL) {
        const code = generateCode(l.id, req);
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(20);
        expect(code).not.toMatch(/undefined|\[object Object\]|NaN/);
      }
    }
  });

  it('never emits em dashes', () => {
    const emDash = String.fromCharCode(0x2014);
    for (const l of LANGUAGES) for (const req of ALL) expect(generateCode(l.id, req)).not.toContain(emDash);
  });

  it('throws for an unknown language', () => {
    expect(() => generateCode('cobol', getReq)).toThrow(/Unknown/);
  });

  it('drops a multipart Content-Type header everywhere', () => {
    for (const l of LANGUAGES) expect(generateCode(l.id, formReq)).not.toContain('boundary=stale');
  });

  it('honours the indent option', () => {
    expect(generateCode('curl', jsonReq, { indent: '    ' })).toContain('\\\n    -H');
    expect(generateCode('python-requests', getReq, { indent: '\t' })).toContain("\t'Accept': 'application/json',");
  });
});

describe('curl', () => {
  it('builds a multi-line command with continuations', () => {
    const code = generateCode('curl', jsonReq);
    expect(code.split('\n')[0]).toBe("curl -X POST 'https://api.example.com/users' \\");
    expect(code).toContain("  -H 'Content-Type: application/json' \\\n");
    expect(code).toContain('--data-raw ');
  });

  it('escapes single quotes and leaves $ inert', () => {
    const words = shellWords(generateCode('curl', trickyReq));
    expect(words).toContain(TRICKY);
    expect(words).toContain('X-Note: a\'b"c$d');
  });

  it('omits -X for a plain GET and uses --head for HEAD', () => {
    expect(generateCode('curl', getReq)).not.toContain('-X');
    expect(generateCode('curl', { method: 'HEAD', url: 'https://e.com', headers: [] })).toBe("curl --head 'https://e.com'");
  });

  it('adds --globoff for URLs with brackets', () => {
    expect(generateCode('curl', { method: 'GET', url: 'https://e.com/?a[]=1', headers: [] })).toContain('--globoff');
  });

  it('writes form, urlencoded and binary bodies', () => {
    const form = generateCode('curl', formReq);
    expect(form).toContain("-F 'title=Hello'");
    expect(form).toContain("-F 'avatar=@photo.png'");
    const ue = generateCode('curl', urlencodedReq);
    expect(ue).toContain("--data-urlencode 'user=a b&c'");
    expect(generateCode('curl', binaryReq)).toContain("--data-binary '@image.png'");
  });

  it('sends GraphQL as JSON with parsed variables', () => {
    const words = shellWords(generateCode('curl', graphqlReq));
    const data = words[words.indexOf('--data-raw') + 1];
    expect(JSON.parse(data)).toEqual({ query: 'query { me { id } }', variables: { a: 1 } });
  });

  it('omits invalid or empty GraphQL variables', () => {
    for (const variables of ['{nope', '', '   ']) {
      const words = shellWords(generateCode('curl', { ...graphqlReq, body: { ...graphqlReq.body, variables } }));
      expect(JSON.parse(words[words.indexOf('--data-raw') + 1])).toEqual({ query: 'query { me { id } }' });
    }
  });

  it('adds a missing Content-Type for raw bodies', () => {
    const code = generateCode('curl', { method: 'POST', url: 'https://e.com', headers: [], body: { mode: 'raw', text: '<a/>', contentType: 'application/xml' } });
    expect(code).toContain("-H 'Content-Type: application/xml'");
  });
});

describe('POST, PUT and PATCH without a body', () => {
  const empty = (method, headers = []) => ({ method, url: 'https://e.com/a', headers, body: null });

  it('sends Content-Length: 0 from curl, which leaves it out, as the app does', () => {
    for (const m of ['POST', 'PUT', 'PATCH']) expect(shellWords(generateCode('curl', empty(m)))).toContain('Content-Length: 0');
    expect(generateCode('curl', { ...empty('POST'), body: { mode: 'urlencoded', fields: [] } })).toContain('Content-Length: 0');
    expect(generateCode('curl', empty('DELETE'))).not.toContain('Content-Length');
    expect(generateCode('curl', jsonReq)).not.toContain('Content-Length');
    expect(generateCode('curl', empty('POST', [{ key: 'content-length', value: '0' }])).match(/content-length/gi)).toHaveLength(1);
  });

  it('gives PHP the Content-Length: 0 header, not an empty body that would add a form Content-Type', () => {
    const php = generateCode('php-curl', empty('PUT'));
    expect(php).toContain("'Content-Length: 0',");
    expect(php).not.toContain('POSTFIELDS');
    expect(generateCode('php-curl', empty('DELETE'))).not.toContain('Content-Length');
    expect(generateCode('php-curl', empty('POST', [{ key: 'Content-Length', value: '0' }])).match(/content-length/gi)).toHaveLength(1);
  });
});

describe('AWS Signature Version 4', () => {
  const { resolved } = resolveRequest(
    request({ url: 'https://bucket.s3.amazonaws.com/key', auth: { type: 'awsv4', awsv4: { accessKey: 'AKID', secretKey: 'SE CRET', sessionToken: 'tok', region: 'eu-west-1', service: 's3' } } }),
  );

  it('signs with curl itself', () => {
    const code = generateCode('curl', resolved);
    expect(code).toContain("--aws-sigv4 'aws:amz:eu-west-1:s3'");
    expect(code).toContain("-H 'X-Amz-Security-Token: tok'");
    expect(parseCurl(code).auth.awsv4).toMatchObject({ accessKey: 'AKID', secretKey: 'SE CRET', region: 'eu-west-1', service: 's3' });
  });

  it('says in other languages that the request must be signed', () => {
    expect(generateCode('python-requests', resolved).split('\n')[0]).toMatch(/^# .*AWS Signature Version 4/);
    expect(generateCode('fetch', resolved).split('\n')[0]).toMatch(/^\/\/ .*AWS Signature Version 4/);
    expect(generateCode('php-curl', resolved).split('\n').slice(0, 2)).toEqual(['<?php', expect.stringMatching(/^\/\/ .*AWS Signature Version 4/)]);
    expect(generateCode('fetch', { method: 'GET', url: 'https://x', headers: [] })).not.toMatch(/AWS/);
  });
});

describe('httpie and wget', () => {
  it('httpie: method, headers and piped raw body', () => {
    const code = generateCode('httpie', jsonReq);
    expect(code.startsWith("printf '%s' ")).toBe(true);
    expect(code).toContain("| http POST 'https://api.example.com/users'");
    expect(code).toContain("'Content-Type:application/json'");
  });

  it('httpie: forms and files', () => {
    const code = generateCode('httpie', formReq);
    expect(code).toContain('http --form POST');
    expect(code).toContain("'avatar@photo.png'");
    expect(generateCode('httpie', urlencodedReq)).toContain("'user=a b&c'");
    expect(generateCode('httpie', binaryReq)).toContain("< 'image.png'");
  });

  it('httpie: values that start with a separator stay values', () => {
    const r = { ...urlencodedReq, headers: [{ key: 'X-Eq', value: '=v' }], body: { mode: 'urlencoded', fields: [{ key: 'a', value: '=x' }, { key: 'b', value: '@y' }] } };
    const code = generateCode('httpie', r);
    expect(code).toContain("'X-Eq:\\=v'");
    expect(code).toContain("'a=\\=x'");
    expect(code).toContain("'b=\\@y'");
  });

  it('httpie: escapes separators in keys but keeps other backslashes as written', () => {
    const r = { ...urlencodedReq, headers: [], body: { mode: 'urlencoded', fields: [{ key: 'k\\ey', value: '1' }, { key: 'a:b', value: '2' }] } };
    const code = generateCode('httpie', r);
    expect(code).toContain("'k\\ey=1'");
    expect(code).toContain("'a\\:b=2'");
  });

  it('wget: method, headers and body', () => {
    const code = generateCode('wget', jsonReq);
    expect(code).toContain('--method POST');
    expect(code).toContain("--header 'Content-Type: application/json'");
    expect(code).toContain('--body-data ');
    expect(generateCode('wget', urlencodedReq)).toContain("--body-data 'user=a+b%26c&pass=p%3D1'");
    expect(generateCode('wget', binaryReq)).toContain("--body-file 'image.png'");
    expect(generateCode('wget', formReq)).toMatch(/^# wget cannot build multipart/);
  });
});

describe('JavaScript', () => {
  it('fetch: async/await with method, headers and body', () => {
    const code = generateCode('fetch', jsonReq);
    expect(code).toContain("const response = await fetch('https://api.example.com/users', {");
    expect(code).toContain("method: 'POST',");
    expect(code).toContain("'Content-Type': 'application/json',");
    expect(code).toContain('body: \'{"name":"O\\\'Brien","note":"say \\\\"hi\\\\""}\',');
  });

  it('fetch: multi-line text becomes a safe template literal', () => {
    const code = generateCode('fetch', trickyReq);
    expect(code).toContain('body: `it\'s "q" \\\\ $HOME \\`cmd\\` \\${x} #{y} \\\\(z) é\nnext`,');
    // The literal evaluates back to the original text.
    const literal = code.match(/body: (`[\s\S]*?[^\\]`),/)[1];
    expect(new Function(`return ${literal};`)()).toBe(TRICKY);
  });

  it('fetch: forms use FormData and file inputs; urlencoded uses URLSearchParams', () => {
    const code = generateCode('fetch', formReq);
    expect(code).toContain('const form = new FormData();');
    expect(code).toContain("form.append('avatar', fileInput.files[0], 'photo.png');");
    expect(code).toContain('body: form,');
    expect(code).not.toContain('multipart');
    expect(generateCode('fetch', urlencodedReq)).toContain('new URLSearchParams({');
  });

  it('node-fetch: reads files from disk', () => {
    expect(generateCode('node-fetch', formReq)).toContain("await openAsBlob('photo.png')");
    const bin = generateCode('node-fetch', binaryReq);
    expect(bin).toContain("import { readFile } from 'node:fs/promises';");
    expect(bin).toContain("body: await readFile('image.png'),");
  });

  it('axios: request config', () => {
    const code = generateCode('axios', jsonReq);
    expect(code).toContain("import axios from 'axios';");
    expect(code).toContain("method: 'post',");
    expect(code).toContain("url: 'https://api.example.com/users',");
    expect(code).toContain('data: ');
    expect(generateCode('axios', binaryReq)).toContain("data: createReadStream('image.png'),");
    // Text bodies go out as written: Axios would trim JSON, or quote it when it is not valid.
    expect(code).toContain('transformRequest: [(body) => body],');
    expect(generateCode('axios', binaryReq)).not.toContain('transformRequest');
  });

  it('generated JavaScript parses', () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    for (const id of ['fetch', 'node-fetch', 'axios']) {
      for (const req of ALL) {
        const code = generateCode(id, req).replace(/^import .*$/gm, '');
        expect(() => new AsyncFunction(code)).not.toThrow();
      }
    }
  });

  it('duplicate header names become an array of pairs in fetch', () => {
    const code = generateCode('fetch', { method: 'GET', url: 'https://e.com', headers: [{ key: 'X-A', value: '1' }, { key: 'x-a', value: '2' }] });
    expect(code).toContain("['X-A', '1'],");
    expect(code).toContain("['x-a', '2'],");
  });
});

describe('Python', () => {
  it('requests: headers, payload and method', () => {
    const code = generateCode('python-requests', jsonReq);
    expect(code).toContain('import requests');
    expect(code).toContain("url = 'https://api.example.com/users'");
    expect(code).toContain("'Content-Type': 'application/json',");
    expect(code).toContain("response = requests.request('POST', url, headers=headers, data=payload)");
  });

  it('requests: escapes text and encodes non-ASCII', () => {
    const code = generateCode('python-requests', trickyReq);
    expect(code).toContain('payload = """it\'s \\"q\\" \\\\ $HOME `cmd` ${x} #{y} \\\\(z) é\nnext"""');
    expect(code).toContain("data=payload.encode('utf-8')");
    expect(code).toContain("'X-Note': 'a\\'b\"c$d',");
  });

  it('requests: forms, urlencoded and binary', () => {
    const form = generateCode('python-requests', formReq);
    expect(form).toContain("('title', (None, 'Hello')),");
    expect(form).toContain("('avatar', ('photo.png', open('photo.png', 'rb'))),");
    expect(form).toContain('files=files');
    expect(form).not.toContain('multipart');
    expect(generateCode('python-requests', urlencodedReq)).toContain("'user': 'a b&c',");
    expect(generateCode('python-requests', binaryReq)).toContain("payload = open('image.png', 'rb')");
  });

  it('http.client: splits host and path', () => {
    const code = generateCode('python-http-client', getReq);
    expect(code).toContain("conn = http.client.HTTPSConnection('api.example.com')");
    expect(code).toContain("conn.request('GET', '/users?page=1', None, headers)");
    const local = generateCode('python-http-client', { method: 'GET', url: 'http://localhost:3000', headers: [] });
    expect(local).toContain("HTTPConnection('localhost:3000')");
    expect(local).toContain("conn.request('GET', '/', None, headers)");
  });

  it('http.client: builds multipart by hand', () => {
    const code = generateCode('python-http-client', formReq);
    expect(code).toContain("'Content-Type': 'multipart/form-data; boundary=----FormBoundary");
    expect(code).toContain("with open('photo.png', 'rb') as f:");
    expect(code).toContain('filename="photo.png"');
  });
});

describe('Go', () => {
  it('net/http with tabs and needed imports only', () => {
    const code = generateCode('go', jsonReq);
    expect(code).toContain('package main');
    expect(code).toContain('\t"strings"');
    expect(code).not.toContain('"os"');
    expect(code).toContain('req, err := http.NewRequest("POST", "https://api.example.com/users", payload)');
    expect(code).toContain('req.Header.Add("Content-Type", "application/json")');
    const get = generateCode('go', getReq);
    expect(get).toContain('http.NewRequest("GET", "https://api.example.com/users?page=1", nil)');
    expect(get).not.toContain('"strings"');
  });

  it('escapes strings and uses raw strings for multi-line text without backticks', () => {
    expect(generateCode('go', trickyReq)).toContain('strings.NewReader("it\'s \\"q\\" \\\\ $HOME `cmd` ${x} #{y} \\\\(z) é\\nnext")');
    const ml = generateCode('go', { ...jsonReq, body: { ...jsonReq.body, text: '{\n  "a": "\\\\"\n}' } });
    expect(ml).toContain('strings.NewReader(`{\n  "a": "\\\\"\n}`)');
  });

  it('multipart via mime/multipart', () => {
    const code = generateCode('go', formReq);
    expect(code).toContain('writer := multipart.NewWriter(payload)');
    expect(code).toContain('writer.WriteField("title", "Hello")');
    expect(code).toContain('writer.CreateFormFile("avatar", "photo.png")');
    expect(code).toContain('req.Header.Set("Content-Type", writer.FormDataContentType())');
  });
});

describe('PHP', () => {
  it('curl_setopt_array with escaped single quotes', () => {
    const code = generateCode('php-curl', trickyReq);
    expect(code.startsWith('<?php')).toBe(true);
    expect(code).toContain("CURLOPT_CUSTOMREQUEST => 'PUT',");
    expect(code).toContain("'X-Note: a\\'b\"c$d',");
    expect(code).toContain("CURLOPT_POSTFIELDS => 'it\\'s \"q\" \\\\ $HOME");
  });

  it('builds the multipart body itself when form names repeat, since a PHP array keeps only the last', () => {
    const r = { method: 'POST', url: 'https://e.com/up', headers: [], body: { mode: 'form', fields: [{ key: 'tag', value: 'a$b"c' }, { key: 'tag', value: 'b' }, { key: 'f', kind: 'file', fileName: 'a.png' }] } };
    const code = generateCode('php-curl', r);
    expect(code).not.toContain("'tag' =>");
    expect(code).toContain('name=\\"tag\\"\\r\\n\\r\\na\\$b\\"c\\r\\n');
    expect(code).toContain(". file_get_contents('a.png')");
    expect(code).toContain("'Content-Type: multipart/form-data; boundary=");
  });

  it('forms use CURLFile, HEAD uses NOBODY', () => {
    expect(generateCode('php-curl', formReq)).toContain("'avatar' => new CURLFile('photo.png', 'application/octet-stream', 'photo.png'),");
    expect(generateCode('php-curl', { method: 'HEAD', url: 'https://e.com', headers: [] })).toContain('CURLOPT_NOBODY => true');
    expect(generateCode('php-curl', getReq)).not.toContain('CUSTOMREQUEST');
  });
});

describe('JVM', () => {
  it('Java HttpClient', () => {
    const code = generateCode('java-httpclient', jsonReq);
    expect(code).toContain('import java.net.http.HttpClient;');
    expect(code).toContain('.header("Content-Type", "application/json")');
    expect(code).toContain('.method("POST", HttpRequest.BodyPublishers.ofString("{\\"name\\":\\"O\'Brien\\",\\"note\\":\\"say \\\\\\"hi\\\\\\"\\"}"))');
    expect(generateCode('java-httpclient', getReq)).toContain('HttpRequest.BodyPublishers.noBody()');
    expect(generateCode('java-httpclient', binaryReq)).toContain('ofFile(Path.of("image.png"))');
  });

  it('Java comments out headers HttpClient rejects and avoids \\u escapes', () => {
    const code = generateCode('java-httpclient', { method: 'GET', url: 'https://e.com', headers: [{ key: 'Host', value: 'x' }, { key: 'X-Ctl', value: 'a\x01b' }] });
    expect(code).toContain('// .header("Host", "x")');
    expect(code).toContain('.header("X-Ctl", "a\\001b")');
  });

  it('Java builds multipart by hand', () => {
    const code = generateCode('java-httpclient', formReq);
    expect(code).toContain('ByteArrayOutputStream body = new ByteArrayOutputStream();');
    expect(code).toContain('Files.readAllBytes(Path.of("photo.png"))');
    expect(code).toContain('.header("Content-Type", "multipart/form-data; boundary=----FormBoundary');
  });

  it('Kotlin OkHttp escapes $ and handles bodies', () => {
    const code = generateCode('kotlin-okhttp', trickyReq);
    expect(code).toContain('\\$HOME');
    expect(code).toContain('\\${x}');
    expect(code).toContain('.method("PUT", body)');
    expect(code).toContain('.toRequestBody("text/plain".toMediaTypeOrNull())');
    expect(generateCode('kotlin-okhttp', formReq)).toContain('.addFormDataPart("avatar", "photo.png", File("photo.png").asRequestBody(');
    expect(generateCode('kotlin-okhttp', getReq)).toContain('.method("GET", null)');
    expect(generateCode('kotlin-okhttp', { method: 'POST', url: 'https://e.com', headers: [] })).toContain('"".toRequestBody(null)');
  });
});

describe('C#', () => {
  it('puts content headers on the content', () => {
    const code = generateCode('csharp-httpclient', jsonReq);
    expect(code).toContain('new HttpRequestMessage(new HttpMethod("POST"), "https://api.example.com/users")');
    expect(code).toContain('request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");');
    expect(code).not.toContain('request.Headers.TryAddWithoutValidation("Content-Type"');
    expect(generateCode('csharp-httpclient', getReq)).toContain('request.Headers.TryAddWithoutValidation("Accept", "application/json");');
  });

  it('verbatim strings for multi-line text, multipart content for forms', () => {
    expect(generateCode('csharp-httpclient', trickyReq)).toContain('new StringContent(@"it\'s ""q"" \\ $HOME `cmd` ${x} #{y} \\(z) é\nnext", Encoding.UTF8)');
    const form = generateCode('csharp-httpclient', formReq);
    expect(form).toContain('var content = new MultipartFormDataContent();');
    expect(form).toContain('content.Add(new StreamContent(File.OpenRead("photo.png")), "avatar", "photo.png");');
  });
});

describe('Ruby', () => {
  it('Net::HTTP with method classes and generic requests', () => {
    const code = generateCode('ruby-net-http', jsonReq);
    expect(code).toContain("url = URI('https://api.example.com/users')");
    expect(code).toContain('request = Net::HTTP::Post.new(url)');
    expect(code).toContain("request['Content-Type'] = 'application/json'");
    const dup = generateCode('ruby-net-http', { ...getReq, headers: [{ key: 'X-Dup', value: '1' }, { key: 'x-dup', value: '2' }] });
    expect(dup).toContain("request['X-Dup'] = '1'");
    expect(dup).toContain("request.add_field('x-dup', '2')");
    expect(generateCode('ruby-net-http', { method: 'PURGE', url: 'https://e.com', headers: [] })).toContain("Net::HTTPGenericRequest.new('PURGE', false, true, url)");
  });

  it('escapes single quotes and keeps #{} inert', () => {
    const code = generateCode('ruby-net-http', trickyReq);
    expect(code).toContain("request.body = 'it\\'s \"q\" \\\\ $HOME `cmd` ${x} #{y} \\\\(z) é\nnext'");
    expect(generateCode('ruby-net-http', formReq)).toContain("['avatar', File.open('photo.png'), { filename: 'photo.png' }],");
  });

  it('escapes carriage returns, which Ruby would drop from a literal', () => {
    const code = generateCode('ruby-net-http', { method: 'POST', url: 'https://e.com', headers: [], body: { mode: 'raw', text: '--b\r\nX: "q" #{x}\t\\', contentType: 'text/plain' } });
    expect(code).toContain('request.body = "--b\\r\\nX: \\"q\\" \\#{x}\\t\\\\"');
  });
});

describe('Rust', () => {
  it('reqwest with raw strings and multipart', () => {
    const code = generateCode('rust-reqwest', jsonReq);
    expect(code).toContain('.request(reqwest::Method::POST, "https://api.example.com/users")');
    expect(code).toContain('.body(r#"{"name":"O\'Brien","note":"say \\"hi\\""}"#)');
    const tricky = generateCode('rust-reqwest', { ...jsonReq, body: { ...jsonReq.body, text: 'a "# b' } });
    expect(tricky).toContain('.body(r##"a "# b"##)');
    expect(generateCode('rust-reqwest', { method: 'PURGE', url: 'https://e.com', headers: [] })).toContain('reqwest::Method::from_bytes("PURGE".as_bytes())?');
    const form = generateCode('rust-reqwest', formReq);
    expect(form).toContain('features = ["multipart"]');
    expect(form).toContain('.part("avatar", reqwest::multipart::Part::bytes(std::fs::read("photo.png")?).file_name("photo.png"));');
  });
});

describe('Swift', () => {
  it('URLSession with escaped strings', () => {
    const code = generateCode('swift-urlsession', trickyReq);
    expect(code).toContain('var request = URLRequest(url: URL(string: "https://api.example.com/notes/1")!)');
    expect(code).toContain('request.httpMethod = "PUT"');
    expect(code).toContain('request.addValue("a\'b\\"c$d", forHTTPHeaderField: "X-Note")');
    expect(code).toContain('Data("it\'s \\"q\\" \\\\ $HOME `cmd` ${x} #{y} \\\\(z) é\\nnext".utf8)');
    expect(generateCode('swift-urlsession', formReq)).toContain('body.append(try Data(contentsOf: URL(fileURLWithPath: "photo.png")))');
  });
});

describe('PowerShell', () => {
  it('Invoke-RestMethod with -ContentType and doubled quotes', () => {
    const code = generateCode('powershell', trickyReq);
    expect(code).toContain("'X-Note' = 'a''b\"c$d'");
    expect(code).toContain("$body = 'it''s \"q\" \\ $HOME `cmd` ${x} #{y} \\(z) é\nnext'");
    expect(code).toContain("Invoke-RestMethod -Uri 'https://api.example.com/notes/1' -Method Put -Headers $headers -Body $body -ContentType 'text/plain'");
  });

  it('custom methods, forms and files', () => {
    expect(generateCode('powershell', { method: 'PURGE', url: 'https://e.com', headers: [] })).toContain("-CustomMethod 'PURGE'");
    // Hash literals refuse repeated keys (ignoring case), so repeated form names share one key.
    const repeated = generateCode('powershell', { method: 'POST', url: 'https://e.com', headers: [], body: { mode: 'form', fields: [{ key: 'tag', value: 'a' }, { key: 'Tag', value: 'b' }, { key: 'tag', kind: 'file', fileName: 'x.png' }, { key: 'one', value: '1' }] } });
    expect(repeated).toContain("  'tag' = @('a', 'b', (Get-Item -Path 'x.png'))\n  'one' = '1'\n");
    const form = generateCode('powershell', formReq);
    expect(form).toContain("'avatar' = Get-Item -Path 'photo.png'");
    expect(form).toContain('-Form $form');
    expect(generateCode('powershell', binaryReq)).toContain("-InFile 'image.png' -ContentType 'image/png'");
  });
});

describe('PHP empty headers', () => {
  it('writes an empty header as Name; so libcurl sends it', () => {
    const code = generateCode('php-curl', { ...getReq, headers: [{ key: 'X-Empty', value: '' }, { key: 'X-Full', value: 'v' }] });
    expect(code).toContain("'X-Empty;'");
    expect(code).toContain("'X-Full: v'");
  });
});
