#!/usr/bin/env bash
# =============================================================================
# InvenTree Docker Host Control Script
# Convenient CLI helper for managing InvenTree self-hosted Docker deployment
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="docker-compose.yml"
BUILD_COMPOSE_FILE="docker-compose.build.yml"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed! Please install Docker before proceeding."
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose (v2 plugin) is not available! Please install 'docker-compose-plugin'."
        exit 1
    fi
}

ensure_env() {
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            log_warning "No .env file found. Creating from .env.example..."
            cp .env.example .env
            log_info "Please review and edit .env to set your passwords and INVENTREE_SITE_URL."
        else
            log_error "Neither .env nor .env.example found!"
            exit 1
        fi
    fi
}

ensure_data_dirs() {
    # Extract data directory from .env or use default
    DATA_DIR=$(grep "^INVENTREE_EXT_VOLUME=" .env 2>/dev/null | cut -d '=' -f2 | tr -d '"' || echo "./inventree-data")
    if [ ! -d "$DATA_DIR" ]; then
        log_info "Creating data directory: $DATA_DIR"
        mkdir -p "$DATA_DIR" "$DATA_DIR/static" "$DATA_DIR/media" "$DATA_DIR/backup" "$DATA_DIR/redis" "$DATA_DIR/caddy-log" "$DATA_DIR/caddy-data" "$DATA_DIR/caddy-config"
    fi
}

cmd_setup() {
    check_docker
    ensure_env
    ensure_data_dirs
    log_success "Environment setup complete! Check .env and run './docker-host.sh start'."
}

cmd_start() {
    check_docker
    ensure_env
    ensure_data_dirs
    log_info "Starting InvenTree services..."
    docker compose up -d
    log_success "InvenTree services started!"
    echo ""
    cmd_status
}

cmd_build_start() {
    check_docker
    ensure_env
    ensure_data_dirs
    log_info "Building image from local source and starting services..."
    docker compose -f "$COMPOSE_FILE" -f "$BUILD_COMPOSE_FILE" up -d --build
    log_success "InvenTree built and started from local repository!"
    echo ""
    cmd_status
}

cmd_stop() {
    check_docker
    log_info "Stopping InvenTree services..."
    docker compose down
    log_success "InvenTree services stopped."
}

cmd_restart() {
    check_docker
    log_info "Restarting InvenTree services..."
    docker compose restart
    log_success "InvenTree services restarted."
}

cmd_status() {
    check_docker
    docker compose ps
}

cmd_logs() {
    check_docker
    docker compose logs -f "$@"
}

cmd_update() {
    check_docker
    log_info "Running database migrations and static updates..."
    docker compose exec inventree-server invoke update
    log_success "Database migrations and updates finished."
}

cmd_createsuperuser() {
    check_docker
    log_info "Launching superuser creation prompt..."
    docker compose exec inventree-server python3 src/backend/InvenTree/manage.py createsuperuser
}

cmd_backup() {
    check_docker
    log_info "Creating database and media backup..."
    docker compose exec inventree-server invoke backup
    log_success "Backup complete! Check the backup folder in your data volume."
}

cmd_restore() {
    check_docker
    if [ -z "$1" ]; then
        log_error "Usage: ./docker-host.sh restore <backup_file>"
        exit 1
    fi
    log_info "Restoring from backup: $1"
    docker compose exec inventree-server invoke restore "$1"
    log_success "Restore complete."
}

cmd_shell() {
    check_docker
    if [ "$1" == "django" ]; then
        docker compose exec inventree-server python3 src/backend/InvenTree/manage.py shell
    else
        docker compose exec inventree-server /bin/bash
    fi
}

show_help() {
    cat << EOF
InvenTree Docker Management Script

Usage: ./docker-host.sh [command]

Commands:
  setup              Initialize .env and storage directories
  start              Start all services (Postgres, Redis, InvenTree, Worker, Caddy)
  build-start        Build image from local repository source and start
  stop               Stop and remove running containers
  restart            Restart running containers
  status             Show status of all services
  logs [service]     Tail container logs (e.g. ./docker-host.sh logs inventree-server)
  update             Run database migrations and collect static files
  createsuperuser    Create an administrator account interactively
  backup             Create an InvenTree database and media backup
  restore <file>     Restore database from a backup file
  shell [django]     Open a bash shell (or Django shell) inside the server container
  help               Show this help message

Examples:
  ./docker-host.sh setup
  ./docker-host.sh start
  ./docker-host.sh logs -f
  ./docker-host.sh createsuperuser
EOF
}

case "$1" in
    setup)
        cmd_setup
        ;;
    start)
        cmd_start
        ;;
    build-start)
        cmd_build_start
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart
        ;;
    status)
        cmd_status
        ;;
    logs)
        shift
        cmd_logs "$@"
        ;;
    update)
        cmd_update
        ;;
    createsuperuser)
        cmd_createsuperuser
        ;;
    backup)
        cmd_backup
        ;;
    restore)
        shift
        cmd_restore "$@"
        ;;
    shell)
        shift
        cmd_shell "$@"
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
