load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/color",
        "//:node_modules/@types/d3-interpolate",
        "//:node_modules/color",
        "//:node_modules/d3-interpolate",
        "//client/web/helpers/gl",
        "//shared/design",
        "//shared/helpers",
    ],
)
