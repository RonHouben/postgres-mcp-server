# postgres-mcp-server

This is a PostgresSQL Model Context Protocol server to let your LLM interact with your (local) database.
**Warning**: This is still experimental, so DO NOT use this on real database and be careful with write queries!

## Prerequisites

- have [nodeJS](https://nodejs.org/) installed
- run `npm install` to install the project dependencies
- have the following environment variables set:

```
DATABASE_NAME="your_database_name"
DATABASE_USER="your_database_user"
DATABASE_PASSWORD="your_database_password"
DATABASE_SCHEMA_name="your_database_schema_name" # i.e. standard this is usually `public`
```

## Easy config for in your VSCODE settings.json:

```json
{
  "chat.mcp.discovery.enabled": true,
  "mcp": {
    "postgresql-database": {
      "command": "npm",
      "type": "stdio",
      "args": ["start", "--prefix", "/path/to/code/postgres-mcp-server"],
      "env": {
        "CUSTOM_INSTRUCTIONS": "The databaseName is specific for the git branch we are on. It always has the same structure: jira_xxxxx, where the jira_xxxxx stands for the Jira ticket number. This Jira ticket number we always use at the start of a git branch. Hence, you should be able to take this from the current branch and create the databaseName from it",
        "DATABASE_NAME": "my-database-name",
        "DATABASE_USER": "my-user",
        "DATABASE_PASSWORD": "my-password",
        "DATABASE_SCHEMA_NAME": "public"
      }
    }
  }
}
```

## Running over HTTP

Some clients, like the GitHub Copilot ACP, can't launch stdio servers. Set `MCP_TRANSPORT=http` to serve MCP over streamable HTTP instead:

```sh
MCP_TRANSPORT=http MCP_HTTP_PORT=7432 npm start
# or: npm run start:http
```

The server listens on `http://127.0.0.1:<MCP_HTTP_PORT>/mcp` (default port `7432`). It binds to loopback only and rejects requests with a non-localhost `Host` or `Origin` header.

Each consumer can pass its own settings as headers in its MCP config. A header overrides the matching environment variable; anything left out falls back to the environment.

| Header                   | Environment variable   |
| ------------------------ | ---------------------- |
| `X-Database-Name`        | `DATABASE_NAME`        |
| `X-Database-User`        | `DATABASE_USER`        |
| `X-Database-Password`    | `DATABASE_PASSWORD`    |
| `X-Database-Schema-Name` | `DATABASE_SCHEMA_NAME` |
| `X-Custom-Instructions`  | `CUSTOM_INSTRUCTIONS`  |
| `X-Allow-Write-Queries`  | `ALLOW_WRITE_QUERIES`  |

Header values must be a single line of plain ASCII.

Client config:

```json
{
  "servers": {
    "postgresql-database": {
      "type": "http",
      "url": "http://127.0.0.1:7432/mcp",
      "headers": {
        "X-Database-User": "my-user",
        "X-Database-Password": "my-password",
        "X-Database-Schema-Name": "public",
        "X-Custom-Instructions": "The databaseName matches the current git branch."
      }
    }
  }
}
```
