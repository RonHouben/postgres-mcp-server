import { McpServer, ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostgresClient, PostgresClientOptions } from './postgres-client.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ObjectUtils } from './utils/objectUtils.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

type PostgresMcpServerOptions = {
  mcp: {
    name: string;
    version: string;
    instructions: string;
  };
  database: PostgresClientOptions;
};

export class PostgresMcpServer {
  private readonly postgres: PostgresClient;
  private readonly mcpServer: McpServer;

  constructor(options: PostgresMcpServerOptions) {
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
    this.setResources();
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

  private setResources() {
    this.setResourceListDatabases();
  }

  private setResourceListDatabases() {
    this.mcpServer.resource(
      'db-resources-list-databases',
      'postgres://list-databases',
      async () => {
        const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

        const queryResult = await this.postgres.query(query, { readonly: true });

        return {
          contents: queryResult.rows.map((row) => ({
            uri: new URL(`${row.datname}/${this.postgres.schemaName}`, this.postgres.baserUrl).href,
            mimeType: 'application/json',
            name: `"${row.datname}" database schema`,
            text: JSON.stringify(row),
          })),
        };
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
    this.mcpServer.tool('db-list-databases', 'List all databases', async () => {
      const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

      const queryResult = await this.postgres.query(query, { readonly: true });

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
    });
  }

  private setListDatabaseTablesTool() {
    this.mcpServer.tool(
      'db-list-all-tables',
      'List all tables in the database'.concat(process.env.CUSTOM_INSTRUCTIONS ?? ''),
      async () => {
        const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.postgres.schemaName}'`;

        const queryResult = await this.postgres.query(query, { readonly: true });

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
    this.mcpServer.tool(
      'db-readonly-query',
      'Execute a read only query',
      ObjectUtils.pick(this.postgres.validationSchema, 'sqlQuery'),
      async ({ sqlQuery }) => {
        const queryResult = await this.postgres.query(sqlQuery, { readonly: true });

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
    this.mcpServer.tool(
      'db-write-query',
      'Execute a write query',
      ObjectUtils.pick(this.postgres.validationSchema, 'sqlQuery'),
      async ({ sqlQuery }) => {
        const queryResult = await this.postgres.query(sqlQuery, { readonly: false });

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
