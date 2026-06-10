load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "analytics",
    visibility = [
        "//admin/aws:__pkg__",
        "//admin/analytics/analytics_mirror_export:__pkg__",
    ],
    deps = [
        "//server/tracer",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
