"""Security and encryption utilities for QuickBooks Online integration.

Provides at-rest encryption for sensitive OAuth tokens using Fernet symmetric encryption.
Keys are resolved with the following priority:
1. QBO_ENCRYPTION_KEY environment variable.
2. Cryptographically derived key from Django's SECRET_KEY via PBKDF2HMAC.
"""

import base64
import os
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.conf import settings

import structlog

# Attempt to load .env from repository root if dotenv is available
try:
    from dotenv import load_dotenv
    from InvenTree.config import get_root_dir

    env_path = get_root_dir() / '.env'
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()
except Exception:
    pass

logger = structlog.get_logger('inventree.quickbooks')

# Fixed salt for PBKDF2 key derivation from Django SECRET_KEY
_PBKDF2_SALT = b'inventree_qbo_oauth_key_salt_v1'


def _get_fernet_instance() -> Fernet:
    """Generate or retrieve Fernet instance for token encryption/decryption."""
    custom_key = os.environ.get('QBO_ENCRYPTION_KEY')
    if custom_key:
        try:
            return Fernet(custom_key.strip().encode('utf-8'))
        except Exception as e:
            logger.warning("Invalid QBO_ENCRYPTION_KEY provided, falling back to SECRET_KEY derivation: %s", e)

    # Derive 32-byte URL-safe base64 key from Django SECRET_KEY
    secret = getattr(settings, 'SECRET_KEY', 'default-inventree-secret-key').encode('utf-8')
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_PBKDF2_SALT,
        iterations=100_000,
    )
    derived_key = base64.urlsafe_b64encode(kdf.derive(secret))
    return Fernet(derived_key)


def encrypt_token(plaintext: Optional[str]) -> str:
    """Encrypt a plaintext token string.

    Returns an encrypted string or empty string if input is empty.
    """
    if not plaintext:
        return ''
    try:
        fernet = _get_fernet_instance()
        return fernet.encrypt(plaintext.encode('utf-8')).decode('utf-8')
    except Exception as e:
        logger.exception("Failed to encrypt QuickBooks token: %s", e)
        raise


def decrypt_token(ciphertext: Optional[str]) -> str:
    """Decrypt an encrypted token string.

    Returns the decrypted plaintext or empty string if input is empty.
    """
    if not ciphertext:
        return ''
    try:
        fernet = _get_fernet_instance()
        return fernet.decrypt(ciphertext.encode('utf-8')).decode('utf-8')
    except InvalidToken:
        logger.error("Failed to decrypt QuickBooks token: Invalid encryption token or altered key.")
        return ''
    except Exception as e:
        logger.exception("Unexpected error decrypting QuickBooks token: %s", e)
        return ''


def get_setting_or_env(plugin: Any, setting_key: str, env_vars: Optional[list[str]] = None, default: Any = None) -> Any:
    """Retrieve configuration value with environment variables taking precedence over plugin settings.

    Args:
        plugin: QuickBooksPlugin instance
        setting_key: InvenTree plugin setting key (e.g. 'QBO_CLIENT_ID')
        env_vars: Optional list of environment variable names to inspect.
                  Defaults to ['QBO_<KEY>', 'INVENTREE_PLUGIN_QUICKBOOKS_<KEY>'].
        default: Default value if not set in either env or settings.
    """
    if env_vars is None:
        key_suffix = setting_key.removeprefix('QBO_')
        env_vars = [
            f'QBO_{key_suffix}',
            f'INVENTREE_PLUGIN_QUICKBOOKS_{key_suffix}',
            setting_key,
        ]

    for env_var in env_vars:
        val = os.environ.get(env_var)
        if val is not None and val != '':
            return val

    # Fallback to InvenTree PluginSetting
    try:
        setting_val = plugin.get_setting(setting_key)
        if setting_val is not None and setting_val != '':
            return setting_val
    except Exception:
        pass

    return default
