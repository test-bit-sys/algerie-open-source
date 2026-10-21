import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { FORMATS, detectFormat, importData } from '../src/core/io/index.js';
import { exportNative, exportCollectionNative } from '../src/core/io/native.js';
import { exportCollectionV2, exportEnvironmentV2, SCHEMA_V21 } from '../src/core/io/collection-v2.js';
import { sampleSchema } from '../src/core/io/openapi.js';
import { convertTemplate } from '../src/core/io/insomnia.js';
import { collection, folder, request, environment, variable, pair, formField, normalizeCollection, requestsIn, walk } from '../src/core/model.js';

let curlModule = null;
try {
  curlModule = await import('../src/core/curl.js');
} catch {
  curlModule = null;
}

const SCHEMA_V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';
const byName = (items, name) => items.find((i) => i.name === name);
const stripIds = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' || k === 'createdAt' || k === 'updatedAt' ? undefined : v)));

// ---------------------------------------------------------------- fixtures

const v21 = {
  info: { name: 'Pet Store', description: 'Pets API', schema: SCHEMA_V21 },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'https://api.example.com' },
    { key: 'secretKey', value: 's3cr3t', type: 'secret' },
    { key: 'off', value: 'x', disabled: true },
  ],
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: ['console.log("collection");'] } }],
  item: [
    {
      name: 'Pets',
      description: 'Pet endpoints',
      auth: { type: 'noauth' },
      item: [
        {
          name: 'Admin',
          item: [
            {
              name: 'Delete pet',
              request: {
                method: 'DELETE',
                url: '{{baseUrl}}/pets/:id',
                auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] },
              },
            },
          ],
        },
        {
          name: 'Get pet',
          event: [
            { listen: 'prerequest', script: { exec: ['const a = 1;', 'const b = 2;'] } },
            { listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200));'] } },
          ],
          request: {
            method: 'GET',
            description: 'Fetch one pet',
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Off', value: '1', disabled: true },
            ],
            url: {
              raw: '{{baseUrl}}/pets/:id?expand=owner',
              host: ['{{baseUrl}}'],
              path: ['pets', ':id'],
              query: [
                { key: 'expand', value: 'owner' },
                { key: 'debug', value: 'true', disabled: true },
              ],
              variable: [{ key: 'id', value: '42', description: 'Pet id' }],
            },
          },
          response: [
            {
              name: 'Found',
              originalRequest: { method: 'GET', url: { raw: '{{baseUrl}}/pets/42' } },
              status: 'OK',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '{"id":42}',
            },
          ],
        },
      ],
    },
    {
      name: 'Create pet',
      request: {
        method: 'POST',
        auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: 'abc' }, { key: 'in', value: 'query' }] },
        body: { mode: 'raw', raw: '{"name":"Rex"}', options: { raw: { language: 'json' } } },
        url: { protocol: 'https', host: ['api', 'example', 'com'], path: ['pets'] },
      },
    },
    {
      name: 'Login',
      request: {
        method: 'POST',
        auth: {
          type: 'oauth2',
          oauth2: [
            { key: 'accessToken', value: 'tok' },
            { key: 'grant_type', value: 'password_credentials' },
            { key: 'accessTokenUrl', value: 'https://auth/token' },
          ],
        },
        body: { mode: 'urlencoded', urlencoded: [{ key: 'user', value: 'a' }, { key: 'skip', value: 'b', disabled: true }] },
        url: 'https://api.example.com/login',
      },
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'title', value: 'cat', type: 'text' },
            { key: 'photo', type: 'file', src: '/tmp/cat.png' },
          ],
        },
        url: 'https://api.example.com/upload',
      },
    },
    { name: 'Raw file', request: { method: 'PUT', body: { mode: 'file', file: { src: 'a.bin' } }, url: 'https://api.example.com/blob' } },
    {
      name: 'GraphQL',
      request: {
        method: 'POST',
        body: { mode: 'graphql', graphql: { query: '{ pets { id } }', variables: { first: 2 } } },
        url: 'https://api.example.com/graphql',
      },
    },
    { name: 'Plain text', request: { method: 'POST', body: { mode: 'raw', raw: 'hello' }, url: 'https://api.example.com/echo' } },
    { name: 'String request', request: 'https://api.example.com/ping' },
    { name: 'Digest', request: { method: 'GET', auth: { type: 'digest', digest: [] }, url: 'https://api.example.com/d' } },
  ],
};

const v20 = {
  info: { name: 'Old', schema: SCHEMA_V20 },
  item: [{ name: 'One', request: { method: 'GET', url: 'https://x.test/a', auth: { type: 'bearer', bearer: { token: 'old-token' } } } }],
};

const envV2 = {
  id: 'abc',
  name: 'Staging',
  values: [
    { key: 'host', value: 'staging.example.com', enabled: true },
    { key: 'token', value: 'xyz', type: 'secret', enabled: true },
    { key: 'unused', value: '1', enabled: false },
  ],
};

const openapi3 = {
  openapi: '3.0.3',
  info: { title: 'Shop API', description: 'Shop' },
  servers: [{ url: 'https://{region}.shop.test/v{version}', variables: { region: { default: 'eu' }, version: { default: '2' } } }],
  tags: [{ name: 'orders', description: 'Order endpoints' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/orders/{orderId}': {
      parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string', example: 'o-1' } }],
      get: {
        tags: ['orders'],
        summary: 'Get order',
        parameters: [
          { name: 'expand', in: 'query', required: true, schema: { type: 'string', enum: ['items', 'none'] } },
          { name: 'debug', in: 'query', schema: { type: 'boolean' } },
          { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string', default: 't1' } },
          { name: 'Accept', in: 'header', schema: { type: 'string' } },
          { name: 'session', in: 'cookie', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'The order', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
          404: { description: 'Not found' },
        },
      },
    },
    '/orders': {
      post: {
        tags: ['orders', 'extra'],
        operationId: 'createOrder',
        requestBody: { $ref: '#/components/requestBodies/OrderBody' },
        responses: { 201: { description: 'Created' } },
      },
    },
    '/health': {
      get: { security: [], responses: { 200: { description: 'ok' } } },
    },
    '/upload': {
      post: {
        security: [{ keyAuth: [] }],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { note: { type: 'string', example: 'hi' }, file: { type: 'string', format: 'binary' } } },
            },
          },
        },
        responses: {},
      },
    },
    '/login': {
      post: {
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: { type: 'object', properties: { user: { type: 'string' }, remember: { type: 'boolean' } } },
            },
          },
        },
        responses: {},
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      keyAuth: { type: 'apiKey', in: 'query', name: 'api_key' },
    },
    requestBodies: {
      OrderBody: {
        content: {
          'application/xml': { schema: { type: 'string' } },
          'application/json': { schema: { $ref: '#/components/schemas/Order' } },
        },
      },
    },
    schemas: {
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', readOnly: true },
          status: { type: 'string', enum: ['open', 'closed'] },
          createdAt: { type: 'string', format: 'date-time' },
          total: { type: 'number', minimum: 1 },
          items: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
          customer: {
            allOf: [{ $ref: '#/components/schemas/Named' }, { type: 'object', properties: { email: { type: 'string', format: 'email' } } }],
          },
          payment: {
            oneOf: [
              { type: 'object', properties: { card: { type: 'string' } } },
              { type: 'object', properties: { iban: { type: 'string' } } },
            ],
          },
          parent: { $ref: '#/components/schemas/Order' },
        },
      },
      Item: { type: 'object', properties: { sku: { type: 'string', example: 'SKU-1' }, qty: { type: 'integer' } } },
      Named: { type: 'object', properties: { name: { type: 'string' } } },
    },
  },
};

