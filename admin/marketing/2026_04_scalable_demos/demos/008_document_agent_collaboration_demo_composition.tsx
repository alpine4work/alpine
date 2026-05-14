import {
    documentAgentCollaborationDemoRecordingFirstFrame,
    documentAgentCollaborationDemoRecordingHeight,
    documentAgentCollaborationDemoRecordingJumpCuts,
    documentAgentCollaborationDemoRecordingLastFrame,
    documentAgentCollaborationDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/008_document_agent_collaboration_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionDeprecatedLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_deprecated_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoWideViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function DocumentAgentCollaborationDemoComposition() {
    return (
        <ScalableDemoCompositionDeprecatedLayout
            spacingScale={scalableDemoWideViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_008.jpeg")}
            reactionBottom="-7"
            reactionLeft="1"
            reaction={{character: {type: "Yeti", variant: "Blue"}, emotion: "Lolsob"}}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: documentAgentCollaborationDemoRecordingWidth * 2,
                    height: documentAgentCollaborationDemoRecordingHeight * 2,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        zIndex: 10,
                        width: 30,
                        top: 0,
                        bottom: 100,
                        right: 0,
                        backgroundColor: "white",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        zIndex: 10,
                        width: 60,
                        height: 60,
                        top: 0,
                        right: 0,
                        backgroundColor: "white",
                    }}
                />
                <VideoWithJumpCuts
                    src={remotionFile("008_document_agent_collaboration_demo_recording_01.webm")}
                    trimBefore={documentAgentCollaborationDemoRecordingFirstFrame}
                    trimAfter={documentAgentCollaborationDemoRecordingLastFrame}
                    trimSections={documentAgentCollaborationDemoRecordingJumpCuts}
                    volume={0}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarDeprecatedHeight * 2),
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionDeprecatedLayout>
    );
}
