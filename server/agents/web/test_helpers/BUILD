load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    testonly = True,
    name = "test_helpers",
    visibility = ["//server/agents:__subpackages__"],
    deps = [
        "//:node_modules/fast-check",
        "//server/agents/web",
        "//server/cloudflare",
        "//shared/api/content/test_helpers",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
