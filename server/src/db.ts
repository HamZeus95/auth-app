import postgres from 'postgres'
import { env } from './env'

export const sql = postgres(env.DATABASE_URL, {
  // `CREATE ... IF NOT EXISTS` emits a NOTICE on every boot; not worth logging.
  onnotice: () => {},
})

/**
 * Creates the tables if they don't exist. Called on boot and by the seed
 * script so either entry point can bring a fresh database up to date.
 */
export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text NOT NULL UNIQUE,
      name          text NOT NULL,
      password_hash text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `

  // One row per issued refresh token. Rotation revokes the old row, so a
  // stolen token stops working as soon as the real client refreshes.
  await sql`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `

  await sql`
    CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens(user_id)
  `
}
