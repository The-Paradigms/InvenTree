"""OAuth 2.0 flow implementation for QuickBooks Online.

Supports:
- Authorization Code grant flow against Intuit AppCenter
- Token exchange and at-rest Fernet encryption
- Automatic thread-safe token refresh with distributed cache locks
- Token revocation for clean disconnection
"""

import base64
import secrets
import time
import urllib.parse
from typing import Any, Optional

import requests
from django.core.cache import cache
from django.urls import reverse

import structlog

from .exceptions import (
    QuickBooksAuthError,
    QuickBooksConfigurationError,
)
from .security import (
    decrypt_token,
    encrypt_token,
    get_setting_or_env,
)

logger = structlog.get_logger('inventree.quickbooks')

# QuickBooks OAuth 2.0 Endpoints
INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

DEFAULT_SCOPE = 'com.intuit.quickbooks.accounting'
TOKEN_EXPIRY_BUFFER_SECONDS = 300  # Refresh if within 5 minutes of expiring
CACHE_LOCK_KEY = 'qbo_token_refresh_lock'
CACHE_LOCK_TIMEOUT = 30  # seconds


def get_client_id(plugin: Any) -> str:
    """Retrieve QuickBooks Client ID."""
    client_id = get_setting_or_env(plugin, 'QBO_CLIENT_ID')
    if not client_id:
        raise QuickBooksConfigurationError("QuickBooks Client ID is not configured.")
    return str(client_id).strip()


def get_client_secret(plugin: Any) -> str:
    """Retrieve QuickBooks Client Secret."""
    client_secret = get_setting_or_env(plugin, 'QBO_CLIENT_SECRET')
    if not client_secret:
        raise QuickBooksConfigurationError("QuickBooks Client Secret is not configured.")
    return str(client_secret).strip()


def get_environment(plugin: Any) -> str:
    """Retrieve QuickBooks environment ('sandbox' or 'production')."""
    env = get_setting_or_env(plugin, 'QBO_ENVIRONMENT', default='sandbox')
    return str(env).lower().strip()


def get_redirect_uri(plugin: Any, request: Optional[Any] = None) -> str:
    """Determine redirect URI from settings, env, or current request context."""
    explicit_uri = get_setting_or_env(plugin, 'QBO_REDIRECT_URI')
    if explicit_uri:
        return str(explicit_uri).strip()

    if request:
        try:
            return request.build_absolute_uri(reverse('plugin:quickbooks:oauth-callback'))
        except Exception:
            pass

    return ''


def get_basic_auth_header(client_id: str, client_secret: str) -> str:
    """Generate HTTP Basic Auth header for Intuit token endpoints."""
    raw = f'{client_id}:{client_secret}'.encode('utf-8')
    return f'Basic {base64.b64encode(raw).decode("ascii")}'


def generate_authorization_url(plugin: Any, redirect_uri: str, state: Optional[str] = None) -> tuple[str, str]:
    """Generate the Intuit AppCenter OAuth 2.0 authorization URL.

    Returns:
        tuple (auth_url, state)
    """
    client_id = get_client_id(plugin)
    if not redirect_uri:
        raise QuickBooksConfigurationError("Redirect URI is required to generate authorization URL.")

    if not state:
        state = secrets.token_urlsafe(32)

    params = {
        'client_id': client_id,
        'response_type': 'code',
        'scope': DEFAULT_SCOPE,
        'redirect_uri': redirect_uri,
        'state': state,
    }

    auth_url = f'{INTUIT_AUTH_URL}?{urllib.parse.urlencode(params)}'
    return auth_url, state


def exchange_code_for_tokens(
    plugin: Any,
    code: str,
    redirect_uri: str,
    realm_id: Optional[str] = None,
) -> dict:
    """Exchange authorization code for access and refresh tokens.

    Encrypts and persists the tokens into PluginSetting.
    """
    client_id = get_client_id(plugin)
    client_secret = get_client_secret(plugin)

    headers = {
        'Authorization': get_basic_auth_header(client_id, client_secret),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
    }

    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri,
    }

    logger.info("Exchanging OAuth code with Intuit token endpoint...")
    try:
        response = requests.post(INTUIT_TOKEN_URL, headers=headers, data=data, timeout=30)
    except requests.RequestException as e:
        raise QuickBooksAuthError(f"Connection failed during token exchange: {e}") from e

    if response.status_code != 200:
        error_json = {}
        try:
            error_json = response.json()
        except Exception:
            pass
        msg = (
            error_json.get('error_description')
            or error_json.get('error')
            or error_json.get('message')
            or response.text
            or f'HTTP {response.status_code}'
        )
        logger.error("Intuit token exchange failed (HTTP %d): %s", response.status_code, msg)
        raise QuickBooksAuthError(f"Token exchange failed (HTTP {response.status_code}): {msg}", error_details=error_json, status_code=response.status_code)

    token_data = response.json()
    _save_token_data(plugin, token_data, realm_id=realm_id)
    return token_data


