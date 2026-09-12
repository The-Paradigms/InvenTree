# InvenTree Self-Hosting with Docker

This guide provides step-by-step instructions for hosting **InvenTree** (customized as **TPI Inventory**) using Docker on any Linux machine (VPS, cloud instance, dedicated server, or local server).

---

## 1. System Architecture

The Docker deployment consists of 5 coordinated services:

```
[ Incoming HTTP / HTTPS Traffic ]
               │
               ▼
   ┌───────────────────────┐
   │    inventree-proxy    │  (Caddy Reverse Proxy, Port 80 & 443)
   │  Automatic SSL / TLS  │
   └───────────┬───────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
  Static/Media    inventree-server  (Gunicorn App Server, Port 8000)
  Direct Files         │
                       ├─────────────────────┐
                       ▼                     ▼
               inventree-db           inventree-cache
               (PostgreSQL 17)        (Redis 7-alpine)
                       ▲                     ▲
                       │                     │
                       └──────┬──────────────┘
                              │
                      inventree-worker (Django-Q Background Worker)
```

- **inventree-proxy**: Caddy reverse proxy serving static and media assets directly and terminating SSL/TLS automatically.
- **inventree-server**: InvenTree web application running under Gunicorn.
- **inventree-worker**: Background worker running scheduled tasks, email notifications, reports, and imports.
- **inventree-db**: PostgreSQL 17 relational database.
- **inventree-cache**: Redis 7 cache manager and task queue.
- **Data Persistence**: All persistent data (database files, media uploads, static cache, config, logs) is stored in `./inventree-data` on the host machine.

---

## 2. Server Requirements

- **Operating System**: Ubuntu 22.04 / 24.04 LTS, Debian 12, Rocky Linux, or any modern Linux distribution with Docker support.
- **CPU**: 2 cores minimum (4 cores recommended for active teams).
- **RAM**: 2 GB minimum (4 GB recommended).
- **Disk**: 20 GB+ free storage (depends on your uploaded media/attachments).
- **Firewall Ports**:
  - `80/tcp` (HTTP)
  - `443/tcp` (HTTPS)
  - `22/tcp` (SSH management)

---

## 3. Machine Preparation

On the new hosting machine, ensure **Docker** and **Docker Compose** are installed:

### Install Docker Engine & Docker Compose (Ubuntu / Debian)

```bash
# Update package index and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker packages
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable Docker service and add your user to docker group
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```
*(Log out and back in if running without sudo).*

---

## 4. Quick Deployment Steps

### Step 1: Clone or Copy Repository

```bash
git clone https://github.com/The-Paradigms/InvenTree.git
cd InvenTree
```

### Step 2: Initialize Configuration

Run the helper setup command:

```bash
./docker-host.sh setup
```

This creates your `.env` file from `.env.example` and ensures storage directories are ready.

### Step 3: Configure `.env`

Edit the `.env` file with your favorite editor (`nano .env`):

1. **Set your Site URL**:
   - For direct IP access:
     ```env
     INVENTREE_SITE_URL="http://YOUR_SERVER_IP"
     ```
   - For domain name with automatic HTTPS:
     ```env
     INVENTREE_SITE_URL="https://inventory.yourcompany.com"
     ```
2. **Set secure passwords**:
   ```env
   INVENTREE_DB_PASSWORD="your_strong_postgres_password"
   INVENTREE_ADMIN_PASSWORD="your_strong_admin_password"
   INVENTREE_ADMIN_USER="admin"
   INVENTREE_ADMIN_EMAIL="admin@yourcompany.com"
   ```
3. **Instance Branding**:
   ```env
   INVENTREE_INSTANCE="TPI Inventory"
   ```

### Step 4: Launch InvenTree

#### Option A: Run with Pre-Built Official Images (Fastest)

```bash
./docker-host.sh start
# or: docker compose up -d
```

#### Option B: Build Custom Image from Local Fork (Recommended for Fork Customizations)

If you want your fork's custom code and local modifications compiled directly into the image:

```bash
./docker-host.sh build-start
# or: docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Step 5: Verify Deployment

Check container status:

```bash
./docker-host.sh status
```

You should see 5 healthy/running containers:
- `inventree-db` (healthy)
- `inventree-cache` (healthy)
- `inventree-server` (running)
- `inventree-worker` (running)
- `inventree-proxy` (running)

Access InvenTree in your browser at `http://YOUR_SERVER_IP` or `https://inventory.yourcompany.com`.

Log in with:
- **Username**: `admin` (or what you specified in `INVENTREE_ADMIN_USER`)
- **Password**: Your password from `INVENTREE_ADMIN_PASSWORD`

---

## 5. Management & Operations Helper (`./docker-host.sh`)

The repository includes a management utility `./docker-host.sh`:

| Command | Description |
|---|---|
| `./docker-host.sh start` | Start all services in the background |
| `./docker-host.sh build-start` | Build image from local repo source and start |
| `./docker-host.sh stop` | Stop all containers |
| `./docker-host.sh restart` | Restart all containers |
| `./docker-host.sh status` | View status and health of all containers |
| `./docker-host.sh logs` | Follow all logs (or specify service: `logs inventree-server`) |
| `./docker-host.sh update` | Run database migrations and static updates |
| `./docker-host.sh createsuperuser` | Interactively create an admin superuser |
| `./docker-host.sh backup` | Create full database and media backup |
| `./docker-host.sh restore <file>` | Restore database from backup file |
| `./docker-host.sh shell` | Open bash shell inside InvenTree server container |
| `./docker-host.sh shell django` | Open interactive Django Python shell |

---

## 6. Automatic SSL / TLS (Custom Domain)

If you have a domain name (e.g. `inventory.example.com`):
1. Point your domain's DNS `A` record to your server's public IP address.
2. In `.env`, set:
   ```env
   INVENTREE_SITE_URL="https://inventory.example.com"
   ```
3. Restart the services:
   ```bash
   ./docker-host.sh restart
   ```
4. **Caddy** will automatically obtain and renew free Let's Encrypt / ZeroSSL certificates!

---

## 7. Backups and Maintenance

### Creating Backups

Run:
```bash
./docker-host.sh backup
```
The backup archive will be written to `./inventree-data/backup/`.

### Restoring Backups

```bash
./docker-host.sh restore /home/inventree/data/backup/your_backup_file.tar.gz
```

### Upgrading / Syncing Future Updates

When you sync new changes from the repository:
```bash
git pull origin master
./docker-host.sh build-start
./docker-host.sh update
```
