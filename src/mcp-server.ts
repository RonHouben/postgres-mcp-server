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

export type ServerConfig = {
  database: PostgresClientOptions;
  customInstructions: string;
  allowWriteQueries: boolean;
};

type PostgresMcpServerOptions = {
  mcp: {
    name: string;
    version: string;
    buildInstructions: (config: ServerConfig) => string;
  };
  defaults: ServerConfig;
};

type ToolContext = {
  postgres: PostgresClient;
  customInstructions: string;
};

export type TransportOptions = { type: 'stdio' } | { type: 'http'; port: number };

const TOOL_LIST_CACHE_TTL_MS = 300_000;
const HTTP_PATH = '/mcp';
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

export class PostgresMcpServer {
  private readonly clients = new Map<string, PostgresClient>();

  constructor(private readonly options: PostgresMcpServerOptions) {}

  public start(transport: TransportOptions = { type: 'stdio' }) {
    if (transport.type === 'http') {
      this.startHttp(transport.port);
      return;
    }

    const handle = serveStdio(() => this.createPostgresMcpServer(this.options.defaults));

    this.setHandleClose(() => handle.close());
    console.error('Postgres MCP server listening on stdio');
  }

  private startHttp(port: number) {
    const handler = createMcpHandler(
      (ctx) => this.createPostgresMcpServer(this.resolveConfig(ctx.requestInfo?.headers)),
      {
        onerror: (error) => console.error(error),
      }
    );

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

      const method = req.method ?? 'GET';
      const headers = toHeaders(req);
      const headersOnlyRequest = new Request(url, { method, headers });
      const rejection =
        hostHeaderValidationResponse(headersOnlyRequest, localhostAllowedHostnames()) ??
        originValidationResponse(headersOnlyRequest, localhostAllowedOrigins());

      if (rejection) {
        await writeWebResponse(rejection, res);
        return;
      }

      let body: Uint8Array<ArrayBuffer> | undefined;

      if (method !== 'GET' && method !== 'HEAD') {
        body = await readBody(req, MAX_REQUEST_BODY_BYTES);

        if (!body) {
          res.writeHead(413, { Connection: 'close' }).end();
          return;
        }
      }

      const response = await fetchHandler(new Request(url, { method, headers, body }));

      await writeWebResponse(response, res);
    } catch (error) {
      console.error(error);

      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    }
  }

  // Headers set in the consumer's MCP config override the env defaults for that consumer.
  private resolveConfig(headers?: Headers): ServerConfig {
    const defaults = this.options.defaults;

    if (!headers) {
      return defaults;
    }

    const allowWriteQueries = headers.get('x-allow-write-queries');

    return {
      database: {
        ...defaults.database,
        database: headers.get('x-database-name') ?? defaults.database.database,
        user: headers.get('x-database-user') ?? defaults.database.user,
        password: headers.get('x-database-password') ?? defaults.database.password,
        schemaName: headers.get('x-database-schema-name') ?? defaults.database.schemaName,
      },
      customInstructions: headers.get('x-custom-instructions') ?? defaults.customInstructions,
      allowWriteQueries:
        allowWriteQueries === null ? defaults.allowWriteQueries : allowWriteQueries === 'true',
    };
  }

  private getClient(options: PostgresClientOptions) {
    const key = JSON.stringify([
      options.host,
      options.port,
      options.database,
      options.user,
      options.password,
      options.schemaName,
    ]);
    let client = this.clients.get(key);

    if (!client) {
      client = new PostgresClient(options);
      this.clients.set(key, client);
    }

    return client;
  }

  private createPostgresMcpServer(config: ServerConfig) {
    const mcpServer = new McpServer(
      {
        name: this.options.mcp.name,
        version: this.options.mcp.version,
      },
      {
        instructions: this.options.mcp.buildInstructions(config),
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        cacheHints: {
          // The tool list depends on per-consumer settings, so it must not be shared.
          'tools/list': { ttlMs: TOOL_LIST_CACHE_TTL_MS, cacheScope: 'private' },
        },
      }
    );

    this.setTools(mcpServer, config);

    return mcpServer;
  }

  private setTools(mcpServer: McpServer, config: ServerConfig) {
    const context: ToolContext = {
      postgres: this.getClient(config.database),
      customInstructions: config.customInstructions,
    };

    this.setListDatabasesTool(mcpServer, context);
    this.setListDatabaseTablesTool(mcpServer, context);
    this.setReadonlyQueryTool(mcpServer, context);

    if (config.allowWriteQueries) {
      this.setWriteQueryTool(mcpServer, context);
    }
  }

  private setListDatabasesTool(mcpServer: McpServer, { postgres, customInstructions }: ToolContext) {
    mcpServer.registerTool(
      'db-list-databases',
      {
        title: 'List all databases',
        description: 'List all databases. '.concat(customInstructions),
        inputSchema: postgres.validationSchema.pick({ databaseName: true }),
        outputSchema: postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ databaseName }) => {
        const query = 'SELECT datname FROM pg_database WHERE datistemplate = false';

        const queryResult = await postgres.query(query, { databaseName, readonly: true });

        return this.toToolResult(query, queryResult.rows);
      }
    );
  }

  private setListDatabaseTablesTool(mcpServer: McpServer, { postgres, customInstructions }: ToolContext) {
    mcpServer.registerTool(
      'db-list-all-tables',
      {
        title: 'List all tables in the database',
        description: 'List all tables in the database. '.concat(customInstructions),
        inputSchema: postgres.validationSchema.pick({ databaseName: true }),
        outputSchema: postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ databaseName }) => {
        const query = 'SELECT table_name FROM information_schema.tables WHERE table_schema = $1';

        const queryResult = await postgres.query(query, {
          databaseName,
          readonly: true,
          values: [postgres.schemaName],
        });

        return this.toToolResult(query, queryResult.rows);
      }
    );
  }

  private setReadonlyQueryTool(mcpServer: McpServer, { postgres, customInstructions }: ToolContext) {
    mcpServer.registerTool(
      'db-readonly-query',
      {
        title: 'Execute a read only query',
        description: 'Execute a read only query. '.concat(customInstructions),
        inputSchema: postgres.validationSchema,
        outputSchema: postgres.resultSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await postgres.query(sqlQuery, { databaseName, readonly: true });

        return this.toToolResult(sqlQuery, queryResult.rows);
      }
    );
  }

  private setWriteQueryTool(mcpServer: McpServer, { postgres, customInstructions }: ToolContext) {
    mcpServer.registerTool(
      'db-write-query',
      {
        title: 'Execute a write query',
        description: 'Execute a write query. '.concat(customInstructions),
        inputSchema: postgres.validationSchema,
        outputSchema: postgres.resultSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ sqlQuery, databaseName }) => {
        const queryResult = await postgres.query(sqlQuery, { databaseName, readonly: false });

        return this.toToolResult(sqlQuery, queryResult.rows);
      }
    );
  }

  private setHandleClose(closeTransport: () => Promise<void>) {
    const shutdown = async () => {
      await closeTransport();
      await Promise.all([...this.clients.values()].map((client) => client.close()));
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

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return headers;
}

// Resolves undefined when the body exceeds maxBytes.
function readBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;

      if (size > maxBytes) {
        cleanup();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(new Uint8Array(Buffer.concat(chunks)));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
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
    if (done || res.destroyed) {
      break;
    }
    if (!res.write(value)) {
      await waitForDrain(res);
    }
  }

  res.end();
}

function waitForDrain(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}
