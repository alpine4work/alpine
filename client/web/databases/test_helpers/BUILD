load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//app/databases_test:__pkg__",
        "//client/web/databases:__pkg__",
    ],
    deps = [
        "//client/web/databases",
        "//shared/databases",
    ],
)
