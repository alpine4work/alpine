load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "feed",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/content",
        "//client/web/context",
        "//client/web/design",
        "//client/web/forum",
        "//client/web/helpers",
        "//client/web/icons",
        "//client/web/navigation",
        "//client/web/search",
        "//client/web/spaces",
        "//client/web/styles",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/search/path",
    ],
)
