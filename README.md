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
