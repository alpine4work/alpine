load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "adhoc_lib",
    deps = [
        "//:node_modules/@types/node",
        "//server/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)

js_binary(
    name = "adhoc",
    data = [":adhoc_lib"],
    entry_point = "adhoc_main.js",
    env = {"NODE_ENV": "development"},
)
