import pg, { type PoolClient } from 'pg';

// Keep PostgreSQL business dates as YYYY-MM-DD, independent of the host timezone.
pg.types.setTypeParser(1082, value => value);
export function createPool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('Set DATABASE_URL to a PostgreSQL connection string');
  return new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis:10000 });
}
export async function transaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>, isolation = ''): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ${isolation}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
