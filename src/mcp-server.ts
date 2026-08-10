import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { QueryResultRow } from 'pg';
import { PostgresClient, PostgresClientOptions } from './postgres-client.js';

type PostgresMcpServerOptions = {
  mcp: {
    name: string;
    version: string;
    instructions: string;
    customInstructions: string;
    allowWriteQueries: boolean;
  };
  database: PostgresClientOptions;
};

const TOOL_LIST_CACHE_TTL_MS = 300_000;

export class PostgresMcpServer {
  private readonly postgres: PostgresClient;
  private readonly mcpOptions: PostgresMcpServerOptions['mcp'];

  constructor(options: PostgresMcpServerOptions) {
    this.mcpOptions = options.mcp;

    this.postgres = new PostgresClient({
      database: options.database.database,
      schemaName: options.database.schemaName,
      user: options.database.user,
      password: options.database.password,
      host: options.database.host,
      port: options.database.port,
    });
  }

  public start() {
    const handle = serveStdio(() => this.createPostgresMcpServer());

    this.setHandleClose(handle);

    return handle;
  }

  private createPostgresMcpServer() {
    const mcpServer = new McpServer(
      {
        name: this.mcpOptions.name,
        version: this.mcpOptions.version,
      },
      {
        instructions: this.mcpOptions.instructions,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        cacheHints: {
          'tools/list': { ttlMs: TOOL_LIST_CACHE_TTL_MS, cacheScope: 'public' },
        },
      }
    );

    this.setTools(mcpServer);

    return mcpServer;
  }

  private setTools(mcpServer: McpServer) {
    this.setListDatabasesTool(mcpServer);
    this.setListDatabaseTablesTool(mcpServer);
    this.setReadonlyQueryTool(mcpServer);

    if (this.mcpOptions.allowWriteQueries) {
      this.setWriteQueryTool(mcpServer);
    }
  }

  private setListDatabasesTool(mcpServer: McpServer) {
    mcpServer.registerTool(
      'db-list-databases',
      {
        title: 'List all databases',
        description: 'List all databases. '.concat(this.mcpOptions.customInstructions),
        inputSchema: this.postgres.validationSchema.pick({ databaseName: true }),
        outputSchema: this.postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ databaseName }) => {
        const query = 'SELECT datname FROM pg_database WHERE datistemplate = false';

        const queryResult = await this.postgres.query(query, { databaseName, readonly: true });

        return this.toToolResult(query, queryResult.rows);
      }
    );
  }

  private setListDatabaseTablesTool(mcpServer: McpServer) {
    mcpServer.registerTool(
      'db-list-all-tables',
      {
        title: 'List all tables in the database',
        description: 'List all tables in the database. '.concat(this.mcpOptions.customInstructions),
        inputSchema: this.postgres.validationSchema.pick({ databaseName: true }),
        outputSchema: this.postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ databaseName }) => {
        const query = 'SELECT table_name FROM information_schema.tables WHERE table_schema = $1';

        const queryResult = await this.postgres.query(query, {
          databaseName,
          readonly: true,
          values: [this.postgres.schemaName],
        });

        return this.toToolResult(query, queryResult.rows);
      }
    );
  }

  private setReadonlyQueryTool(mcpServer: McpServer) {
    mcpServer.registerTool(
      'db-readonly-query',
      {
        title: 'Execute a read only query',
        description: 'Execute a read only query. '.concat(this.mcpOptions.customInstructions),
        inputSchema: this.postgres.validationSchema,
        outputSchema: this.postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await this.postgres.query(sqlQuery, { databaseName, readonly: true });

        return this.toToolResult(sqlQuery, queryResult.rows);
      }
    );
  }

  private setWriteQueryTool(mcpServer: McpServer) {
    mcpServer.registerTool(
      'db-write-query',
      {
        title: 'Execute a write query',
        description: 'Execute a write query. '.concat(this.mcpOptions.customInstructions),
        inputSchema: this.postgres.validationSchema,
        outputSchema: this.postgres.resultSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await this.postgres.query(sqlQuery, { databaseName, readonly: false });

        return this.toToolResult(sqlQuery, queryResult.rows);
      }
    );
  }

  private setHandleClose(handle: StdioServerHandle) {
    const shutdown = async () => {
      await handle.close();
      await this.postgres.close();
    };

    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
  }

  private toToolResult(executedQuery: string, queryResult: QueryResultRow[]) {
    const structuredContent = { queryResult, executedQuery };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }
}