const swagger2Yaml = `
swagger: "2.0"
info:
  title: Legacy API
host: legacy.test
basePath: /api
schemes: [http, https]
consumes: [application/json]
securityDefinitions:
  basicAuth:
    type: basic
  key:
    type: apiKey
    in: header
    name: X-Api-Key
security:
  - basicAuth: []
paths:
  /users/{userId}:
    put:
      tags: [users]
      summary: Update user
      security:
        - key: []
      parameters:
        - name: userId
          in: path
          required: true
          type: integer
          x-example: 7
        - name: body
          in: body
          schema:
            $ref: '#/definitions/User'
      responses:
        "200":
          description: Updated
          schema:
            $ref: '#/definitions/User'
  /avatar:
    post:
      consumes: [multipart/form-data]
      parameters:
        - { name: image, in: formData, type: file }
        - { name: caption, in: formData, type: string, default: me }
      responses: {}
definitions:
  User:
    type: object
    properties:
      name: { type: string, example: Ada }
      age: { type: integer, minimum: 18 }
`;

const har = {
  log: {
    version: '1.2',
    creator: { name: 'Browser', version: '1' },
    entries: [
      {
        request: {
          method: 'POST',
          url: 'https://api.test/v1/items?draft=1',
          httpVersion: 'HTTP/2',
          headers: [
            { name: ':authority', value: 'api.test' },
            { name: ':method', value: 'POST' },
            { name: 'content-type', value: 'application/json' },
            { name: 'cookie', value: 'a=b' },
            { name: 'content-length', value: '12' },
            { name: 'x-client', value: 'web' },
          ],
          queryString: [{ name: 'draft', value: '1' }],
          postData: { mimeType: 'application/json', text: '{"name":"x"}' },
        },
        response: {
          status: 201,
          statusText: 'Created',
          headers: [{ name: 'content-type', value: 'application/json' }],
          content: { mimeType: 'application/json', text: '{"id":1}' },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.test/login',
          headers: [],
          postData: { mimeType: 'application/x-www-form-urlencoded', text: 'user=ada&pass=a%20b' },
        },
        response: { status: 0 },
      },
      {
        request: { method: 'GET', url: 'https://api.test/', headers: [] },
      },
    ],
  },
};

const insomnia = {
  _type: 'export',
  __export_format: 4,
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'My Space', description: 'ws' },
    {
      _id: 'env_base',
      _type: 'environment',
      parentId: 'wrk_1',
      name: 'Base',
      data: { baseUrl: 'https://ins.test', auth: { token: 'base-tok' } },
    },
    { _id: 'env_dev', _type: 'environment', parentId: 'env_base', name: 'Dev', data: { baseUrl: 'http://localhost:3000' } },
    {
      _id: 'fld_1',
      _type: 'request_group',
      parentId: 'wrk_1',
      name: 'Users',
      metaSortKey: 1,
      authentication: { type: 'bearer', token: '{{ _.auth.token }}' },
    },
    { _id: 'fld_2', _type: 'request_group', parentId: 'fld_1', name: 'Nested', metaSortKey: 1 },
    {
      _id: 'req_1',
      _type: 'request',
      parentId: 'fld_1',
      name: 'List users',
      metaSortKey: 2,
      method: 'GET',
      url: '{{ _.baseUrl }}/users',
      parameters: [{ name: 'page', value: '1' }, { name: 'off', value: 'x', disabled: true }],
      headers: [{ name: 'X-Req', value: '{{_.reqId}}' }],
      authentication: {},
      body: {},
    },
    {
      _id: 'req_2',
      _type: 'request',
      parentId: 'fld_2',
      name: 'Create user',
      method: 'POST',
      url: '{{ _.baseUrl }}/users/:org',
      pathParameters: [{ name: 'org', value: 'acme' }],
      body: { mimeType: 'application/json', text: '{"name":"{{ _.name }}"}' },
      authentication: { type: 'basic', username: 'u', password: 'p' },
    },
    {
      _id: 'req_3',
      _type: 'request',
      parentId: 'wrk_1',
      name: 'Query',
      metaSortKey: 5,
      method: 'POST',
      url: '{{ _.baseUrl }}/graphql',
      body: { mimeType: 'application/graphql', text: JSON.stringify({ query: '{ me { id } }', variables: { a: 1 } }) },
      authentication: { type: 'apikey', key: 'k', value: 'v', addTo: 'queryParams' },
    },
    {
      _id: 'req_4',
      _type: 'request',
      parentId: 'wrk_1',
      name: 'Form',
      metaSortKey: 6,
      method: 'POST',
      url: 'https://ins.test/form?x=1',
      body: { mimeType: 'multipart/form-data', params: [{ name: 'a', value: 'b' }, { name: 'f', type: 'file', fileName: '/x.png' }] },
    },
    { _id: 'jar_1', _type: 'cookie_jar', parentId: 'wrk_1', name: 'Default Jar' },
  ],
};

function sampleCollection() {
  return collection({
    name: 'Round Trip',
    description: 'All the things',
    auth: { type: 'bearer', bearer: { token: '{{token}}' } },
    scripts: { pre: 'console.log(1);\nconsole.log(2);', post: '' },
    variables: [variable('baseUrl', 'https://rt.test'), variable('secret', 'shh', { secret: true }), variable('off', '0', { enabled: false })],
    items: [
      folder({
        name: 'Folder A',
        description: 'desc A',
        auth: { type: 'none' },
        items: [
          folder({
            name: 'Inner',
            items: [
              request({
                name: 'Get thing',
                method: 'GET',
                url: '{{baseUrl}}/things/:thingId?limit=10',
                params: [pair('limit', '10'), pair('hidden', '1', { enabled: false })],
                pathVars: [pair('thingId', '5', { description: 'the id' })],
                headers: [pair('Accept', 'application/json'), pair('X-Off', 'no', { enabled: false })],
                examples: [
                  {
                    name: 'OK',
                    status: 200,
                    statusText: 'OK',
                    headers: [pair('Content-Type', 'application/json')],
                    body: '{"a":1}',
                    request: { method: 'GET', url: '{{baseUrl}}/things/5' },
                  },
                ],
              }),
            ],
          }),
        ],
      }),
      request({ name: 'Post json', method: 'POST', url: 'https://rt.test:8443/json', body: { mode: 'raw', raw: '{"x":1}', rawType: 'json' } }),
      request({ name: 'Post xml', method: 'POST', url: 'https://rt.test/xml', body: { mode: 'raw', raw: '<a/>', rawType: 'xml' } }),
      request({
        name: 'Encoded',
        method: 'POST',
        url: 'https://rt.test/e',
        body: { mode: 'urlencoded', urlencoded: [pair('a', '1'), pair('b', '2', { enabled: false })] },
      }),
      request({
        name: 'Form',
        method: 'POST',
        url: 'https://rt.test/f',
        body: { mode: 'form', form: [formField('t', 'v'), formField('up', '', { kind: 'file' })] },
      }),
      request({
        name: 'GQL',
        method: 'POST',
        url: 'https://rt.test/g',
        body: { mode: 'graphql', graphql: { query: '{ a }', variables: '{"x":1}' } },
      }),
      request({
        name: 'Basic',
        url: 'https://rt.test/b',
        auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
        settings: { followRedirects: false, encodeUrl: false },
      }),
      request({ name: 'Key', url: 'https://rt.test/k', auth: { type: 'apikey', apikey: { key: 'X-K', value: 'v', in: 'query' } } }),
      request({
        name: 'OAuth',
        url: 'https://rt.test/o',
        auth: {
          type: 'oauth2',
          oauth2: { accessToken: 'at', grantType: 'password', tokenUrl: 'https://rt.test/token', clientId: 'cid', username: 'u', password: 'p' },
        },
        scripts: { pre: '', post: 'console.log("done");' },
      }),
    ],
  });
}

