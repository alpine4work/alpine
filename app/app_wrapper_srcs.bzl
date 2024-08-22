"""
Files in our `AppService` development entry point. Files in the `AppService`
entry point can't be hot reloaded in development mode.
"""

APP_WRAPPER_SRCS = [
    "app_service.ts",
    "app_service_worker.ts",
    "seed_dynamo.ts",
    "helpers/virtual_remix_server_build.d.ts",
]