def refresh_tokens(plugin: Any) -> str:
    """Refresh the access token using the stored refresh token.

    Employs a distributed lock via Django cache to prevent concurrent race conditions
    when multiple worker processes attempt to refresh simultaneously.
    """
    lock_acquired = cache.add(CACHE_LOCK_KEY, 'locked', timeout=CACHE_LOCK_TIMEOUT)
    if not lock_acquired:
        logger.info("Another process is currently refreshing QuickBooks token, waiting for result...")
        # Poll up to 5 seconds for other worker to finish refresh
        for _ in range(10):
            time.sleep(0.5)
            if not cache.get(CACHE_LOCK_KEY):
                current_token = decrypt_token(plugin.get_setting('QBO_ACCESS_TOKEN'))
                if current_token:
                    return current_token
        logger.warning("Lock wait timed out, proceeding to refresh anyway.")

    try:
        raw_refresh_token = plugin.get_setting('QBO_REFRESH_TOKEN')
        refresh_token = decrypt_token(raw_refresh_token)
        if not refresh_token:
            raise QuickBooksAuthError("No refresh token available to refresh access token.")

        client_id = get_client_id(plugin)
        client_secret = get_client_secret(plugin)

        headers = {
            'Authorization': get_basic_auth_header(client_id, client_secret),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        }

        data = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
        }

        logger.info("Refreshing QuickBooks access token...")
        try:
            response = requests.post(INTUIT_TOKEN_URL, headers=headers, data=data, timeout=30)
        except requests.RequestException as e:
            raise QuickBooksAuthError(f"Connection failed during token refresh: {e}") from e

        if response.status_code != 200:
            error_json = {}
            try:
                error_json = response.json()
            except Exception:
                pass
            msg = (
                error_json.get('error_description')
                or error_json.get('error')
                or error_json.get('message')
                or response.text
                or f'HTTP {response.status_code}'
            )
            logger.error("Intuit token refresh failed (HTTP %d): %s", response.status_code, msg)
            raise QuickBooksAuthError(f"Token refresh failed (HTTP {response.status_code}): {msg}", error_details=error_json, status_code=response.status_code)

        token_data = response.json()
        _save_token_data(plugin, token_data)
        return token_data['access_token']
    finally:
        cache.delete(CACHE_LOCK_KEY)


def _save_token_data(plugin: Any, token_data: dict, realm_id: Optional[str] = None) -> None:
    """Encrypt and save token payload to PluginSetting."""
    access_token = token_data.get('access_token', '')
    refresh_token = token_data.get('refresh_token', '')
    expires_in = int(token_data.get('expires_in', 3600))
    expires_at = int(time.time()) + expires_in

    plugin.set_setting('QBO_ACCESS_TOKEN', encrypt_token(access_token))
    if refresh_token:
        plugin.set_setting('QBO_REFRESH_TOKEN', encrypt_token(refresh_token))

    plugin.set_setting('QBO_TOKEN_EXPIRES_AT', str(expires_at))

    if realm_id:
        plugin.set_setting('QBO_REALM_ID', str(realm_id).strip())

    logger.info("QuickBooks tokens saved and encrypted successfully. Expires in %d seconds.", expires_in)


def get_valid_access_token(plugin: Any) -> str:
    """Retrieve a valid, unexpired access token.

    Automatically refreshes if expired or within buffer window.
    """
    raw_access_token = plugin.get_setting('QBO_ACCESS_TOKEN')
    access_token = decrypt_token(raw_access_token)

    try:
        expires_at = int(plugin.get_setting('QBO_TOKEN_EXPIRES_AT', backup_value='0'))
    except (ValueError, TypeError):
        expires_at = 0

    now = int(time.time())
    is_expiring = (expires_at - now) <= TOKEN_EXPIRY_BUFFER_SECONDS

    if not access_token or is_expiring:
        logger.info("Access token missing or expiring soon (expires_at: %d, now: %d). Refreshing...", expires_at, now)
        return refresh_tokens(plugin)

    return access_token


def revoke_and_disconnect(plugin: Any) -> bool:
    """Revoke tokens with Intuit and clear local credentials."""
    raw_refresh = plugin.get_setting('QBO_REFRESH_TOKEN')
    refresh_token = decrypt_token(raw_refresh)

    if refresh_token:
        try:
            client_id = get_client_id(plugin)
            client_secret = get_client_secret(plugin)
            headers = {
                'Authorization': get_basic_auth_header(client_id, client_secret),
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
            data = {'token': refresh_token}
            requests.post(INTUIT_REVOKE_URL, headers=headers, json=data, timeout=15)
        except Exception as e:
            logger.warning("Error calling Intuit revoke endpoint: %s", e)

    # Clear stored settings
    plugin.set_setting('QBO_ACCESS_TOKEN', '')
    plugin.set_setting('QBO_REFRESH_TOKEN', '')
    plugin.set_setting('QBO_REALM_ID', '')
    plugin.set_setting('QBO_TOKEN_EXPIRES_AT', '0')
    logger.info("QuickBooks credentials cleared successfully.")
    return True


def get_connection_status(plugin: Any) -> dict:
    """Return status summary of the QuickBooks connection without exposing raw tokens."""
    realm_id = plugin.get_setting('QBO_REALM_ID', backup_value='')
    raw_access_token = plugin.get_setting('QBO_ACCESS_TOKEN', backup_value='')
    raw_refresh_token = plugin.get_setting('QBO_REFRESH_TOKEN', backup_value='')

    has_tokens = bool(raw_access_token) and bool(raw_refresh_token)

    try:
        expires_at = int(plugin.get_setting('QBO_TOKEN_EXPIRES_AT', backup_value='0'))
    except (ValueError, TypeError):
        expires_at = 0

    now = int(time.time())
    seconds_remaining = max(0, expires_at - now) if expires_at > 0 else 0
    is_expired = (expires_at <= now) if expires_at > 0 else True

    # Check client credentials
    client_id_configured = bool(get_setting_or_env(plugin, 'QBO_CLIENT_ID'))
    client_secret_configured = bool(get_setting_or_env(plugin, 'QBO_CLIENT_SECRET'))

    return {
        'connected': has_tokens and bool(realm_id),
        'realm_id': realm_id,
        'environment': get_environment(plugin),
        'client_id_configured': client_id_configured,
        'client_secret_configured': client_secret_configured,
        'expires_at_timestamp': expires_at,
        'seconds_until_expiry': seconds_remaining,
        'is_token_expired': is_expired,
    }
