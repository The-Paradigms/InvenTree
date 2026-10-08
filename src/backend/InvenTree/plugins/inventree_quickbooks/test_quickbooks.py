"""Comprehensive unit and integration test suite for QuickBooks Online Plugin."""

import base64
import json
import time
import unittest
from unittest import mock

from django.test import RequestFactory

from .client import QuickBooksClient
from .exceptions import (
    QuickBooksApiError,
    QuickBooksAuthError,
    QuickBooksConfigurationError,
    QuickBooksRateLimitError,
)
from .oauth import (
    exchange_code_for_tokens,
    generate_authorization_url,
    get_connection_status,
    get_valid_access_token,
    refresh_tokens,
    revoke_and_disconnect,
)
from .plugin import QuickBooksPlugin
from .security import (
    decrypt_token,
    encrypt_token,
    get_setting_or_env,
)


class MockQuickBooksPlugin:
    """Mock plugin instance providing in-memory setting storage for fast, reliable unit testing."""

    SLUG = 'quickbooks'
    slug = 'quickbooks'
    NAME = 'QuickBooks Online'

    def __init__(self):
        self._settings = {}

    def get_setting(self, key: str, backup_value=None, cache=False):
        return self._settings.get(key, backup_value)

    def set_setting(self, key: str, value, user=None):
        self._settings[key] = str(value) if value is not None else ''


class QuickBooksSecurityTests(unittest.TestCase):
    """Test encryption, decryption, and secure secret resolution."""

    def test_token_encryption_and_decryption(self):
        secret_sample = "eyJhbGciOiJSUzI1NiIsIng1dCI6InRlc3QifQ.sample_qbo_access_token"
        encrypted = encrypt_token(secret_sample)

        self.assertNotEqual(secret_sample, encrypted)
        self.assertTrue(len(encrypted) > 20)

        decrypted = decrypt_token(encrypted)
        self.assertEqual(secret_sample, decrypted)

    def test_empty_token_handling(self):
        self.assertEqual(encrypt_token(""), "")
        self.assertEqual(encrypt_token(None), "")
        self.assertEqual(decrypt_token(""), "")
        self.assertEqual(decrypt_token(None), "")

    def test_invalid_token_decryption_graceful_fail(self):
        result = decrypt_token("not-a-valid-fernet-token")
        self.assertEqual(result, "")

    def test_env_var_precedence_over_settings(self):
        plugin = MockQuickBooksPlugin()
        plugin.set_setting('QBO_CLIENT_ID', 'setting_client_id')

        with mock.patch.dict('os.environ', {'QBO_CLIENT_ID': ''}):
            # When env var is empty, falls back to setting value
            val = get_setting_or_env(plugin, 'QBO_CLIENT_ID')
            self.assertEqual(val, 'setting_client_id')

        # With env var set, env var takes precedence
        with mock.patch.dict('os.environ', {'QBO_CLIENT_ID': 'env_client_id'}):
            val = get_setting_or_env(plugin, 'QBO_CLIENT_ID')
            self.assertEqual(val, 'env_client_id')


