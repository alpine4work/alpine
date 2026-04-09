import {Video} from "@remotion/media";
import {
    replyToChatMessageRangeDemoRecording01FirstFrame,
    replyToChatMessageRangeDemoRecordingHeight,
    replyToChatMessageRangeDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/004_reply_to_chat_message_range_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoDefaultViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function ReplyToChatMessageRangeDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoDefaultViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_04.jpeg")}
            reactionBottom="-7"
            reactionLeft="-2"
            reaction={{character: {type: "Frog", variant: "Green"}, emotion: "Lolsob"}}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: replyToChatMessageRangeDemoRecordingWidth * 2,
                    height: replyToChatMessageRangeDemoRecordingHeight * 2,
                }}
            >
                <Video
                    src={remotionFile("004_reply_to_chat_message_range_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={replyToChatMessageRangeDemoRecording01FirstFrame}
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
        </ScalableDemoCompositionLayout>
    );
}
