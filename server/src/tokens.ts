import { sign, verify } from 'hono/jwt'
import type { JWTPayload } from 'hono/utils/jwt/types'
import { sql } from './db'
import { env } from './env'
import type { User } from 'shared'

export type AccessPayload = JWTPayload & {
  sub: string
  email: string
  name: string
  type: 'access'
}

type RefreshPayload = JWTPayload & {
  sub: string
  jti: string
  type: 'refresh'
}

const now = () => Math.floor(Date.now() / 1000)

/** Refresh tokens are stored hashed, so a database leak can't be replayed. */
function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}

export async function createAccessToken(user: User): Promise<string> {
  const payload: AccessPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    type: 'access',
    iat: now(),
    exp: now() + env.ACCESS_TOKEN_TTL,
  }
  return sign(payload, env.ACCESS_TOKEN_SECRET)
}

export async function verifyAccessToken(token: string): Promise<AccessPayload | null> {
  try {
    const payload = (await verify(token, env.ACCESS_TOKEN_SECRET)) as AccessPayload
    return payload.type === 'access' ? payload : null
  } catch {
    return null
  }
}

/** Issues a refresh token and records it so it can later be rotated or revoked. */
export async function createRefreshToken(userId: string): Promise<string> {
  const jti = crypto.randomUUID()
  const expiresAt = new Date((now() + env.REFRESH_TOKEN_TTL) * 1000)

  const payload: RefreshPayload = {
    sub: userId,
    jti,
    type: 'refresh',
    iat: now(),
    exp: now() + env.REFRESH_TOKEN_TTL,
  }
  const token = await sign(payload, env.REFRESH_TOKEN_SECRET)

  await sql`
    INSERT INTO refresh_tokens ${sql({
      user_id: userId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    })}
  `

  return token
}

/**
 * Verifies the signature *and* checks the token is still live in the database,
 * which is what makes logout and rotation actually take effect.
 */
export async function verifyRefreshToken(token: string): Promise<User | null> {
  let payload: RefreshPayload
  try {
    payload = (await verify(token, env.REFRESH_TOKEN_SECRET)) as RefreshPayload
  } catch {
    return null
  }
  if (payload.type !== 'refresh') return null

  const rows = await sql<{ id: string; email: string; name: string }[]>`
    SELECT u.id, u.email, u.name
    FROM refresh_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ${hashToken(token)}
      AND t.revoked_at IS NULL
      AND t.expires_at > now()
  `

  return rows[0] ?? null
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await sql`
    UPDATE refresh_tokens
    SET revoked_at = now()
    WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL
  `
}
