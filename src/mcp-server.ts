import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
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

export type TransportOptions = { type: 'stdio' } | { type: 'http'; port: number };

const TOOL_LIST_CACHE_TTL_MS = 300_000;
const HTTP_PATH = '/mcp';

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

  public start(transport: TransportOptions = { type: 'stdio' }) {
    if (transport.type === 'http') {
      this.startHttp(transport.port);
      return;
    }

    const handle = serveStdio(() => this.createPostgresMcpServer());

    this.setHandleClose(() => handle.close());
    console.error('Postgres MCP server listening on stdio');
  }

  private startHttp(port: number) {
    const handler = createMcpHandler(() => this.createPostgresMcpServer(), {
      onerror: (error) => console.error(error),
    });

    const httpServer = createServer((req, res) => {
      void this.handleHttpRequest(handler.fetch, req, res);
    });

    // Bind to loopback only; the Host/Origin checks below assume a local server.
    httpServer.listen(port, '127.0.0.1', () => {
      console.error(`Postgres MCP server listening on http://127.0.0.1:${port}${HTTP_PATH}`);
    });

    this.setHandleClose(async () => {
      await handler.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
  }

  private async handleHttpRequest(
    fetchHandler: (request: Request) => Promise<Response>,
    req: IncomingMessage,
    res: ServerResponse
  ) {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (url.pathname !== HTTP_PATH) {
        res.writeHead(404).end();
        return;
      }

      const request = await toWebRequest(req, url);
      const response =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins()) ??
        (await fetchHandler(request));

      await writeWebResponse(response, res);
    } catch (error) {
      console.error(error);

      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    }
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

  private setHandleClose(closeTransport: () => Promise<void>) {
    const shutdown = async () => {
      await closeTransport();
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

async function toWebRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = req.method ?? 'GET';
  let body: Uint8Array<ArrayBuffer> | undefined;

  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    body = new Uint8Array(Buffer.concat(chunks));
  }

  return new Request(url, { method, headers, body });
}

async function writeWebResponse(response: Response, res: ServerResponse) {
  res.writeHead(response.status, Object.fromEntries(response.headers));

  if (!response.body) {
    res.end();
    return;
  }

  // Flush headers right away so SSE clients see the stream open.
  res.flushHeaders();

  const reader = response.body.getReader();
  res.once('close', () => void reader.cancel());

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    res.write(value);
  }

  res.end();
}
