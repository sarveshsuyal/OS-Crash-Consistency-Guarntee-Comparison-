from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse


def root_welcome(request):
    return JsonResponse({
        'project': 'Crash-Consistency Guarantee Comparison',
        'subsystem': 'Operating Systems File Transmission & Journaling Engine',
        'api_root': '/api/',
        'health_check': '/api/health/',
        'status': 'OPERATIONAL'
    })


urlpatterns = [
    path('', root_welcome, name='root_welcome'),
    path('admin/', admin.site.urls),
    path('api/', include('transmission_engine.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
