load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/scheduler",
        "//:node_modules/date-fns",
        "//:node_modules/scheduler",
        "//client/web/design",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
