load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tracer",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/scheduler",
        "//:node_modules/scheduler",
        "//client/design",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
