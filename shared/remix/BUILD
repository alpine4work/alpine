load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "remix",
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@remix-run/router",
        "//shared/helpers",
        "//shared/schema",
        "//shared/search/path",
        "//shared/tasks",
    ],
)

write_source_files(
    name = "write_app_space_route_id",
    files = {
        "app_space_route_id.ts": "//app:app_space_route_id.ts",
    },
)
