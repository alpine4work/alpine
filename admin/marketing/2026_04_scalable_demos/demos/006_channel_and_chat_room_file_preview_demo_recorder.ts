import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createDemoMockBots} from "~/admin/environment/demo_space/create_demo_mock_bots.js";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {
    channelAndChatRoomFilePreviewDemoRecordingHeight,
    channelAndChatRoomFilePreviewDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/006_channel_and_chat_room_file_preview_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const {chatGpt, cursor} = await createDemoMockBots(
        accounts.roseCompas,
        services.getAppServiceTokenAgent(),
    );

    const document = await TestDocument.create(accounts.cassCade, {
        title: "Onboarding",
        body: "Welcome! On your first day, subscribe to some channels. We recommend:",
        access: "Public",
    });

    const [channel1, channel2, chatRoom1, channel3, channel4] = await runAllPromises([
        TestChannel.create(accounts.roseCompas, {
            name: "Announcements",
            description:
                "📢 Company-wide announcements. Please read everything here, it\u2019s important!\n\nIf you want to post here, ask the people team.",
        }),
        TestChannel.create(accounts.cassCade, {
            name: "Product Feedback",
            description:
                "To record and discuss any feedback we get from customers. Our primary feedback channels are social media and our support email.",
        }),
        TestChat.createRoom(accounts.cassCade, {
            name: "Office Chat",
        }),
        TestChannel.create(accounts.elleKappaTan, {
            name: "Music",
            description:
                "🎶 Share songs, albums, playlists, or artists you love. All genres welcome!",
        }),
        TestChannel.create(accounts.masonClay, {
            name: "Games",
            description: "🎮🎲 The video games, board games, or card games we\u2019re playing.",
        }),
    ]);

    await runAllPromiseThunks(
        async () => {
            await channel1.createPost(accounts.cassCade);
            await channel1.createPost(accounts.hollyEvergreen);
            await channel1.createPost(accounts.cliffWeathers);
            await channel1.createPost(accounts.masonClay);
            await channel1.createPost(accounts.mattRHorn);
            await channel1.createPost(accounts.elleKappaTan);
        },
        async () => {
            await channel2.createPost(accounts.cliffWeathers);
            await channel2.createPost(accounts.elleKappaTan);
            await channel2.createPost(cursor);
            await channel2.createPost(accounts.masonClay);
            await channel2.createPost(chatGpt);
        },
        async () => {
            await chatRoom1.sendMessage(
                accounts.hollyEvergreen,
                "I\u2019m going to place a delivery order for mall fish, anyone want anything?",
            );
            await chatRoom1.sendMessage(
                accounts.elleKappaTan,
                "ooh, yes, could you get me a bowl?",
            );
            await chatRoom1.sendMessage(
                accounts.mattRHorn,
                "I could use some tea if you\u2019re ordering drinks. Decaf please! I really shouldn\u2019t have more caffeine today",
            );
        },
        async () => {
            await channel3.createPost(accounts.masonClay);
            await channel3.createPost(accounts.cassCade);
        },
        async () => {
            await channel4.createPost(accounts.mattRHorn);
            await channel4.createPost(accounts.elleKappaTan);
            await channel4.createPost(chatGpt);
            await channel4.createPost(accounts.roseCompas);
        },
    );

    await document.update(accounts.cassCade, lastUpdatePos => [
        new ReplaceStep(
            lastUpdatePos + 1,
            lastUpdatePos + 1,
            new Slice(
                Fragment.from([
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Channel:${channel2.id}`}),
                    ]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Chat:${chatRoom1.id}`}),
                    ]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Channel:${channel3.id}`}),
                        schema.node("file", {fileId: `Channel:${channel4.id}`}),
                    ]),
                ]),
                0,
                0,
            ),
        ),
    ]);

    await recorder.record({
        instructions: markdown`
We\u2019re showing the user can save time in this demo when onboarding new employees via channel +
chat room previews.

In this demo we show the ability to preview channels and chat rooms in a document. We\u2019ll show
the ability to add one of these previews using an @ mention and we\u2019ll show that you can easily
subscribe by looking at the preview. If you click on the preview it would open the channel/chat room
but we won\u2019t show that in this demo.

1. Expand out the Chrome window so the rounded corners aren\u2019t visible in the recording.

2. Start recording.

3. Open the Chrome DevTools. Add \`setTimeout(() => document.activeElement.blur(), 10_000)\`. Do the
   next step within the next 10 seconds.

4. Add text selection at the end of \u201CWe recommend:\u201D. Press enter, type \u201C@\u201D,
   press down, and select \u201CAnnouncements\u201D to insert a channel preview.

5. Wait for the 10 second timer to elapse and the blue focus ring around the channel preview
   disappears.

6. Gently scroll to the bottom of the document.

7. Scroll back up and press subscribe on \u201CProduct feedback\u201D and \u201COffice chat\u201D.

8. Scroll all the way back to the top then stop recording.
        `,
        session: accounts.roseCompas,
        path: `/doc/${document.id}`,
        viewport: {
            width: channelAndChatRoomFilePreviewDemoRecordingWidth,
            height: channelAndChatRoomFilePreviewDemoRecordingHeight + 8,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
