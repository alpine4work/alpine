load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

remix_app(
    name = "app",
)

ts_project(
    name = "app_lib",
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/dev",
        "//client",
        "//server",
        "//shared",
    ],
)

js_binary(
    name = "remix_compiler",
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
    ],
    entry_point = "remix-compiler.js",
)

js_binary(
    name = "app_dev",
    data = [
        ":app",
        "//:node_modules/@miniflare/http-server",
        "//:node_modules/chalk",
        "//:node_modules/miniflare",
        "//:node_modules/serve-static",
        "//:node_modules/ws",
    ],
    entry_point = "remix-dev.js",
    tags = ["ibazel_notify_changes"],
)
