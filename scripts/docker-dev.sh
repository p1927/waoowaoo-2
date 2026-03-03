#!/bin/bash
# Docker development script with live reload

set -e

echo "🚀 Starting waoowaoo in DEV mode with live reload..."
echo ""

# Stop existing containers if running
echo "🛑 Stopping existing containers..."
docker compose -f docker-compose.dev.yml down 2>/dev/null || true

# Build and start containers
echo "🔨 Building and starting containers..."
docker compose -f docker-compose.dev.yml up --build -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Show logs
echo ""
echo "📋 Container status:"
docker compose -f docker-compose.dev.yml ps

echo ""
echo "📝 Following logs (Ctrl+C to stop)..."
echo "   Frontend: http://localhost:13000"
echo "   Queue UI: http://localhost:13010/admin/queues"
echo ""

# Follow logs
docker compose -f docker-compose.dev.yml logs -f app
