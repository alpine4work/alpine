load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "demo_space",
    data = glob(
        ["fixtures/**"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["fixtures/**/.*"],
    ),
    visibility = ["//admin:__subpackages__"],
    deps = [
        "//:node_modules/cookie",
        "//admin/helpers",
        "//server/bots/test_helpers",
        "//server/context",
        "//server/helpers/node",
        "//server/spaces/test_helpers",
        "//server/tokens",
        "//shared/avatar/protocol",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
