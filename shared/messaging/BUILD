load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    test_deps = ["//shared/documents"],
    visibility = ["//visibility:public"],
    deps = [
        "//shared/accounts",
        "//shared/api",
        "//shared/content",
        "//shared/design",
        "//shared/error",
        "//shared/id",
        "//shared/reactions",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
