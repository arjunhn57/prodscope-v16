// PM2 Ecosystem Configuration
// Usage:
//   npx pm2 start ecosystem.config.js
//   npx pm2 reload ecosystem.config.js   (zero-downtime restart)
//   npx pm2 logs backend

module.exports = {
  apps: [
    {
      name: "backend",
      script: "server.js",
      instances: 1,              // single instance (emulator is single-threaded)
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1024M",
      min_uptime: "10s",         // must survive 10s to count as started
      max_restarts: 10,          // max restarts within restart_delay window
      restart_delay: 3000,       // 3s between restarts

      // Environment
      //
      // CRAWL_ENGINE is pinned to "v17" here (sprint-1 commit 381bae6).
      // Pm2's env block takes precedence over dotenv, so this is the
      // authoritative default for production. The legacy v16 path is
      // still reachable by flipping .env:CRAWL_ENGINE=v16 + pm2 restart
      // --update-env, per the V17_LAUNCH_CHECKLIST §3 rollback plan.
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        AGENT_LOOP: "true",
        CRAWL_ENGINE: "v17",
      },

      // Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: `${process.env.HOME || '/home/arjunhn'}/.pm2/logs/backend-error.log`,
      out_file: `${process.env.HOME || '/home/arjunhn'}/.pm2/logs/backend-out.log`,
      merge_logs: true,
      log_type: "json",

      // Graceful shutdown
      kill_timeout: 30000,       // 15s for in-flight job checkpoint
      listen_timeout: 10000,
      shutdown_with_message: true,

      // Health
      exp_backoff_restart_delay: 1000,
    },
  ],
};
