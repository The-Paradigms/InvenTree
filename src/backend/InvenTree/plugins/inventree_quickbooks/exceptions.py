"""Custom exceptions for QuickBooks Online integration."""


class QuickBooksError(Exception):
    """Base exception for all QuickBooks integration errors."""


class QuickBooksConfigurationError(QuickBooksError):
    """Raised when required configuration (Client ID, Secret, Realm ID) is missing."""


class QuickBooksAuthError(QuickBooksError):
    """Raised when OAuth 2.0 authentication or token refresh fails."""

    def __init__(self, message, error_details=None, status_code=None):
        super().__init__(message)
        self.error_details = error_details or {}
        self.status_code = status_code


class QuickBooksApiError(QuickBooksError):
    """Raised when an API call to QuickBooks returns an error response."""

    def __init__(self, message, status_code=None, error_code=None, error_detail=None, response_data=None):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.error_detail = error_detail
        self.response_data = response_data or {}

    def __str__(self):
        parts = [super().__str__()]
        if self.status_code:
            parts.append(f'(HTTP {self.status_code})')
        if self.error_code:
            parts.append(f'[Code: {self.error_code}]')
        if self.error_detail:
            parts.append(f'- {self.error_detail}')
        return ' '.join(parts)


class QuickBooksRateLimitError(QuickBooksApiError):
    """Raised when QuickBooks API rate limit (429 Too Many Requests) is hit."""

    def __init__(self, message="QuickBooks API rate limit exceeded", retry_after=None, **kwargs):
        super().__init__(message, status_code=429, **kwargs)
        self.retry_after = retry_after