class QuickBooksOAuthTests(unittest.TestCase):
    """Test OAuth 2.0 authorization code flow, token exchange, and refresh logic."""

    def setUp(self):
        super().setUp()
        self.env_patcher = mock.patch.dict('os.environ', {
            'QBO_CLIENT_ID': '',
            'QBO_CLIENT_SECRET': '',
            'QBO_ENVIRONMENT': '',
        })
        self.env_patcher.start()
        self.plugin = MockQuickBooksPlugin()
        self.plugin.set_setting('QBO_CLIENT_ID', 'test_client_id_123')
        self.plugin.set_setting('QBO_CLIENT_SECRET', 'test_client_secret_xyz')
        self.plugin.set_setting('QBO_ENVIRONMENT', 'sandbox')

    def tearDown(self):
        self.env_patcher.stop()
        super().tearDown()

    def test_generate_authorization_url(self):
        redirect_uri = 'https://example.com/plugin/quickbooks/callback/'
        auth_url, state = generate_authorization_url(self.plugin, redirect_uri=redirect_uri)

        self.assertIn('https://appcenter.intuit.com/connect/oauth2', auth_url)
        self.assertIn('client_id=test_client_id_123', auth_url)
        self.assertIn('response_type=code', auth_url)
        self.assertIn('scope=com.intuit.quickbooks.accounting', auth_url)
        self.assertIn(f'state={state}', auth_url)
        self.assertTrue(len(state) >= 32)

    def test_generate_authorization_url_missing_client_id(self):
        self.plugin.set_setting('QBO_CLIENT_ID', '')
        with self.assertRaises(QuickBooksConfigurationError):
            generate_authorization_url(self.plugin, redirect_uri='https://example.com/cb')

    @mock.patch('requests.post')
    def test_exchange_code_for_tokens_success(self, mock_post):
        mock_response = mock.MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'access_token': 'mock_access_token_123',
            'refresh_token': 'mock_refresh_token_456',
            'expires_in': 3600,
            'x_refresh_token_expires_in': 8726400,
            'token_type': 'bearer',
        }
        mock_post.return_value = mock_response

        token_data = exchange_code_for_tokens(
            self.plugin,
            code='sample_auth_code',
            redirect_uri='https://example.com/callback/',
            realm_id='1234567890',
        )

        self.assertEqual(token_data['access_token'], 'mock_access_token_123')

        # Verify tokens stored encrypted
        stored_access = decrypt_token(self.plugin.get_setting('QBO_ACCESS_TOKEN'))
        stored_refresh = decrypt_token(self.plugin.get_setting('QBO_REFRESH_TOKEN'))
        stored_realm = self.plugin.get_setting('QBO_REALM_ID')
        stored_expires_at = int(self.plugin.get_setting('QBO_TOKEN_EXPIRES_AT'))

        self.assertEqual(stored_access, 'mock_access_token_123')
        self.assertEqual(stored_refresh, 'mock_refresh_token_456')
        self.assertEqual(stored_realm, '1234567890')
        self.assertTrue(stored_expires_at > int(time.time()))

    @mock.patch('requests.post')
    def test_exchange_code_failure(self, mock_post):
        mock_response = mock.MagicMock()
        mock_response.status_code = 400
        mock_response.json.return_value = {'error': 'invalid_grant', 'error_description': 'Code expired'}
        mock_post.return_value = mock_response

        with self.assertRaises(QuickBooksAuthError) as ctx:
            exchange_code_for_tokens(self.plugin, code='bad_code', redirect_uri='https://example.com/callback/')
        self.assertIn('Code expired', str(ctx.exception))

    @mock.patch('requests.post')
    def test_refresh_tokens_success(self, mock_post):
        # Set existing refresh token
        self.plugin.set_setting('QBO_REFRESH_TOKEN', encrypt_token('old_refresh_token'))

        mock_response = mock.MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'access_token': 'new_rotated_access_token',
            'refresh_token': 'new_rotated_refresh_token',
            'expires_in': 3600,
        }
        mock_post.return_value = mock_response

        new_access = refresh_tokens(self.plugin)
        self.assertEqual(new_access, 'new_rotated_access_token')

        stored_access = decrypt_token(self.plugin.get_setting('QBO_ACCESS_TOKEN'))
        stored_refresh = decrypt_token(self.plugin.get_setting('QBO_REFRESH_TOKEN'))
        self.assertEqual(stored_access, 'new_rotated_access_token')
        self.assertEqual(stored_refresh, 'new_rotated_refresh_token')

    @mock.patch('requests.post')
    def test_proactive_token_refresh_when_near_expiry(self, mock_post):
        # Set token that expires in 60 seconds (buffer is 300 seconds)
        self.plugin.set_setting('QBO_ACCESS_TOKEN', encrypt_token('expiring_access_token'))
        self.plugin.set_setting('QBO_REFRESH_TOKEN', encrypt_token('valid_refresh_token'))
        self.plugin.set_setting('QBO_TOKEN_EXPIRES_AT', str(int(time.time()) + 60))

        mock_response = mock.MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'access_token': 'refreshed_proactive_token',
            'refresh_token': 'rotated_refresh_token',
            'expires_in': 3600,
        }
        mock_post.return_value = mock_response

        token = get_valid_access_token(self.plugin)
        self.assertEqual(token, 'refreshed_proactive_token')
        mock_post.assert_called_once()

    @mock.patch('requests.post')
    def test_revoke_and_disconnect(self, mock_post):
        self.plugin.set_setting('QBO_ACCESS_TOKEN', encrypt_token('access_tok'))
        self.plugin.set_setting('QBO_REFRESH_TOKEN', encrypt_token('refresh_tok'))
        self.plugin.set_setting('QBO_REALM_ID', '1234567890')
        self.plugin.set_setting('QBO_TOKEN_EXPIRES_AT', '123456789')

        revoke_and_disconnect(self.plugin)

        self.assertEqual(self.plugin.get_setting('QBO_ACCESS_TOKEN'), '')
        self.assertEqual(self.plugin.get_setting('QBO_REFRESH_TOKEN'), '')
        self.assertEqual(self.plugin.get_setting('QBO_REALM_ID'), '')
        self.assertEqual(self.plugin.get_setting('QBO_TOKEN_EXPIRES_AT'), '0')


