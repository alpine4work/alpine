import {Video} from "@remotion/media";
import {
    postReactionsDemoExtraHeight,
    postReactionsDemoRecordingFirstFrame,
    postReactionsDemoRecordingHeight,
    postReactionsDemoRecordingLastFrame,
    postReactionsDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/007_post_reactions_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function PostReactionsDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_007.jpeg")}
            reactionBottom="-8"
            reactionLeft="-1"
            reaction={{character: {type: "Tulip", variant: "Yellow"}, emotion: "Happy"}}
        >
            <div style={{paddingTop: postReactionsDemoExtraHeight * 2}}>
                <div
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        width: postReactionsDemoRecordingWidth * 2,
                        height:
                            (postReactionsDemoRecordingHeight - postReactionsDemoExtraHeight) * 2,
                    }}
                >
                    <Video
                        src={remotionFile("007_post_reactions_demo_recording_01.webm")}
                        trimBefore={postReactionsDemoRecordingFirstFrame}
                        trimAfter={postReactionsDemoRecordingLastFrame}
                        volume={0}
                        style={{
                            position: "absolute",
                            top: -scalableDemoMacOsTopBarAndChromeTopBarHeight * 2,
                            left:
                                -convertRemLengthToPx(
                                    scalableDemoSpaceSideBarWidth,
                                    scalableDemoNarrowViewportSpacingScale,
                                ) * 2,
                            pointerEvents: "none",
                        }}
                    />
                </div>
            </div>
        </ScalableDemoCompositionLayout>
    );
}
