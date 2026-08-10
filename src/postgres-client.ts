import pg from 'pg';
import type { QueryResult, QueryResultRow, PoolConfig } from 'pg';
import { z } from 'zod';

export type PostgresClientOptions = Required<
  Pick<PoolConfig, 'database' | 'user' | 'password' | 'host' | 'port'> & CustomOptions
>;

type CustomOptions = {
  schemaName: string;
};

type QueryOptions = {
  readonly: boolean;
  databaseName?: string;
  values?: unknown[];
};

export class PostgresClient {
  public readonly baserUrl: URL;
  public readonly schemaName: string;
  public readonly validationSchema = z.object({
    databaseName: z.string().describe('The name of the database to connect to.').optional(),
    sqlQuery: z
      .string()
      .describe(
        'The SQL query to execute against the database. Use double quotes when fields or tables are camelCases to avoid SQL syntax issues.'
      ),
  });

  public readonly resultSchema = z.object({
    queryResult: z.array(z.record(z.string(), z.unknown())).describe('The rows returned by the query.'),
    executedQuery: z.string().describe('The SQL that was executed.'),
  });

  private readonly initialDatabaseName: string;
  private readonly connectionOptions: Omit<PoolConfig, 'database'>;
  private readonly pools = new Map<string, pg.Pool>();

  constructor(options: PostgresClientOptions) {
    this.initialDatabaseName = options.database;
    this.baserUrl = this.getBaseUrl({ databaseName: options.database });

    this.schemaName = options.schemaName;

    this.connectionOptions = {
      user: options.user,
      password: options.password,
      host: options.host,
      port: options.port,
    };
  }

  public async query<T extends QueryResultRow>(
    query: string,
    options: QueryOptions
  ): Promise<QueryResult<T>> {
    const pool = this.getPool(options.databaseName ?? this.initialDatabaseName);
    const client = await pool.connect();

    try {
      if (options.readonly) {
        await client.query('BEGIN TRANSACTION READ ONLY');
      }

      const result = await client.query<T>(query, options.values);

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
    const pools = [...this.pools.values()];

    this.pools.clear();

    await Promise.all(pools.map((pool) => pool.end()));
  }

  private getBaseUrl({ databaseName }: { databaseName: string }) {
    const url = new URL(`postgres://${databaseName}`);
    url.protocol = 'postgres:';
    url.password = '';

    return url;
  }

  // A pg pool is bound to the database it was created for, so each database needs its own.
  private getPool(databaseName: string) {
    const existingPool = this.pools.get(databaseName);

    if (existingPool) {
      return existingPool;
    }

    const pool = new pg.Pool({ ...this.connectionOptions, database: databaseName });

    this.pools.set(databaseName, pool);

    return pool;
  }
}
