import {Video} from "@remotion/media";
import {shareTaskCollectionToChatDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/029_share_task_collection_to_chat_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";

export function ShareTaskCollectionToChatDemoComposition() {
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: scalableDemoWideViewport.width * 2,
                height: scalableDemoWideViewport.height * 2,
            }}
        >
            <Video
                src={remotionFile("029_share_task_collection_to_chat_demo_recording_01.webm")}
                volume={0}
                trimBefore={shareTaskCollectionToChatDemoRecording01FirstFrame}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    pointerEvents: "none",
                }}
            />
        </div>
    );
}
