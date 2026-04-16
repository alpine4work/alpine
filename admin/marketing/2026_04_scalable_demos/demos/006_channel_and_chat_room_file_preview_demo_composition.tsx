import {
    channelAndChatRoomFilePreviewDemoRecordingFirstFrame,
    channelAndChatRoomFilePreviewDemoRecordingHeight,
    channelAndChatRoomFilePreviewDemoRecordingJumpCuts,
    channelAndChatRoomFilePreviewDemoRecordingLastFrame,
    channelAndChatRoomFilePreviewDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/006_channel_and_chat_room_file_preview_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {ScalableDemoCompositionLayout} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_composition_layout.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {VideoWithJumpCuts} from "~/admin/marketing/2026_04_scalable_demos/helpers/video_with_jump_cuts.js";

export function ChannelAndChatRoomFilePreviewDemoComposition() {
    return (
        <ScalableDemoCompositionLayout
            spacingScale={scalableDemoNarrowViewportSpacingScale}
            backgroundImageSrc={remotionFile("rachel_date_background_006.jpeg")}
            reactionBottom="-12"
            reactionLeft="3"
            reaction={{character: {type: "Tree", variant: "Pink"}, emotion: "Yes"}}
        >
            <div
                style={{
                    position: "relative",
                    overflow: "hidden",
                    width: channelAndChatRoomFilePreviewDemoRecordingWidth * 2,
                    height: channelAndChatRoomFilePreviewDemoRecordingHeight * 2,
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        zIndex: 10,
                        width: 30,
                        top: 0,
                        bottom: 0,
                        right: 0,
                        backgroundColor: "white",
                    }}
                />
                <VideoWithJumpCuts
                    src={remotionFile(
                        "006_channel_and_chat_room_file_preview_demo_recording_01.webm",
                    )}
                    trimBefore={channelAndChatRoomFilePreviewDemoRecordingFirstFrame}
                    trimAfter={channelAndChatRoomFilePreviewDemoRecordingLastFrame}
                    trimSections={channelAndChatRoomFilePreviewDemoRecordingJumpCuts}
                    volume={0}
                    style={{
                        position: "absolute",
                        top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2),
                        left: 0,
                        pointerEvents: "none",
                    }}
                />
            </div>
        </ScalableDemoCompositionLayout>
    );
}
