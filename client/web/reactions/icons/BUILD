load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "icons",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        ":icon_svgs",
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/styles",
        "//shared/design",
        "//shared/helpers",
        "//shared/reactions",
    ],
)

js_library(
    name = "icon_svgs",
    srcs = ["reaction_icon_svgs.js"],
)

CHARACTERS = {
    "Cat": {
        "file_name": "cat",
        "variants": {
            "Grey": {"file_name": "grey"},
            "Pink": {"file_name": "pink"},
            "Yellow": {"file_name": "yellow"},
        },
    },
    "Tree": {
        "file_name": "tree",
        "variants": {
            "Blue": {"file_name": "blue"},
            "Green": {"file_name": "green"},
            "Pink": {"file_name": "pink"},
        },
    },
    "Yeti": {
        "file_name": "yeti",
        "variants": {
            "Blue": {"file_name": "blue"},
            "Brown": {"file_name": "brown"},
            "Olive": {"file_name": "olive"},
        },
    },
    "Frog": {
        "file_name": "frog",
        "variants": {
            "Green": {"file_name": "green"},
            "Cyan": {"file_name": "cyan"},
            "Yellow": {"file_name": "yellow"},
        },
    },
    "Pigeon": {
        "file_name": "pigeon",
        "variants": {
            "Plain": {"file_name": "plain"},
            "Brown": {"file_name": "brown"},
            "Grey": {"file_name": "grey"},
        },
    },
    "Tulip": {
        "file_name": "tulip",
        "variants": {
            "Yellow": {"file_name": "yellow"},
            "Pink": {"file_name": "pink"},
            "Violet": {"file_name": "violet"},
        },
    },
}

EMOTIONS = {
    "Celebrate": {"file_name": "celebrate"},
    "DeadInside": {"file_name": "dead_inside"},
    "Hardship": {"file_name": "hardship"},
    "Happy": {"file_name": "happy"},
    "Laugh": {"file_name": "laugh"},
    "Lolsob": {"file_name": "lolsob"},
    "Shock": {"file_name": "shock"},
    "Heart": {"file_name": "heart"},
    "Yes": {"file_name": "yes"},
    "No": {"file_name": "no"},
    "ThankYou": {"file_name": "thank_you"},
}

genrule(
    name = "icon_svgs_genrule",
    srcs = glob(["svg/*.svg"]),
    outs = ["reaction_icon_svgs.js"],
    cmd = """
echo "export const reactionIconSvgs = {{\n{out}}};" > $@
""".format(
        out = "".join([
            "    {}: {{\n{}    }},\n".format(
                character,
                "".join([
                    "        {}: {{\n{}        }},\n".format(
                        variant,
                        "".join([
                            "            {}: \\`\\\\\n$$(cat $(location {}))\\`,\n".format(
                                emotion,
                                "svg/reaction_icon_{}_{}_{}.svg".format(
                                    CHARACTERS[character]["file_name"],
                                    CHARACTERS[character]["variants"][variant]["file_name"],
                                    EMOTIONS[emotion]["file_name"],
                                ),
                            )
                            for emotion in EMOTIONS
                        ]),
                    )
                    for variant in CHARACTERS[character]["variants"]
                ]),
            )
            for character in CHARACTERS
        ]),
    ),
)
