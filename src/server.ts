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
      database: options.database.database,
    });
  }

  public async start() {
    console.log('Starting server...');

    this.setResources();
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

  private setResources() {
    console.log('Setting resources...');

    this.setResourceListDatabases();
    this.setResourceListDatabaseTables();

    console.log('Resources set successfully');
  }

  private setResourceListDatabases() {
    this.mcpServer.resource(
      'db-resources-list-databases',
      'postgres://list-databases',
      async () => {
        const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

        const queryResult = await this.postgres.query(query);

        return {
          contents: queryResult.rows.map((row) => ({
            uri: this.postgres.getUri(row.datname),
            text: JSON.stringify(row, null, 2),
            mimeType: 'application/json',
            name: `"${row.datname}" database schema`,
            description: `This is the "${row.datname}" database schema. This data is requested from the database using the following query: "${query}"`,
          })),
        };
      }
    );
  }

  private setResourceListDatabaseTables() {
    this.mcpServer.resource('db-resources-list-tables', 'postgres://list-tables', async () => {
      const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.postgres.schemaName}'`;

      const queryResult = await this.postgres.query(query);

      return {
        contents: queryResult.rows.map((row) => ({
          uri: this.postgres.getUri(row.table_name),
          text: JSON.stringify(row, null, 2),
          mimeType: 'application/json',
          name: `"${row.table_name}" database schema`,
          description: `This is the "${row.table_name}" database schema. This data is requested from the database using the following query: "${query}"`,
        })),
      };
    });
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
    this.mcpServer.tool('db-list-databases', 'List all databases', {}, async () => {
      const query = `SELECT datname FROM pg_database WHERE datistemplate = false`;

      const queryResult = await this.postgres.query(query);

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
    });
  }

  private setListDatabaseTablesTool() {
    this.mcpServer.tool('db-list-all-tables', 'List all tables in the database', {}, async () => {
      const query = `SELECT table_name FROM information_schema.tables WHERE table_schema = '${this.postgres.schemaName}'`;

      const queryResult = await this.postgres.query(query);

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
    });
  }

  private setReadonlyQueryTool() {
    this.mcpServer.tool(
      'db-readonly-query',
      'Execute a read only query',
      {
        sqlQuery: z
          .string()
          .describe(
            'The SQL read-only query to execute against the database. When a table name is given in camelCase, make sure to use double quotes around it.'
          ),
      },
      async ({ sqlQuery }) => {
        const queryResult = await this.postgres.query(sqlQuery, { readonly: true });

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
      {
        sqlQuery: z
          .string()
          .describe(
            'The SQL write query to execute against the database. ONLY EXECUTE THIS QUERY AFTER CONSULTING THE QUERY WITH THE USER! When a table name is given in camelCase, make sure to use double quotes around it.'
          ),
      },
      async ({ sqlQuery }) => {
        const queryResult = await this.postgres.query(sqlQuery, { readonly: false });

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
