"""QuickBooks Online API Client.

Wraps calls to Intuit Accounting REST API (Sandbox and Production).
Provides:
- Dynamic Sandbox / Production base URL routing
- Automatic token injection and proactive/reactive token refresh
- Automatic 401 recovery
- Intuit Fault / Error payload parsing into Python exceptions
- Rate limit handling (HTTP 429)
"""

import time
from typing import Any, Optional

import requests

import structlog

from .exceptions import (
    QuickBooksApiError,
    QuickBooksAuthError,
    QuickBooksConfigurationError,
    QuickBooksRateLimitError,
)
from .oauth import (
    get_environment,
    get_valid_access_token,
    refresh_tokens,
)

logger = structlog.get_logger('inventree.quickbooks')

SANDBOX_BASE_URL = 'https://sandbox-quickbooks.api.intuit.com/v3/company'
PRODUCTION_BASE_URL = 'https://quickbooks.api.intuit.com/v3/company'


class QuickBooksClient:
    """Client for making authenticated calls to QuickBooks Online Accounting API."""

    def __init__(self, plugin: Any):
        self.plugin = plugin

    @property
    def environment(self) -> str:
        return get_environment(self.plugin)

    @property
    def realm_id(self) -> str:
        realm_id = self.plugin.get_setting('QBO_REALM_ID')
        if not realm_id:
            raise QuickBooksConfigurationError("QuickBooks Realm ID (Company ID) is not set. Please authenticate first.")
        return str(realm_id).strip()

    @property
    def base_url(self) -> str:
        base = PRODUCTION_BASE_URL if self.environment == 'production' else SANDBOX_BASE_URL
        return f'{base}/{self.realm_id}'

    def _parse_error_response(self, response: requests.Response) -> QuickBooksApiError:
        """Parse Intuit XML/JSON Fault error structure into QuickBooksApiError."""
        status_code = response.status_code
        error_msg = f"QuickBooks API request failed with status {status_code}"
        error_code = None
        error_detail = None
        resp_data = {}

        try:
            resp_data = response.json()
            if 'Fault' in resp_data:
                fault = resp_data['Fault']
                errors = fault.get('Error', [])
                if errors and isinstance(errors, list):
                    first_err = errors[0]
                    error_msg = first_err.get('Message', error_msg)
                    error_detail = first_err.get('Detail')
                    error_code = first_err.get('code')
        except Exception:
            resp_data = {'raw_text': response.text}

        if status_code == 429:
            retry_after = response.headers.get('Retry-After')
            return QuickBooksRateLimitError(
                message=error_msg,
                retry_after=retry_after,
                error_code=error_code,
                error_detail=error_detail,
                response_data=resp_data,
            )

        if status_code == 401:
            return QuickBooksAuthError(
                message=f"Unauthorized: {error_msg}",
                error_details=resp_data,
                status_code=401,
            )

        return QuickBooksApiError(
            message=error_msg,
            status_code=status_code,
            error_code=error_code,
            error_detail=error_detail,
            response_data=resp_data,
        )

    def request(
        self,
        method: str,
        endpoint: str,
        params: Optional[dict] = None,
        json_data: Optional[dict] = None,
        data: Optional[Any] = None,
        retry_401: bool = True,
        timeout: int = 30,
        **kwargs,
    ) -> dict:
        """Execute an authenticated request against QuickBooks Online API.

        Handles proactive token validation, reactive 401 re-authorization, and error decoding.
        """
        access_token = get_valid_access_token(self.plugin)

        clean_endpoint = endpoint.lstrip('/')
        url = f'{self.base_url}/{clean_endpoint}'

        headers = {
            'Authorization': f'Bearer {access_token}',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }
        if 'headers' in kwargs:
            headers.update(kwargs.pop('headers'))

        logger.debug("Executing QBO %s to %s", method.upper(), url)

        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                params=params,
                json=json_data,
                data=data,
                headers=headers,
                timeout=timeout,
                **kwargs,
            )
        except requests.RequestException as e:
            raise QuickBooksApiError(f"Network error communicating with QuickBooks API: {e}") from e

        # Handle 401 Unauthorized (reactive refresh)
        if response.status_code == 401 and retry_401:
            logger.warning("QuickBooks returned 401 Unauthorized. Attempting reactive token refresh and retry...")
            try:
                new_token = refresh_tokens(self.plugin)
                headers['Authorization'] = f'Bearer {new_token}'
                response = requests.request(
                    method=method.upper(),
                    url=url,
                    params=params,
                    json=json_data,
                    data=data,
                    headers=headers,
                    timeout=timeout,
                    **kwargs,
                )
            except Exception as refresh_err:
                logger.error("Reactive token refresh failed: %s", refresh_err)
                raise QuickBooksAuthError(f"Re-authentication failed: {refresh_err}") from refresh_err

        # Check status codes
        if not response.ok:
            raise self._parse_error_response(response)

        try:
            return response.json()
        except ValueError:
            return {'raw': response.text}

    def get(self, endpoint: str, params: Optional[dict] = None, **kwargs) -> dict:
        """HTTP GET convenience method."""
        return self.request('GET', endpoint, params=params, **kwargs)

    def post(self, endpoint: str, json_data: Optional[dict] = None, params: Optional[dict] = None, **kwargs) -> dict:
        """HTTP POST convenience method."""
        return self.request('POST', endpoint, params=params, json_data=json_data, **kwargs)

    def query(self, query_str: str) -> dict:
        """Run a QuickBooks Query Language (QQL) statement.

        Example:
            client.query("SELECT * FROM Item MAXRESULTS 10")
        """
        endpoint = 'query'
        params = {'query': query_str}
        data = self.get(endpoint, params=params)
        return data.get('QueryResponse', {})

    def get_company_info(self) -> dict:
        """Fetch CompanyInfo for the connected Realm ID.

        Useful for connection health verification.
        """
        endpoint = f'companyinfo/{self.realm_id}'
        data = self.get(endpoint)
        return data.get('CompanyInfo', {})

    def get_items(self, max_results: int = 50) -> list[dict]:
        """Fetch Items (parts/services) from QuickBooks."""
        result = self.query(f"SELECT * FROM Item MAXRESULTS {max_results}")
        return result.get('Item', [])

    def get_vendors(self, max_results: int = 50) -> list[dict]:
        """Fetch Vendors (suppliers) from QuickBooks."""
        result = self.query(f"SELECT * FROM Vendor MAXRESULTS {max_results}")
        return result.get('Vendor', [])

    def get_customers(self, max_results: int = 50) -> list[dict]:
        """Fetch Customers from QuickBooks."""
        result = self.query(f"SELECT * FROM Customer MAXRESULTS {max_results}")
        return result.get('Customer', [])
