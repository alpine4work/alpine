load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    deps = [
        "//:node_modules/chalk",
        "//admin",
        "//shared",
    ],
)

js_binary(
    name = "dev",
    data = [":dev_lib"],
    entry_point = "dev-main.js",
    env = {"NODE_ENV": "development"},
)
