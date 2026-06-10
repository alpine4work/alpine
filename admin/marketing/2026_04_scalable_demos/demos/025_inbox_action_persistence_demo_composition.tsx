import {Video} from "@remotion/media";
import {
    inboxActionPersistenceDemoRecording01FirstFrame,
    inboxActionPersistenceDemoRecordingHeight,
    inboxActionPersistenceDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/025_inbox_action_persistence_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {scalableDemoMacOsTopBarAndChromeTopBarHeight} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_mac_os_top_bar_and_chrome_top_bar_height.js";

export function InboxActionPersistenceDemoComposition() {
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: inboxActionPersistenceDemoRecordingWidth * 2,
                height: inboxActionPersistenceDemoRecordingHeight * 2,
            }}
        >
            <Video
                src={remotionFile("025_inbox_action_persistence_demo_recording_01.webm")}
                volume={0}
                trimBefore={inboxActionPersistenceDemoRecording01FirstFrame}
                style={{
                    position: "absolute",
                    top: -(scalableDemoMacOsTopBarAndChromeTopBarHeight * 2),
                    left: 0,
                    pointerEvents: "none",
                }}
            />
        </div>
    );
}
