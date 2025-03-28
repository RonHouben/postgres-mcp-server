import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostgresClient, PostgresClientOptions } from './postgres-client.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ObjectUtils } from './utils/objectUtils.js';

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
      schemaName: options.database.schemaName,
      user: options.database.user,
      password: options.database.password,
      host: options.database.host,
      port: options.database.port,
    });
  }

  public async start() {
    console.log('Starting server...');

    this.setTools();
    this.setHandleClose();

    const transport = new StdioServerTransport();

    await this.mcpServer.connect(transport);

    console.log('Server started successfully');
  }

  private createPostgresMcpServer(options: PostgresMcpServerOptions['mcp']) {
    return new McpServer(
      {
        name: options.name,
        version: options.version,
      },
      {
        enforceStrictCapabilities: true,
        instructions: options.instructions,
        capabilities: {
          resources: {
            subscribe: true,
            listChanged: true,
          },
          tools: {
            listChanged: true,
          },
        },
      }
    );
  }

  private setTools() {
    console.log('Setting tools...');

    this.setListDatabasesTool();
    this.setListDatabaseTablesTool();
    this.setReadonlyQueryTool();
    this.setWriteQueryTool();

    console.log('Tools set successfully');
  }

  private setListDatabasesTool() {
    this.mcpServer.tool(
      'db-list-databases',
      'List all databases',
      ObjectUtils.pick(this.postgres.validationSchema, 'databaseName'),
      async ({ databaseName }) => {
        const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

        const queryResult = await this.postgres.query(databaseName, query, { readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  queryResult: queryResult.rows,
                  executedQuery: query,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  }

  private setListDatabaseTablesTool() {
    this.mcpServer.tool(
      'db-list-all-tables',
      'List all tables in the database'.concat(process.env.CUSTOM_INSTRUCTIONS ?? ''),
      ObjectUtils.pick(this.postgres.validationSchema, 'databaseName'),
      async ({ databaseName }) => {
        const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.postgres.schemaName}'`;

        const queryResult = await this.postgres.query(databaseName, query, { readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  queryResult: queryResult.rows,
                  executedQuery: query,
                },
                null,
                2
              ),
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

      this.postgres.validationSchema,
      async ({ databaseName, sqlQuery }) => {
        const queryResult = await this.postgres.query(databaseName, sqlQuery, { readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  queryResult: queryResult.rows,
                  executedQuery: sqlQuery,
                },
                null,
                2
              ),
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
      this.postgres.validationSchema,
      async ({ databaseName, sqlQuery }) => {
        const queryResult = await this.postgres.query(databaseName, sqlQuery, { readonly: false });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  queryResult: queryResult.rows,
                  executedQuery: sqlQuery,
                },
                null,
                2
              ),
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
