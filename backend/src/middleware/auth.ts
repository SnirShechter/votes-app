import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Next } from 'hono';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    const jwksUri = process.env.OIDC_JWKS_URI ||
      `${process.env.OIDC_ISSUER}jwks/`;
    jwks = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwks;
}

async function verifyJwt(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: process.env.OIDC_ISSUER,
  });
  return payload;
}

// --- Userinfo fallback for opaque tokens ---

interface UserinfoCache {
  sub: string;
  email: string;
  name: string;
  expiresAt: number;
}

const userinfoCache = new Map<string, UserinfoCache>();
const USERINFO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchUserinfo(token: string): Promise<UserinfoCache> {
  const cached = userinfoCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const userinfoUrl = process.env.OIDC_USERINFO_URI ||
    `${process.env.OIDC_ISSUER}userinfo/`;
  const response = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Userinfo request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (!data.sub || typeof data.sub !== 'string') {
    throw new Error('No sub claim in userinfo response');
  }

  const entry: UserinfoCache = {
    sub: data.sub,
    email: (data.email as string) || '',
    name: (data.name as string) || (data.preferred_username as string) || '',
    expiresAt: Date.now() + USERINFO_CACHE_TTL,
  };

  userinfoCache.set(token, entry);
  return entry;
}

/**
 * Resolve user from Bearer token.
 * Try JWT first -> catch -> fetch userinfo (opaque token).
 */
async function resolveUser(token: string): Promise<UserinfoCache> {
  let jwtError: string = '';
  try {
    const payload = await verifyJwt(token);
    return {
      sub: payload.sub as string,
      email: (payload as any).email || '',
      name: (payload as any).name || (payload as any).preferred_username || '',
      expiresAt: Date.now() + USERINFO_CACHE_TTL,
    };
  } catch (err: any) {
    jwtError = err.message || String(err);
    console.log(`JWT verification failed (expected for opaque tokens): ${jwtError}`);
  }

  try {
    return await fetchUserinfo(token);
  } catch (err: any) {
    console.error(`Both JWT and userinfo failed. JWT: ${jwtError}. Userinfo: ${err.message}`);
    throw err;
  }
}

/**
 * Debug endpoint handler — returns auth diagnostic info.
 */
export async function debugAuth(c: any) {
  const userinfoUrl = process.env.OIDC_USERINFO_URI ||
    `${process.env.OIDC_ISSUER}userinfo/`;
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const info: Record<string, unknown> = {
    oidcIssuer: process.env.OIDC_ISSUER,
    userinfoUrl,
    oidcUserinfoUri: process.env.OIDC_USERINFO_URI || '(not set)',
    hasToken: !!token,
    tokenPrefix: token ? token.substring(0, 10) + '...' : null,
  };

  if (token) {
    // Test userinfo call
    try {
      const resp = await fetch(userinfoUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.text();
      info.userinfoStatus = resp.status;
      info.userinfoBody = body.substring(0, 500);
    } catch (err: any) {
      info.userinfoError = err.message;
    }

    // Test DNS/connectivity
    try {
      const resp = await fetch(userinfoUrl, { method: 'OPTIONS' });
      info.connectivityOk = true;
      info.connectivityStatus = resp.status;
    } catch (err: any) {
      info.connectivityOk = false;
      info.connectivityError = err.message;
    }
  }

  return c.json(info);
}

/**
 * Required auth middleware.
 * Sets userId, userEmail, userName on context.
 * Returns 401 if no valid token.
 */
export async function requireAuth(c: any, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const user = await resolveUser(token);
    c.set('userId', user.sub);
    c.set('userEmail', user.email);
    c.set('userName', user.name);
  } catch (err: any) {
    console.error('requireAuth failed:', err.message);
    return c.json({ error: 'Invalid or expired token', detail: err.message }, 401);
  }

  await next();
}