// ---------------------------------------------------------------- tests

describe('FORMATS and detectFormat', () => {
  it('lists unique ids with labels and extensions', () => {
    const ids = FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FORMATS) {
      expect(typeof f.label).toBe('string');
      expect(f.extensions.length).toBeGreaterThan(0);
    }
  });

  it('detects every supported format', () => {
    expect(detectFormat(exportNative({ collections: [collection()] }))).toBe('native');
    expect(detectFormat(collection())).toBe('native');
    expect(detectFormat(JSON.stringify(v21))).toBe('collection-v2.1');
    expect(detectFormat(v20)).toBe('collection-v2.0');
    expect(detectFormat(envV2)).toBe('environment-v2');
    expect(detectFormat(openapi3)).toBe('openapi');
    expect(detectFormat(YAML.stringify(openapi3))).toBe('openapi');
    expect(detectFormat(swagger2Yaml)).toBe('swagger');
    expect(detectFormat(har)).toBe('har');
    expect(detectFormat(insomnia)).toBe('insomnia');
    expect(detectFormat(YAML.stringify(insomnia))).toBe('insomnia');
  });

  it('returns null for unknown input', () => {
    expect(detectFormat('hello world')).toBe(null);
    expect(detectFormat('{"foo": 1}')).toBe(null);
    expect(detectFormat('')).toBe(null);
    expect(detectFormat(null)).toBe(null);
    expect(detectFormat([1, 2])).toBe(null);
  });
});

describe('importData errors', () => {
  it('rejects empty, garbage and unsupported input with friendly messages', async () => {
    await expect(importData('')).rejects.toThrow(/empty/);
    await expect(importData('   ')).rejects.toThrow(/empty/);
    await expect(importData('{ not: json: [')).rejects.toThrow(/not valid JSON or YAML/);
    await expect(importData('just some words')).rejects.toThrow(/not in a supported format/);
    await expect(importData('{"hello": "world"}')).rejects.toThrow(/Supported formats/);
    const v1 = JSON.stringify({ info: { schema: SCHEMA_V20.replace('v2.0.0', 'v1.0.0') } });
    await expect(importData(v1)).rejects.toThrow(/v1 is not supported/);
  });
});

describe('OpenAPI path parameters', () => {
  it('uses :name only for whole segments', async () => {
    const op = (params) => ({ get: { parameters: params, responses: { 200: { description: 'ok' } } } });
    const doc = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/reports/{id}.json': op([{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 7 } }]),
        '/files/{name}.{ext}': op([{ name: 'name', in: 'path', schema: { type: 'string' } }, { name: 'ext', in: 'path', schema: { type: 'string' } }]),
        '/users/{userId}/posts': op([{ name: 'userId', in: 'path', schema: { type: 'string' } }]),
      },
    };
    const out = await importData(JSON.stringify(doc));
    expect(requestsIn(out.collections[0]).map(({ item }) => item.url).sort()).toEqual(['{{baseUrl}}/files/{{name}}.{{ext}}', '{{baseUrl}}/reports/7.json', '{{baseUrl}}/users/:userId/posts']);
  });

  it('fills query parameters described with content instead of a schema', async () => {
    const doc = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: { '/x': { get: { parameters: [{ name: 'filter', in: 'query', required: true, content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'integer', example: 1 } } } } } }], responses: { 200: { description: 'ok' } } } } } };
    const out = await importData(JSON.stringify(doc));
    expect(requestsIn(out.collections[0])[0].item.params[0]).toMatchObject({ key: 'filter', value: '{"a":1}' });
  });

  it('puts operations tagged 5 and "5" in one folder', async () => {
    const yaml = "openapi: 3.0.0\ninfo: {title: t, version: '1'}\npaths:\n  /x:\n    get:\n      tags: [5]\n      responses: {'200': {description: ok}}\n  /y:\n    get:\n      tags: ['5']\n      responses: {'200': {description: ok}}\n";
    const out = await importData(yaml);
    expect(out.collections[0].items.filter((i) => i.type === 'folder').map((f) => [f.name, f.items.length])).toEqual([['5', 2]]);
  });

  it('serializes array and object query examples the way their style says', async () => {
    const q = (name, extra) => ({ name, in: 'query', required: true, ...extra });
    const doc = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/x': {
          get: {
            parameters: [
              q('ids', { schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] }),
              q('csv', { explode: false, schema: { type: 'array', example: ['a', 'b'] } }),
              q('pipes', { style: 'pipeDelimited', explode: false, schema: { type: 'array', example: ['a', 'b'] } }),
              q('filter', { style: 'deepObject', schema: { type: 'object', example: { a: 1, b: 'x' } } }),
            ],
            responses: { 200: { description: 'ok' } },
          },
        },
      },
    };
    const v3 = requestsIn((await importData(JSON.stringify(doc))).collections[0])[0].item;
    expect(v3.params.map((p) => [p.key, p.value])).toEqual([['ids', '1'], ['ids', '2'], ['csv', 'a,b'], ['pipes', 'a|b'], ['filter[a]', '1'], ['filter[b]', 'x']]);
    expect(v3.url).toBe('{{baseUrl}}/x?ids=1&ids=2&csv=a,b&pipes=a|b&filter[a]=1&filter[b]=x');
    const swagger = {
      swagger: '2.0',
      info: { title: 't', version: '1' },
      paths: { '/y': { get: { parameters: [q('tags', { type: 'array', items: { type: 'string' }, collectionFormat: 'multi', 'x-example': ['a', 'b'] }), q('plain', { type: 'array', items: { type: 'string' }, 'x-example': ['c', 'd'] })], responses: { 200: { description: 'ok' } } } } },
    };
    const v2 = requestsIn((await importData(JSON.stringify(swagger))).collections[0])[0].item;
    expect(v2.params.map((p) => [p.key, p.value])).toEqual([['tags', 'a'], ['tags', 'b'], ['plain', 'c,d']]);
  });

  it('applies YAML merge keys', async () => {
    const yaml = "openapi: 3.0.0\ninfo: {title: t, version: '1'}\nx-common: &common\n  parameters: [{name: limit, in: query, required: true, schema: {type: integer, example: 10}}]\n  responses: {'200': {description: ok}}\npaths:\n  /x:\n    get:\n      <<: *common\n      summary: List\n";
    const out = await importData(yaml);
    expect(requestsIn(out.collections[0])[0].item.params).toMatchObject([{ key: 'limit', value: '10' }]);
  });

  it('follows $refs that contain a bare %', async () => {
    const doc = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: { '/x': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/100%' } } } }, responses: { 200: { description: 'ok' } } } } }, components: { schemas: { '100%': { type: 'object', properties: { a: { type: 'integer' } } } } } };
    const out = await importData(JSON.stringify(doc));
    expect(JSON.parse(requestsIn(out.collections[0])[0].item.body.raw)).toEqual({ a: 0 });
  });

  it('uses servers set on a path or an operation', async () => {
    const ok = { responses: { 200: { description: 'ok' } } };
    const doc = {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      servers: [{ url: 'https://a.com' }],
      paths: { '/x': { servers: [{ url: 'https://b.com/' }], get: ok, post: { ...ok, servers: [{ url: 'https://{region}.c.com', variables: { region: { default: 'eu' } } }] } }, '/y': { get: ok } },
    };
    const out = await importData(JSON.stringify(doc));
    expect(requestsIn(out.collections[0]).map(({ item }) => `${item.method} ${item.url}`).sort()).toEqual(['GET https://b.com/x', 'GET {{baseUrl}}/y', 'POST https://eu.c.com/x']);
  });
});

