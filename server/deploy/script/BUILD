load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

js_binary(
    name = "script",
    data = [":script_lib"],
    entry_point = "deploy_service_main.js",
    env = {"NODE_ENV": "production"},
)

ts_project(
    name = "script_lib",
    data = [
        "//admin/aws:cdk_data",
        "//admin/local_redirect:wrangler",
        "//app:app_static_production",
        "//server/edge:wrangler",
        "//server/agents:wrangler",
        "//server/resources:wrangler",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-cloudformation",
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@octokit/auth-action",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/serve-static",
        "//:node_modules/aws-cdk",
        "//:node_modules/date-fns",
        "//:node_modules/env-paths",
        "//:node_modules/fs-extra",
        "//:node_modules/serve-static",
        "//server/cloudflare/r2",
        "//server/deploy/data",
        "//server/helpers/node",
        "//server/node",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
