load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    test_deps = ["//shared/tasks/test_helpers"],
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/react-router",
        "//client/accounts",
        "//client/context",
        "//client/search/core",
        "//client/spaces",
        "//client/tracer",
        "//shared/helpers",
        "//shared/tasks",
    ],
)
