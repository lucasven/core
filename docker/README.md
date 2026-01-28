# Stop all containers
docker compose down

# Rebuild and restart just the app
docker compose build core && docker compose up -d core

# View all running containers
docker compose ps

# Check logs for errors
docker compose logs core --tail 100
