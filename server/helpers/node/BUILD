load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "node",
    data = [":wait_for_http_server"],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//shared/error",
        "//shared/helpers",
    ],
)

sh_binary(
    name = "wait_for_http_server",
    srcs = ["wait_for_http_server.sh"],
)
