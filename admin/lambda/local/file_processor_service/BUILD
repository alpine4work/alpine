load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "file_processor_local_service_lib",
    visibility = ["//admin/dev:__pkg__"],
    deps = [
        "//admin/lambda/local",
        "//server/files/processor:processor_lib",
        "//server/helpers/node",
        "//server/lambda",
        "//server/node",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)

js_binary(
    name = "lambda_runtime",
    data = [":file_processor_local_service_lib"],
    entry_point = "file_processor_local_service_main.js",
    visibility = ["//admin/dev:__pkg__"],
)
