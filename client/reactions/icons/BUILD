load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "icons",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        ":icon_svgs",
        "//shared/helpers",
        "//shared/reactions",
    ],
)

js_library(
    name = "icon_svgs",
    srcs = ["reaction_icon_svgs.js"],
)

CREATURES = {
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
}

EMOTIONS = {
    "Celebrate": {"file_name": "celebrate"},
    "DeadInside": {"file_name": "dead_inside"},
    "Hardship": {"file_name": "hardship"},
    "Heart": {"file_name": "heart"},
    "Laugh": {"file_name": "laugh"},
    "Lolsob": {"file_name": "lolsob"},
    "No": {"file_name": "no"},
    "Shock": {"file_name": "shock"},
    "Yes": {"file_name": "yes"},
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
                creature,
                "".join([
                    "        {}: {{\n{}        }},\n".format(
                        variant,
                        "".join([
                            "            {}: \\`\\\\\n$$(cat $(location {}))\\`,\n".format(
                                emotion,
                                "svg/reaction_icon_{}_{}_{}.svg".format(
                                    CREATURES[creature]["file_name"],
                                    CREATURES[creature]["variants"][variant]["file_name"],
                                    EMOTIONS[emotion]["file_name"],
                                ),
                            )
                            for emotion in EMOTIONS
                        ]),
                    )
                    for variant in CREATURES[creature]["variants"]
                ]),
            )
            for creature in CREATURES
        ]),
    ),
)
