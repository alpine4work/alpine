import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    searchMentionByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const designDoc = await TestDocument.create(accounts.mattRHorn, {
        title: "✉️ Email Integration Design Spec",
        access: "Public",
        body: markdown`
## Overview

This document covers the design for Alpine\u2019s email integration \u2014 letting teams send and
receive email from inside Alpine, just like chat messages. Incoming emails are automatically triaged
by importance and linked to the right project or thread.

## Goals

- Read and send email from within Alpine
- Thread-level linking: email threads surface alongside related tasks and docs
- Zero new UI primitives: email lives in the existing chat surface

## Open questions

- Authentication flow: OAuth vs IMAP/SMTP
- Per-account vs per-space credential storage
- How to handle attachments in the existing file model
        `,
    });
    await designDoc.updateContentPreview();

    // Index the document directly, bypassing the 10-second SQS job delay that
    // `createDocument()` sets on the IndexSearchEntity job. Without this the retry
    // loop below would exhaust its attempts before the job queue subprocess ever picks
    // up the job.
    await processIndexSearchEntityJob(
        space.systemAction(),
        {
            type: "IndexSearchEntity",
            spaceId: space.id,
            update: {
                type: "Document",
                documentId: designDoc.id,
                updatedTraits: {type: "Any"},
            },
        },
        new Date(),
        {addData: () => {}},
    );

    // Boost affinity so the doc reliably appears first in the @ mention picker.
    await addSearchAffinityEntityPointsForTest(accounts.mattRHorn.action(), {
        spaceId: space.id,
        accountId: accounts.mattRHorn.account.id,
        entityId: `Document:${designDoc.id}`,
        points: 999_000_000,
    });

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Short pre-seeded backlog of Matt and Mason coordinating on the email
    // integration.
    const chat = await TestChat.get(accounts.mattRHorn, accounts.masonClay);

    await chat.sendMessage(
        accounts.mattRHorn,
        "heard Cass giving you the details on the email integration project",
        {
            overrideCreatedTime: new Date("2026-04-30T10:13:00-04:00"),
        },
    );
    await chat.sendMessage(accounts.mattRHorn, "what do you think?", {
        overrideCreatedTime: new Date("2026-04-30T10:13:00-04:00"),
    });
    await chat.sendMessage(
        accounts.masonClay,
        "ngl the email integration is kind of a sick idea. i\u2019ve been thinking about it all morning",
        {overrideCreatedTime: new Date("2026-04-30T10:14:00-05:00")},
    );
    await chat.sendMessage(accounts.mattRHorn, "right?", {
        overrideCreatedTime: new Date("2026-04-30T10:31:00-04:00"),
    });
    await chat.sendMessage(
        accounts.mattRHorn,
        "it\u2019s the no-new-primitives constraint that makes it interesting. email is just another chat room",
        {overrideCreatedTime: new Date("2026-04-30T10:31:01-04:00")},
    );
    await chat.sendMessage(accounts.masonClay, "this is going to be so good. send me the spec", {
        overrideCreatedTime: new Date("2026-04-30T10:32:00-05:00"),
    });

    await retryWithExponentialBackoff(async retry => {
        try {
            const results = await searchMentionByKeywords(accounts.mattRHorn.action(), {
                spaceId: space.id,
                queryText: "Email Integration",
                limit: 5,
            });
            assert(
                results.some(r => r.model.id === `Document:${designDoc.id}`),
                "Document not yet indexed",
            );
        } catch (error) {
            throw retry(error);
        }
    });

    await recorder.record({
        instructions: markdown`
# Demo: mentioning a document in a chat message

Matt and Mason have been coordinating on the email integration project. Matt has just finished his
design spec and is sending Mason a message with the spec using a document mention.

You are logged in as Matt. The chat with Mason is pre-loaded with a short backlog.

1. Click the chat input (\u201CNew message\u201D field at the bottom of the chat).

2. Type \u201C@Email\u201D. The @ triggers the mention picker \u2014 pause for a moment after it
   appears so the viewer can see the \u201CEmail Integration \u2014 Design Spec\u201D document
   highlighted at the top. Do not move the mouse.

3. Type: \u201Cdone. brace yourself\u2014 \u201D

4. Press Return to insert the document mention into the message.

5. Press Enter (or click Send) to send the message.

6. Hold on the final state for a moment so the sent message with the document preview is clearly
   visible, then stop recording.
        `,
        session: accounts.mattRHorn,
        path: `/s/${space.id}/chat/${chat.id}`,
        // Add 35px so the height of the viewport is tall enough to display the mention
        // floater with 2 people, the email spec doc, and the insert menu.
        viewport: {width: scalableDemoNarrowViewportWidth + 35},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
        actions: [
            async page => {
                await wait(2000);

                const input = page.getByLabel("New message");
                await input.click();

                await input.pressSequentially("@Email design spec", {delay: 80});
                await wait(500);
                await page.keyboard.press("Enter"); // select top mention picker result

                await input.pressSequentially("done. brace yourself", {delay: 80});

                await wait(500);
                await input.press("Enter"); // send message
            },
        ],
    });
});
