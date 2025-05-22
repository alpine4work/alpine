load("@bazel_skylib//rules:common_settings.bzl", "string_flag")
load("@build_bazel_rules_apple//apple:ios.bzl", "ios_application", "ios_build_test")
load("@build_bazel_rules_apple//apple:versioning.bzl", "apple_bundle_version")
load("@build_bazel_rules_swift//swift:swift.bzl", "swift_library")
load(
    "@rules_xcodeproj//xcodeproj:defs.bzl",
    "top_level_target",
    "xcodeproj",
)
load("//native/mobile/ios:build_config.bzl", "build_config")

sources = glob(["Sources/**/*.swift"])

filegroup(
    name = "sources",
    srcs = sources,
)

filegroup(
    name = "resources_fonts",
    srcs = glob(
        ["Resources/Fonts/**/*"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["**/.*"],
    ),
)

filegroup(
    name = "resources",
    srcs = [
        ":resources_fonts",
        "//native/mobile/ios/Resources/Assets.xcassets",
    ],
)

# NOTE(calebmer, 2023-01-17): Currently, JavaScript code has one flag,
# `process.env.NODE_ENV`, that controls:
#
# - Debug assertions
# - Optimized builds
# - Run environment (e.g. use localhost or alpine.inc domain)
#
# This is too much. It provides us no flexibility to, for instance, run on
# localhost with an optimized build. So over time we should tease apart this
# flag into, at minimum, `compilation_mode` (provided by Bazel) and
# `run_environment`. We're starting this pattern here in iOS. Eventually,
# instead of just having a `run_environment` setting for iOS, we'd like to
# put this in our root `BUILD` file and use it for JavaScript too.
#
# Some notes on how I'd like the run environment to work:
#
# - `development`: We have a full suite of services running on a local machine.
#   This is used by developers while they build out the product. All services
#   are running on some `localhost` port.
#
# - `production`: We are running in our AWS account serving live user traffic.
#   We may have multiple instances of each service to support user traffic
#   scale.
#
# - `test`: We aren't running in a full environment and instead are running a
#   unit test which only has some small set of necessary services or databases
#   running. Unclear whether integration tests should be a `development` or
#   `test` run environment.
#
# Adhoc scripts are either `development` or `production`. You choose which one
# to target from the command line.
#
# When we move the `run_environment` flag to the root `BUILD` file, add a
# [build setting alias][1] so developers can write the very natural looking
# `bazel build //native/mobile/ios --run_environment=production --compilation_mode=opt`.
#
# [1]: https://bazel.build/extending/config#using-build-setting-aliases
string_flag(
    name = "run_environment",
    build_setting_default = "development",
    values = [
        "development",
        "production",
        "test",
    ],
)

config_setting(
    name = "development_run_environment",
    flag_values = {":run_environment": "development"},
)

config_setting(
    name = "production_run_environment",
    flag_values = {":run_environment": "production"},
)

config_setting(
    name = "test_run_environment",
    flag_values = {":run_environment": "test"},
)

config_setting(
    name = "fastbuild_compilation_mode",
    values = {"compilation_mode": "fastbuild"},
)

config_setting(
    name = "dbg_compilation_mode",
    values = {"compilation_mode": "dbg"},
)

config_setting(
    name = "opt_compilation_mode",
    values = {"compilation_mode": "opt"},
)

string_flag(
    name = "base_url",
    build_setting_default = "default",
)

build_config(
    name = "build_config",
    default_base_url = select({
        ":development_run_environment": "http://localhost:3000",
        ":test_run_environment": "http://localhost:3000",
        ":production_run_environment": "http://alpine.inc",
    }),
)

filegroup(
    name = "build_config_swift_files",
    srcs = [":build_config"],
    output_group = "swift_files",
)

filegroup(
    name = "build_config_plist_files",
    srcs = [":build_config"],
    output_group = "plist_files",
)

swift_library(
    name = "lib",
    srcs = [
        ":build_config_swift_files",
        ":sources",
    ],
    # Fail to build if there are warnings.
    copts = ["-warnings-as-errors"],
    data = [":resources"],
    defines = select({
        ":development_run_environment": ["DEVELOPMENT_RUN_ENVIRONMENT"],
        ":production_run_environment": ["PRODUCTION_RUN_ENVIRONMENT"],
        ":test_run_environment": ["TEST_RUN_ENVIRONMENT"],
    }) + select({
        ":fastbuild_compilation_mode": ["FASTBUILD_COMPILATION_MODE"],
        ":dbg_compilation_mode": ["DBG_COMPILATION_MODE"],
        ":opt_compilation_mode": ["OPT_COMPILATION_MODE"],
    }) + select({
        ":default_provisioning_profile": [],
        "//conditions:default": ["PROVISIONING_PROFILE"],
    }),
    module_name = "Cyberworlds",
)

string_flag(
    name = "provisioning_profile",
    build_setting_default = "default",
)

config_setting(
    name = "local_provisioning_profile",
    flag_values = {
        ":provisioning_profile": "local",
    },
)

config_setting(
    name = "default_provisioning_profile",
    flag_values = {
        ":provisioning_profile": "default",
    },
)

config_setting(
    name = "local_provisioning_profile_and_production_run_environment",
    flag_values = {
        ":provisioning_profile": "local",
        ":run_environment": "production",
    },
)

apple_bundle_version(
    name = "app_version",
    build_version = "1.0.6",
    short_version_string = "1.0",
)

IOS_MINIMUM_VERSION = "17.0"

ios_application(
    name = "app",
    app_icons = ["//native/mobile/ios/Resources/Assets.xcassets:AppIcon.appiconset"],
    bundle_id = select({
        ":local_provisioning_profile_and_production_run_environment": "inc.alpine.mobile.app",
        # Different `bundle_id` in development so we can have a development version and
        # production version installed on a device at the same time.
        "//conditions:default": "dev.cyberworlds.mobile.app",
    }),
    bundle_name = "Alpine",
    entitlements = select({
        ":local_provisioning_profile_and_production_run_environment": "Resources/Entitlements/ProductionEntitlements.entitlements",
        ":local_provisioning_profile": "Resources/Entitlements/DevelopmentEntitlements.entitlements",
        "//conditions:default": "Resources/Entitlements/DevelopmentEntitlementsWithoutProvisioningProfile.entitlements",
    }),
    families = [
        "iphone",
        "ipad",
    ],
    infoplists = [":build_config_plist_files"],
    launch_storyboard = "Resources/Launch.storyboard",
    minimum_os_version = IOS_MINIMUM_VERSION,
    # To build with the local provisioning profile:
    #
    # ```
    # bazel build //native/mobile/ios:app --//native/mobile/ios:provisioning_profile=local
    # ```
    provisioning_profile = select({
        ":local_provisioning_profile_and_production_run_environment": "Resources/LocalProductionProvisioningProfile.mobileprovision",
        ":local_provisioning_profile": "Resources/LocalDevelopmentProvisioningProfile.mobileprovision",
        "//conditions:default": None,
    }),
    version = ":app_version",
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
    # Can only run this test on MacOS where we have Swift installed on the system.
    tags = ["macos"],
)

ios_build_test(
    name = "build_test",
    size = "small",
    minimum_os_version = IOS_MINIMUM_VERSION,
    # Can only run this test on MacOS where we have XCode CC toolchains.
    tags = ["macos"],
    targets = [":lib"],
)

xcodeproj(
    name = "xcodeproj",
    build_mode = "bazel",
    default_xcode_configuration = "Debug",
    project_name = "App",
    tags = ["manual"],
    top_level_targets = [
        top_level_target(
            ":app",
            target_environments = [
                "simulator",
            ],
        ),
    ],
    xcode_configurations = {
        "Debug": {
            "//command_line_option:compilation_mode": "dbg",
        },
        "Release": {
            "//command_line_option:compilation_mode": "opt",
        },
    },
)
