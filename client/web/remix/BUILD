load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "remix",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/react",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/jest",
        "//:node_modules/@types/js-cookie",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/js-cookie",
        "//:node_modules/react",
        "//:node_modules/react-aria",
        "//:node_modules/react-dom",
        "//:node_modules/react-router",
        "//:node_modules/react-router-dom",
        "//client/web/helpers",
        "//shared/design",
        "//shared/helpers",
        "//shared/messaging",
        "//shared/remix",
        "//shared/schema",
        "//shared/search",
    ],
)