describe('Postman OAuth 2.0 round trip', () => {
  it('keeps an empty header prefix', async () => {
    const col = collection({ name: 'C', auth: { type: 'oauth2', oauth2: { accessToken: 't', headerPrefix: '' } }, items: [] });
    const back = await importData(exportCollectionV2(col));
    expect(back.collections[0].auth.oauth2.headerPrefix).toBe('');
    const bearer = await importData(exportCollectionV2(collection({ name: 'D', auth: { type: 'oauth2', oauth2: { accessToken: 't', headerPrefix: 'Token' } }, items: [] })));
    expect(bearer.collections[0].auth.oauth2.headerPrefix).toBe('Token');
  });
});

describe('auth import details', () => {
  it('keeps Insomnia bearer prefixes and cookie API keys', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'W' },
        { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'A', method: 'GET', url: 'https://a.test/', authentication: { type: 'bearer', token: 'abc', prefix: 'Token' } },
        { _id: 'req_2', _type: 'request', parentId: 'wrk_1', name: 'B', method: 'GET', url: 'https://a.test/', authentication: { type: 'apikey', key: 'sid', value: 'v', addTo: 'cookie' } },
      ],
    };
    const out = await importData(JSON.stringify(doc));
    const [a, b] = requestsIn(out.collections[0]).map(({ item }) => item.auth.apikey);
    expect(a).toMatchObject({ key: 'Authorization', value: 'Token abc', in: 'header' });
    expect(b).toMatchObject({ key: 'Cookie', value: 'sid=v', in: 'header' });
    expect(out.warnings.join(' ')).toContain('cookie');
  });
});

describe('HAR form bodies', () => {
  it('reads url-encoded bodies from the raw text, not the possibly still-encoded params', async () => {
    const doc = { log: { version: '1.2', creator: { name: 'x' }, entries: [{ request: { method: 'POST', url: 'https://a.test/', headers: [], postData: { mimeType: 'application/x-www-form-urlencoded', text: 'q=a%20b&s=%26', params: [{ name: 'q', value: 'a%20b' }, { name: 's', value: '%26' }] } }, response: { status: 0 } }] } };
    const out = await importData(JSON.stringify(doc));
    const req = requestsIn(out.collections[0])[0].item;
    expect(req.body.urlencoded.map((p) => [p.key, p.value])).toEqual([['q', 'a b'], ['s', '&']]);
  });
});

describe('OpenAPI examples', () => {
  it('stays small for schemas that all reference each other', async () => {
    const schemas = {};
    for (let i = 0; i < 10; i++) {
      const props = { id: { type: 'integer' } };
      for (let j = 0; j < 10; j++) if (j !== i) props[`p${j}`] = { $ref: `#/components/schemas/S${j}` };
      schemas[`S${i}`] = { type: 'object', properties: props };
    }
    const body = (n) => ({ requestBody: { content: { 'application/json': { schema: { $ref: `#/components/schemas/S${n}` } } } }, responses: { 200: { description: 'ok' } } });
    const doc = { openapi: '3.0.0', info: { title: 't', version: '1' }, paths: { '/a': { post: body(0) }, '/b': { post: body(1) } }, components: { schemas } };
    const started = Date.now();
    const out = await importData(JSON.stringify(doc));
    expect(Date.now() - started).toBeLessThan(1000);
    const raws = [];
    walk(out.collections[0], (i) => i.type === 'request' && raws.push(i.body.raw));
    expect(raws).toHaveLength(2);
    for (const raw of raws) {
      expect(raw.length).toBeLessThan(200000);
      expect(JSON.parse(raw).id).toBe(0);
    }
  });
});

describe('native format', () => {
  it('round-trips collections and environments with ids intact', async () => {
    const col = sampleCollection();
    const env = environment({ name: 'Prod', variables: [variable('host', 'prod.test'), variable('pw', 'x', { secret: true })] });
    const text = exportNative({ collections: [col], environments: [env] });
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe('api-client');
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe('string');
    const out = await importData(text, { fileName: 'backup.json' });
    expect(out.format).toBe('native');
    expect(out.collections).toEqual([col]);
    expect(out.environments).toEqual([env]);
    expect(out.warnings).toEqual([]);
  });

  it('imports copies of shared collections as the user\'s own', async () => {
    const col = { ...sampleCollection(), shared: { path: '/bob/x.json', owner: 'bob', mode: 'read' } };
    expect(JSON.parse(exportNative({ collections: [col] })).collections[0].shared).toBeUndefined();
    const file = JSON.stringify({ format: 'api-client', version: 1, collections: [col], environments: [] });
    expect((await importData(file)).collections[0].shared).toBeUndefined();
    expect((await importData(JSON.stringify(col))).collections[0].shared).toBeUndefined();
  });

  it('exports a single collection and accepts a bare collection object', async () => {
    const col = sampleCollection();
    const one = await importData(exportCollectionNative(col));
    expect(one.collections).toEqual([col]);
    const bare = await importData(JSON.stringify(col));
    expect(bare.collections).toEqual([col]);
    expect(bare.environments).toEqual([]);
  });

  it('warns on newer versions', async () => {
    const out = await importData(JSON.stringify({ format: 'api-client', version: 9, collections: [collection()] }));
    expect(out.warnings[0]).toMatch(/newer version/);
  });
});

