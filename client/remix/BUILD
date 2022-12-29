load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "remix",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/react",
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//shared/helpers",
        "//shared/remix",
        "//shared/schema",
    ],
)
