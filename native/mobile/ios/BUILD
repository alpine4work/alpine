load("@bazel_skylib//rules:build_test.bzl", "build_test")
load("@build_bazel_rules_apple//apple:ios.bzl", "ios_application")
load("@build_bazel_rules_swift//swift:swift.bzl", "swift_library")

sources = glob(["Sources/**/*.swift"])

filegroup(
    name = "sources",
    srcs = sources,
)

filegroup(
    name = "resources_fonts",
    srcs = glob(["Resources/Fonts/**/*"]),
)

filegroup(
    name = "resources",
    srcs = [
        ":resources_fonts",
        "//native/mobile/ios/Resources/Assets.xcassets",
    ],
)

swift_library(
    name = "lib",
    srcs = [":sources"],
    # Fail to build if there are warnings.
    copts = ["-warnings-as-errors"],
    data = [":resources"],
    module_name = "Cyberworlds",
)

ios_application(
    name = "app",
    bundle_id = "dev.cyberworlds.app",
    families = [
        "iphone",
        "ipad",
    ],
    infoplists = ["Resources/Info.plist"],
    launch_storyboard = "Resources/Launch.storyboard",
    minimum_os_version = "16.0",
    visibility = ["//visibility:public"],
    deps = [":lib"],
)

sh_test(
    name = "format_test",
    srcs = ["swift_format_test.sh"],
    args = ["{}/{}".format(
        package_name(),
        source,
    ) for source in sources] + ["Package.swift"],
    data = [
        "swift_format_config.json",
        ":sources",
        "//:Package.swift",
        "//admin/vendor:swift-format",
    ],
)

build_test(
    name = "build_test",
    targets = [":app"],
)