describe('collection v2 import', () => {
  it('maps structure, folders, variables, scripts and descriptions', async () => {
    const { collections, warnings } = await importData(JSON.stringify(v21));
    const c = collections[0];
    expect(c).toEqual(normalizeCollection(c));
    expect(c.name).toBe('Pet Store');
    expect(c.description).toBe('Pets API');
    expect(c.auth.type).toBe('bearer');
    expect(c.auth.bearer.token).toBe('{{token}}');
    expect(c.scripts.pre).toBe('console.log("collection");');
    expect(c.variables.map((v) => [v.key, v.value, v.enabled, v.secret])).toEqual([
      ['baseUrl', 'https://api.example.com', true, false],
      ['secretKey', 's3cr3t', true, true],
      ['off', 'x', false, false],
    ]);

    const pets = byName(c.items, 'Pets');
    expect(pets.type).toBe('folder');
    expect(pets.description).toBe('Pet endpoints');
    expect(pets.auth.type).toBe('none');
    const admin = byName(pets.items, 'Admin');
    expect(admin.type).toBe('folder');
    expect(admin.auth.type).toBe('inherit');
    const del = admin.items[0];
    expect(del.method).toBe('DELETE');
    expect(del.auth).toMatchObject({ type: 'basic', basic: { username: 'u', password: 'p' } });
    expect(del.pathVars.map((p) => p.key)).toEqual(['id']);

    const get = byName(pets.items, 'Get pet');
    expect(get.description).toBe('Fetch one pet');
    expect(get.url).toBe('{{baseUrl}}/pets/:id?expand=owner');
    expect(get.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['expand', 'owner', true],
      ['debug', 'true', false],
    ]);
    expect(get.pathVars.map((p) => [p.key, p.value, p.description])).toEqual([['id', '42', 'Pet id']]);
    expect(get.headers.map((h) => [h.key, h.enabled])).toEqual([
      ['Accept', true],
      ['X-Off', false],
    ]);
    expect(get.auth.type).toBe('inherit');
    expect(get.scripts.pre).toBe('const a = 1;\nconst b = 2;');
    expect(get.scripts.post).toContain('pm.test');
    expect(get.examples).toHaveLength(1);
    expect(get.examples[0]).toMatchObject({
      name: 'Found',
      status: 200,
      statusText: 'OK',
      body: '{"id":42}',
      request: { method: 'GET', url: '{{baseUrl}}/pets/42' },
    });
    expect(get.examples[0].headers[0]).toMatchObject({ key: 'Content-Type', value: 'application/json' });

    expect(warnings.some((w) => /pm\.\*/.test(w) && /1 item/.test(w))).toBe(true);
    expect(warnings.some((w) => /digest/.test(w))).toBe(true);
    expect(warnings.some((w) => /2 file upload/.test(w))).toBe(true);
  });

  it('maps body modes and auth types', async () => {
    const c = (await importData(v21)).collections[0];
    const create = byName(c.items, 'Create pet');
    expect(create.url).toBe('https://api.example.com/pets');
    expect(create.body).toMatchObject({ mode: 'raw', raw: '{"name":"Rex"}', rawType: 'json' });
    expect(create.auth).toMatchObject({ type: 'apikey', apikey: { key: 'X-Key', value: 'abc', in: 'query' } });

    const login = byName(c.items, 'Login');
    expect(login.body.mode).toBe('urlencoded');
    expect(login.body.urlencoded.map((p) => [p.key, p.enabled])).toEqual([
      ['user', true],
      ['skip', false],
    ]);
    expect(login.auth.type).toBe('oauth2');
    expect(login.auth.oauth2).toMatchObject({
      accessToken: 'tok',
      grantType: 'password',
      tokenUrl: 'https://auth/token',
      headerPrefix: 'Bearer',
    });

    const upload = byName(c.items, 'Upload');
    expect(upload.body.mode).toBe('form');
    expect(upload.body.form.map((f) => [f.key, f.kind, f.value])).toEqual([
      ['title', 'text', 'cat'],
      ['photo', 'file', ''],
    ]);
    expect(byName(c.items, 'Raw file').body.mode).toBe('binary');

    const gql = byName(c.items, 'GraphQL');
    expect(gql.body.mode).toBe('graphql');
    expect(gql.body.graphql.query).toBe('{ pets { id } }');
    expect(JSON.parse(gql.body.graphql.variables)).toEqual({ first: 2 });

    expect(byName(c.items, 'Plain text').body).toMatchObject({ mode: 'raw', rawType: 'text', raw: 'hello' });
    expect(byName(c.items, 'String request')).toMatchObject({ method: 'GET', url: 'https://api.example.com/ping' });
    expect(byName(c.items, 'Digest').auth.type).toBe('none');
  });

  it('reads v2.0 object-style auth and defaults collection auth to none', async () => {
    const c = (await importData(v20)).collections[0];
    expect(c.auth.type).toBe('none');
    expect(c.items[0].auth).toMatchObject({ type: 'bearer', bearer: { token: 'old-token' } });
  });

  it('reads headers written as a "Key: value" block, quickly even when a line is huge', async () => {
    const block = (header) => ({ info: { name: 'H', schema: SCHEMA_V20 }, item: [{ name: 'R', request: { method: 'GET', url: 'https://x.test/', header } }] });
    const headersOf = async (header) => (await importData(block(header))).collections[0].items[0].headers.map((h) => [h.key, h.value]);
    expect(await headersOf('Accept: text/plain\r\n  X-Id :  a:b \nno colon\n: empty name\nX-Empty:')).toEqual([
      ['Accept', 'text/plain'],
      ['X-Id', 'a:b '],
      ['X-Empty', ''],
    ]);
    const started = Date.now();
    expect(await headersOf(`a${' '.repeat(160000)}`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('imports and exports environments', async () => {
    const { environments, collections } = await importData(JSON.stringify(envV2));
    expect(collections).toEqual([]);
    const env = environments[0];
    expect(env.name).toBe('Staging');
    expect(env.variables.map((v) => [v.key, v.value, v.enabled, v.secret])).toEqual([
      ['host', 'staging.example.com', true, false],
      ['token', 'xyz', true, true],
      ['unused', '1', false, false],
    ]);
    const again = await importData(exportEnvironmentV2(env));
    expect(stripIds(again.environments[0].variables)).toEqual(stripIds(env.variables));
    expect(again.environments[0].name).toBe('Staging');
  });
});

describe('collection v2.1 export', () => {
  it('exports keys written without = as null values, which Postman sends bare', async () => {
    const c = collection({ name: 'C', items: [request({ name: 'R', url: 'https://e.com/a?flag&x=1&empty=' })] });
    const out = JSON.parse(exportCollectionV2(c));
    expect(out.item[0].request.url.query).toEqual([{ key: 'flag', value: null }, { key: 'x', value: '1' }, { key: 'empty', value: '' }]);
    const back = await importData(JSON.stringify(out));
    expect(requestsIn(back.collections[0])[0].item.url).toBe('https://e.com/a?flag&x=1&empty=');
  });

  it('writes the v2.1 schema and structured urls', () => {
    const out = JSON.parse(exportCollectionV2(sampleCollection()));
    expect(out.info.schema).toBe(SCHEMA_V21);
    const inner = out.item[0].item[0].item[0];
    expect(inner.request.url).toMatchObject({
      raw: '{{baseUrl}}/things/:thingId?limit=10',
      host: ['{{baseUrl}}'],
      path: ['things', ':thingId'],
      query: [{ key: 'limit', value: '10' }, { key: 'hidden', value: '1', disabled: true }],
      variable: [{ key: 'thingId', value: '5', description: 'the id' }],
    });
    const json = out.item.find((i) => i.name === 'Post json');
    expect(json.request.url).toMatchObject({ protocol: 'https', host: ['rt', 'test'], port: '8443', path: ['json'] });
    expect(json.request.body.options.raw.language).toBe('json');
    expect(out.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] });
    expect(out.event[0]).toMatchObject({ listen: 'prerequest', script: { exec: ['console.log(1);', 'console.log(2);'] } });
    expect(out.item[0].auth).toEqual({ type: 'noauth' });
    expect(out.item.find((i) => i.name === 'Basic').protocolProfileBehavior).toEqual({ followRedirects: false, disableUrlEncoding: true });
  });

  it('round-trips through import with structure preserved', async () => {
    const original = sampleCollection();
    const { collections, format } = await importData(exportCollectionV2(original));
    expect(format).toBe('collection-v2.1');
    const back = collections[0];
    // File references cannot travel through this format; everything else should.
    const expected = structuredClone(original);
    expect(stripIds(back)).toEqual(stripIds(expected));
  });
});

describe('OpenAPI import', () => {
  it('builds folders, urls, params and variables from an OpenAPI 3 document', async () => {
    const { collections, warnings, format } = await importData(JSON.stringify(openapi3));
    expect(format).toBe('openapi');
    const c = collections[0];
    expect(c.name).toBe('Shop API');
    expect(c.variables.find((v) => v.key === 'baseUrl').value).toBe('https://eu.shop.test/v2');
    expect(c.variables.find((v) => v.key === 'bearerToken').secret).toBe(true);
    expect(c.auth).toMatchObject({ type: 'bearer', bearer: { token: '{{bearerToken}}' } });

    const orders = byName(c.items, 'orders');
    expect(orders.type).toBe('folder');
    expect(orders.description).toBe('Order endpoints');
    expect(c.items.find((i) => i.name === 'extra')).toBeUndefined();

    const get = byName(orders.items, 'Get order');
    expect(get.url).toBe('{{baseUrl}}/orders/:orderId?expand=items');
    expect(get.pathVars.map((p) => [p.key, p.value])).toEqual([['orderId', 'o-1']]);
    expect(get.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['expand', 'items', true],
      ['debug', '', false],
    ]);
    expect(get.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([['X-Trace', 't1', true]]);
    expect(get.auth.type).toBe('inherit');
    expect(get.examples).toHaveLength(1);
    expect(get.examples[0].status).toBe(200);
    expect(JSON.parse(get.examples[0].body).id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');

    const create = byName(orders.items, 'createOrder');
    expect(create.method).toBe('POST');
    expect(create.body.mode).toBe('raw');
    expect(create.body.rawType).toBe('json');
    const body = JSON.parse(create.body.raw);
    expect(body).toMatchObject({
      status: 'open',
      createdAt: '2024-01-01T12:00:00Z',
      total: 1,
      items: [{ sku: 'SKU-1', qty: 0 }],
      customer: { name: 'string', email: 'user@example.com' },
      payment: { card: 'string' },
    });
    expect(body.id).toBeUndefined();
    expect(body.parent).toBeUndefined();

    const health = byName(c.items, 'GET /health');
    expect(health.auth.type).toBe('none');

    const upload = byName(c.items, 'POST /upload');
    expect(upload.auth).toMatchObject({ type: 'apikey', apikey: { key: 'api_key', value: '{{apiKey}}', in: 'query' } });
    expect(upload.body.form.map((f) => [f.key, f.kind, f.value])).toEqual([
      ['note', 'text', 'hi'],
      ['file', 'file', ''],
    ]);

    const login = byName(c.items, 'POST /login');
    expect(login.body.urlencoded.map((p) => [p.key, p.value])).toEqual([
      ['user', 'string'],
      ['remember', 'true'],
    ]);
    expect(warnings.some((w) => /cookie/.test(w))).toBe(true);
  });

  it('imports Swagger 2.0 YAML', async () => {
    const { collections, format } = await importData(swagger2Yaml, { fileName: 'legacy.yaml' });
    expect(format).toBe('swagger');
    const c = collections[0];
    expect(c.name).toBe('Legacy API');
    expect(c.variables.find((v) => v.key === 'baseUrl').value).toBe('https://legacy.test/api');
    expect(c.auth).toMatchObject({ type: 'basic', basic: { username: '{{username}}', password: '{{password}}' } });

    const put = byName(byName(c.items, 'users').items, 'Update user');
    expect(put.url).toBe('{{baseUrl}}/users/:userId');
    expect(put.pathVars[0]).toMatchObject({ key: 'userId', value: '7' });
    expect(put.auth).toMatchObject({ type: 'apikey', apikey: { key: 'X-Api-Key', in: 'header' } });
    expect(JSON.parse(put.body.raw)).toEqual({ name: 'Ada', age: 18 });
    expect(JSON.parse(put.examples[0].body)).toEqual({ name: 'Ada', age: 18 });

    const avatar = byName(c.items, 'POST /avatar');
    expect(avatar.body.mode).toBe('form');
    expect(avatar.body.form.map((f) => [f.key, f.kind, f.value])).toEqual([
      ['image', 'file', ''],
      ['caption', 'text', 'me'],
    ]);
  });

  it('generates examples for tricky schemas', () => {
    const doc = {
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { value: { type: 'integer' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } },
          },
          Loop: { $ref: '#/components/schemas/Loop' },
        },
      },
    };
    expect(sampleSchema({ $ref: '#/components/schemas/Node' }, doc)).toEqual({ value: 0, children: [] });
    expect(sampleSchema({ $ref: '#/components/schemas/Loop' }, doc)).toBeUndefined();
    expect(sampleSchema({ type: ['string', 'null'], format: 'date' }, doc)).toBe('2024-01-01');
    expect(sampleSchema({ anyOf: [{ type: 'null' }, { type: 'boolean' }] }, doc)).toBe(true);
    expect(sampleSchema({ type: 'object', additionalProperties: { type: 'number' } }, doc)).toEqual({ key: 0 });
    expect(sampleSchema({ type: 'object', properties: { pw: { type: 'string', writeOnly: true } } }, doc, 'response')).toEqual({});
  });

  it('warns about relative or missing servers', async () => {
    const rel = await importData({ openapi: '3.1.0', info: { title: 'R' }, servers: [{ url: '/v1' }], paths: { '/a': { get: {} } } });
    expect(rel.warnings.some((w) => /relative/.test(w))).toBe(true);
    const none = await importData({ openapi: '3.1.0', info: { title: 'N' }, paths: {} });
    expect(none.warnings.some((w) => /no server URL/.test(w))).toBe(true);
  });
});

