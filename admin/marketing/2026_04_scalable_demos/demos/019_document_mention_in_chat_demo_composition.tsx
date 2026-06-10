import {Video} from "@remotion/media";
import {
    documentMentionInChatDemoRecording01FirstFrame,
    documentMentionInChatDemoRecordingHeight,
    documentMentionInChatDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/019_document_mention_in_chat_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {scalableDemoWideViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export function DocumentMentionInChatDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoWideViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_020.png")}
            reaction={{character: {type: "Frog", variant: "Green"}, emotion: "Celebrate"}}
            reactionBottom="-6"
            reactionLeft="0"
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: documentMentionInChatDemoRecordingWidth * 2,
                    height: documentMentionInChatDemoRecordingHeight * 2,
                }}
            >
                <Video
                    src={remotionFile("019_document_mention_in_chat_demo_recording_01.webm")}
                    volume={0}
                    trimBefore={documentMentionInChatDemoRecording01FirstFrame}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight + 10) * 2,
                        left:
                            -(
                                convertRemLengthToPx(
                                    scalableDemoSpaceSideBarWidth,
                                    scalableDemoNarrowViewportSpacingScale,
                                ) + 24
                            ) * 2,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
