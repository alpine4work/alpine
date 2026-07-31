load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "markdown",
    srcs = glob(["*.ts"], exclude = ["*.test.ts"]),
    test_srcs = glob(["*.test.ts"]),
    visibility = ["//app/docs/codegen:__pkg__"],
    deps = [
        "//shared/docs",
        "//shared/error",
        "//shared/helpers",
    ],
)
