load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    deps = [
        "//:node_modules/@types/express",
        "//:node_modules/@types/ws",
        "//:node_modules/aws4fetch",
        "//:node_modules/chalk",
        "//:node_modules/express",
        "//:node_modules/fs-extra",
        "//:node_modules/ws",
        "//admin/aws",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//app/local",
        "//shared/helpers",
    ],
)

js_binary(
    name = "dev",
    data = [
        ":dev_lib",
        "//app",
    ],
    entry_point = "dev_main.js",
    env = {"NODE_ENV": "development"},
    node_options = [
        # Always enable Node.js inspector in development so you can connect an
        # inspector with `chrome://inspect`. There is no performance impact if a
        # debugger is not attached.
        # https://stackoverflow.com/questions/45379080/does-the-node-inspect-flag-have-any-notable-performance-impact
        "--inspect",
        # Support for Cloudflare modules format.
        # https://miniflare.dev/core/modules
        "--experimental-vm-modules",
    ],
    tags = ["ibazel_notify_changes"],
)
