import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';

export type PostgresClientOptions = Required<
  Pick<PoolConfig, 'user' | 'password' | 'host' | 'port' | 'database'> & CustomOptions
>;

type CustomOptions = {
  schemaName: string;
};

export class PostgresClient {
  public readonly schemaName: string;

  private readonly baseUri: string;
  private readonly databaseName: string;
  private readonly pool: pg.Pool;

  constructor(options: PostgresClientOptions) {
    this.databaseName = options.database;
    this.schemaName = options.schemaName;

    this.baseUri = `postgres://${this.databaseName}`;

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
    options: { databaseName?: string; readonly: boolean } = {
      databaseName: this.pool.options.database,
      readonly: true, // default to readonly to avoid accidental writes
    }
  ): Promise<QueryResult<T>> {
    if (options.databaseName) {
      this.setDatabaseInPool(options.databaseName);
    }

    const client = await this.pool.connect();

    try {
      if (options.readonly) {
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

  public getUri(tableName: string): string {
    return new URL(`${tableName}/${this.schemaName}`, this.baseUri).href;
  }

  private setDatabaseInPool(databaseName: string) {
    this.pool.options.database = databaseName;
  }
}
