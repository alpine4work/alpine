sh_binary(
    name = "deploy",
    srcs = ["deploy.sh"],
    data = [
        "//admin/aws:cdk",
        "//server/edge:wrangler",
    ],
    deps = [
        "@bazel_tools//tools/bash/runfiles",
    ],
)
