load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "peek",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@dnd-kit/core",
        "//:node_modules/@remix-run/router",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/motion",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//:node_modules/react-router",
        "//:node_modules/react-router-dom",
        "//client/web/content",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/remix",
        "//client/web/spaces",
        "//client/web/styles",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
