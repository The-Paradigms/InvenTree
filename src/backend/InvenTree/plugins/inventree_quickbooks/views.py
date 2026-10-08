"""Views for QuickBooks Online OAuth 2.0 flow and connection management."""


from django.http import (
    HttpResponse,
    HttpResponseBadRequest,
    HttpResponseForbidden,
    HttpResponseRedirect,
    JsonResponse,
)
from django.urls import reverse
from django.utils.html import escape

import structlog

from InvenTree.permissions import auth_exempt
from plugin.registry import registry

from .client import QuickBooksClient
from .exceptions import QuickBooksAuthError, QuickBooksConfigurationError, QuickBooksError
from .oauth import (
    exchange_code_for_tokens,
    generate_authorization_url,
    get_connection_status,
    get_redirect_uri,
    revoke_and_disconnect,
)

logger = structlog.get_logger('inventree.quickbooks')


def _get_plugin():
    """Retrieve active or registered QuickBooks plugin instance."""
    plugin = registry.get_plugin('quickbooks', active=None)
    if not plugin:
        raise QuickBooksConfigurationError("QuickBooks plugin is not loaded in registry.")
    return plugin


from django.conf import settings


def is_admin_or_staff(request):
    """Ensure requesting user has administrator / staff permissions.

    Supports:
    - Standard Django session authentication
    - InvenTree Token / Bearer API header authentication
    - Permissive access in local development (DEBUG=True)
    """
    user = getattr(request, 'user', None)

    # 1. Standard Django session authentication
    if user and user.is_authenticated and (user.is_staff or user.is_superuser):
        return True

    # 2. Token / Bearer authorization header (from InvenTree frontend or API)
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Token ') or auth_header.startswith('Bearer '):
        token_key = auth_header.split(' ')[1].strip()
        try:
            from rest_framework.authtoken.models import Token
            token_obj = Token.objects.filter(key=token_key).first()
            if token_obj and (token_obj.user.is_staff or token_obj.user.is_superuser):
                return True
        except Exception:
            pass

    # 3. In DEBUG development mode, allow access so developers are not blocked by SPA session decoupling
    if getattr(settings, 'DEBUG', False):
        return True

    return False


@auth_exempt
def oauth_connect(request):
    """Initiate OAuth 2.0 Authorization Code flow against Intuit AppCenter."""
    if not is_admin_or_staff(request):
        return HttpResponseForbidden("Only administrators can configure the QuickBooks integration.")

    try:
        plugin = _get_plugin()
        redirect_uri = get_redirect_uri(plugin, request)
        if not redirect_uri:
            redirect_uri = request.build_absolute_uri(reverse('plugin:quickbooks:oauth-callback'))

        auth_url, state = generate_authorization_url(plugin, redirect_uri=redirect_uri)

        # Store state and redirect_uri in session for CSRF verification
        request.session['qbo_oauth_state'] = state
        request.session['qbo_oauth_redirect_uri'] = redirect_uri

        logger.info("Redirecting user to Intuit AppCenter OAuth URL: %s", auth_url)
        return HttpResponseRedirect(auth_url)

    except QuickBooksConfigurationError as e:
        return HttpResponseBadRequest(
            f"Configuration Error: {escape(str(e))}. Please configure Client ID and Secret in Plugin Settings or Environment Variables."
        )
    except Exception as e:
        logger.exception("Failed to initialize QuickBooks OAuth connect: %s", e)
        return HttpResponseBadRequest(f"Error starting OAuth flow: {escape(str(e))}")


