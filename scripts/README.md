# Break-glass Cloud9 commands

The admin console is the normal interface for adding, refreshing, reviewing, and publishing projects. These commands are retained for recovery if that console is unavailable.

Run from the tool directory with `LIVE_EDITS_ADMIN_TOKEN` exported only for the current shell:

```bash
node scripts/setup-product.js --site en --source /home/ec2-user/environment/wwwroot/en/product-name
node scripts/publish-product.js --site en --name product-name
node scripts/publish-product.js --site en --name product-name --apply --published-by 'Release manager name'
```

Setup and forced refresh create private preview backups. Publishing is a dry run unless `--apply` is explicit. Recovery details are in [../docs/OPERATIONS.md](../docs/OPERATIONS.md).
