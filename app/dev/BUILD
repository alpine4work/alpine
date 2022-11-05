load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    deps = [
        "//:node_modules/@miniflare/http-server",
        "//:node_modules/@types/serve-static",
        "//:node_modules/@types/ws",
        "//:node_modules/chalk",
        "//:node_modules/miniflare",
        "//:node_modules/serve-static",
        "//:node_modules/ws",
        "//admin",
        "//shared",
    ],
)

js_binary(
    name = "dev",
    data = [
        ":dev_lib",
        "//app",
    ],
    entry_point = "remix-dev.js",
    # Always enable Node.js inspector in development so you can connect an
    # inspector with `chrome://inspect`. There is no performance impact if a
    # debugger is not attached.
    # https://stackoverflow.com/questions/45379080/does-the-node-inspect-flag-have-any-notable-performance-impact
    node_options = ["--inspect"],
    tags = ["ibazel_notify_changes"],
)
