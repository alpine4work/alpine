load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

# To understand the `.xcassets` format, we recommend looking at the
# documentation here:
# https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/FolderStructure.html
filegroup(
    name = "Assets.xcassets",
    srcs = [
        "Contents.json",
        "RootTabBarShadow.imageset",
        ":icon_assets",
    ],
    visibility = ["//native/mobile/ios:__subpackages__"],
)

filegroup(
    name = "RootTabBarShadow.imageset",
    srcs = glob(["RootTabBarShadow.imageset/**/*"]),
)

ts_project(
    name = "assets_lib",
    deps = [
        "//:node_modules/@resvg/resvg-js",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/fs-extra",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//shared/helpers",
    ],
)

ICONS = [
    "House",
    "MagnifyingGlass",
    "Plus",
    "Bell",
    "List",
]

js_binary(
    name = "generate_icon_assets",
    data = [":assets_lib"],
    entry_point = "generate_icon_assets_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "icon_assets",
    outs = ["{icon}Icon.imageset/Contents.json".format(icon = icon) for icon in ICONS] +
           ["{icon}Icon.imageset/{icon}Icon.png".format(icon = icon) for icon in ICONS] +
           ["{icon}Icon.imageset/{icon}Icon_2x.png".format(icon = icon) for icon in ICONS] +
           ["{icon}Icon.imageset/{icon}Icon_3x.png".format(icon = icon) for icon in ICONS],
    args = ICONS,
    chdir = package_name(),
    # NOCOMMIT: Just for debugging
    silent_on_success = False,
    tool = ":generate_icon_assets",
)
