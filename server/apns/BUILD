load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "apns",
    data = [
        "certificates/apns_development_cert.pem",
        "certificates/apns_development_key.pem",
    ],
    visibility = [
        "//admin/adhoc:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/date-fns",
        "//server/context",
        "//server/helpers",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
