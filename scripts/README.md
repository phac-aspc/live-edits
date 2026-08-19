# Cloud9 commands

Run commands from the repository root.

```bash
export LIVE_EDITS_ADMIN_TOKEN='the Azure ADMIN_TOKEN value'
node scripts/setup-product.js --site en --source /home/ec2-user/environment/wwwroot/en/product-name
node scripts/publish-product.js --site en --name product-name
node scripts/publish-product.js --site en --name product-name --apply
```

The first publish command is a dry run. Setup options and recovery procedures are documented in [../docs/OPERATIONS.md](../docs/OPERATIONS.md).
