load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "opengraph",
    srcs = ["create_documentation_meta.ts"],
    test_srcs = glob(["*.test.ts"]),
    visibility = ["//app:__subpackages__"],
    deps = [
        "//shared/content",
        "//shared/helpers",
    ],
)
