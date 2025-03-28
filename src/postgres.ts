import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';
import * as z from 'zod';

export type PostgresClientOptions = Required<
  Pick<PoolConfig, 'user' | 'password' | 'host' | 'port'> & CustomOptions
>;

type CustomOptions = {
  schemaName: string;
};

export class PostgresClient {
  public readonly schemaName: string;
  public readonly validationSchema = {
    databaseName: z.string().describe('The name of the database'),
    sqlQuery: z.string().describe('The SQL query to execute against the database'),
  };

  private readonly pool: pg.Pool;

  constructor(options: PostgresClientOptions) {
    this.schemaName = options.schemaName;

    this.pool = new pg.Pool({
      user: options.user,
      password: options.password,
      host: options.host,
      port: options.port,
    });
  }

  public async query<T extends QueryResultRow>(
    databaseName: string,
    query: string,
    options: { readonly: boolean }
  ): Promise<QueryResult<T>> {
    this.setDatabaseOnPool(databaseName);

    const client = await this.pool.connect();

    try {
      if (options.readonly) {
        await client.query('BEGIN TRANSACTION READ ONLY');
      }

      const result = await client.query<T>(query);

      if (options.readonly) {
        await client.query('COMMIT');
      }

      return result;
    } catch (e) {
      const error = e as Error;

      console.error('Query execution error:');
      console.log({ error, query, options });

      console.log('Rolling back transaction...');

      await client
        .query('ROLLBACK')
        .catch((error) => console.warn('Could not roll back transaction:', error));

      throw error;
    } finally {
      console.log('Releasing client...');
      client.release();
      console.log('Client released');
    }
  }

  public getUri(databaseName: string, tableName: string): string {
    const baseUri = `postgres://${databaseName}`;

    return new URL(`${tableName}/${this.schemaName}`, baseUri).href;
  }

  public async close() {
    console.log('Ending Postgres pool...');

    this.setDatabaseOnPool('');

    await this.pool.end();

    console.log('Postgres pool ended.');
  }

  private setDatabaseOnPool(databaseName: string) {
    this.pool.options.database = databaseName;
  }
}
