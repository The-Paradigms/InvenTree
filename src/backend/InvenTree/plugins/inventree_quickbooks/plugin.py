"""InvenTree QuickBooks Online Integration Plugin."""

from django.utils.translation import gettext_lazy as _

from plugin import InvenTreePlugin
from plugin.mixins import SettingsMixin, UrlsMixin

from .client import QuickBooksClient


class QuickBooksPlugin(UrlsMixin, SettingsMixin, InvenTreePlugin):
    """Integration plugin connecting InvenTree to QuickBooks Online accounting services.

    Supports OAuth 2.0 authorization code flow against QuickBooks sandbox and production APIs,
    secure at-rest token encryption, proactive/reactive token refreshing, and API helper client.
    """

    NAME = 'QuickBooks Online'
    SLUG = 'quickbooks'
    TITLE = 'QuickBooks Online Integration'
    DESCRIPTION = 'Integrate InvenTree with QuickBooks Online (OAuth 2.0, Sandbox & Production)'
    VERSION = '1.0.0'
    AUTHOR = 'InvenTree'
    SETTINGS_URL = '/plugin/quickbooks/status/'

    SETTINGS = {
        'QBO_CLIENT_ID': {
            'name': _('Client ID'),
            'description': _('Intuit Developer App Client ID (or set QBO_CLIENT_ID environment variable)'),
            'protected': True,
        },
        'QBO_CLIENT_SECRET': {
            'name': _('Client Secret'),
            'description': _('Intuit Developer App Client Secret (or set QBO_CLIENT_SECRET environment variable)'),
            'protected': True,
        },
        'QBO_ENVIRONMENT': {
            'name': _('Environment'),
            'description': _('QuickBooks API Environment'),
            'choices': [('sandbox', 'Sandbox'), ('production', 'Production')],
            'default': 'sandbox',
        },
        'QBO_REDIRECT_URI': {
            'name': _('Redirect URI'),
            'description': _('Explicit OAuth redirect URI (leave empty to auto-detect from host)'),
            'default': '',
        },
        'QBO_REALM_ID': {
            'name': _('QuickBooks Company / Realm ID'),
            'description': _('QuickBooks Company ID (populated automatically during OAuth authorization)'),
            'default': '',
        },
        'QBO_ACCESS_TOKEN': {
            'name': _('Access Token'),
            'description': _('Encrypted OAuth 2.0 Access Token'),
            'protected': True,
            'hidden': True,
        },
        'QBO_REFRESH_TOKEN': {
            'name': _('Refresh Token'),
            'description': _('Encrypted OAuth 2.0 Refresh Token'),
            'protected': True,
            'hidden': True,
        },
        'QBO_TOKEN_EXPIRES_AT': {
            'name': _('Token Expiration'),
            'description': _('Epoch timestamp when current access token expires'),
            'default': '0',
            'hidden': True,
        },
    }

    def setup_urls(self):
        """Setup OAuth and management endpoints for QuickBooks plugin."""
        from .urls import urlpatterns
        return urlpatterns

    @property
    def client(self) -> QuickBooksClient:
        """Return an authenticated QuickBooksClient instance."""
        return QuickBooksClient(self)
