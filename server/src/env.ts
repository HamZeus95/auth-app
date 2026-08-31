function required(name: string, fallback?: string): string {
  const value = Bun.env[name] ?? fallback
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  ACCESS_TOKEN_SECRET: required('ACCESS_TOKEN_SECRET'),
  REFRESH_TOKEN_SECRET: required('REFRESH_TOKEN_SECRET'),
  CLIENT_URL: required('CLIENT_URL', 'http://localhost:5173'),
  PORT: Number(Bun.env.PORT ?? 3000),

  /**
   * `Secure` cookies are withheld by browsers on plain HTTP, which breaks the
   * refresh flow when running the container locally on http://localhost.
   * Defaults to on in production; set COOKIE_SECURE=false to demo over HTTP.
   */
  COOKIE_SECURE:
    Bun.env.COOKIE_SECURE !== undefined
      ? Bun.env.COOKIE_SECURE === 'true'
      : Bun.env.NODE_ENV === 'production',

  /** Access tokens are short lived; the client refreshes them silently. */
  ACCESS_TOKEN_TTL: 60 * 15, // 15 minutes
  REFRESH_TOKEN_TTL: 60 * 60 * 24 * 7, // 7 days
} as const
