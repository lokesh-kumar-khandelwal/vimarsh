/**
 * Cross-Platform Production Preview Entrypoint (/scripts/preview.ts)
 *
 * Sets NODE_ENV='production' before starting the Express server, ensuring full
 * cross-platform compatibility across Windows PowerShell, Windows cmd.exe, macOS, and Linux.
 */

process.env.NODE_ENV = 'production';

import('../server')
  .then((server) => {
    void server.startServer();
  })
  .catch((err) => {
    console.error('Failed to start production preview server:', err);
    process.exit(1);
  });
