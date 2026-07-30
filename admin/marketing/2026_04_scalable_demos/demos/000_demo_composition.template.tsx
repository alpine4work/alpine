import {Video} from "@remotion/media";
// @ts-expect-error — template placeholder path
import {__demoName__DemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/__DEMO_NUMBER_____DEMO_NAME___demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {scalableDemoDefaultViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";

export function __DemoName__DemoComposition() {
    return (
        <div
            style={{
                position: "relative",
                overflow: "hidden",
                width: scalableDemoDefaultViewport.width * 2,
                height: scalableDemoDefaultViewport.height * 2,
            }}
        >
            <Video
                src={remotionFile("__DEMO_NUMBER_____DEMO_NAME___demo_recording_01.webm")}
                volume={0}
                trimBefore={__demoName__DemoRecording01FirstFrame}
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
