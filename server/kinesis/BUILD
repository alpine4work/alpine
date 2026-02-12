load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "kinesis",
    test_deps = [
        "//shared/tracer/dev",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/helpers",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
