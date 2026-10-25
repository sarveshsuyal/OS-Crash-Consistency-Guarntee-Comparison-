from django.urls import path
from . import views

urlpatterns = [
    # Health check for Render / Vercel
    path('health/', views.health_check, name='health_check'),

    # Authentication (10-Digit Phone Number)
    path('auth/register/', views.register_user, name='register_user'),
    path('auth/login/', views.login_user, name='login_user'),
    path('auth/me/', views.current_user, name='current_user'),

    # Users & WhatsApp-style Chat
    path('users/', views.list_users, name='list_users'),
    path('messages/', views.chat_messages, name='chat_messages'),

    # File Transfer & Crash-Consistency Engine
    path('transfers/', views.list_transfers, name='list_transfers'),
    path('transfers/initiate/', views.initiate_transfer, name='initiate_transfer'),
    path('transfers/<uuid:transfer_id>/', views.get_transfer_details, name='get_transfer_details'),
    path('transfers/<uuid:transfer_id>/content', views.content_stream_upload, name='content_stream_upload'),
    path('transfers/<uuid:transfer_id>/content/', views.content_stream_upload, name='content_stream_upload_slash'),
    path('transfers/<uuid:transfer_id>/chunk/', views.upload_chunk, name='upload_chunk'),
    path('transfers/<uuid:transfer_id>/resume_state/', views.get_resume_state, name='get_resume_state'),
    path('transfers/<uuid:transfer_id>/crash/', views.simulate_crash, name='simulate_crash'),
    path('transfers/<uuid:transfer_id>/recover/', views.recover_transfer, name='recover_transfer'),
    path('transfers/<uuid:transfer_id>/download/', views.download_transfer_file, name='download_transfer_file'),

    # Global Crash Simulation
    path('crash/global/', views.simulate_crash, name='global_simulate_crash'),

    # OS Comparative Metrics & Kernel Logs
    path('os-metrics/', views.get_os_metrics, name='get_os_metrics'),
    path('os-metrics/reset/', views.reset_os_metrics, name='reset_os_metrics'),
]
