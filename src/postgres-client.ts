import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';
import { z } from 'zod';

export type PostgresClientOptions = Required<
  Pick<PoolConfig, 'database' | 'user' | 'password' | 'host' | 'port'> & CustomOptions
>;

type CustomOptions = {
  schemaName: string;
};

export class PostgresClient {
  public readonly baserUrl: URL;
  public readonly schemaName: string;
  public readonly validationSchema = {
    databaseName: z.string().describe('The name of the database to connect to.').optional(),
    sqlQuery: z
      .string()
      .describe(
        'The SQL query to execute against the database. Use double quotes when fields or tables are camelCases to avoid SQL syntax issues.'
      ),
  };

  private readonly initialDatabaseName: string;
  private readonly pool: pg.Pool;

  constructor(options: PostgresClientOptions) {
    this.initialDatabaseName = options.database;
    this.baserUrl = this.getBaseUrl({ databaseName: options.database });

    this.schemaName = options.schemaName;

    this.pool = new pg.Pool({
      database: options.database,
      user: options.user,
      password: options.password,
      host: options.host,
      port: options.port,
    });
  }

  public async query<T extends QueryResultRow>(
    query: string,
    options: { readonly: boolean; databaseName?: string }
  ): Promise<QueryResult<T>> {
    if (options.databaseName) {
      this.setDatabaseOnPool(options.databaseName);
    }

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

      await client.query('ROLLBACK');

      throw error;
    } finally {
      client.release();
    }
  }

  public async close() {
    this.setDatabaseOnPool(this.initialDatabaseName);

    await this.pool.end();
  }

  private getBaseUrl({ databaseName }: { databaseName: string }) {
    const url = new URL(`postgres://${databaseName}`);
    url.protocol = 'postgres:';
    url.password = '';

    return url;
  }

  private setDatabaseOnPool(databaseName: string | undefined) {
    this.pool.options.database = databaseName;
  }
}
