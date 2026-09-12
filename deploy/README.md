# ITS staging operations

## PostgreSQL backups

The FirstVDS `autobackup` job currently backs up selected filesystem paths but
does not dump PostgreSQL. Install the application backup timer after the first
release and whenever its unit files change:

```bash
sudo bash /srv/its/current/backend/scripts/install-stage-backup.sh --run-now
```

The timer creates a verified custom-format dump every day in
`/var/backups/its-stage/postgresql`, keeps 14 days, and never prints database
credentials. Check it with:

```bash
sudo systemctl status its-stage-backup.timer
sudo systemctl status its-stage-backup.service
sudo pg_restore --list /var/backups/its-stage/postgresql/its-stage-*.dump >/dev/null
```

These dumps protect against logical mistakes but remain on the same server.
Before production launch, copy them to separate storage or enable a provider
snapshot policy and test a restore.
