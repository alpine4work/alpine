load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    test_deps = [
        "//:node_modules/@testing-library/react",
        "//:node_modules/react-dom",
    ],
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//client/web/context",
        "//client/web/helpers",
        "//client/web/web_socket",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
