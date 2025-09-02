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
        "//:node_modules/@types/node",
        "//:node_modules/ajv",
        "//:node_modules/find-my-way",
        "//:node_modules/openapi-types",
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