describe('HAR import', () => {
  it('creates one request per entry with cleaned headers and bodies', async () => {
    const { collections, format } = await importData(JSON.stringify(har), { fileName: 'session.har' });
    expect(format).toBe('har');
    const c = collections[0];
    expect(c.name).toBe('session');
    expect(c.items.map((i) => i.name)).toEqual(['POST /v1/items', 'POST /login', 'GET /']);
    const [items, login, root] = c.items;
    expect(items.headers.map((h) => h.key)).toEqual(['content-type', 'x-client']);
    expect(items.params.map((p) => [p.key, p.value])).toEqual([['draft', '1']]);
    expect(items.body).toMatchObject({ mode: 'raw', rawType: 'json', raw: '{"name":"x"}' });
    expect(items.examples[0]).toMatchObject({ status: 201, statusText: 'Created', body: '{"id":1}' });
    expect(login.body.mode).toBe('urlencoded');
    expect(login.body.urlencoded.map((p) => [p.key, p.value])).toEqual([
      ['user', 'ada'],
      ['pass', 'a b'],
    ]);
    expect(login.examples).toEqual([]);
    expect(root.body.mode).toBe('none');
  });
});

describe('Insomnia import', () => {
  it('imports WebSocket requests with their saved messages', async () => {
    const doc = {
      _type: 'export',
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'W' },
        { _id: 'ws', _type: 'websocket_request', parentId: 'wrk', name: 'Live', url: 'wss://echo.test/socket?room=1', headers: [{ name: 'X-Token', value: 'a' }], parameters: [{ name: 'v', value: '{{ _.version }}' }] },
        { _id: 'p1', _type: 'websocket_payload', parentId: 'ws', name: 'Hello', value: '{"op":"hi"}', mode: 'application/json', metaSortKey: 1 },
        { _id: 'p2', _type: 'websocket_payload', parentId: 'ws', name: 'Ping', value: 'ping', mode: 'text/plain', metaSortKey: 2 },
      ],
    };
    const { collections, warnings } = await importData(JSON.stringify(doc));
    const ws = collections[0].items[0];
    expect(ws).toMatchObject({ type: 'websocket', name: 'Live', url: 'wss://echo.test/socket?room=1&v={{version}}' });
    expect(ws.params.map((p) => [p.key, p.value])).toEqual([['room', '1'], ['v', '{{version}}']]);
    expect(ws.messages.map((m) => [m.name, m.body, m.format])).toEqual([['Hello', '{"op":"hi"}', 'json'], ['Ping', 'ping', 'text']]);
    expect(warnings.join(' ')).toMatch(/Headers and auth on 1 WebSocket request/);
  });

  it('imports AWS IAM auth as AWS Signature', async () => {
    const doc = {
      _type: 'export',
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'W' },
        { _id: 'req', _type: 'request', parentId: 'wrk', name: 'S3', method: 'GET', url: 'https://s3.amazonaws.com', authentication: { type: 'iam', accessKeyId: '{{ _.key }}', secretAccessKey: 's', sessionToken: 't', region: 'eu-west-1', service: 's3' } },
      ],
    };
    const { collections, warnings } = await importData(JSON.stringify(doc));
    expect(collections[0].items[0].auth).toMatchObject({ type: 'awsv4', awsv4: { accessKey: '{{key}}', secretKey: 's', sessionToken: 't', region: 'eu-west-1', service: 's3' } });
    expect(warnings).toEqual([]);
  });

  it('warns when an OAuth 2.0 grant type is not supported', async () => {
    const doc = (grantType) => ({ _type: 'export', __export_format: 4, resources: [
      { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'W' },
      { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'R', method: 'GET', url: 'https://x.test', authentication: { type: 'oauth2', grantType, accessToken: 'tok' } },
    ] });
    const code = await importData(doc('authorization_code'));
    expect(code.collections[0].items[0].auth.oauth2.accessToken).toBe('tok');
    expect(code.warnings).toEqual([expect.stringMatching(/grant type "authorization_code" on "R" is not supported/)]);
    expect((await importData(doc('password'))).warnings).toEqual([]);
    expect((await importData(doc('client_credentials'))).warnings).toEqual([]);
  });

  it('converts template syntax', () => {
    expect(convertTemplate('{{ _.baseUrl }}/x/{{_.id}}')).toBe('{{baseUrl}}/x/{{id}}');
    expect(convertTemplate('{{ _["my var"] }}')).toBe('{{my var}}');
    expect(convertTemplate('{{plain}}')).toBe('{{plain}}');
  });

  it('builds collections, folders and environments', async () => {
    const { collections, environments, format } = await importData(YAML.stringify(insomnia));
    expect(format).toBe('insomnia');
    expect(collections).toHaveLength(1);
    const c = collections[0];
    expect(c.name).toBe('My Space');
    expect(c.variables.map((v) => [v.key, v.value])).toEqual([
      ['baseUrl', 'https://ins.test'],
      ['auth.token', 'base-tok'],
    ]);
    expect(environments.map((e) => e.name)).toEqual(['Dev']);
    expect(environments[0].variables[0]).toMatchObject({ key: 'baseUrl', value: 'http://localhost:3000' });

    const users = byName(c.items, 'Users');
    expect(users.type).toBe('folder');
    expect(users.auth).toMatchObject({ type: 'bearer', bearer: { token: '{{auth.token}}' } });
    expect(users.items.map((i) => i.name)).toEqual(['Nested', 'List users']);

    const list = byName(users.items, 'List users');
    expect(list.url).toBe('{{baseUrl}}/users?page=1');
    expect(list.params.map((p) => [p.key, p.enabled])).toEqual([
      ['page', true],
      ['off', false],
    ]);
    expect(list.headers[0]).toMatchObject({ key: 'X-Req', value: '{{reqId}}' });
    expect(list.auth.type).toBe('inherit');
    expect(list.body.mode).toBe('none');

    const create = byName(users.items, 'Nested').items[0];
    expect(create.url).toBe('{{baseUrl}}/users/:org');
    expect(create.pathVars.map((p) => [p.key, p.value])).toEqual([['org', 'acme']]);
    expect(create.body).toMatchObject({ mode: 'raw', rawType: 'json', raw: '{"name":"{{name}}"}' });
    expect(create.auth).toMatchObject({ type: 'basic', basic: { username: 'u', password: 'p' } });

    const query = byName(c.items, 'Query');
    expect(query.body.mode).toBe('graphql');
    expect(query.body.graphql.query).toBe('{ me { id } }');
    expect(JSON.parse(query.body.graphql.variables)).toEqual({ a: 1 });
    expect(query.auth).toMatchObject({ type: 'apikey', apikey: { key: 'k', value: 'v', in: 'query' } });

    const form = byName(c.items, 'Form');
    expect(form.url).toBe('https://ins.test/form?x=1');
    expect(form.body.form.map((f) => [f.key, f.kind])).toEqual([
      ['a', 'text'],
      ['f', 'file'],
    ]);
    expect(requestsIn(c)).toHaveLength(4);
  });
});

