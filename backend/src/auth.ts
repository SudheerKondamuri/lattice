import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Tx } from './db.js';
import { AppError, configured } from './errors.js';
export interface Identity {
  id: string;
  email: string;
}
export interface Authenticator {
  verify(token: string): Promise<Identity>;
}
export function supabaseAuth(config: Config): Authenticator {
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return {
    async verify(token) {
      try {
        // Supabase Auth confirms email and also supports projects still using HS256.
        if (decodeProtectedHeader(token).alg === 'HS256') {
          const key = configured(config.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY for legacy JWTs');
          const response = await fetch(`${issuer}/user`, {
            headers: { Authorization: `Bearer ${token}`, apikey: key },
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new AppError('UNAUTHORIZED', 'Invalid access token', 401);
          const user = (await response.json()) as Record<string, unknown>;
          if (!user.email_confirmed_at)
            throw new AppError('UNAUTHORIZED', 'Verify your email before continuing', 401);
          return { id: z.uuid().parse(user.id), email: z.email().parse(user.email).toLowerCase() };
        }
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience: config.SUPABASE_JWT_AUDIENCE,
          algorithms: ['RS256', 'ES256'],
        });
        if (payload.role !== 'authenticated' || payload.is_anonymous === true)
          throw new Error('Not an authenticated user');
        // Email invitation claims require an Auth-verified address, not editable user_metadata.
        const key = configured(config.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY for verified email checks');
        {
          const res = await fetch(`${issuer}/user`, {
            headers: { Authorization: `Bearer ${token}`, apikey: key },
            signal: AbortSignal.timeout(10000),
          });
          const user = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
          if (!user.email_confirmed_at || user.id !== payload.sub) throw new Error('Unverified email');
          return { id: z.uuid().parse(payload.sub), email: z.email().parse(user.email).toLowerCase() };
        }
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONFIGURATION_ERROR') throw error;
        throw new AppError('UNAUTHORIZED', 'Invalid, expired, or unverified Supabase access token', 401);
      }
    },
  };
}
export async function authorize(tx: Tx, workspaceId: string, userId: string, owner = false) {
  const membership = await tx.one('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
    workspaceId,
    userId,
  ]);
  if (!membership) throw new AppError('NOT_FOUND', 'Workspace not found', 404);
  if (owner && membership.role !== 'owner') throw new AppError('FORBIDDEN', 'Owner permission required', 403);
  return membership.role as 'owner' | 'member';
}
