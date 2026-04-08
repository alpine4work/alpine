load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    testonly = True,
    name = "test_helpers",
    visibility = ["//server/agents:__subpackages__"],
    deps = [
        "//server/agents/web",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
