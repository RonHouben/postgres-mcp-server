import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PostgresClient, PostgresClientOptions } from './postgres.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type PostgresMcpServerOptions = {
  mcp: {
    name: string;
    version: string;
  };
  database: PostgresClientOptions;
};

export class PostgresMcpServer {
  public readonly postgres: PostgresClient;

  private readonly server: McpServer;

  constructor(options: PostgresMcpServerOptions) {
    this.server = this.createPostgresMcpServer(options.mcp);
    this.postgres = new PostgresClient({
      user: options.database.user,
      password: options.database.password,
      host: options.database.host,
      port: options.database.port,
      database: options.database.database,
    });
  }

  public async start() {
    console.log('Starting server...');

    this.setTools();

    const transport = new StdioServerTransport();

    await this.server.connect(transport);

    console.log('Server started successfully');
  }

  private createPostgresMcpServer(options: PostgresMcpServerOptions['mcp']) {
    return new McpServer(
      {
        name: options.name,
        version: options.version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );
  }

  private setTools() {
    console.log('Setting tools...');

    this.setReadonlyQueryTool();

    console.log('Tools set successfully');
  }

  private setReadonlyQueryTool() {
    this.server.tool(
      'readonly-query',
      'Execute a read only query',
      { sqlQuery: z.string() },
      async ({ sqlQuery }) => {
        const queryResult = await this.postgres.query(sqlQuery, { readonly: true });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  queryResult: queryResult.rows,
                  rowCount: queryResult.rowCount,
                  sqlQuery,
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
}
