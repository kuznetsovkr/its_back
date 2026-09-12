# ITS staging operations

## PostgreSQL and uploads backups

The application timer creates restorable PostgreSQL dumps and compressed
archives of `/srv/its/shared/uploads`. Install it after the first release and
whenever its scripts or unit files change:

```bash
sudo bash /srv/its/current/backend/scripts/install-stage-backup.sh --run-now
```

The timer runs before the provider autobackup, writes verified artifacts to
`/var/backups/its-stage/postgresql` and `/var/backups/its-stage/uploads`, keeps
14 days, and never prints database credentials. Check it with:

```bash
sudo systemctl status its-stage-backup.timer
sudo systemctl status its-stage-backup.service
sudo pg_restore --list /var/backups/its-stage/postgresql/its-stage-*.dump >/dev/null
sudo tar -tzf /var/backups/its-stage/uploads/its-stage-uploads-*.tar.gz >/dev/null
```

The FirstVDS autobackup must include both `/var/backups/its-stage/postgresql`
and `/srv/its/shared/uploads`, so database dumps and original uploads also have
an off-server copy. Test both archive extraction and database restore before
production launch.

## Monitoring and retention

Install the monitoring and maintenance timers after a release containing the
operations scripts:

```bash
sudo bash /srv/its/current/backend/scripts/install-stage-operations.sh --send-test
```

The monitor runs every five minutes and checks the public home page and API,
the Node.js, nginx, PostgreSQL and Redis services, disk and inode usage, backup
age, application restarts and new error-priority journal entries. Alerts are
sent through the orders Telegram bot to its active subscribers. To isolate
infrastructure notifications, put `ITS_MONITOR_TELEGRAM_BOT_TOKEN` and
`ITS_MONITOR_TELEGRAM_CHAT_IDS` in the root-owned
`/etc/its-site/monitor.env`. An optional `ITS_MONITOR_HEARTBEAT_URL` supports
an external dead-man's-switch; an external check is still required to detect a
complete VPS or network outage.

Maintenance runs daily at 03:15 UTC, after the application backup. Defaults:

- keep the five newest immutable releases, including the active release;
- keep photos for sent orders for 180 days;
- keep photos for cancelled, expired or failed orders for 30 days;
- delete unreferenced order photos after seven days;
- delete abandoned temporary uploads after 24 hours;
- never delete photos of active orders or inventory catalog images.

Override these values in `/etc/its-site/maintenance.env` using the names in
`.env.production.example`. Before changing the policy, preview both jobs:

```bash
sudo systemd-run --wait --pipe --collect --unit=its-retention-preview \
  --property=Type=oneshot --property=User=itsdeploy --property=Group=itsdeploy \
  --property=WorkingDirectory=/srv/its/current/backend \
  --property=EnvironmentFile=/etc/its-site/stage.env \
  /usr/bin/node /srv/its/current/backend/scripts/cleanup-order-uploads.js --dry-run
sudo -u itsdeploy ITS_RELEASES_TO_KEEP=5 \
  bash /srv/its/current/backend/scripts/prune-releases.sh --dry-run
```

Routine checks:

```bash
sudo systemctl status its-stage-monitor.timer its-stage-maintenance.timer
sudo journalctl -u its-stage-monitor.service -n 50 --no-pager
sudo journalctl -u its-stage-maintenance.service -n 50 --no-pager
```
