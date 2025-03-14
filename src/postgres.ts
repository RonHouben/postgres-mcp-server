import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';

export type PostgresClientOptions = Pick<
  PoolConfig,
  'user' | 'password' | 'host' | 'port' | 'database'
>;

export class PostgresClient {
  private readonly pool: pg.Pool;

  constructor(options: PostgresClientOptions) {
    this.pool = new pg.Pool({
      user: options.user,
      password: options.password,
      host: options.host,
      port: options.port,
      database: options.database,
    });
  }

  public async query<T extends QueryResultRow>(
    query: string,
    options?: { readonly: boolean }
  ): Promise<QueryResult<T>> {
    const client = await this.pool.connect();

    try {
      if (options?.readonly) {
        await client.query('BEGIN TRANSACTION READ ONLY');
      }

      return await client.query<T>(query);
    } catch (e) {
      const error = e as Error;

      console.error('Query execution error:');
      console.log({ error, query, options });

      throw error;
    } finally {
      console.log('Rolling back transaction...');

      await client
        .query('ROLLBACK')
        .catch((error) => console.warn('Could not roll back transaction:', error));

      console.log('Releasing client...');
      client.release();
      console.log('Client released');
    }
  }
}
