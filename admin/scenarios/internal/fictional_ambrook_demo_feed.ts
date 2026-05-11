import {CalendarDateTime, today} from "@internationalized/date";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoFeed({
    cassCade,
    mattRHorn,
    elleKappaTan,
    cliffWeathers,
    masonClay,
}: DemoSpaceAccounts) {
    debug("Creating feed");

    const {space} = cassCade;

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const baseTime = new CalendarDateTime(currentDate.year, 5, 22, 9);

    const [engineeringChannel, salesChannel] = await runAllPromises([
        TestChannel.create(cassCade, {
            name: "Engineering",
            access: "Public",
        }),
        TestChannel.create(cassCade, {
            name: "Sales",
            access: "Public",
        }),
    ]);

    const post2 = await engineeringChannel.createPost(
        elleKappaTan,
        markdown`
### Incident retrospective: upload backlog

- What happened: Between 02:10-03:05 UTC on May 20, 2026, image uploads queued but didn\u2019t
  process due to a misconfigured worker autoscaler.

- Impact: 7.2% of uploads were delayed up to 55 minutes; no data loss.

- Root cause: Autoscaler min replicas set to 0 after a staging → prod copy.

- Fix: Hot-patched min replicas to 3 and drained the backlog.

Follow-ups:

1. Add Terraform policy check to prevent min=0 on prod pools.
2. Alert on queue age > 5 minutes.
3. Blue/green config promotion with checksum gating.
4. Post-deploy smoke test that enqueues a canary image.

Thanks to Mason and Cass for rapid triage.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 2, minutes: 1})
                .toDate(timeZone),
        },
    );

    const post1 = await salesChannel.createPost(
        cliffWeathers,
        markdown`
Some common questions and answers I\u2019m seeing come up in customer calls about our the new
receipt scanner mobile feature:

**Q: Can I save receipts without signal?**\\\n A: Yes. The mobile app stores images locally and
syncs later.

**Q: How do I know it synced?**\\\n A: Look for the small cloud icon. Grey = pending; blue = synced.

**Q: My receipt is upside down, how do I fix it?**\\\n A: If a receipt looks crooked, tap
\u201CAuto-rotate\u201D to straighten the image.
        `,
        {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 5, minutes: 36})
                .toDate(timeZone),
        },
    );

    await post1.setReaction(masonClay, "ThankYou");
    await post1.setReaction(cassCade, "Heart");
    await post1.setReaction(mattRHorn, "Happy");
    await post1.setReaction(elleKappaTan, "GenericLike");

    const otherDocument = await TestDocument.create(cassCade, {
        title: "Q1 Product Roadmap",
        access: "Public",
    });

    const document = await TestDocument.create(cassCade, {
        access: "Public",
        title: "Q2 Product Roadmap",
        body: Mustache.render(
            markdown`
In our [Q1 Product Roadmap]({{spaceUrl}}/documents/{{otherDocumentId}}?mention) we focused on small
and medium sized businesses (SMBs). That _directly contributed_ to our 16% revenue growth last
quarter. We\u2019re going to add a couple features for larger businesses this quarter.

| Project                  | DRI                                                                       | Priority <span hidden data-column-widths="4,3,2"/> |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Receipt Mobile Scanner   | [Mason Clay]({{spaceUrl}}/accounts/{{masonClayAccountId}}?mention)        | <mark class="highlight-blue">Low</mark>            |
| Profit by Acre Dashboard | [Elle Kappa-Tan]({{spaceUrl}}/accounts/{{elleKappaTanAccountId}}?mention) | <mark class="highlight-red">High</mark>            |
| Grants Navigator         | [Cass Cade]({{spaceUrl}}/accounts/{{cassCadeAccountId}}?mention)          | <mark class="highlight-orange">Medium</mark>       |
            `,
            {
                spaceUrl: `https://alpine.inc/s/${space.id}`,
                otherDocumentId: otherDocument.id,
                masonClayAccountId: masonClay.account.id,
                elleKappaTanAccountId: elleKappaTan.account.id,
                cassCadeAccountId: cassCade.account.id,
            },
        ),
    });

    await document.updateContentPreview();

    const entries: Array<FeedEntry> = [
        {
            type: "Post",
            postId: post1.id,
            channelId: salesChannel.id,
            authorId: cliffWeathers.account.id,
            createdTime: post1.createdTime,
        },
        {
            type: "Document",
            documentId: document.id,
            sharedTime: baseTime.subtract({days: 1}).add({hours: 4, minutes: 38}).toDate(timeZone),
            sharerId: cassCade.account.id,
            creator: {id: cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: post2.id,
            channelId: engineeringChannel.id,
            authorId: elleKappaTan.account.id,
            createdTime: post2.createdTime,
        },
    ];

    debug("Created feed");

    return entries;
}