@auth_exempt
def oauth_callback(request):
    """Callback endpoint for Intuit OAuth 2.0 redirection."""
    # Check for error from Intuit
    error = request.GET.get('error')
    if error:
        error_description = request.GET.get('error_description', error)
        logger.warning("Intuit OAuth returned error: %s (%s)", error, error_description)
        return HttpResponseBadRequest(f"QuickBooks Authorization Error: {escape(error_description)}")

    # Verify CSRF state
    received_state = request.GET.get('state')
    expected_state = request.session.pop('qbo_oauth_state', None)

    if not expected_state or expected_state != received_state:
        logger.warning("Invalid OAuth state received. expected=%s, received=%s", expected_state, received_state)
        return HttpResponseBadRequest("Invalid OAuth state token (CSRF check failed). Please initiate login again.")

    code = request.GET.get('code')
    realm_id = request.GET.get('realmId')

    if not code:
        return HttpResponseBadRequest("Missing authorization code from QuickBooks callback.")

    try:
        plugin = _get_plugin()
        redirect_uri = request.session.pop('qbo_oauth_redirect_uri', None) or get_redirect_uri(plugin, request)
        if not redirect_uri:
            redirect_uri = request.build_absolute_uri(reverse('plugin:quickbooks:oauth-callback'))

        # Exchange code for tokens
        exchange_code_for_tokens(
            plugin,
            code=code,
            redirect_uri=redirect_uri,
            realm_id=realm_id,
        )

        logger.info("QuickBooks OAuth exchange completed successfully for Realm ID %s", realm_id)
        return HttpResponseRedirect(reverse('plugin:quickbooks:oauth-status') + '?success=true')

    except (QuickBooksAuthError, QuickBooksConfigurationError) as e:
        logger.error("OAuth token exchange failed: %s", e)
        return HttpResponseBadRequest(f"OAuth Exchange Failed: {escape(str(e))}")
    except Exception as e:
        logger.exception("Unexpected error during OAuth callback: %s", e)
        return HttpResponseBadRequest(f"Unexpected error: {escape(str(e))}")


@auth_exempt
def oauth_disconnect(request):
    """Disconnect QuickBooks integration by revoking tokens and clearing stored credentials."""
    if not is_admin_or_staff(request):
        return HttpResponseForbidden("Only administrators can disconnect QuickBooks integration.")

    try:
        plugin = _get_plugin()
        revoke_and_disconnect(plugin)
        return HttpResponseRedirect(reverse('plugin:quickbooks:oauth-status') + '?disconnected=true')
    except Exception as e:
        logger.exception("Error during QuickBooks disconnect: %s", e)
        return HttpResponseBadRequest(f"Failed to disconnect: {escape(str(e))}")


@auth_exempt
def oauth_status(request):
    """Display connection status dashboard and allow testing connectivity with Sandbox API."""
    if not is_admin_or_staff(request):
        return HttpResponseForbidden("Unauthorized: Administrator permissions required.")

    plugin = _get_plugin()
    status_data = get_connection_status(plugin)

    test_result = None
    test_error = None

    if request.GET.get('test') == 'true' and status_data['connected']:
        try:
            client = QuickBooksClient(plugin)
            company_info = client.get_company_info()
            test_result = {
                'status': 'success',
                'company_name': company_info.get('CompanyName'),
                'legal_name': company_info.get('LegalName'),
                'fiscal_year_start': company_info.get('FiscalYearStartMonth'),
                'country': company_info.get('Country'),
            }
        except QuickBooksError as e:
            test_error = str(e)
        except Exception as e:
            test_error = f"Unexpected test error: {e}"

    if test_result:
        status_data['test_result'] = test_result
    if test_error:
        status_data['test_error'] = test_error

    if request.GET.get('format') == 'json' or 'application/json' in request.headers.get('Accept', ''):
        return JsonResponse(status_data)

    # Render clean HTML status page
    html = _render_status_html(status_data, request)
    return HttpResponse(html)


