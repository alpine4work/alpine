import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const chat = await TestChat.get(accounts.cliffWeathers, accounts.cassCade);

    // A tiny bit of prior context so the chat doesn't look empty when the recording
    // starts.
    await chat.sendMessage(accounts.cliffWeathers, "Morning! Quick question...");
    await chat.sendMessage(accounts.cassCade, "Yeah what\u2019s up");

    await recorder.record({
        instructions: markdown`
1. Wait for the typing indicator to appear under Cliff\u2019s prior message, then for the message to
   arrive.

2. Hover over the line starting \u201CAcme is dragging on close\u201D and react with
   \u201CYes\u201D.

3. Hover over the \u201Ccoffee streak\u201D line and react with \u201CLaugh\u201D.
        `,
        session: accounts.cassCade,
        path: `/s/${space.id}/chat/${chat.id}`,
        viewport: scalableDemoWideViewport,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
        collaborators: {
            // Cliff types the full message into the chat input, then presses Enter to send
            // \u2014 driving the typing indicator naturally and letting the real send flow
            // deliver the message to the primary browser via realtime.
            cliff: {
                session: accounts.cliffWeathers,
                actions: [
                    async cliffBrowser => {
                        await wait(2000);

                        await cliffBrowser.goto(`/s/${space.id}/chat/${chat.id}`);

                        const input = cliffBrowser.getByLabel("New message");
                        await input.click();

                        const messageParagraphs = [
                            "Acme is dragging on close and we need to make a move. Want me to push for Friday sign-by?",
                            "Also: my office coffee streak just hit 47 days. Pretty sure that qualifies for equity refresh \ud83c\udfc6",
                        ];

                        for (let i = 0; i < messageParagraphs.length; i++) {
                            if (i > 0) {
                                // Blank line between paragraphs \u2014 two Shift+Enters produces a hard line
                                // break + an empty line, matching how a human composes a multi-paragraph chat
                                // message.
                                await input.press("Shift+Enter");
                            }

                            await input.pressSequentially(messageParagraphs[i]!, {delay: 15});
                        }

                        // Plain Enter sends.
                        await input.press("Enter");
                    },
                ],
            },
        },
    });
});
