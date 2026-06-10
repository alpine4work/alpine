import * as inquirer from "@inquirer/prompts";
import {createDemoMockChatGptBot} from "~/admin/environment/demo_space/create_demo_mock_bots.js";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createMockAgentRecording} from "~/admin/environment/demo_space/create_mock_agent_recording.js";
import {putMockAgentRecording} from "~/admin/environment/demo_space/put_mock_agent_recording.js";
import {
    documentAgentCollaborationDemoRecordingHeight,
    documentAgentCollaborationDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/008_document_agent_collaboration_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {UnknownError} from "~/shared/error/error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const {chatGpt} = await createDemoMockChatGptBot(
        accounts.roseCompas,
        services.getAppServiceTokenAgent(),
        services,
    );

    const document = await TestDocument.create(accounts.cassCade, {
        title: "Landing page outline",
        body: markdown`
This doc is an outline for the new landing page of the product we\u2019re launching.

Our visual style is: dark mode, spacy, glassy, blue/purple gradients. It\u2019s a totally unique
visual style we haven\u2019t seen anyone else use before. We\u2019re quite proud of our original
aesthetic. Hope no one else has discovered this style before us.

## Hero section

- Screenshot of the new product
- Write demo content, pay attention to the details!
- Use investors in social proof section

## Problem section

This text paired with some illustration graphic:

> You spend too much time wasting time. What if you spent time on things that mattered instead of
> things that don\u2019t matter?

## Solution section

Photo of people smiling holding laptops. We\u2019re showing our product makes people happy. First
draft of the copy accompanying our visuals:

> Our product gives you your time back. It automates the stuff that annoys you so you can do work
> that gives you energy. Our customers love having their time back.
        `,
    });

    await recorder.record({
        instructions: markdown`
We\u2019re demonstrating how agents (like ChatGPT) can collaborate with you like a person directly
in a document. This saves you time since you don\u2019t have to copy/paste your content back and
forth. You also don\u2019t have to make updates to the document yourself.

1. Expand the Chrome window out so corner radiuses aren\u2019t included in the recording.

2. Start recording.

3. Highlight all the text in the block quote starting with \u201CYou spend too much time wasting
   time…\u201D

4. Press the \u201CComment\u201D button to add a comment.

5. Type \u201C@ChatGPT what do you think about this?\u201D

6. Send the comment.

7. Ok, so continue the recording but we\u2019re going to cut this part out. You\u2019re going to
   open the comment thread and copy the comment thread ID from the URL.

8. Next we\u2019ll ask for the comment thread ID so we can use it to setup the ChatGPT recording
   we\u2019ll replay.
        `,
        session: accounts.cassCade,
        path: `/doc/${document.id}`,
        viewport: {
            width: documentAgentCollaborationDemoRecordingWidth,
            height: documentAgentCollaborationDemoRecordingHeight,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });

    const commentThreadId = assertId<DocumentCommentThreadId>(
        await inquirer.input({message: "Document comment thread ID?"}),
    );

    await putMockAgentRecording(
        "chat-gpt",
        chatGpt,
        `/documents/${document.id}/threads/${commentThreadId}`,
        createMockAgentRecording(
            [
                8_000,
                "I like the general direction, but I think you\u2019re leaving a lot of power on the table with how abstract and repetitive it is.",
                100,
                "What\u2019s working:",
                100,
                "- It\u2019s clearly about _time_ and _waste_, which is emotionally resonant.",
                100,
                "- The contrast between \u201Cthings that mattered\u201D vs \u201Cthings that didn\u2019t\u201D is the right idea.",
                100,
                "What could be stronger:",
                100,
                "- It\u2019s not specific enough. The reader doesn\u2019t see their life in it yet (no mention of meetings, Slack pings, admin, etc.).",
                100,
                "- It asks a hypothetical question instead of making a confident statement.",
                100,
                "Suggestion: Make it concrete and visual, and shift from hypothetical to \u201Cthis is what\u2019s happening to you right now.\u201D **Let me know if you\u2019d like me to make this update for you.**",
            ],
            {waitMillisecondsBetweenTokens: 10},
        ),
    );

    await recorder.record({
        instructions: markdown`
9. Wait for \u201CChatGPT\u201D to show up in realtime and then click on the comment thread so the
   sidebar opens.

10. Wait for the mock ChatGPT response to finish streaming.

11. All done!
        `,
        session: accounts.cassCade,
        path: `/doc/${document.id}`,
        viewport: {
            width: documentAgentCollaborationDemoRecordingWidth,
            height: documentAgentCollaborationDemoRecordingHeight,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");

            await wait(2000);

            // Manually send a webhook event to `AgentService` to trigger our new ChatGPT
            // recording.
            const requestBody: ApiBotWebhookRequestBody = {
                spaceId: space.id,
                botId: chatGpt.bot.id,
                botAccountId: chatGpt.id,
                attempt: 1,
                accessToken: await services
                    .getJobQueueServiceTokenAgent()
                    .privateSide.dangerouslySignLongLivedTokenForBotWebhook({
                        type: "Bot",
                        spaceId: space.id,
                        accountId: chatGpt.id,
                        scope: {type: "Document", documentId: document.id},
                    }),
                eventId: generateChronologicalId(),
                event: {
                    type: "NewMessage",
                    room: {
                        type: "DocumentCommentThread",
                        id: document.id,
                        threadId: commentThreadId,
                    },
                    index: 0,
                    authorId: accounts.cassCade.account.id,
                    createdTimeZone: defaultTimeZone,
                    wasMentioned: true,
                },
            };

            await fetchWithTracer(
                context.tracer.getTracer(),
                `http://localhost:${services.getAgentServicePort()}/mock/chat-gpt/webhook`,
                {
                    serviceName: "AgentService",
                    route: "/mock/chat-gpt/webhook",
                    method: "POST",
                    headers: {"content-type": "application/json"},
                    body: JSON.stringify(requestBody),
                },
                async request => {
                    if (!request.ok) {
                        throw new UnknownError(
                            `Failed to send mock agent webhook event with status code ${request.status}`,
                        );
                    }
                },
            );
        },
    });
});
