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
        ":color_assets",
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
        "//:node_modules/@types/color",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/react",
        "//:node_modules/@types/react-dom",
        "//:node_modules/color",
        "//:node_modules/fs-extra",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//shared/design",
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
    outs = ["Icons/{icon}Icon.imageset/Contents.json".format(icon = icon) for icon in ICONS] +
           ["Icons/{icon}Icon.imageset/{icon}Icon.png".format(icon = icon) for icon in ICONS] +
           ["Icons/{icon}Icon.imageset/{icon}Icon_2x.png".format(icon = icon) for icon in ICONS] +
           ["Icons/{icon}Icon.imageset/{icon}Icon_3x.png".format(icon = icon) for icon in ICONS],
    args = ICONS,
    chdir = package_name(),
    tool = ":generate_icon_assets",
)

js_binary(
    name = "generate_color_assets",
    data = [":assets_lib"],
    entry_point = "generate_color_assets_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "color_assets",
    chdir = package_name(),
    out_dirs = ["Colors"],
    tool = ":generate_color_assets",
)