def _render_status_html(status: dict, request) -> str:
    """Generate modern, clean HTML dashboard for the QuickBooks OAuth status."""
    connected = status['connected']
    realm_id = status['realm_id'] or 'Not Connected'
    env = status['environment'].upper()
    seconds = status['seconds_until_expiry']
    expired = status['is_token_expired']

    status_badge = (
        '<span style="background: #10b981; color: #fff; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 13px;">Connected</span>'
        if connected and not expired
        else (
            '<span style="background: #f59e0b; color: #fff; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 13px;">Token Expired (Auto-refresh on call)</span>'
            if connected
            else '<span style="background: #ef4444; color: #fff; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 13px;">Disconnected</span>'
        )
    )

    env_badge = f'<span style="background: {"#3b82f6" if env == "SANDBOX" else "#8b5cf6"}; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">{env}</span>'

    connect_url = reverse('plugin:quickbooks:oauth-connect')
    disconnect_url = reverse('plugin:quickbooks:oauth-disconnect')
    status_url = reverse('plugin:quickbooks:oauth-status')
    test_url = f"{status_url}?test=true"

    notification = ""
    if request.GET.get('success'):
        notification = '<div style="background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">Successfully authenticated with QuickBooks Online!</div>'
    elif request.GET.get('disconnected'):
        notification = '<div style="background: #fef2f2; border: 1px solid #ef4444; color: #991b1b; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">QuickBooks integration has been disconnected.</div>'

    test_box = ""
    if 'test_result' in status:
        res = status['test_result']
        test_box = f'''
        <div style="background: #f0fdf4; border: 1px solid #86efac; padding: 16px; border-radius: 8px; margin-top: 20px;">
            <h4 style="margin: 0 0 8px 0; color: #166534;">Sandbox API Test: Success!</h4>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Company:</strong> {escape(str(res.get("company_name", "")))}</p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Legal Name:</strong> {escape(str(res.get("legal_name", "")))}</p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Country:</strong> {escape(str(res.get("country", "")))}</p>
        </div>
        '''
    elif 'test_error' in status:
        test_box = f'''
        <div style="background: #fef2f2; border: 1px solid #fca5a5; padding: 16px; border-radius: 8px; margin-top: 20px;">
            <h4 style="margin: 0 0 8px 0; color: #991b1b;">Sandbox API Test: Failed</h4>
            <p style="margin: 0; font-size: 14px; color: #7f1d1d;">{escape(status["test_error"])}</p>
        </div>
        '''

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>InvenTree - QuickBooks Integration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f8fafc;
            color: #1e293b;
            margin: 0;
            padding: 40px 20px;
        }}
        .container {{
            max-width: 680px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
            padding: 32px;
        }}
        h1 {{ margin: 0 0 8px 0; font-size: 24px; color: #0f172a; }}
        p.subtitle {{ color: #64748b; margin: 0 0 24px 0; font-size: 14px; }}
        .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }}
        .card {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }}
        .card-label {{ font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }}
        .card-val {{ font-size: 15px; font-weight: 500; color: #0f172a; word-break: break-all; }}
        .actions {{ display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap; }}
        .btn {{
            display: inline-block;
            padding: 10px 18px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            border-radius: 6px;
            cursor: pointer;
            border: none;
            transition: background 0.15s ease;
        }}
        .btn-primary {{ background: #0284c7; color: #ffffff; }}
        .btn-primary:hover {{ background: #0369a1; }}
        .btn-test {{ background: #059669; color: #ffffff; }}
        .btn-test:hover {{ background: #047857; }}
        .btn-danger {{ background: #dc2626; color: #ffffff; }}
        .btn-danger:hover {{ background: #b91c1c; }}
        .btn-secondary {{ background: #e2e8f0; color: #334155; }}
        .btn-secondary:hover {{ background: #cbd5e1; }}
    </style>
</head>
<body>
    <div class="container">
        {notification}
        <h1>QuickBooks Online Integration</h1>
        <p class="subtitle">InvenTree OAuth 2.0 Integration &amp; Sandbox API Connector</p>

        <div style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
            <div>Status: {status_badge}</div>
            <div>Environment: {env_badge}</div>
        </div>

        <div class="grid">
            <div class="card">
                <div class="card-label">Company / Realm ID</div>
                <div class="card-val">{escape(realm_id)}</div>
            </div>
            <div class="card">
                <div class="card-label">Access Token Expiry</div>
                <div class="card-val">{f"{seconds} seconds remaining" if connected and seconds > 0 else ("Expired (Ready to refresh)" if connected else "N/A")}</div>
            </div>
            <div class="card">
                <div class="card-label">Client ID Configured</div>
                <div class="card-val">{"Yes" if status["client_id_configured"] else "No (Set in env or settings)"}</div>
            </div>
            <div class="card">
                <div class="card-label">Client Secret Configured</div>
                <div class="card-val">{"Yes" if status["client_secret_configured"] else "No (Set in env or settings)"}</div>
            </div>
        </div>

        <div class="actions">
            {"<a href='" + connect_url + "' class='btn btn-primary'>Reconnect with QuickBooks</a>" if connected else "<a href='" + connect_url + "' class='btn btn-primary'>Connect to QuickBooks</a>"}
            {"<a href='" + test_url + "' class='btn btn-test'>Test Sandbox Connection</a>" if connected else ""}
            {"<a href='" + disconnect_url + "' class='btn btn-danger' onclick='return confirm(\"Are you sure you want to disconnect QuickBooks?\")'>Disconnect</a>" if connected else ""}
            <a href="/settings/admin/plugin/" class="btn btn-secondary">InvenTree Plugins Admin</a>
        </div>

        {test_box}
    </div>
</body>
</html>
"""
