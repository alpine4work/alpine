import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const chat = await TestChat.get(accounts.mattRHorn, accounts.cassCade);

    await chat.sendMessage(accounts.cassCade, "haha", {
        overrideCreatedTime: new Date("2026-03-19T21:48:57.671Z"),
    });

    await chat.sendMessage(
        accounts.cassCade,
        "Quick question, when will the new template be ready?? The old one is soooo lame…",
        {overrideCreatedTime: new Date("2026-03-20T21:48:57.671Z")},
    );

    await chat.sendMessage(
        accounts.mattRHorn,
        "it took a while but i finally wrapped up the new sign in page design",
        {overrideCreatedTime: new Date("2026-03-20T21:48:55.671Z")},
    );

    await chat.sendMessage(
        accounts.mattRHorn,
        "i\u2019ll have the template ready for you by end of this week",
        {overrideCreatedTime: new Date("2026-03-20T21:48:56.671Z")},
    );

    await chat.sendMessage(accounts.cassCade, "omg thanks", {
        overrideCreatedTime: new Date("2026-03-20T21:48:57.671Z"),
    });

    await chat.sendMessage(
        accounts.cassCade,
        "What brand color should I use for the deck: olive green, rust red, or cobalt blue?",
        {overrideCreatedTime: new Date("2026-04-06T19:32:56.671Z")},
    );

    await recorder.record({
        instructions: markdown`
1. Drag the window out so the window corners aren\u2019t visible in the screen recording.

2. Highlight the text \u201Crust red\u201D and press \u201CReply\u201D. Do not move your mouse!
   Start typing instead.

3. Type \u201Cthis one!\u201D and send.

4. Press \u201Crust red\u201D so you can see it highlights in the original message.
        `,
        session: accounts.mattRHorn,
        path: `/chat/${chat.id}`,
        viewport: {width: scalableDemoDefaultViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
