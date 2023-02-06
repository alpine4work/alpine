load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cloudflare",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/context",
        "//client/helpers",
        "//shared/cloudflare",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
