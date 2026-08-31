import { createMiddleware } from 'hono/factory'
import { verifyAccessToken, type AccessPayload } from './tokens'

export type AuthEnv = {
  Variables: {
    user: AccessPayload
  }
}

/** Rejects the request unless it carries a valid `Authorization: Bearer` access token. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization')

  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing access token' }, 401)
  }

  const payload = await verifyAccessToken(header.slice('Bearer '.length))
  if (!payload) {
    return c.json({ error: 'Invalid or expired access token' }, 401)
  }

  c.set('user', payload)
  await next()
})
