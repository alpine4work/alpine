load("//admin/typescript:typescript.bzl", "ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_binary")

ts_project(
    name = "generate_build_file_lib",
    visibility = ["//admin:__subpackages__"],
    deps = ["//:node_modules/@types/node"],
)

js_binary(
    name = "generate_build_file",
    entry_point = "generate_build_file.js",
    data = [":generate_build_file_lib"],
    visibility = ["//visibility:public"],
)
