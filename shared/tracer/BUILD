load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/tough-cookie",
        "//:node_modules/cookie",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/tough-cookie",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
