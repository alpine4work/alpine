load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    test_deps = [
        "//shared/api/content/closed_source",
        "//shared/documents",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//shared/accounts",
        "//shared/agents",
        "//shared/api/specification",
        "//shared/content",
        "//shared/design",
        "//shared/error",
        "//shared/files",
        "//shared/id",
        "//shared/helpers",
        "//shared/reactions",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
