load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

remix_app(
    name = "app",
)

ts_project(
    name = "app_lib",
    data = [":app_assets"],
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/cloudflare-workers",
        "//:node_modules/@remix-run/dev",
        "//client",
        "//server",
        "//shared",
    ],
)

copy_to_bin(
    name = "app_assets",
    srcs = glob(["public/**/*"]),
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
        ":app_assets",
        "//:node_modules/@miniflare/http-server",
        "//:node_modules/chalk",
        "//:node_modules/miniflare",
        "//:node_modules/serve-static",
        "//:node_modules/ws",
    ],
    entry_point = "remix-dev.js",
    # Always enable Node.js inspector in development so you can connect an
    # inspector with `chrome://inspect`. There is no performance impact if a
    # debugger is not attached.
    # https://stackoverflow.com/questions/45379080/does-the-node-inspect-flag-have-any-notable-performance-impact
    node_options = ["--inspect"],
    tags = ["ibazel_notify_changes"],
)
