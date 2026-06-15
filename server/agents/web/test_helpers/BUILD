load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    testonly = True,
    name = "test_helpers",
    visibility = [
        "//server/agents:__subpackages__",
        "//shared/api/markdown:__subpackages__",
    ],
    deps = [
        "//:node_modules/fast-check",
        "//server/agents/web",
        "//server/cloudflare",
        "//shared/api/markdown/test_helpers",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