class QuickBooksClientTests(unittest.TestCase):
    """Test QuickBooks API client routing, automatic 401 retry, and error decoding."""

    def setUp(self):
        super().setUp()
        self.env_patcher = mock.patch.dict('os.environ', {
            'QBO_CLIENT_ID': '',
            'QBO_CLIENT_SECRET': '',
            'QBO_ENVIRONMENT': '',
        })
        self.env_patcher.start()
        self.plugin = MockQuickBooksPlugin()
        self.plugin.set_setting('QBO_CLIENT_ID', 'test_client_id')
        self.plugin.set_setting('QBO_CLIENT_SECRET', 'test_client_secret')
        self.plugin.set_setting('QBO_ENVIRONMENT', 'sandbox')
        self.plugin.set_setting('QBO_REALM_ID', '9341452093847')
        self.plugin.set_setting('QBO_ACCESS_TOKEN', encrypt_token('active_token'))
        self.plugin.set_setting('QBO_REFRESH_TOKEN', encrypt_token('active_refresh'))
        self.plugin.set_setting('QBO_TOKEN_EXPIRES_AT', str(int(time.time()) + 3000))

        self.client = QuickBooksClient(self.plugin)

    def tearDown(self):
        self.env_patcher.stop()
        super().tearDown()

    def test_sandbox_base_url(self):
        self.assertEqual(
            self.client.base_url,
            'https://sandbox-quickbooks.api.intuit.com/v3/company/9341452093847'
        )

    def test_production_base_url(self):
        self.plugin.set_setting('QBO_ENVIRONMENT', 'production')
        self.assertEqual(
            self.client.base_url,
            'https://quickbooks.api.intuit.com/v3/company/9341452093847'
        )

    @mock.patch('requests.request')
    def test_get_company_info(self, mock_request):
        mock_response = mock.MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'CompanyInfo': {
                'CompanyName': 'Sandbox Test Company',
                'LegalName': 'Sandbox LLC',
            }
        }
        mock_request.return_value = mock_response

        info = self.client.get_company_info()
        self.assertEqual(info['CompanyName'], 'Sandbox Test Company')
        mock_request.assert_called_with(
            method='GET',
            url='https://sandbox-quickbooks.api.intuit.com/v3/company/9341452093847/companyinfo/9341452093847',
            params=None,
            json=None,
            data=None,
            headers={
                'Authorization': 'Bearer active_token',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            timeout=30,
        )

    @mock.patch('plugins.inventree_quickbooks.client.refresh_tokens')
    @mock.patch('requests.request')
    def test_reactive_401_recovery(self, mock_request, mock_refresh):
        mock_refresh.return_value = 'new_fresh_token'

        resp_401 = mock.MagicMock()
        resp_401.ok = False
        resp_401.status_code = 401
        resp_401.json.return_value = {'Fault': {'Error': [{'Message': 'Token expired'}]}}

        resp_200 = mock.MagicMock()
        resp_200.ok = True
        resp_200.status_code = 200
        resp_200.json.return_value = {'QueryResponse': {'Item': [{'Name': 'Widget'}]}}

        mock_request.side_effect = [resp_401, resp_200]

        items = self.client.get_items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['Name'], 'Widget')
        mock_refresh.assert_called_once()
        self.assertEqual(mock_request.call_count, 2)

    @mock.patch('requests.request')
    def test_error_response_fault_parsing(self, mock_request):
        mock_resp = mock.MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 400
        mock_resp.json.return_value = {
            'Fault': {
                'Error': [
                    {
                        'Message': 'Invalid query syntax',
                        'Detail': 'The element Query contains invalid syntax near FROM',
                        'code': '4001',
                    }
                ],
                'type': 'ValidationFault',
            }
        }
        mock_request.return_value = mock_resp

        with self.assertRaises(QuickBooksApiError) as ctx:
            self.client.query("INVALID SQL")

        err = ctx.exception
        self.assertEqual(err.status_code, 400)
        self.assertEqual(err.error_code, '4001')
        self.assertIn('Invalid query syntax', str(err))

    @mock.patch('requests.request')
    def test_rate_limit_429_handling(self, mock_request):
        mock_resp = mock.MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 429
        mock_resp.headers = {'Retry-After': '60'}
        mock_resp.json.return_value = {'Fault': {'Error': [{'Message': 'Too Many Requests'}]}}
        mock_request.return_value = mock_resp

        with self.assertRaises(QuickBooksRateLimitError) as ctx:
            self.client.get('items')
        self.assertEqual(ctx.exception.retry_after, '60')


class QuickBooksViewsTests(unittest.TestCase):
    """Test OAuth views: connect, callback, status."""

    def setUp(self):
        super().setUp()
        self.factory = RequestFactory()
        self.plugin = MockQuickBooksPlugin()
        self.plugin.set_setting('QBO_CLIENT_ID', 'test_client_id')
        self.plugin.set_setting('QBO_CLIENT_SECRET', 'test_client_secret')
        self.plugin.set_setting('QBO_ENVIRONMENT', 'sandbox')

    @mock.patch('plugins.inventree_quickbooks.views._get_plugin')
    def test_oauth_status_json_response(self, mock_get_plugin):
        from .views import oauth_status

        mock_get_plugin.return_value = self.plugin

        request = self.factory.get('/plugin/quickbooks/status/?format=json')
        admin_user = mock.MagicMock()
        admin_user.is_authenticated = True
        admin_user.is_staff = True
        admin_user.is_superuser = True
        request.user = admin_user

        response = oauth_status(request)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content.decode('utf-8'))
        self.assertIn('connected', data)
        self.assertIn('environment', data)
        self.assertEqual(data['environment'], 'sandbox')
