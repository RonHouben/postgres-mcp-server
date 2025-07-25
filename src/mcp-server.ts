import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostgresClient, PostgresClientOptions } from './postgres-client.js';
import { ObjectUtils } from './utils/objectUtils.js';

type PostgresMcpServerOptions = {
  mcp: {
    name: string;
    version: string;
    instructions: string;
    customInstructions: string;
  };
  database: PostgresClientOptions;
};

export class PostgresMcpServer {
  private readonly postgres: PostgresClient;
  private readonly mcpServer: McpServer;
  private readonly customInstructions: string;

  constructor(options: PostgresMcpServerOptions) {
    this.customInstructions = options.mcp.customInstructions;
    this.mcpServer = this.createPostgresMcpServer(options.mcp);

    this.postgres = new PostgresClient({
      database: options.database.database,
      schemaName: options.database.schemaName,
      user: options.database.user,
      password: options.database.password,
      host: options.database.host,
      port: options.database.port,
    });
  }

  public async start() {
    this.setTools();
    this.setHandleClose();

    const transport = new StdioServerTransport();

    await this.mcpServer.connect(transport);
  }

  private createPostgresMcpServer(options: PostgresMcpServerOptions['mcp']) {
    return new McpServer(
      {
        name: options.name,
        version: options.version,
      },
      {
        enforceStrictCapabilities: false,
        instructions: options.instructions,
        capabilities: {
          resources: {
            subscribe: false,
            listChanged: false,
          },
          tools: {
            listChanged: false,
          },
          logging: {},
          experimental: {},
          prompts: {
            listChanged: false,
          },
        },
      }
    );
  }

  private setTools() {
    this.setListDatabasesTool();
    this.setListDatabaseTablesTool();
    this.setReadonlyQueryTool();
    this.setWriteQueryTool();
  }

  private setListDatabasesTool() {
    this.mcpServer.registerTool(
      'db-list-databases',
      {
        title: 'List all databases',
        description: 'List all databases. '.concat(this.customInstructions),
        inputSchema: ObjectUtils.pick(this.postgres.validationSchema, 'databaseName'),
      },
      async ({ databaseName }) => {
        const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

        const queryResult = await this.postgres.query(query, { databaseName, readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                queryResult: queryResult.rows,
                executedQuery: query,
              }),
            },
          ],
        };
      }
    );
  }

  private setListDatabaseTablesTool() {
    this.mcpServer.registerTool(
      'db-list-all-tables',
      {
        title: 'List all tables in the database',
        description: 'List all tables in the database. '.concat(this.customInstructions),
        inputSchema: ObjectUtils.pick(this.postgres.validationSchema, 'databaseName'),
      },
      async ({ databaseName }) => {
        const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.postgres.schemaName}'`;

        const queryResult = await this.postgres.query(query, { databaseName, readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                queryResult: queryResult.rows,
                executedQuery: query,
              }),
            },
          ],
        };
      }
    );
  }

  private setReadonlyQueryTool() {
    this.mcpServer.registerTool(
      'db-readonly-query',
      {
        title: 'Execute a read only query',
        description: 'Execute a read only query. '.concat(this.customInstructions),
        inputSchema: ObjectUtils.pick(this.postgres.validationSchema, 'databaseName', 'sqlQuery'),
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await this.postgres.query(sqlQuery, { databaseName, readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                queryResult: queryResult.rows,
                executedQuery: sqlQuery,
              }),
            },
          ],
        };
      }
    );
  }

  private setWriteQueryTool() {
    this.mcpServer.registerTool(
      'db-write-query',
      {
        title: 'Execute a write query',
        description: 'Execute a write query. '.concat(this.customInstructions),
        inputSchema: ObjectUtils.pick(this.postgres.validationSchema, 'databaseName', 'sqlQuery'),
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await this.postgres.query(sqlQuery, { databaseName, readonly: false });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                queryResult: queryResult.rows,
                executedQuery: sqlQuery,
              }),
            },
          ],
        };
      }
    );
  }

  private setHandleClose() {
    this.mcpServer.server.onclose = async () => {
      await this.postgres.close();
    };
  }
}
