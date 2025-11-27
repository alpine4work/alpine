load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "rpc",
    visibility = [
        "//admin/adhoc:__pkg__",
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/scheduler",
        "//:node_modules/react",
        "//:node_modules/scheduler",
        "//client/web/context",
        "//client/web/helpers",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
    ],
)
