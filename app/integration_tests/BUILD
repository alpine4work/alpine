load("//admin/playwright:playwright.bzl", "ts_playwright_tests")

ts_playwright_tests(
    name = "integration_tests",
    data = ["//app"],
    node_options = [
        # Support for Cloudflare modules format.
        # https://miniflare.dev/core/modules
        "--experimental-vm-modules",
    ],
    skip_projects_by_src = {
        # Peeks only work on desktop.
        "peek/peek.spec.ts": ["webkit_mobile"],
    },
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@types/serve-static",
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/ws",
        "//:node_modules/get-port",
        "//:node_modules/miniflare",
        "//:node_modules/serve-static",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/ws",
        "//admin/helpers",
        "//app/local",
        "//server/dynamo/test_helpers/shared",
        "//server/remix",
    ],
)
