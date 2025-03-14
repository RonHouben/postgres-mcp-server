import { PostgresMcpServer } from './server.js';

const postgresMcpServer = new PostgresMcpServer({
  database: { 
    database: process.env.DATABASE_NAME,
    host: 'localhost',
    password: process.env.DATABASE_PASSWORD,
    port: 5432,
    user: process.env.DATABASE_USER
  },
  mcp: { name: 'Postgres', version: '1.0' }
});

await postgresMcpServer.start();
