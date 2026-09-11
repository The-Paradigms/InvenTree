<!-- DELETE THIS FILE AFTER READING -->
# InvenTree — Local Development (Windows)

## Prerequisites (Install These)

| Tool | Minimum Version | Verify |
|------|----------------|--------|
| Python | 3.11+ (3.14 used here) | `python --version` |
| Node.js | 18+ | `node --version` |
| Yarn | 1.22+ | `yarn --version` |
| Git | any | `git --version` |
| virtualenv | any | `pip install virtualenv` |

## One-Time Setup

```powershell
# 1. Clone
git clone https://github.com/inventree/InvenTree.git
cd InvenTree

# 2. Create venv
python -m venv env
.\env\Scripts\activate

# 3. Install backend deps
invoke install --dev

# 4. Run migrations
invoke migrate

# 5. Collect static files
invoke static

# 6. Create superuser
invoke superuser

# 7. Install frontend deps
cd src/frontend
yarn install
cd ../..

# 8. Install pre-commit hooks
prek install
```

If `invoke` fails on Windows, the `tasks.py` requires the fixes below first.

## Start Dev Servers (Two Terminals)

**Terminal 1 — Backend:**
```powershell
cd InvenTree
.\env\Scripts\activate
invoke dev.server
# Runs on http://localhost:8000
```

**Terminal 2 — Frontend:**
```powershell
cd InvenTree/src/frontend
yarn run dev --host
# Runs on http://localhost:5173
```

Open **http://localhost:5173** in your browser. The frontend proxies API requests to port 8000.

## config.yaml

Located at `config/config.yaml`. Minimal working dev config:

```yaml
debug: True
allowed_hosts:
  - '*'
site_url: 'http://localhost:8000'
database:
  engine: sqlite3
  name: db/data.sqlite3
media_root: data/media
static_root: data/static
backup_dir: data/backups
plugin_dir: data/plugins
```

## Windows-Specific Fixes Applied

### 1. `tasks.py` — python3/pip3 don't exist on Windows

`tasks.py` hardcodes `python3` and `pip3` which don't exist on Windows.
Fixed by adding platform-aware helpers:

```python
def get_python_bin():
    return sys.executable if sys.platform == 'win32' else 'python3'

def get_pip_bin():
    return f'{sys.executable} -m pip' if sys.platform == 'win32' else 'pip3'
```

All `python3` / `pip3` calls in `manage()`, `run_install()` replaced with these helpers.

### 2. `tasks.py` — node_available() fails on Windows

`subprocess.check_output([cmd], shell=True)` doesn't work on Windows when `cmd` is a string like `"node --version"`. The entire string is passed as the command name.

Fixed by splitting the string and using `shell=True` so the shell resolves `.ps1`/`.cmd` wrappers (needed for `yarn.ps1`):

```python
def check(cmd_parts):
    parts = cmd_parts.split()
    return subprocess.check_output(parts, stderr=subprocess.STDOUT, shell=True).strip()
```

### 3. `tasks.py` — rm/find shell commands don't work on Windows

`run(c, 'find src -name "*.pyc" -exec rm -f {} +')` only works on Unix.

Fixed by replacing with Python `Path.rglob()` / `shutil.rmtree()`.

### 4. `report/models.py` — WeasyPrint crashes on Windows

WeasyPrint requires `libgobject-2.0-0` (GTK). Not available on Windows.
Django startup would `sys.exit(1)` when importing it.

Fixed to degrade gracefully — reports/labels simply won't work, but everything else runs.

### 5. `users/models.py` — "User has no profile" on login

The `post_save` signal calls `instance.profile.save()` unconditionally.
When `update_last_login` fires on login (`created=False`), it crashes if no
profile existed before the user was saved.

Fixed by wrapping in try/except and creating the profile on first miss.

### 6. `plugin/builtin/labels/label_sheet.py` — WeasyPrint import

Same WeasyPrint issue as #4, but in a builtin plugin. Wrapped in try/except.

## Known Limitations

- **PDF reports / labels** — WeasyPrint doesn't work on Windows without GTK. Use WSL or skip.
- **Background worker** — `invoke worker` runs `django-q` cluster. Not blocked by any Windows issue.
- **invoke warning** — `INVE-W9 - Wrong Invoke Environment` will still show because invoke detects the call path. It's harmless.

## Common invoke commands

```
invoke version              # Show environment info
invoke migrate              # Run DB migrations
invoke static               # Collect static files
invoke superuser            # Create admin user
invoke backend-trans        # Compile translations
invoke dev.server           # Start backend (Django dev server)
invoke dev.frontend-server  # Start frontend (Vite dev server)
invoke worker               # Start background task worker
invoke dev.test             # Run tests
```
