load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    data = [
        "//app",
    ],
    visibility = [
        "//app:__subpackages__",
        "//integration_tests:__subpackages__",
    ],
    deps = [
        "//:node_modules/@miniflare/http-server",
        "//:node_modules/@miniflare/web-sockets",
        "//:node_modules/@types/node",
        "//:node_modules/@types/serve-static",
        "//:node_modules/@types/ws",
        "//:node_modules/miniflare",
        "//:node_modules/serve-static",
        "//:node_modules/undici",
        "//:node_modules/ws",
        "//admin/helpers",
        "//shared/helpers",
    ],
)
