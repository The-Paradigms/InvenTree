"""URL routing for QuickBooks Online integration."""

from django.urls import path

from . import views

urlpatterns = [
    path('connect/', views.oauth_connect, name='oauth-connect'),
    path('callback/', views.oauth_callback, name='oauth-callback'),
    path('disconnect/', views.oauth_disconnect, name='oauth-disconnect'),
    path('status/', views.oauth_status, name='oauth-status'),
]
