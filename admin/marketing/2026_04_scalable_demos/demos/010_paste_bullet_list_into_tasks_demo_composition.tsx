import {
    pasteBulletListIntoTasksDemoRecordingFirstFrame,
    pasteBulletListIntoTasksDemoRecordingHeight,
    pasteBulletListIntoTasksDemoRecordingJumpCuts,
    pasteBulletListIntoTasksDemoRecordingLastFrame,
    pasteBulletListIntoTasksDemoRecordingPaddingTop,
    pasteBulletListIntoTasksDemoRecordingPaddingX,
    pasteBulletListIntoTasksDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/010_paste_bullet_list_into_tasks_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {scalableDemoWideViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function PasteBulletListIntoTasksDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_010.jpeg")}
            reactionBottom="-6"
            reactionLeft="3"
            reaction={{character: {type: "Pigeon", variant: "Brown"}, emotion: "Yes"}}
        >
            <div
                style={{
                    paddingTop: pasteBulletListIntoTasksDemoRecordingPaddingTop,
                    paddingLeft: pasteBulletListIntoTasksDemoRecordingPaddingX,
                    paddingRight: pasteBulletListIntoTasksDemoRecordingPaddingX,
                }}
            >
                <div
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        width:
                            (pasteBulletListIntoTasksDemoRecordingWidth -
                                pasteBulletListIntoTasksDemoRecordingPaddingX * 2) *
                            2,
                        height:
                            (pasteBulletListIntoTasksDemoRecordingHeight -
                                pasteBulletListIntoTasksDemoRecordingPaddingTop) *
                            2,
                    }}
                >
                    <VideoWithJumpCuts
                        src={remotionFile(
                            "010_paste_bullet_list_into_tasks_demo_recording_01.webm",
                        )}
                        trimBefore={pasteBulletListIntoTasksDemoRecordingFirstFrame}
                        trimAfter={pasteBulletListIntoTasksDemoRecordingLastFrame}
                        trimSections={pasteBulletListIntoTasksDemoRecordingJumpCuts}
                        volume={0}
                        style={{
                            position: "absolute",
                            top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2),
                            left:
                                -convertRemLengthToPx(
                                    scalableDemoSpaceSideBarWidth,
                                    scalableDemoWideViewportSpacingScale,
                                ) * 2,
                            pointerEvents: "none",
                        }}
                    />
                </div>
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
