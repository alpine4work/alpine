import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {
    postReactionsDemoExtraHeight,
    postReactionsDemoRecordingHeight,
    postReactionsDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/007_post_reactions_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoNarrowViewportSpacingScale} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scalableDemoSpaceSideBarWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_space_side_bar_width.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const channel = await TestChannel.create(accounts.hollyEvergreen, {name: "Welcome"});

    const post = await channel.createPost(
        accounts.masonClay,
        "Today\u2019s my first day here as a product engineer. Excited to be working with such a cracked team! In my interviews everyone was really nice and really smart and it convinced me I just had to work here. My hobbies are hiking, camping, and climbing. Last weekend I went camping in the smokey mountains.",
        {overrideCreatedTime: new Date("2026-10-18T14:53:41.765Z")},
    );

    await post.setReaction(accounts.cassCade, "Celebrate");
    await post.setReaction(accounts.mattRHorn, "Heart");
    await post.setReaction(accounts.elleKappaTan, "Happy");
    await post.setReaction(accounts.hollyEvergreen, "Celebrate");

    await post.createComment(accounts.roseCompas, "Welcome Mason, happy to have you on the team!", {
        overrideCreatedTime: new Date("2026-10-18T14:54:41.765Z"),
    });

    await post.createComment(
        accounts.elleKappaTan,
        "no way, i was there a couple months ago. it\u2019s beautiful this time of year",
        {
            overrideCreatedTime: new Date("2026-10-18T14:55:41.765Z"),
            parent: {
                type: "PostRange",
                contentVersion: 0,
                startPos: 268,
                endPos: 299,
            },
        },
    );

    await recorder.record({
        instructions: markdown`
This demo shows the reaction radial picker which has a fun design inspired by video games and moves
gently towards the mouse as the mouse cycles around. There\u2019s also a reaction party which shows
you everyone whose previously reacted in visual space. The way this saves the user time is at a
glance they get a sense of how many people reacted and who reacted (since you know who uses what
reaction). The party concept is unique because we have the reactions assembled in physical space. It
feels like they\u2019re actually in a room together!

1. Expand the Chrome window so you don\u2019t record any corner radiuses.

2. Start recording.

3. Press the reaction button and move your mouse gently around the reaction picker. Eventually
   select the tree celebrate reaction.

4. Move your mouse back, you\u2019re done! Quick demo.
        `,
        session: accounts.roseCompas,
        path: `/post/${post.id}`,
        viewport: {
            width:
                postReactionsDemoRecordingWidth +
                convertRemLengthToPx(
                    scalableDemoSpaceSideBarWidth,
                    scalableDemoNarrowViewportSpacingScale,
                ),
            height: postReactionsDemoRecordingHeight - postReactionsDemoExtraHeight,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
