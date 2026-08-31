import { migrate, sql } from './db'

const USERS = [
  { email: 'alice@example.com', name: 'Alice Johnson', password: 'password123' },
  { email: 'bob@example.com', name: 'Bob Smith', password: 'password456' },
]

await migrate()

for (const user of USERS) {
  const passwordHash = await Bun.password.hash(user.password)

  // Re-running the seed resets the password rather than failing on the
  // unique email constraint.
  await sql`
    INSERT INTO users (email, name, password_hash)
    VALUES (${user.email}, ${user.name}, ${passwordHash})
    ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
  `

  console.log(`  ✓ ${user.email}  (password: ${user.password})`)
}

console.log(`\nSeeded ${USERS.length} users.`)
await sql.end()
