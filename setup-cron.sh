#!/bin/bash

# Setup cron job for news processing
# Run every 30 minutes

CRON_JOB="*/30 * * * * curl -X POST http://localhost:3000/api/process-news > /dev/null 2>&1"

# Add to crontab if not already present
(crontab -l 2>/dev/null | grep -v "process-news"; echo "$CRON_JOB") | crontab -

echo "Cron job added: News processing every 30 minutes"
echo "Current crontab:"
crontab -l
