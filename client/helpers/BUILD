load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/color",
        "//:node_modules/@types/dedent",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/react",
        "//:node_modules/color",
        "//:node_modules/dedent",
        "//:node_modules/react",
        "//:node_modules/react-router-dom",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
