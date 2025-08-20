load("//admin/typescript:typescript.bzl", "ts_project")

# The difference between `//server/helpers/node` and `//server/node` is
# `//server/helpers/node` contains Node.js helpers that can be used anywhere
# in our project. `//server/node` is for building full Node.js services.
#
# `//server/node` takes dependencies on many modules including
# `//server/dynamo/core` and `//:node_modules/@aws-sdk` whereas
# `//server/helpers/node` has a light dependency set which makes it portable.
ts_project(
    name = "node",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@smithy/types",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/ws",
        "//:node_modules/bufferutil",  # Optional module that improves `ws` performance
        "//:node_modules/utf-8-validate",  # Optional module that improves `ws` performance
        "//:node_modules/fs-extra",
        "//:node_modules/ws",
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers/node",
        "//server/jobs/core",
        "//server/tokens",
        "//server/tracer",
        "//server/web_socket",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
