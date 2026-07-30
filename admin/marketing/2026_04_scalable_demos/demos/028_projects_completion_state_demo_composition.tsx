import {Video} from "@remotion/media";
import {projectsCompletionStateDemoRecording01FirstFrame} from "~/admin/marketing/2026_04_scalable_demos/demos/028_projects_completion_state_demo_shared.js";
import {remotionFile} from "~/admin/marketing/2026_04_scalable_demos/helpers/remotion_file.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";

export function ProjectsCompletionStateDemoComposition() {
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
                src={remotionFile("028_projects_completion_state_demo_recording_01.webm")}
                volume={0}
                trimBefore={projectsCompletionStateDemoRecording01FirstFrame}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    pointerEvents: "none",
                    zoom: 1.002, // demo size is just a little off our default
                }}
            />
        </div>
    );
}
