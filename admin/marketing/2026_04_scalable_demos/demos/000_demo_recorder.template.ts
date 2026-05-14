import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context, {name: "Alpine"});
    const session = await space.createSession();

    await recorder.record({
        instructions: markdown`
TODO: describe the demo steps here.
        `,
        session,
        path: `/s/${space.id}/`,
    });
});
