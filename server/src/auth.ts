import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { AuthResponse, LoginRequest, User } from 'shared'
import { sql } from './db'
import { env } from './env'
import { requireAuth, type AuthEnv } from './middleware'
import {
  createAccessToken,
  createRefreshToken,
  revokeRefreshToken,
  verifyRefreshToken,
} from './tokens'

const REFRESH_COOKIE = 'refresh_token'

/**
 * Hashed once at startup so an unknown email costs the same as a known one.
 *
 * Verifying only when the row exists lets `||` short-circuit, which skips
 * argon2 entirely and makes "no such account" answer ~115ms faster than
 * "wrong password" - a timing oracle that reveals which emails are
 * registered, even though both paths return an identical 401.
 */
const DUMMY_PASSWORD_HASH = await Bun.password.hash('no-such-account-placeholder')

const auth = new Hono<AuthEnv>()

function setRefreshCookie(c: Context<AuthEnv>, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL,
  })
}

async function issueSession(c: Context<AuthEnv>, user: User): Promise<AuthResponse> {
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(user),
    createRefreshToken(user.id),
  ])
  setRefreshCookie(c, refreshToken)
  return { user, accessToken, expiresIn: env.ACCESS_TOKEN_TTL }
}

auth.post('/login', async (c) => {
  const body = await c.req.json<Partial<LoginRequest>>().catch(() => null)

  if (!body?.email || !body?.password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const rows = await sql<{ id: string; email: string; name: string; password_hash: string }[]>`
    SELECT id, email, name, password_hash
    FROM users
    WHERE email = ${body.email.toLowerCase()}
  `
  const row = rows[0]

  // Verify unconditionally. Both the response *and* the time it takes must be
  // identical for a missing account and a wrong password, so the hash is
  // always computed - against a placeholder when there is no row.
  const passwordMatches = await Bun.password.verify(
    body.password,
    row?.password_hash ?? DUMMY_PASSWORD_HASH,
  )

  if (!row || !passwordMatches) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const user: User = { id: row.id, email: row.email, name: row.name }
  return c.json(await issueSession(c, user), 200)
})

auth.post('/refresh', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE)
  if (!token) {
    return c.json({ error: 'Missing refresh token' }, 401)
  }

  const user = await verifyRefreshToken(token)
  if (!user) {
    deleteCookie(c, REFRESH_COOKIE, { path: '/' })
    return c.json({ error: 'Invalid or expired refresh token' }, 401)
  }

  // Rotate: the old refresh token is dead the moment a new one is issued.
  await revokeRefreshToken(token)
  return c.json(await issueSession(c, user), 200)
})

auth.post('/logout', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE)
  if (token) await revokeRefreshToken(token)

  deleteCookie(c, REFRESH_COOKIE, { path: '/' })
  return c.json({ success: true }, 200)
})

auth.get('/me', requireAuth, (c) => {
  const payload = c.get('user')
  const user: User = { id: payload.sub, email: payload.email, name: payload.name }
  return c.json({ user }, 200)
})

export default auth
