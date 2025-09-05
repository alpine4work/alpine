load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "access",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/chat/test_helpers",
        "//server/forum/data:data_testonly",
        "//server/forum/test_helpers",
    ],
    visibility = ["//server:__subpackages__"],
    deps = [
        "//server/spaces",
        "//shared/access",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
    ],
)
