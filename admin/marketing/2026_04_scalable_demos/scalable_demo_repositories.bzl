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
    "006_channel_and_chat_room_file_preview_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1vnYdh_tkwKS4lboISWYaAJRE068eReey/view?usp=drive_link",
        "integrity": "sha256-NQ8IX3p5+2C43rw3rXS70ML6hTCKYbbNomKmohruEkU=",
    },
    "007_post_reactions_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/183LyNNJcl0KuvRmKQ3JYBiI_WOmZwJOG/view?usp=drive_link",
        "integrity": "sha256-YepOwz/7156NOTsjGjSPw2SntfZCQTYM5AA7jCPyvV0=",
    },
    "008_document_agent_collaboration_demo_recording_01.webm": {
        "url": "https://drive.google.com/file/d/182EAmlJFet2M3rnI_lFdWhbkFb-6p4bi/view?usp=drive_link",
        "integrity": "sha256-i+NZRvnYRZzYB5do2YfkiPd3X9i+dolmky+VZFdACBc=",
    },
    "009_task_templates_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1PDyHR5huCCoH-kpOjjMk4KrxfS44PzEJ/view?usp=drive_link",
        "integrity": "sha256-ntMKbFCl8vMYVw6pfFdFG7W1P0qtsBNY6dn3xoo1E+c=",
    },
    "010_paste_bullet_list_into_tasks_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/16dcaTbueeSwiAAHukxq2v_oqdXfrKnYE/view?usp=drive_link",
        "integrity": "sha256-34ycRNsDrvgFjssGpC2NNnNTtNYWDJAkmkOdzo+Kf70=",
    },
    "011_search_project_preview_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1x9OyrwhQITU7nWJ5rV_UMaxv_aylz7eL/view?usp=drive_link",
        "integrity": "sha256-LpUK/1FWU9MM01k4F+B5QOySiv+nW5tZJbBxorg/kEs=",
    },
    "012_chat_message_paragraph_reactions_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1t2gZpSjKBy-AJYmLviJ2gxztbjxJr5-H/view?usp=drive_link",
        "integrity": "sha256-08TFn3uH49Tbqz5ymRn4G+58szyNC3hkOLqFGWRck98=",
    },
    "013_inbox_triage_demo_recording_01.mov": {
        "url": "https://drive.google.com/file/d/1ESg0p2bqItpMOQtOPfY5FPrTKmhs2nKP/view?usp=drive_link",
        "integrity": "sha256-2PO5WJComF2cEPOTdwaDMnNhDJmxRtMr8P+bky3o3BE=",
    },
    "rachel_date_background_01.jpeg": {
        "url": "https://drive.google.com/file/d/1AJpgkEwTEBXq9sc_Bvil31I7rfqKCG6s/view?usp=drive_link",
        "integrity": "sha256-kFfKiGfkNtqisvfIs06n+yi5JW32dC8N50xyceMArn0=",
    },
    "rachel_date_background_002.jpeg": {
        "url": "https://drive.google.com/file/d/1ppPnzupPbvBWfBpdbn80A7l2SERg7z6P/view?usp=drive_link",
        "integrity": "sha256-eD6uPmr4UqSFY54US4IAllDZmFXR1DHlGasGtbRkCAI=",
    },
    "rachel_date_background_003.jpeg": {
        "url": "https://drive.google.com/file/d/1yf7z-Mp2nzgTgf4oEhuo3Fe-SRLw1Dni/view?usp=drive_link",
        "integrity": "sha256-v2Q18WZcIwK06HSwggT7D2XI5YzjXLWu+7GxzldDqEM=",
    },
    "rachel_date_background_004.jpeg": {
        "url": "https://drive.google.com/file/d/1uxNO3-IK9MKcUT0_d2PJ0Bax0w0xxqhI/view?usp=drive_link",
        "integrity": "sha256-RiGX4frmmmqc8xOgGr2dNie1YwaxZ9Kiq81Fne38FWA=",
    },
    "rachel_date_background_005.jpeg": {
        "url": "https://drive.google.com/file/d/1hmh2IRu06MwvKUKRe2CqGqa-pOTcUWdC/view?usp=drive_link",
        "integrity": "sha256-7vsQPRsSqeAsJvxqe4rNiItGMv4x4csJU93FLEUZ/E8=",
    },
    "rachel_date_background_006.heif": {
        "url": "https://drive.google.com/file/d/15-FH2VOIBM7vc0R3i07gaxIXY1eH6Erx/view?usp=drive_link",
        "integrity": "sha256-QAw0pjj1F9x1I+NKV3wXLjz1JnQK3f24uzm6k534rxo=",
    },
    "rachel_date_background_007.heif": {
        "url": "https://drive.google.com/file/d/1iqsKjK9ps6N5vDeTU6mQIqQu5hiZomfC/view?usp=drive_link",
        "integrity": "sha256-QfrzIt58BnHR3Y9qIFIZLVhtBAOm7378Z1ZekhrkBv8=",
    },
    "rachel_date_background_008.webm": {
        "url": "https://drive.google.com/file/d/1YO7kCdX8r8DfFvwB4Jh68gEbzdGV7vko/view?usp=drive_link",
        "integrity": "sha256-ZZCiEqL5ZCAnDFeIxkNySKOiye59hzVleAw/sMYkvk0=",
    },
    "rachel_date_background_009.heif": {
        "url": "https://drive.google.com/file/d/1UMi38c18oGu8ip41kFS8bTpitV6pxCEb/view?usp=drive_link",
        "integrity": "sha256-2UfR5rawZt8HhgIumbidCLCvWJUYF9YFOWTDiz7ZmlQ=",
    },
    "rachel_date_background_010.heif": {
        "url": "https://drive.google.com/file/d/110XDYaZK54EB_cV82jv9t6ShpMr-cmiu/view?usp=drive_link",
        "integrity": "sha256-CiEuwD1pmFaDry3MGC36iopfC02iMNnJSBKBO/EU2xw=",
    },
    "rachel_date_background_011.heif": {
        "url": "https://drive.google.com/file/d/1sigpL4XVMWDboS8YjTkgp8K5FuPcxoK7/view?usp=drive_link",
        "integrity": "sha256-vBhigmZdhtlMaqDNBvPgsudyin1OH3TsRNvALnfdkZg=",
    },
    "rachel_date_background_012.jpeg": {
        "url": "https://drive.google.com/file/d/1hZRUMh7qLzrrqMvFCQOzm1s6fDoTY_iS/view?usp=drive_link",
        "integrity": "sha256-n/QxoDmQnc/Ucs34Ei5GAoALHcMZoYtIDlRtWnng3JQ=",
    },
    "rachel_date_background_013.heif": {
        "url": "https://drive.google.com/file/d/1E08SW9uFtZ1Op5Sxe5dopIpDVHfpFvSg/view?usp=drive_link",
        "integrity": "sha256-uhNeXzmnaacq4kluLv6eBXNVC+obz9GZ3d3FFwsiW8s=",
    },
    "rachel_date_background_014.heif": {
        "url": "https://drive.google.com/file/d/1BWvL-w16t-o9TWUeGU_vC3zKH4YNJXFi/view?usp=drive_link",
        "integrity": "sha256-poRq0LVsBmOF/scfflZvYYzHtduAPPItq7bVTEv/GU0=",
    },
    "rachel_date_background_015.heif": {
        "url": "https://drive.google.com/file/d/1r0fSU6wAkfVM5wlpKWfkiTUagU7y6cR2/view?usp=drive_link",
        "integrity": "sha256-KypnwKTrMDgZhbf8uqw60sXXbr+7I7+jq1HMhn3wz5w=",
    },
    "rachel_date_background_016.heif": {
        "url": "https://drive.google.com/file/d/1OwwywegF9egWnAsO7sixoYeVb-KXs16h/view?usp=drive_link",
        "integrity": "sha256-NOOuEa979EVBuc0AUlGVngvCbgLmiFmZudOovXuVzs4=",
    },
    "rachel_date_background_017.heif": {
        "url": "https://drive.google.com/file/d/1iy-W-FYimI8iiH8qMVokdDokwqAcsXEK/view?usp=drive_link",
        "integrity": "sha256-gqzOE6A1gIvhtBujro/ftByiaiybRIlZ0hCMmw9Kp/M=",
    },
    "rachel_date_background_018.heif": {
        "url": "https://drive.google.com/file/d/1G75XyJeH3L0MHVFXY50OM5JqPcv3PLu-/view?usp=drive_link",
        "integrity": "sha256-veQykiQ60LTKjdR9a5JI8zTl/6ACb/MicaxgvUpprNQ=",
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
        elif extension == "heif":
            native.genrule(
                name = "public_{}_jpeg".format(name_without_extension),
                outs = ["public/{}.jpeg".format(name_without_extension)],
                srcs = [
                    "//:node_modules/sharp",
                    "//:node",
                    "@marketing_2026_04_scalable_demos_{}//file".format(name_without_extension),
                ],
                cmd = """
bazel_sandbox="$$(pwd)"
cmd_log="$$bazel_sandbox/$(RULEDIR)/cmd.log"

cd "$(RULEDIR)/../../.."

"$$bazel_sandbox/$(location //:node)" \\
    -e 'const sharp = require("sharp"); (async () => {{ await sharp(process.argv[1]).rotate().jpeg().toFile(process.argv[2]) }})().catch(error => {{ console.error(error); process.exit(1) }})' \\
    "$$bazel_sandbox/$(location @marketing_2026_04_scalable_demos_{name_without_extension}//file)" \\
    "$$bazel_sandbox/$(RULEDIR)/public/{name_without_extension}.jpeg" >> "$$cmd_log" 2>> "$$cmd_log" || (cat "$$cmd_log" && exit 1)
""".format(
                    name_without_extension = name_without_extension,
                ),
            )

            public_srcs.append("public/{}.jpeg".format(name_without_extension))
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
