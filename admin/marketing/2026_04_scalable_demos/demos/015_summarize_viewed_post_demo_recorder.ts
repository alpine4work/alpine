import * as inquirer from "@inquirer/prompts";
import {createDemoMockChatGptBot} from "~/admin/environment/demo_space/create_demo_mock_bots.js";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createMockAgentRecording} from "~/admin/environment/demo_space/create_mock_agent_recording.js";
import {putMockAgentRecording} from "~/admin/environment/demo_space/put_mock_agent_recording.js";
import {
    summarizeViewedPostDemoRecordingHeight,
    summarizeViewedPostDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/015_summarize_viewed_post_demo_shared.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const {chatGpt} = await createDemoMockChatGptBot(
        accounts.roseCompas,
        services.getAppServiceTokenAgent(),
        services,
    );

    // Account mention helper: the markdown parser treats `alpine.inc` account links
    // with a `#mention` search param as first-class `@` mentions, which in turn light
    // up the inbox loud-notification path for the mentioned account.
    const mention = (account: {account: {id: string}}, displayName: string) =>
        `[@${displayName}](https://alpine.inc/mention/${account.account.id})`;

    const mentionRose = mention(accounts.roseCompas, "Rose Compás");
    const mentionMatt = mention(accounts.mattRHorn, "Matt Horn");

    // Seed several channels so Rose's feed and sidebar don't feel empty, and so her
    // inbox contains a realistic mix of unread items. The launch channel is where our
    // main post lives; the others exist primarily for sample content.
    const productLaunchChannel = await TestChannel.create(accounts.cassCade, {
        name: "Product launch",
    });
    const generalChannel = await TestChannel.create(accounts.hollyEvergreen, {name: "General"});
    const engineeringChannel = await TestChannel.create(accounts.masonClay, {name: "Engineering"});
    const designChannel = await TestChannel.create(accounts.mattRHorn, {name: "Design"});
    const salesChannel = await TestChannel.create(accounts.cliffWeathers, {name: "Sales"});

    // --- Feed content (unmentioned posts that populate Rose's feed) ---

    await generalChannel.createPost(
        accounts.hollyEvergreen,
        markdown`
Reminder: all-hands is Tuesday 2pm ET. We\u2019ll celebrate launch day together. Pizza will be
delivered to the office for anyone in person.
        `,
        {overrideCreatedTime: new Date("2026-04-21T13:00:00.000Z")},
    );

    await engineeringChannel.createPost(
        accounts.elleKappaTan,
        markdown`
Sprint demo recap: shipped the new notification fan-out, crash-free sessions are up to 99.91%, and
the pen test report came back clean. Full writeup in the engineering wiki.
        `,
        {overrideCreatedTime: new Date("2026-04-22T16:30:00.000Z")},
    );

    await designChannel.createPost(
        accounts.mattRHorn,
        markdown`
Landing page v4 is in Figma. I kept the hero typography from v3 but tightened the product screenshot
crop. Would love eyes before Monday freeze.
        `,
        {overrideCreatedTime: new Date("2026-04-22T19:05:00.000Z")},
    );

    await salesChannel.createPost(
        accounts.cliffWeathers,
        markdown`
Q1 closed at 118% of plan. Deck for the board packet is in Drive. Shoutout to the field team — huge
quarter.
        `,
        {overrideCreatedTime: new Date("2026-04-23T17:45:00.000Z")},
    );

    await engineeringChannel.createPost(
        accounts.masonClay,
        markdown`
Heads up: status page integration ships with the launch. If you see an incident auto-opened on
Monday morning, it\u2019s the migration, not a real outage.
        `,
        {overrideCreatedTime: new Date("2026-04-23T20:20:00.000Z")},
    );

    // --- Inbox content (posts that @-mention Rose so they land in her inbox) ---

    await designChannel.createPost(
        accounts.mattRHorn,
        `
${mentionRose} — final branding lockup is ready. Need your eyes before it ships with
the launch build on Tuesday. 5-minute review, I promise.
        `,
        {overrideCreatedTime: new Date("2026-04-23T14:15:00.000Z")},
    );

    await salesChannel.createPost(
        accounts.cliffWeathers,
        `
${mentionRose} — the board packet draft is in Drive. Tagging you so you see it before
Friday. Nothing urgent, just want to make sure the narrative lands.
        `,
        {overrideCreatedTime: new Date("2026-04-23T22:40:00.000Z")},
    );

    await generalChannel.createPost(
        accounts.hollyEvergreen,
        `
${mentionRose} new-hire onboarding next Monday overlaps with launch day. Happy to push
to Wednesday — just need a thumbs up from you.
        `,
        {overrideCreatedTime: new Date("2026-04-24T12:30:00.000Z")},
    );

    // --- The main post Rose is going to ask ChatGPT to summarize ---

    const post = await productLaunchChannel.createPost(
        accounts.cassCade,
        `
${mentionRose} — we\u2019re 9 days out from the public launch and I want to lock in our final
go/no-go plan today. Proposing we ship Tuesday morning as planned. Dropping the open
questions here so we can resolve them in-thread instead of another meeting.
        `,
        {overrideCreatedTime: new Date("2026-04-24T13:10:00.000Z")},
    );

    // Seed a long, realistic comment thread with enough varied content that a summary
    // is genuinely useful. One comment is the urgent blocker the summary should
    // surface to Rose.
    const commentPlan: Array<{
        author: keyof typeof accounts;
        text: string;
    }> = [
        {
            author: "mattRHorn",
            text: "Landing page has been redesigned from the ground up. Final polish is happening in the Figma file tonight.",
        },
        {
            author: "mattRHorn",
            text: "One thing to watch: the hero video is still using last month\u2019s render. I\u2019ll swap it before freeze on Monday.",
        },
        {
            author: "masonClay",
            text: "Backend is green across staging. We ran the soak test overnight, no regressions.",
        },
        {
            author: "elleKappaTan",
            text: "Mobile app submission went in yesterday. Apple review usually takes 24–48 hours so we should be fine for Tuesday.",
        },
        {
            author: "cliffWeathers",
            text: `**Blocker for ${mentionRose}:** Legal has flagged the pricing page copy. They want a sign-off from you personally before we ship. Need a decision by EOD Friday or we slip to Wednesday.`,
        },
        {
            author: "hollyEvergreen",
            text: "New hire onboarding lands the same day. I can shift that to Wednesday if launch day is going to be a zoo.",
        },
        {
            author: "mattRHorn",
            text: "Got the final illustration set back from the contractor. Uploading to the CMS now.",
        },
        {
            author: "masonClay",
            text: "We still need to flip the feature flag for the new onboarding flow. I\u2019d like to do that Monday morning so we have a 24h soak in production.",
        },
        {
            author: "elleKappaTan",
            text: "Ran the Playwright suite against the launch build. 3 flakes, all known, filed in Linear.",
        },
        {
            author: "cassCade",
            text: "Press embargo lifts 6am PT Tuesday. Cliff will be coordinating outreach with the 7 publications that confirmed.",
        },
        {
            author: "cliffWeathers",
            text: "Confirming: TechCrunch, The Verge, Axios, Forbes, Bloomberg, and two newsletters. All briefed under NDA as of yesterday.",
        },
        {
            author: "mattRHorn",
            text: "Social tiles are done. Scheduled to post at 6:05am PT Tuesday via Buffer.",
        },
        {
            author: "masonClay",
            text: "Rate limits on the public API endpoint are set conservatively. We can dial up if we see capacity to spare.",
        },
        {
            author: "elleKappaTan",
            text: "I added the launch-day runbook to our docs. Pasting link in the comments later today.",
        },
        {
            author: "hollyEvergreen",
            text: "Should we set up a war room Slack channel or just use this post for launch day coordination?",
        },
        {
            author: "cassCade",
            text: "War room feels heavy for this launch. Let\u2019s keep it in-post unless something goes sideways.",
        },
        {
            author: "mattRHorn",
            text: "Agree with Cass. Post thread is easier to look back on after.",
        },
        {
            author: "masonClay",
            text: "We should double check CDN cache invalidation. Last launch we shipped and a stale asset lingered for 15 minutes.",
        },
        {
            author: "elleKappaTan",
            text: "I\u2019ll own the cache purge step in the runbook. Just added it.",
        },
        {
            author: "cliffWeathers",
            text: "Sales team will get the deck 24 hours before embargo lifts so they can start pipeline work immediately.",
        },
        {
            author: "hollyEvergreen",
            text: "HR side: the all-hands to celebrate is on the calendar for Tuesday 2pm ET. Invite goes out Friday.",
        },
        {
            author: "cassCade",
            text: `${mentionRose}, I know you\u2019re double booked Friday afternoon. Can we get the legal sign-off before your 10am?`,
        },
        {
            author: "mattRHorn",
            text: "Also: the customer testimonial video from Acme is back. It\u2019s good. Want to land it on the homepage at launch.",
        },
        {
            author: "masonClay",
            text: "One more thing: the status page integration ships in the same release. If anyone sees weird incidents open on Monday, that\u2019s why.",
        },
        {
            author: "elleKappaTan",
            text: "Pen testing report came back clean. One medium on the internal admin route, patch is already in review.",
        },
        {
            author: "cliffWeathers",
            text: "Pricing experiment results: variant B (annual discount) converted 2.1x. We\u2019re going with B on launch day.",
        },
        {
            author: "hollyEvergreen",
            text: "Field team is ready. They\u2019ll be responding on social from 5am PT to 9pm PT Tuesday.",
        },
        {
            author: "mattRHorn",
            text: "Forgot to mention, the new logo lockup ships with this release. It\u2019s subtle but the whole brand system updates at once.",
        },
        {
            author: "masonClay",
            text: "Rollback plan is documented. Feature flag flip + cache bust gets us back to current state in under 2 minutes.",
        },
        {
            author: "elleKappaTan",
            text: "Crash-free sessions on iOS beta build: 99.91% over the last 72 hours. Good signal.",
        },
        {
            author: "cassCade",
            text: "Last open item I\u2019m tracking: customer success needs the final pricing table by Friday so they can update the renewal playbook.",
        },
        {
            author: "cliffWeathers",
            text: "That\u2019s downstream of the legal sign-off. Same Friday deadline.",
        },
        {
            author: "mattRHorn",
            text: "Ok, I\u2019m out for the night. Will have the final Figma ready by 9am tomorrow.",
        },
        {
            author: "hollyEvergreen",
            text: "Same here. Talk tomorrow team!",
        },
        {
            author: "elleKappaTan",
            text: "One last thing, should we run a pre-launch readiness review Monday morning? 30 min max.",
        },
        {
            author: "masonClay",
            text: "+1 to Monday readiness review. Worth the 30 min.",
        },
    ];

    // Space comments one minute apart so the timeline looks natural.
    let commentTime = new Date(post.createdTime.getTime() + 60_000);
    for (const {author, text} of commentPlan) {
        await post.createComment(accounts[author], text, {overrideCreatedTime: commentTime});
        commentTime = new Date(commentTime.getTime() + 60_000);
    }

    // Pre-create the 1:1 chat between Rose and ChatGPT so the same `ChatId` is used
    // whether Rose opens peek chat via the UI or the server hands her the existing
    // chat through `getOrCreateChatForAccounts`. Pre-register the mock summary on that
    // chat so when Rose sends her message during the recording, the mock agent
    // naturally responds — no manual webhook firing needed. This works because the
    // mock now mirrors the production 1:1-chat-with-bot response policy.
    const chat = await TestChat.get(accounts.roseCompas, chatGpt);

    await putMockAgentRecording(
        "chat-gpt",
        chatGpt,
        `/chats/${chat.id}`,
        createMockAgentRecording(
            [
                2_000,
                "Here\u2019s a quick read on the launch post you\u2019re on:",
                100,
                "**Summary.** Tuesday launch is still the plan. Engineering is green, mobile is submitted, press embargo is locked with 7 outlets, social and sales enablement are queued up. Rollback plan is documented and fast.",
                100,
                "**Important points:**",
                100,
                "- **Legal sign-off on the pricing page copy (Cliff, comment 5)** — you personally need to approve by EOD Friday or launch slips to Wednesday. Cass suggests slotting it in before your 10am Friday.",
                100,
                "- Customer success needs the final pricing table by the same Friday deadline — downstream of the legal sign-off.",
                100,
                "- Smaller open decisions: Monday 30-min pre-launch readiness review (Elle proposed, Mason +1\u2019d), and whether to keep launch-day coordination in this post or spin up a war room channel (Cass leaning toward in-post).",
                100,
                "**Draft reply** you can post as-is or tweak:",
                100,
                `> Approving legal sign-off for Friday morning. ${mentionMatt}, can you have the pricing copy in front of me by 9am? Cliff, you\u2019re unblocked after that. Also good with Elle and Mason on the Monday readiness review, and let\u2019s stay in this post for launch-day coordination unless something goes sideways.`,
            ],
            {waitMillisecondsBetweenTokens: 10},
        ),
    );

    await recorder.record({
        instructions: markdown`
This demo shows how an agent like ChatGPT can answer a question about the thing you\u2019re
currently looking at — without you ever leaving your workflow. Rose is the CEO. Her feed has the
day\u2019s highlights, her inbox is full, she has a launch post she needs to act on, and her next
meeting is in 10 minutes.

1. Expand the Chrome window so corner radiuses aren\u2019t included in the recording.

2. Start recording.

3. Rose lands on her home feed. Scroll through the feed briefly so the volume of activity is visible
   — sprint recaps, design updates, Q1 numbers, launch-adjacent notes from across the company.

4. In the space sidebar, click **Inbox**. Several recent items should be waiting: a branding
   approval from Matt, a board-deck tag from Cliff, an onboarding scheduling question from Holly,
   and at the top the launch-day go/no-go post from Cass.

5. Click the launch post from Cass so it peeks open on the right. Scroll the peek briefly so
   it\u2019s obvious there\u2019s a long comment thread.

6. While the post is still peeked on the right, open the 1:1 chat with ChatGPT **from the space
   sidebar** (the ChatGPT direct chat under the people/agents section). It should open as a peek on
   top.

7. Type into the peek chat input:

    > Can you summarize this post, call out any important points, and draft a response for me?

8. Press send. Within a couple of seconds ChatGPT will begin streaming. It will stream three
   sections in order: a short **Summary**, **Important points** (the \u201CLegal sign-off\u201D
   bullet is the key beat — pause a moment after it appears so it reads on camera), and a **Draft
   reply** block-quote Rose can post as-is.

9. Let the full response finish streaming. Select the draft-reply quote text and copy it.

10. Close the peek chat so the launch post is visible again in the peek pane (inbox still on the
    left, sidebar still on the far left).

11. Click into the post\u2019s comment composer inside the peek and paste the draft reply. Feel free
    to make a tiny edit if it looks too robotic.

12. Send the reply. Stop recording once it lands in the thread.
        `,
        session: accounts.roseCompas,
        path: `/home/${space.id}`,
        viewport: {
            width: summarizeViewedPostDemoRecordingWidth,
            height: summarizeViewedPostDemoRecordingHeight,
        },
    });

    await inquirer.confirm({message: "Done recording?"});
});
