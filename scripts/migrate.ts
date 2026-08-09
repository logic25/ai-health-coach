/* Apply SQL migrations in src/db/migrations in filename order.
   Tracked in _migrations. Usage: npm run db:migrate */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query(
    `create table if not exists _migrations (
       name text primary key, applied_at timestamptz not null default now()
     )`
  );
  const dir = join(__dirname, "..", "src", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await client.query("select name from _migrations")).rows.map((r) => r.name)
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    console.log(`applying ${file}…`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into _migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log("migrations up to date");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
