# InvenTree QuickBooks Online Integration

This plugin connects **InvenTree** to **QuickBooks Online (QBO)** sandbox and production environments using the OAuth 2.0 `authorization_code` grant flow.

---

## Features

- **OAuth 2.0 Authorization Code Flow**: Handles authorization against Intuit AppCenter, code exchange, and token rotation.
- **Secure Secret Handling (12-Factor)**: Supports environment variables (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, etc.) with fallback to protected InvenTree plugin settings.
- **At-Rest Token Encryption**: Sensitive access and refresh tokens are encrypted in the database using **Fernet symmetric encryption** derived from `QBO_ENCRYPTION_KEY` or Django's `SECRET_KEY`.
- **Proactive & Reactive Token Refresh**: Automatically refreshes access tokens before expiration (5-minute buffer), with automatic 401 recovery and distributed lock protection against race conditions in multi-worker environments.
- **QuickBooks API Client**: High-level wrapper with dynamic Sandbox/Production URL resolution, QQL query execution, and Intuit Fault/Error parsing into structured Python exceptions.
- **Built-in Dashboard & Health Checks**: Web and JSON endpoints (`/plugin/quickbooks/status/`) with one-click sandbox connectivity verification.

---

## 1. Intuit Developer App Setup

1. Log in to [Intuit Developer Portal](https://developer.intuit.com/).
2. Create an App under **Accounting** and open your Sandbox environment keys.
3. Under **Keys & OAuth**:
   - Copy your **Client ID** and **Client Secret**.
   - Add your Redirect URI under **Redirect URIs**:
     ```
     http://localhost:8000/plugin/quickbooks/callback/
     ```
     *(Replace `http://localhost:8000` with your actual domain or external host if running remotely).*

---

## 2. Configuration & Environment Variables

You can supply configuration via environment variables (recommended for security) or through the InvenTree Plugin Settings UI.

### Environment Variables
| Variable | Description | Default |
| :--- | :--- | :--- |
| `INVENTREE_PLUGINS_ENABLED` | Enable InvenTree plugin subsystem | `True` |
| `QBO_CLIENT_ID` | QuickBooks App Client ID | *(from plugin settings)* |
| `QBO_CLIENT_SECRET` | QuickBooks App Client Secret | *(from plugin settings)* |
| `QBO_ENVIRONMENT` | API target (`sandbox` or `production`) | `sandbox` |
| `QBO_REDIRECT_URI` | Explicit OAuth redirect URL | *(auto-detected from request)* |
| `QBO_ENCRYPTION_KEY` | Dedicated 32-byte Fernet key for token encryption | *(derived from Django `SECRET_KEY`)* |

### InvenTree Global Setting
Ensure plugin URLs are enabled in InvenTree:
```bash
# In your .env or shell
INVENTREE_PLUGINS_ENABLED=True
```
And inside InvenTree global settings, verify `ENABLE_PLUGINS_URL` is enabled (true by default when plugins are active).

---

## 3. Endpoints & Usage

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/plugin/quickbooks/status/` | `GET` | View connection dashboard, Realm ID, token expiration, or JSON status (`?format=json`). |
| `/plugin/quickbooks/status/?test=true` | `GET` | Tests live sandbox communication by requesting `CompanyInfo` from QuickBooks. |
| `/plugin/quickbooks/connect/` | `GET` | Initiates OAuth 2.0 flow; generates secure state and redirects to Intuit. |
| `/plugin/quickbooks/callback/` | `GET` | Intuit callback handler; exchanges code for tokens and encrypts credentials. |
| `/plugin/quickbooks/disconnect/` | `GET` | Revokes tokens with Intuit and purges stored credentials from InvenTree. |

---

## 4. Using the QuickBooks Client in Python

You can interact with QuickBooks anywhere in InvenTree (tasks, background jobs, models):

```python
from plugin.registry import registry
from plugins.inventree_quickbooks.client import QuickBooksClient

# 1. Retrieve the plugin
plugin = registry.get_plugin('quickbooks')

# 2. Access the pre-configured authenticated client
client = plugin.client

# 3. Check Company Info (Sandbox)
company = client.get_company_info()
print("Connected to:", company.get('CompanyName'))

# 4. Query Items (Parts / Services)
items = client.get_items(max_results=10)
for item in items:
    print(f"Item: {item['Name']} - Unit Price: {item.get('UnitPrice', 0)}")

# 5. Query Suppliers / Vendors
vendors = client.get_vendors(max_results=10)
for vendor in vendors:
    print(f"Vendor: {vendor['DisplayName']}")

# 6. Run Custom QuickBooks Queries (QQL)
results = client.query("SELECT * FROM PurchaseOrder MAXRESULTS 5")
```

---

## 5. Running the Tests

To run the unit test suite:

```bash
INVENTREE_PLUGINS_ENABLED=True .venv/bin/python -c "import os, sys, django; sys.path.insert(0, 'src/backend/InvenTree'); os.environ['DJANGO_SETTINGS_MODULE']='InvenTree.settings'; django.setup(); import unittest; unittest.main(module='plugins.inventree_quickbooks.test_quickbooks', argv=['unittest', '-v'])"
```
