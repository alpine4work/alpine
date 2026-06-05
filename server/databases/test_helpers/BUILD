load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/databases:__pkg__"],
    deps = [
        "//server/databases",
        "//shared/id",
    ],
)
