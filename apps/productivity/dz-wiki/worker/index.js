/* global router, me */
import { WikiService } from './service.js';
import { authenticate } from './auth.js';

async function readBody(request, limit = 17_000_000) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error('Request too large'), { status: 413 });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(body);
}

router.get('/health', () => Response.json({ ok: true, protocol: 1, build: __WORKER_BUILD__, builtAt: __WORKER_BUILT_AT__ }));

router.post('/api', async ({ request, user }) => {
  try {
    if (!user?.puter) return Response.json({ message: 'Sign in with Puter to continue.' }, { status: 401 });
    const text = await readBody(request);
    if (text === null) return Response.json({ message: 'A JSON request body is required.' }, { status: 400 });
    const input = JSON.parse(text);
    const identity = await authenticate(request, user.puter, input);
    return Response.json(await new WikiService(me.puter).call(identity, input));
  } catch (error) {
    return Response.json(
      { message: error instanceof SyntaxError ? 'Invalid JSON request.' : error.status ? error.message : 'The space could not synchronize. Please retry.' },
      { status: error.status || (error instanceof SyntaxError ? 400 : 500) },
    );
  }
});
