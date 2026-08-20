load("//admin/typescript:typescript.bzl", "ts_project")

# Stub files replace these private interfaces in the public archive. Declaring the destinations as
# Bazel file labels proves they exist without reading their proprietary contents into the archive action.
filegroup(
    name = "open_source_stub_destinations",
    srcs = [
        "fetch_external_service.ts",
        "types/tracer_event_data.ts",
        "types/tracer_service_name.ts",
    ],
    visibility = ["//admin/open_source:__pkg__"],
)

ts_project(
    name = "tracer",
    test_deps = ["//:node_modules/expect-type"],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/tough-cookie",
        "//:node_modules/cookie",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/tough-cookie",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