describe.skipIf(!curlModule)('curl import', () => {
  it('detects and imports a curl command', async () => {
    const cmd = `curl -X POST https://api.test/v1/things -H 'Content-Type: application/json' -d '{"a":1}'`;
    expect(detectFormat(cmd)).toBe('curl');
    const { collections, format } = await importData(cmd);
    expect(format).toBe('curl');
    const c = collections[0];
    expect(c.name).toBe('Imported request');
    expect(c.items).toHaveLength(1);
    const r = c.items[0];
    expect(r.type).toBe('request');
    expect(r.method).toBe('POST');
    expect(r.url).toContain('https://api.test/v1/things');
    expect(r.name).toBe('POST /v1/things');
  });

  it('warns when the text holds more than one command', async () => {
    const { collections, warnings } = await importData("curl https://a.test/one ;\ncurl https://b.test/two");
    expect(collections[0].items.map((r) => r.url)).toEqual(['https://a.test/one']);
    expect(warnings).toEqual([expect.stringMatching(/more than one curl command/)]);
  });

  it('reports unreadable commands', async () => {
    await expect(importData('curl -H')).rejects.toThrow(/curl/);
  });
});

describe('OpenAPI documents written loosely', () => {
  it('reads an unquoted YAML version such as openapi: 3.1', async () => {
    const y = "openapi: 3.1\ninfo: {title: T, version: '1'}\npaths:\n  /a:\n    get: {responses: {'200': {description: ok}}}\n";
    expect(detectFormat(y)).toBe('openapi');
    const { format, collections } = await importData(y);
    expect(format).toBe('openapi');
    expect(collections[0].items).toHaveLength(1);
    expect(detectFormat(y.replace('3.1', '3.0'))).toBe('openapi');
  });

  it('reads parameter names that YAML turns into numbers', async () => {
    const y = "openapi: 3.0.0\ninfo: {title: T, version: '1'}\npaths:\n  /a:\n    get:\n      parameters:\n        - {name: 2024, in: query, required: true, example: y}\n      responses: {}\n";
    const req = (await importData(y)).collections[0].items[0];
    expect(req.url).toBe('{{baseUrl}}/a?2024=y');
    expect(req.params.map((p) => [p.key, p.value])).toEqual([['2024', 'y']]);
  });
});

