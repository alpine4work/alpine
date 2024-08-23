load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "node",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/credential-provider-node",
        "//:node_modules/@smithy/types",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)

# This test waits forever. It's used by `acquireBazelLock()` to lock the Bazel
# for server for as long as we need.
sh_test(
    name = "bazel_lock_test",
    timeout = "eternal",
    srcs = ["bazel_lock_test.sh"],
    tags = [
        "manual",
        "no-cache",
        "no-remote",
        "no-sandbox",
    ],
)
