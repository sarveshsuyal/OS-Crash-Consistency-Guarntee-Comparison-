
"""
Django settings for backend project.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


# --------------------------------------------------
# SECURITY
# --------------------------------------------------

SECRET_KEY = os.environ.get("SECRET_KEY")

if not SECRET_KEY:
    if os.environ.get("RENDER"):
        raise RuntimeError(
            "Set SECRET_KEY in Render Environment settings."
        )
    SECRET_KEY = (
        "django-insecure-local-development-only-change-this-key"
    )

DEBUG = os.environ.get("DEBUG", "False").strip().lower() in {
    "true", "1", "yes"
}


# --------------------------------------------------
# ALLOWED HOSTS
# --------------------------------------------------

allowed_hosts_env = os.environ.get("ALLOWED_HOSTS", "")
render_hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")

ALLOWED_HOSTS = [
    host.strip()
    for host in allowed_hosts_env.split(",")
    if host.strip() and host.strip() != "*"
]

if render_hostname:
    ALLOWED_HOSTS.append(render_hostname)

ALLOWED_HOSTS.extend(["localhost", "127.0.0.1"])
ALLOWED_HOSTS = list(dict.fromkeys(ALLOWED_HOSTS))


# --------------------------------------------------
# APPLICATIONS
# --------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "transmission_engine",
]


# --------------------------------------------------
# MIDDLEWARE
# --------------------------------------------------

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "transmission_engine.middleware.StartupReconciliationMiddleware",
]


# --------------------------------------------------
# URLS AND WSGI
# --------------------------------------------------

ROOT_URLCONF = "backend.urls"
WSGI_APPLICATION = "backend.wsgi.application"


# --------------------------------------------------
# TEMPLATES
# --------------------------------------------------

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# --------------------------------------------------
# DATABASE
# --------------------------------------------------

# Defaults to the existing local database location.
# In production, set DATABASE_PATH to a SQLite file on an
# attached persistent disk. Back up the old database first.
database_path = os.environ.get("DATABASE_PATH", "").strip()

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": (
            Path(database_path).expanduser()
            if database_path
            else BASE_DIR / "db.sqlite3"
        ),
        "OPTIONS": {
            "timeout": 20,
        },
    }
}


# --------------------------------------------------
# PASSWORD VALIDATION
# --------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        ),
    },
]


# --------------------------------------------------
# INTERNATIONALIZATION
# --------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# --------------------------------------------------
# STATIC AND MEDIA FILES
# --------------------------------------------------

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"

MEDIA_ROOT = Path(
    os.environ.get(
        "MEDIA_ROOT",
        str(BASE_DIR / "media"),
    )
).expanduser()

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage."
            "CompressedManifestStaticFilesStorage"
        ),
    },
}


# --------------------------------------------------
# CORS
# --------------------------------------------------

cors_origins_env = os.environ.get("CORS_ALLOWED_ORIGINS", "")

if cors_origins_env.strip():
    CORS_ALLOWED_ORIGINS = [
        origin.strip().rstrip("/")
        for origin in cors_origins_env.split(",")
        if origin.strip()
    ]
else:
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

CORS_ALLOW_CREDENTIALS = True

CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
]


# --------------------------------------------------
# CSRF
# --------------------------------------------------

csrf_trusted_raw = os.environ.get("CSRF_TRUSTED_ORIGINS", "")

if csrf_trusted_raw.strip():
    CSRF_TRUSTED_ORIGINS = [
        origin.strip()
        for origin in csrf_trusted_raw.split(",")
        if origin.strip()
    ]
else:
    CSRF_TRUSTED_ORIGINS = [
        "https://*.onrender.com",
        "https://*.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


# --------------------------------------------------
# DJANGO REST FRAMEWORK
# --------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
}


# --------------------------------------------------
# TRANSACTION ENGINE STORAGE
# --------------------------------------------------

DB_WAL_ENABLED = True

# Set this environment variable to the actual mount path of your
# Render persistent disk. The fallback is for local development only.
PERSISTENT_STORAGE_ROOT = os.environ.get(
    "PERSISTENT_STORAGE_ROOT",
    str(BASE_DIR.parent / "storage"),
)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

