const app = require('./app');
const env = require('./config/env');

// pid + start time make a stale process (started before a route/controller change was saved)
// immediately visible in the terminal, instead of only discoverable via a confusing "Route not
// found" on the new endpoint -- see resolution.md BUG-21. Always run via `npm run dev` (nodemon)
// during development, not `npm start`/bare `node`, so file changes reload this automatically.
app.listen(env.port, () => {
  console.log(`Customer Portal API listening on port ${env.port} (pid ${process.pid}, started ${new Date().toISOString()})`);
});
