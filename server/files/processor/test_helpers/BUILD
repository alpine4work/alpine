load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/files/processor:__pkg__"],
    deps = [
        "//:node_modules/@miniflare/r2",
        "//:node_modules/@miniflare/storage-file",
        "//:node_modules/@types/node",
        "//:node_modules/decode-ico",
        "//:node_modules/get-port",
        "//:node_modules/looks-same",
        "//server/cloudflare/r2",
        "//server/dynamo/test_helpers",
        "//server/edge:upload_file_testonly",
        "//server/files/data",
        "//server/files/processor:processor_lib",
        "//server/helpers",
        "//server/spaces",
        "//server/spaces/test_helpers",
        "//shared/files",
        "//shared/helpers",
        "//shared/rpc",
    ],
)
