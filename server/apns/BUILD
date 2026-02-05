load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

js_library(
    name = "apns_development_certificates",
    data = [
        "certificates/apns_development_certificate.pem",
        "certificates/apns_development_certificate_private_key.pem",
    ],
    no_copy_to_bin = [
        "certificates/apns_development_certificate.pem",
        "certificates/apns_development_certificate_private_key.pem",
    ],
    visibility = [
        "//admin/adhoc:__pkg__",
        "//admin/dev:__pkg__",
        "//admin/environment/test/integration:__pkg__",
    ],
)

ts_project(
    name = "apns",
    visibility = [
        "//admin/adhoc:__pkg__",
        "//app:__pkg__",
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
