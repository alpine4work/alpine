load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "feed",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/content",
        "//client/context",
        "//client/design",
        "//client/forum",
        "//client/helpers",
        "//client/icons",
        "//client/navigation",
        "//client/search",
        "//client/spaces",
        "//client/styles",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
