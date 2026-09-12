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
