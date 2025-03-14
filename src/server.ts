import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
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
  public readonly db: PostgresClient;

  private readonly server: McpServer;

  constructor(options: PostgresMcpServerOptions) {
    this.server = this.createPostgresMcpServer(options.mcp);

    this.db = new PostgresClient({
      schemaName: options.database.schemaName,
      user: options.database.user,
      password: options.database.password,
      host: options.database.host,
      port: options.database.port,
      database: options.database.database,
    });
  }

  public async start() {
    console.log('Starting server...');

    this.setResources();
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

  private setResources() {
    console.log('Setting resources...');

    this.setListResources();

    console.log('Resources set successfully');
  }

  private setListResources() {
    this.server.resource(
      'list',
      new ResourceTemplate('postgres://list', { list: undefined }),
      async () => {
        const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.db.schemaName}'`;

        const queryResult = await this.db.query(query);

        return {
          contents: queryResult.rows.map((row) => ({
            uri: this.db.getUri(row.table_name),
            mimeType: 'application/json',
            name: `"${row.table_name}" database schema`,
            description: `This is the "${row.table_name}" database schema. This data is requested from the database using the following query: "${query}"`,
            blob: '',
          })),
        };
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
        const queryResult = await this.db.query(sqlQuery, { readonly: true });

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
