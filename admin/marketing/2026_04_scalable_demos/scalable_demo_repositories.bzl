"""
Download demo assets from Google Drive and create Bazel repositories for them.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_file")
load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")

# To download these assets and make them available in Remotion Studio, run:
#
# ```bash
# bazel build //admin/marketing/2026_04_scalable_demos:public
# ```
SCALABLE_DEMOS_REPOSITORIES = {
    "001_share_switch_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1ji0efIw8oP3qSf5ZiNr6EPMfzaSVhCoW/view?usp=drive_link",
        "integrity": "sha256-BPcDLUESIqvZ1cwN8O9wDolceU4fZkC/uNRuFIr8SNI=",
    },
    "002_image_gallery_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1KJB-sgkOlhZc0_JDanW1aiPcezxdm6mf/view?usp=drive_link",
        "integrity": "sha256-V4R3Uog2M1BwpVaVVokJ3BCX5XeQn735a9H1pty/+wM=",
    },
    "003_task_progress_wheel_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1sor6o51E23MwMpE7U_Gpo4MYS3iFWHoV/view?usp=drive_link",
        "integrity": "sha256-nNlskj76obwocwjtwdPmgqKO8/EtVEKRHUFczlBJT8U=",
    },
    "004_reply_to_chat_message_range_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1GFBOu_-Q1gZ0fcOrT0355bYm-pZWMA8y/view?usp=drive_link",
        "integrity": "sha256-llqjr0tNYTDdSjG01QU02jD6E7/KrGiBzxm7KahyNgw=",
    },
    "005_export_table_to_markdown_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1LDn7aMKmqqQkdPyCrcg4rRmljGsYaHud/view?usp=drive_link",
        "integrity": "sha256-C/v+fuRYZqnMl05AVYdK2BYYifgbGjxh2BMnan8bJL8=",
    },
    "rachel_date_background_01.jpeg": {
        "url": "https://drive.google.com/file/d/1AJpgkEwTEBXq9sc_Bvil31I7rfqKCG6s/view?usp=drive_link",
        "integrity": "sha256-kFfKiGfkNtqisvfIs06n+yi5JW32dC8N50xyceMArn0=",
    },
    "rachel_date_background_02.jpeg": {
        "url": "https://drive.google.com/file/d/1ppPnzupPbvBWfBpdbn80A7l2SERg7z6P/view?usp=drive_link",
        "integrity": "sha256-eD6uPmr4UqSFY54US4IAllDZmFXR1DHlGasGtbRkCAI=",
    },
    "rachel_date_background_03.jpeg": {
        "url": "https://drive.google.com/file/d/1yf7z-Mp2nzgTgf4oEhuo3Fe-SRLw1Dni/view?usp=drive_link",
        "integrity": "sha256-v2Q18WZcIwK06HSwggT7D2XI5YzjXLWu+7GxzldDqEM=",
    },
    "rachel_date_background_04.jpeg": {
        "url": "https://drive.google.com/file/d/1uxNO3-IK9MKcUT0_d2PJ0Bax0w0xxqhI/view?usp=drive_link",
        "integrity": "sha256-RiGX4frmmmqc8xOgGr2dNie1YwaxZ9Kiq81Fne38FWA=",
    },
    "rachel_date_background_05.jpeg": {
        "url": "https://drive.google.com/file/d/1hmh2IRu06MwvKUKRe2CqGqa-pOTcUWdC/view?usp=drive_link",
        "integrity": "sha256-7vsQPRsSqeAsJvxqe4rNiItGMv4x4csJU93FLEUZ/E8=",
    },
}

def scalable_demo_repositories():
    """
    Download demo assets from Google Drive and create Bazel repositories for them.
    """

    for name, info in SCALABLE_DEMOS_REPOSITORIES.items():
        extension = name.split(".")[-1]

        if len(extension) == len(name):
            fail("Expected file extension in repository name but got: `{}`".format(name))

        name_without_extension = name[:-(len(extension) + 1)]

        # To convert a Google Drive link into a downlodable URL first copy the file
        # link. You should get a URL in this format:
        #
        # ```
        # https://drive.google.com/file/d/$FILE_ID/view?usp=sharing
        # ```
        #
        # Convert that URL into the following format:
        #
        # ```
        # https://drive.google.com/uc?export=download&id=$FILE_ID
        # ```
        google_drive_file_url_prefix = "https://drive.google.com/file/d/"
        google_drive_file_url_suffix = "/view"

        url = info["url"]
        url = url.split("?")[0]

        if not url.startswith(google_drive_file_url_prefix):
            fail("Expected Google Drive file URL to start with `{}` but got: `{}`".format(google_drive_file_url_prefix, url))

        url = url[len(google_drive_file_url_prefix):]

        if not url.endswith(google_drive_file_url_suffix):
            fail("Expected Google Drive file URL to end with `{}` but got: `{}`".format(google_drive_file_url_suffix, url))

        url = url[:-len(google_drive_file_url_suffix)]

        url = "https://drive.google.com/uc?export=download&id={}".format(url)

        http_file(
            name = "marketing_2026_04_scalable_demos_{}".format(name_without_extension),
            url = url,
            integrity = info["integrity"],
            downloaded_file_path = "file.{}".format(extension),
        )

def scalable_demo_repositories_public():
    """
    Create a `public` directory containing all of our demo assets from Google Drive.
    """

    public_srcs = []

    for name in SCALABLE_DEMOS_REPOSITORIES.keys():
        extension = name.split(".")[-1]
        name_without_extension = name[:-(len(extension) + 1)]

        if extension == "mov":
            native.genrule(
                name = "public_{}_webm".format(name_without_extension),
                outs = ["public/{}.webm".format(name_without_extension)],
                srcs = ["@ffmpeg", "@marketing_2026_04_scalable_demos_{}//file".format(name_without_extension)],
                tags = ["cpu:4"],
                cmd = """
cmd_log="$(RULEDIR)/cmd.log"

"$(RULEDIR)/../../../external/ffmpeg/install/bin/ffmpeg" \\
    -i "$(location @marketing_2026_04_scalable_demos_{name_without_extension}//file)" \\
    -f webm \\
    -threads 4 \\
    -vcodec libvpx-vp9 \\
    -acodec libopus \\
    -row-mt 1 \\
    -deadline realtime \\
    -cpu-used 8 \\
    "$(RULEDIR)/public/{name_without_extension}.webm" >> "$$cmd_log" 2>> "$$cmd_log" || (cat "$$cmd_log" && exit 1)
""".format(
                    name_without_extension = name_without_extension,
                ),
            )

            public_srcs.append("public/{}.webm".format(name_without_extension))
        else:
            copy_file(
                name = "public_{}_{}".format(name_without_extension, extension),
                out = "public/{}.{}".format(name_without_extension, extension),
                src = "@marketing_2026_04_scalable_demos_{}//file".format(name_without_extension),
                allow_symlink = True,
            )

            public_srcs.append("public/{}.{}".format(name_without_extension, extension))

    native.filegroup(
        name = "public",
        srcs = public_srcs,
    )
