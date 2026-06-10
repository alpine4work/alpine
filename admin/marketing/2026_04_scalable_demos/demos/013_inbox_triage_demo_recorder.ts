import {CalendarDateTime, today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);

    // Anchor inbox texture to the recording day so "2h ago" / "yesterday" stays
    // realistic when the demo is re-shot.
    const todayAt = (hour: number, minute: number) =>
        new CalendarDateTime(
            currentDate.year,
            currentDate.month,
            currentDate.day,
            hour,
            minute,
        ).toDate(timeZone);

    const daysAgoAt = (days: number, hour: number, minute: number) =>
        new CalendarDateTime(currentDate.year, currentDate.month, currentDate.day, hour, minute)
            .subtract({days})
            .toDate(timeZone);

    // 1. The long Q3 planning document Cass is heads-down editing. She stays on this
    //    page the whole demo, only ducking into the inbox for quick triage.
    const q3PlanningDoc = await TestDocument.create(accounts.cassCade, {
        title: "Q3 Planning",
        access: "Public",
        body: markdown`
Planning doc for Q3. Collecting inputs from each function so Rose and I can finalize priorities by
the end of next week. Please drop your thoughts directly in the relevant section. I\u2019ll
synthesize as we go.

## Engineering priorities

The big investment continuing into Q3 is **realtime reliability**. Elle\u2019s reconnection work
lands in week 6. Follow-up is better health checks, deploy blast-radius reduction, and alerting on
the new jittered reconnect path. Everything else queues behind that.

Tables ship in October. Mason and Matt are closing out final polish. Next editor project is under
discussion. Image galleries are the leading candidate but not committed.

**Enterprise SSO scoping** continues. Elle\u2019s tech spec is close to review-ready. Realistic ship
is next quarter, not this one. Cliff has been setting that expectation with prospects.

## Product direction

Two cross-cutting themes from the Q3 customer survey feed into Q4 planning: notification control
(inbox filters, channel-level mute) and faster search on large workspaces. Holly\u2019s summary is
linked above. I want us to pick one to commit to.

- Notification control lines up with internal feedback too. Several of us have been hand-rolling
  filters.
- Search speed is a bigger engineering project but higher-leverage if we\u2019re going upmarket.

## Sales and go-to-market

Cliff is working three active deals and one strong inbound from the first case study. Holly\u2019s
one-pager and demo script are in their final revision. Cliff\u2019s feedback on the inbox section
has been incorporated.

Second case study is drafted, waiting on customer approval.

## Hiring

Senior backend engineer. Final-round candidate is strong. Rose and I are aligned on making the
offer. Details in the candidate debrief doc. Target start date TBD.

No other roles opening this quarter.

## Open questions for Rose

1. Notification control vs. search speed. Pick one.
2. SSO ship target: committed Q1 or floating?
3. Offer level for the senior backend role.
        `,
    });

    await q3PlanningDoc.updateContentPreview();

    // 2. Background texture: channel posts. One engineering channel, two posts from
    //    different authors across the past couple of days. They show up as a single
    //    bucketed "ChannelPosts" inbox entry.
    const engineering = await TestChannel.create(accounts.cassCade, {
        name: "Engineering",
        access: "Public",
    });

    await engineering.createPost(
        accounts.elleKappaTan,
        markdown`
### Realtime reconnect: thundering herd fix

Found a thundering herd problem in the reconnect path. When a server restarts, every disconnected
client hits the new instance at the same moment and briefly overwhelms it before it\u2019s warmed
up. Switching to jittered exponential backoff on the client side, with a cap so reconnects still
feel instant under normal conditions.

Design updates posted in the reliability spec. Will roll out behind the existing feature flag next
week.
        `,
        {overrideCreatedTime: daysAgoAt(2, 15, 42)},
    );

    await engineering.createPost(
        accounts.hollyEvergreen,
        markdown`
### Q3 customer survey summary

Compiled the Q3 survey responses into a summary doc. Top three themes:

1. **Table support in documents.** Consistent across segments, satisfying given what Mason is
   building.
2. **Notification control.** Per-channel mute, inbox filters.
3. **Search speed on large workspaces.** Mostly from our bigger enterprise accounts.

Feeds directly into Q3 and Q4 planning. Happy to walk anyone through the raw data.
        `,
        {overrideCreatedTime: daysAgoAt(1, 10, 15)},
    );

    // 3. Background texture: document comment threads. Two separate docs produce two
    //    "DocumentNewCommentThreads" inbox entries. Cass is the creator on both so the
    //    notifications flow to her.
    const tablesDesignSpec = await TestDocument.create(accounts.cassCade, {
        title: "Tables Design Spec",
        access: "Public",
        body: markdown`
Design spec for tables in the editor. Ownership is shared: Matt on interaction, Mason on
implementation. This doc collects the open decisions and captures the ones that are already made.

## Selection model

Cell selection is spatial, not document-linear. Clicking a cell selects it; shift-click extends the
rectangle. Arrow keys move one cell at a time inside a selection. More detail in Matt\u2019s
interaction audit. This section picks the parts that apply to tables specifically.

## Toolbar placement

Floating toolbar attaches to the table on focus, not to the cell. Keeps the format menu from
fighting for the same vertical band.

## Column resizing

Open debate. Mason has smooth continuous resize. Matt wants grid-snap so users produce
well-proportioned tables rather than arbitrary pixel widths. Leaning toward a compromise:
snap-by-default with a modifier key for freeform.
        `,
    });

    await tablesDesignSpec.createCommentThread(
        accounts.mattRHorn,
        {from: 400, to: 460},
        markdown`
Revisiting this after the interaction audit pass. The toolbar attachment point is right, but the
entry animation still feels like it\u2019s arriving from the wrong direction when the table is near
the top of the viewport. Want to sync on whether we change anchoring or the animation.
        `,
        {overrideCreatedTime: daysAgoAt(1, 14, 5)},
    );

    const salesOnePager = await TestDocument.create(accounts.cassCade, {
        title: "Sales One-Pager Draft",
        access: "Public",
        body: markdown`
First pass at the updated sales one-pager. Replaces the old deck content with the current product
shape. Holly\u2019s draft, Cliff\u2019s edits inline.

## What Alpine is

A productivity suite for technical teams: docs, tasks, chat, forum, inbox, and search, all inside
one workspace.

## Who it\u2019s for

Teams of 10 to 100 where today\u2019s work is split across four or five different tools and the
seams are starting to show.

## How people use it

Planning in docs. Tracking in tasks. Deciding in threads. Everything searchable from one place.

## Pricing

Two tiers: Team and Business. Enterprise pricing on request (SSO required).
        `,
    });

    await salesOnePager.createCommentThread(
        accounts.roseCompas,
        {from: 180, to: 240},
        markdown`
This framing is almost right but I want the first line to lead with the outcome, not the feature
list. Something like: \u201cThe work environment for teams that ship.\u201d We can list the surfaces
after.
        `,
        {overrideCreatedTime: daysAgoAt(1, 16, 30)},
    );

    // 4. The three urgent DMs. Each has a lived-in backlog spanning several days so
    //    the chat feels like a real ongoing conversation when Cass opens it, plus a
    //    newest unread message that's driving the action. The newest message on each
    //    is "today" so the three DMs sort above the older posts and comments in the
    //    inbox.
    const [roseCass, cliffCass, mattCass] = await runAllPromises([
        TestChat.get(accounts.cassCade, accounts.roseCompas),
        TestChat.get(accounts.cassCade, accounts.cliffWeathers),
        TestChat.get(accounts.cassCade, accounts.mattRHorn),
    ]);

    // Rose <> Cass. Context: hiring + board-level ops. Rose is direct and sparing.
    // Cass is organized, occasionally casual. Her newest message is the most recent
    // item in the inbox.
    await roseCass.sendMessage(
        accounts.cassCade,
        "pipeline review is up for your Tuesday 1:1. added a slide on retention since that came up last time.",
        {overrideCreatedTime: daysAgoAt(4, 16, 12)},
    );
    await roseCass.sendMessage(accounts.roseCompas, "good. any surprises this month", {
        overrideCreatedTime: daysAgoAt(4, 16, 40),
    });
    await roseCass.sendMessage(
        accounts.cassCade,
        "nothing on the product side. Cliff\u2019s Q4 plan lands thursday. also the senior backend candidate is back in final round.",
        {overrideCreatedTime: daysAgoAt(4, 16, 43)},
    );
    await roseCass.sendMessage(accounts.roseCompas, "who is on the final loop", {
        overrideCreatedTime: daysAgoAt(4, 16, 55),
    });
    await roseCass.sendMessage(
        accounts.cassCade,
        "elle, mason, me, then you. bar raiser is Elle. schedule goes out today.",
        {overrideCreatedTime: daysAgoAt(4, 16, 58)},
    );
    await roseCass.sendMessage(accounts.roseCompas, "how did Matt\u2019s call go yesterday", {
        overrideCreatedTime: daysAgoAt(3, 10, 5),
    });
    await roseCass.sendMessage(
        accounts.cassCade,
        "short version, landing on snap-by-default for columns. Mason is ok with it. tiny push on modifier key behavior but nothing blocking.",
        {overrideCreatedTime: daysAgoAt(3, 10, 9)},
    );
    await roseCass.sendMessage(accounts.roseCompas, "fine. tell him i trust the call.", {
        overrideCreatedTime: daysAgoAt(3, 10, 10),
    });
    await roseCass.sendMessage(accounts.cassCade, "on it", {
        overrideCreatedTime: daysAgoAt(3, 10, 11),
    });
    await roseCass.sendMessage(
        accounts.cassCade,
        "you around for a quick debrief on the candidate?",
        {overrideCreatedTime: daysAgoAt(1, 17, 45)},
    );
    await roseCass.sendMessage(
        accounts.roseCompas,
        "tomorrow morning is better. give me 15 min before my 10am",
        {overrideCreatedTime: daysAgoAt(1, 17, 52)},
    );
    await roseCass.sendMessage(accounts.cassCade, "works. coffee first tbh", {
        overrideCreatedTime: daysAgoAt(1, 17, 53),
    });
    await roseCass.sendMessage(
        accounts.roseCompas,
        "need to talk about the offer. level, start date, signing bonus. let\u2019s nail it down before it goes out. let\u2019s chat in our 1:1",
        {overrideCreatedTime: todayAt(9, 12)},
    );

    // Cliff <> Cass. Context: pipeline + Acme blocked on SSO. Cliff is upbeat with
    // exclamation points. Cass is terse-professional. His newest message is the "reply
    // in-line" one Cass will respond to.
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "Acme call locked in for wednesday! Demo plus procurement in the same room. Big week.",
        {overrideCreatedTime: daysAgoAt(4, 9, 5)},
    );
    await cliffCass.sendMessage(accounts.cassCade, "amazing. want anything pulled for prep?", {
        overrideCreatedTime: daysAgoAt(4, 9, 18),
    });
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "I\u2019ve got the new one-pager and Holly\u2019s updated script. I\u2019m good!",
        {overrideCreatedTime: daysAgoAt(4, 9, 22)},
    );
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "New inbound off the first case study btw. 80-person eng org, serious fit.",
        {overrideCreatedTime: daysAgoAt(3, 13, 40)},
    );
    await cliffCass.sendMessage(accounts.cassCade, "nice. where did they come in from", {
        overrideCreatedTime: daysAgoAt(3, 13, 44),
    });
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "LinkedIn. Holly\u2019s post did numbers. I\u2019ll queue them for next week.",
        {overrideCreatedTime: daysAgoAt(3, 13, 47)},
    );
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "Acme call went great! They\u2019re in on the pilot as soon as SSO is live.",
        {overrideCreatedTime: daysAgoAt(2, 11, 20)},
    );
    await cliffCass.sendMessage(accounts.cassCade, "nice. what did you tell them on timing", {
        overrideCreatedTime: daysAgoAt(2, 11, 45),
    });
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "\u201Ccoming soon, this quarter-ish.\u201D Honestly they\u2019re patient but want a real ETA.",
        {overrideCreatedTime: daysAgoAt(2, 11, 48)},
    );
    await cliffCass.sendMessage(
        accounts.cassCade,
        "ok i\u2019ll pull Elle in. omw to the Elle/SSO scoping doc now.",
        {overrideCreatedTime: daysAgoAt(2, 11, 55)},
    );
    await cliffCass.sendMessage(
        accounts.cliffWeathers,
        "Acme just pinged again. Can you confirm the ETA Elle gave me? They\u2019re building their Q4 procurement plan this week.",
        {overrideCreatedTime: todayAt(8, 38)},
    );

    // Matt <> Cass. Context: tables design polish. Matt is abstract and pulls design
    // history references. Low urgency FYI. Cass will open, skim, and close without
    // acknowledging.
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "finally got the floating toolbar study done. three variants. variant B has 1987 LaserWriter vibes, you\u2019ll see why.",
        {overrideCreatedTime: daysAgoAt(4, 11, 2)},
    );
    await mattCass.sendMessage(accounts.cassCade, "lol send when you can", {
        overrideCreatedTime: daysAgoAt(4, 11, 14),
    });
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "figma link coming shortly. Mason has seen it and we\u2019re converging on B with minor edits.",
        {overrideCreatedTime: daysAgoAt(4, 11, 18)},
    );
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "new pass on the table toolbar. cleaner attachment, no more fight with the format menu.",
        {overrideCreatedTime: daysAgoAt(3, 14, 10)},
    );
    await mattCass.sendMessage(accounts.cassCade, "oh nice. got a quick frame?", {
        overrideCreatedTime: daysAgoAt(3, 14, 25),
    });
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "yeah. also want to show you the column resize snap behavior. i think it lands.",
        {overrideCreatedTime: daysAgoAt(3, 14, 28)},
    );
    await mattCass.sendMessage(
        accounts.cassCade,
        "did a first look. snap feels right. the modifier key is the part i want to see live.",
        {overrideCreatedTime: daysAgoAt(2, 9, 40)},
    );
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "agreed. working on a small motion for the snap so it doesn\u2019t feel surprising. will share this week.",
        {overrideCreatedTime: daysAgoAt(2, 9, 45)},
    );
    await mattCass.sendMessage(
        accounts.mattRHorn,
        "peek at the table toolbar mocks when you have a sec. no rush, just want a sanity check before i send to Mason.",
        {overrideCreatedTime: todayAt(7, 5)},
    );

    // Inbox notifications are asynchronous. Wait until all six entries (3 chats + 1
    // channel-posts bucket + 2 doc-comments buckets) have landed before starting the
    // recording so the inbox looks complete when Cass opens it.
    await retryWithExponentialBackoff(async retry => {
        try {
            const inbox = await getInbox(accounts.cassCade.action(), {spaceId: space.id});
            assert(
                inbox.model.entryCount === 6,
                `Expected 6 inbox entries, got ${inbox.model.entryCount}`,
            );
        } catch (error) {
            throw retry(error);
        }
    });

    await recorder.record({
        instructions: markdown`
1. Type a few words into the Q3 Planning doc to establish \u201CCass is heads-down editing.\u201D

2. Click \u201CInbox\u201D in the left sidebar. The three DMs from Rose, Cliff, and Matt sit at the
   top. They\u2019re the most recent, bubbling above the older channel posts and document comments.

3. Click Rose\u2019s message. Read her line about the offer details. Press \u201CDone\u201D to
   dismiss. Cass is already on it.

4. Click Cliff\u2019s message. Read his Acme SSO ping. Reply in-line: \u201Ccan do\u201D and Send.
   The chat clears from the inbox on reply.

5. Click Matt\u2019s message. Skim the table toolbar ask. Not urgent. Close without acknowledging.
   It stays in the inbox for later.

6. Click back into the Q3 Planning doc in the sidebar. Resume typing where you left off.
        `,
        session: accounts.cassCade,
        path: `/doc/${q3PlanningDoc.id}`,
        viewport: scalableDemoWideViewport,
    });
});
