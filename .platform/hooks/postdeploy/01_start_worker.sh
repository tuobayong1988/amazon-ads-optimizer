#!/bin/bash
# P5e: Start worker process as a systemd service
# This runs after EB deployment to start the independent worker process

if [ "${P5_WORKER_ENABLED}" = "true" ]; then
  echo "[P5e] Starting worker process..."
  
  # Create systemd service for worker
  cat > /etc/systemd/system/ads-worker.service << 'SVCEOF'
[Unit]
Description=Amazon Ads Optimizer Worker Process
After=web.service

[Service]
Type=simple
User=webapp
WorkingDirectory=/var/app/current
ExecStart=/usr/bin/node dist/worker.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=2048
StandardOutput=append:/var/log/ads-worker.log
StandardError=append:/var/log/ads-worker.log

[Install]
WantedBy=multi-user.target
SVCEOF

  systemctl daemon-reload
  systemctl enable ads-worker
  systemctl restart ads-worker
  
  echo "[P5e] Worker process started successfully"
else
  echo "[P5e] Worker process disabled (P5_WORKER_ENABLED != true)"
  # Stop worker if it was running
  systemctl stop ads-worker 2>/dev/null || true
  systemctl disable ads-worker 2>/dev/null || true
fi
