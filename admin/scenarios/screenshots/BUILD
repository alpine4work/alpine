load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "screenshots_lib",
    deps = [
        "//:node_modules/playwright",
        "//admin/environment/demo_space",
        "//admin/environment/test/integration",
        "//admin/scenarios:scenarios_lib",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

# Usage from the root of the repository:
#
# ```
# rm -rf .local/screenshots && mkdir -p .local/screenshots && bazel run //admin/scenarios/screenshots:screenshots_bin -- $PWD/.local/screenshots
# ```
#
# Eventually it would be nice to have a `screenshots` Bazel rule that builds
# the screenshots in a sandbox but for now it's nice to have the logs given the
# command is slow.
js_binary(
    name = "screenshots_bin",
    data = [
        ":screenshots_lib",
        "@playwright_browsers//:browsers",
    ],
    entry_point = "scenario_screenshots_main.js",
    env = {
        "NODE_ENV": "development",
        "ADMIN_SCRIPT": "scenarios",
        "DEBUG": "admin/scenarios/*,admin/environment/*",
        "PLAYWRIGHT_BROWSERS_PATH": "$(rootpath @playwright_browsers//:browsers)",
    },
    no_copy_to_bin = ["@playwright_browsers//:browsers"],
)