describe('OpenAPI path keys with a query', () => {
  it('keeps the query written in the path before the parameters', async () => {
    const doc = { openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {
      '/api?action=list': { get: { summary: 'list', responses: {} } },
      '/api?action=get': { get: { summary: 'get', parameters: [{ name: 'id', in: 'query', required: true, example: 5 }], responses: {} } },
    } };
    const [list, get] = (await importData(doc)).collections[0].items;
    expect(list.url).toBe('{{baseUrl}}/api?action=list');
    expect(get.url).toBe('{{baseUrl}}/api?action=get&id=5');
    expect(get.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['action', 'get', true],
      ['id', '5', true],
    ]);
  });
});

describe('OpenAPI JSON examples written as strings', () => {
  it('uses the JSON text as the body instead of quoting it again', async () => {
    const json = (example) => ({ 'application/json': { example } });
    const doc = { openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: { '/a': { post: {
      requestBody: { content: json('{"name":"x"}') },
      responses: { 200: { description: 'ok', content: json('[1, 2]') }, 201: { description: 'made', content: json('plain') } },
    } } } };
    const req = (await importData(doc)).collections[0].items[0];
    expect(req.body.raw).toBe('{"name":"x"}');
    expect(req.examples.map((e) => e.body)).toEqual(['[1, 2]', '"plain"']);
  });
});

describe('OpenAPI security requirements with several schemes', () => {
  const doc = (security, opSecurity) => ({
    openapi: '3.0.0',
    info: { title: 'T', version: '1' },
    components: { securitySchemes: {
      appId: { type: 'apiKey', in: 'header', name: 'X-App-Id' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      tenant: { type: 'apiKey', in: 'query', name: 'tenant' },
      bearer: { type: 'http', scheme: 'bearer' },
    } },
    security,
    paths: {
      '/a': { get: { summary: 'a', responses: {} } },
      '/b': { get: { summary: 'b', ...(opSecurity ? { security: opSecurity } : {}), responses: {} } },
    },
  });

  it('sends every key a requirement asks for, each in its own variable', async () => {
    const c = (await importData(doc([{ appId: [], apiKey: [] }]))).collections[0];
    expect(c.auth).toMatchObject({ type: 'apikey', apikey: { key: 'X-App-Id', value: '{{appId}}', in: 'header' } });
    const a = byName(c.items, 'a');
    expect(a.auth.type).toBe('inherit');
    expect(a.headers.map((h) => [h.key, h.value, h.enabled])).toEqual([['X-Api-Key', '{{apiKey}}', true]]);
    expect(c.variables.filter((v) => v.key !== 'baseUrl').map((v) => [v.key, v.secret])).toEqual([
      ['appId', true],
      ['apiKey', true],
    ]);
  });

  it('keeps another scheme as the auth and adds the keys to the request', async () => {
    const c = (await importData(doc([{ bearer: [] }], [{ tenant: [], bearer: [] }]))).collections[0];
    const a = byName(c.items, 'a');
    expect(a.headers).toEqual([]);
    expect(a.url).toBe('{{baseUrl}}/a');
    const b = byName(c.items, 'b');
    expect(b.auth.type).toBe('inherit');
    expect(b.url).toBe('{{baseUrl}}/b?tenant={{tenant}}');
    expect(b.params.map((p) => [p.key, p.value, p.enabled])).toEqual([['tenant', '{{tenant}}', true]]);
  });
});

describe('Swagger 2 header parameters', () => {
  it('keeps Authorization and Accept, which only OpenAPI 3 says to ignore', async () => {
    const doc = { swagger: '2.0', info: { title: 'S', version: '1' }, host: 'api.x.com', paths: { '/orders': { get: { parameters: [
      { name: 'Authorization', in: 'header', required: true, type: 'string', default: 'Bearer <token>' },
      { name: 'Accept', in: 'header', required: true, type: 'string', default: 'application/vnd.x.v2+json' },
      { name: 'Content-Type', in: 'header', type: 'string', default: 'text/plain' },
      { name: 'X-Tenant', in: 'header', required: true, type: 'string' },
    ], responses: {} } } } };
    const req = (await importData(doc)).collections[0].items[0];
    expect(req.headers.map((h) => [h.key, h.value])).toEqual([
      ['Authorization', 'Bearer <token>'],
      ['Accept', 'application/vnd.x.v2+json'],
      ['X-Tenant', ''],
    ]);
  });

  it('leaves a header the security scheme sets to the auth', async () => {
    const op = (security) => ({ ...(security ? { security } : {}), parameters: [{ name: 'Authorization', in: 'header', required: true, type: 'string' }, { name: 'X-Key', in: 'header', type: 'string' }], responses: {} });
    const doc = {
      swagger: '2.0',
      info: { title: 'S', version: '1' },
      host: 'api.x.com',
      securityDefinitions: { Bearer: { type: 'apiKey', name: 'Authorization', in: 'header' }, Key: { type: 'apiKey', name: 'X-Key', in: 'header' } },
      security: [{ Bearer: [] }],
      paths: { '/a': { get: op() }, '/b': { get: op([{ Key: [] }]) } },
    };
    const [a, b] = (await importData(doc)).collections[0].items;
    expect(a.headers.map((h) => h.key)).toEqual(['X-Key']);
    expect(b.headers.map((h) => h.key)).toEqual(['Authorization']);
  });
});

describe('YAML documents', () => {
  it('reads duplicate keys the way JSON does, keeping the last one', async () => {
    const y = "openapi: 3.0.0\ninfo:\n  title: T\n  version: '1'\n  description: first\n  description: second\npaths:\n  /a:\n    get: {responses: {'200': {description: ok}}}\n";
    const { collections } = await importData(y);
    expect(collections[0].description).toBe('second');
  });

  it("says where the YAML reader stopped when a file cannot be read", async () => {
    await expect(importData('a: [1, 2\nb: 3\n')).rejects.toThrow(/not valid JSON or YAML.*line \d+, column \d+/);
  });
});
