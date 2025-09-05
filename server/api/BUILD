load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "api_lib",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/dynamo/test_helpers",
    ],
    deps = [
        "//:node_modules/@lezer/json",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/negotiator",
        "//:node_modules/@types/node",
        "//:node_modules/@types/prettier",
        "//:node_modules/ajv",
        "//:node_modules/ajv-formats",
        "//:node_modules/escape-html",
        "//:node_modules/find-my-way",
        "//:node_modules/negotiator",
        "//:node_modules/openapi-types",
        "//:node_modules/prettier",
        "//:node_modules/prosemirror-model",
        "//:node_modules/yaml",
        "//server/api/specification",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/node",
        "//server/search/data/index",
        "//server/spaces",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/content/code",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "api",
    data = [":api_lib"],
    entry_point = "api_service_main.js",
)
