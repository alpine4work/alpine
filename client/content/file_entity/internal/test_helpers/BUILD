load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//client/content/file_entity:__pkg__"],
    deps = [
        "//:node_modules/@types/prettier",
        "//:node_modules/prettier",
        "//shared/helpers",
    ],
)
