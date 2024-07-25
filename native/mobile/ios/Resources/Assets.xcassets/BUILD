load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

# To understand the `.xcassets` format, we recommend looking at the
# documentation here:
# https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/FolderStructure.html
filegroup(
    name = "Assets.xcassets",
    srcs = [
        "AppIcon.appiconset",
        "Colors/Contents.json",
        "Contents.json",
        "Icons/Contents.json",
        "RootTabBarShadow.imageset",
        ":color_assets",
        ":icon_assets",
    ],
    visibility = ["//native/mobile/ios:__subpackages__"],
)

filegroup(
    name = "AppIcon.appiconset",
    srcs = glob(
        ["AppIcon.appiconset/**/*"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["**/.*"],
    ),
    visibility = ["//native/mobile/ios:__subpackages__"],
)

filegroup(
    name = "RootTabBarShadow.imageset",
    srcs = glob(
        ["RootTabBarShadow.imageset/**/*"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["**/.*"],
    ),
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
    "SpinnerGap",
]

js_binary(
    name = "generate_icon_assets",
    data = [":assets_lib"],
    entry_point = "Icons/generate_icon_assets_main.js",
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
    entry_point = "Colors/generate_color_assets_main.js",
    env = {"NODE_ENV": "development"},
)

COLORS = [
    "grey-0",
    "grey-5",
    "grey-10",
    "grey-20",
    "grey-30",
    "grey-40",
    "grey-50",
    "grey-60",
    "grey-70",
    "grey-80",
    "grey-90",
    "grey-100",
    "indigo-10",
    "indigo-20",
    "indigo-30",
    "indigo-40",
    "indigo-50",
    "indigo-60",
    "indigo-70",
    "indigo-80",
    "indigo-90",
    "grey-0-const",
    "red-50-const",
]

js_run_binary(
    name = "color_assets",
    outs = ["Colors/{}.colorset/Contents.json".format(color) for color in COLORS],
    args = COLORS,
    chdir = package_name(),
    tool = ":generate_color_assets",
)
