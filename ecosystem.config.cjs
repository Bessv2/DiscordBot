// pm2 settings for running the bot without Docker (docs/WITHOUT-DOCKER.md):
//   pm2 start ecosystem.config.cjs   then   pm2 save   (and pm2 startup, once)
// pm2 restarts the bot if it crashes; scripts/local.cjs applies pending
// database migrations on every start, like the Docker image does.
module.exports = {
  apps: [
    {
      name: 'discord-mod-bot',
      script: 'scripts/local.cjs',
      args: 'start',
      cwd: __dirname,
      // Give the bot time to stop music and close the database cleanly.
      kill_timeout: 10000,
      // Back off instead of hammering Discord's login if something is wrong
      // (a bad token, no internet); resets once the bot stays up.
      exp_backoff_restart_delay: 2000,
      // A config mistake (empty token) exits straight away; stop retrying
      // after a few tries so the log shows the fix instead of a restart loop.
      min_uptime: 10000,
      max_restarts: 10,
      time: true,
    },
  ],
};
