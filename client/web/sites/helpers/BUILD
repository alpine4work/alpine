load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = [
        "//client/web/chat:__subpackages__",
        "//client/web/documents:__subpackages__",
        "//client/web/forum:__subpackages__",
        "//client/web/tasks:__subpackages__",
        "//client/web/sites:__subpackages__",
        "//client/web/navigation:__subpackages__",
    ],
    deps = [
        "//client/web/context",
        "//client/web/remix",
        "//shared/access",
        "//shared/rpc",
        "//shared/sites",
    ],
)
