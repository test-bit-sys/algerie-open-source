// Request authentication, from the Whiteboard worker (src/whiteboard/worker/auth.js).
import { hash, verify } from "../src/collab/protocol.js";
import { tokenClaims } from "../src/collab/auth.js";

const proofs = new Map();
// How long Puter's validation of a restricted token is reused. Revoking the
// token takes effect within it, sooner than a peer ticket's 90 seconds; board
// access is still checked on every request.
const VALIDATED = 30_000;
const denied = () =>
  Object.assign(Error("Could not verify this collaboration request."), {
    status: 401,
  });

async function publicKey(puter, file) {
  const proof = JSON.parse(await (await puter.fs.read(file.path)).text());
  if (proof.version !== 1 || !proof.publicKey || proof.publicKey.d)
    throw denied();
  return proof.publicKey;
}

export async function authenticate(request, puter, input, now = Date.now) {
  const token = request.headers.get("puter-auth");
  // Keep already-open clients compatible. A restricted bearer token must never
  // be allowed through this legacy path by dropping its proof header.
  const claims = tokenClaims(token);
  if (claims.type === "session" || claims.type === "app-under-user")
    return puter.auth.getUser();
  if (claims.type !== "access-token" || !claims.user_uid) throw denied();
  try {
    const header = request.headers.get("x-wiki-proof");
    if (!header || header.length > 4096) throw denied();
    const proof = JSON.parse(header);
    if (
      proof.version !== 1 ||
      typeof proof.path !== "string" ||
      !proof.path ||
      proof.path.length > 2048
    )
      throw denied();
    if (Number.isFinite(claims.exp) && claims.exp * 1000 <= now())
      throw denied();
    const key = `${token}|${proof.path}|${claims.user_uid}`;
    let cached = proofs.get(key);
    if (
      !cached ||
      cached.expires <= now() ||
      cached.checked + VALIDATED <= now()
    ) {
      // /whoami rejects scoped access tokens. A strong stat validates the
      // exact token with Puter, including expiry and revocation.
      // Puter reports is_shared:null for a file the authenticated caller does
      // not own. Requiring an unshared owned file also prevents substituting
      // an attacker's public key through a publicly readable file.
      const file = await puter.fs.stat(proof.path, { consistency: "strong" });
      if (
        file.is_shared !== false ||
        typeof file.owner?.username !== "string" ||
        !file.owner.username ||
        file.is_dir ||
        !Number.isFinite(file.size) ||
        file.size < 0 ||
        file.size > 4096
      )
        throw denied();
      if (cached && cached.expires > now()) {
        cached.checked = now();
        cached.username = file.owner.username;
      } else {
        if (proofs.size >= 2048) proofs.delete(proofs.keys().next().value);
        cached = {
          expires: now() + 5 * 60_000,
          checked: now(),
          username: file.owner.username,
          pending: publicKey(puter, file),
        };
        proofs.set(key, cached);
        const entry = cached;
        entry.pending.catch(() => {
          if (proofs.get(key) === entry) proofs.delete(key);
        });
      }
    }
    // Only trust decoded identity claims after Puter accepts the credential.
    const identity = { uuid: claims.user_uid, username: cached.username };
    if (
      !(await verify(
        await cached.pending,
        [
          new URL(request.url).origin,
          proof.path,
          await hash(JSON.stringify(input)),
        ],
        proof.signature,
      ))
    )
      throw denied();
    return identity;
  } catch {
    throw denied();
  }
}
