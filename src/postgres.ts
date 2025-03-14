import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';

export type PostgresClientOptions = Pick<
  PoolConfig,
  'user' | 'password' | 'host' | 'port' | 'database'
>;

export class PostgresClient {
  public readonly connectionString: string; // TODO: Don't expose this anymore
  public readonly schemaPath = 'schema';

  private readonly pool: pg.Pool;

  constructor(options: PostgresClientOptions) {
    this.connectionString = new URL(
      `postgres://${options.user}:${options.password}@${options.host}:${options.port}/${options.database}`
    ).href;

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
    params?: unknown[]
  ): Promise<QueryResult<T>> {
    const client = await this.pool.connect();

    try {
      return await client.query<T>(query, params);
    } catch (e) {
      const error = e as Error;

      console.error('Query execution error:');
      console.log({ error, query, params });

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
