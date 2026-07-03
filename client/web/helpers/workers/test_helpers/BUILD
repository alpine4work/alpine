load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//client/web/databases:__pkg__",
        "//client/web/helpers:__pkg__",
    ],
    deps = [
        "//client/web/helpers",
        "//shared/error",
    ],
)
