import Mustache from "mustache";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotFileEntity} from "~/app/screenshot_tests/helpers/screenshot_file_entity.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {
    encodeContentDuplicationVariableSchemaForUrl,
    extractContentDuplicationVariableSchema,
} from "~/shared/content/content_duplication_variable_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId, unsafelyGenerateStableId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    const document = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "document"),
        title: "Q3 Planning",
        access: "Public",
        body: Mustache.render(
            markdown`
Author: {{cassMention}}

Everything in here is WIP. I want input from each of you in your section by Friday. Rose and I will
finalize the week after.

A few notes coming in:

- The sync deploy incident at the end of August is the reason Elle\u2019s reliability work is P0
  this quarter. We don\u2019t want a repeat of that.
- Mason has tables far enough along that we can credibly commit to a ship date. We\u2019ve spent
  weeks on the design, and the remaining open questions are small.
- Holly\u2019s first case study just published and Cliff\u2019s pipeline is in the best shape
  it\u2019s been all year. We should keep that flywheel turning.

## Priorities

<table data-column-widths="1,3,3,3">
<thead>
<tr>
<th>

Priority

</th>
<th>

Project

</th>
<th>

Owner(s)

</th>
<th>

Outcome

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Tables in the rich text editor

</td>
<td>

{{masonMention}} + {{mattMention}}

</td>
<td>

GA rollout

</td>
</tr>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Realtime reliability

</td>
<td>

{{elleMention}}

</td>
<td>

Remaining phases rolled out

</td>
</tr>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Senior backend engineer hire

</td>
<td>

{{cassMention}} + {{roseMention}}

</td>
<td>

Offer accepted with Q4 start date

</td>
</tr>
<tr>
<td>

<mark class="highlight-orange">P1</mark>

</td>
<td>

Enterprise SSO scoping

</td>
<td>

{{elleMention}} + {{cliffMention}}

</td>
<td>

Reviewable design doc

</td>
</tr>
<tr>
<td>

<mark class="highlight-orange">P1</mark>

</td>
<td>

Customer case studies

</td>
<td>

{{hollyMention}}

</td>
<td>

Second published, third in draft

</td>
</tr>
<tr>
<td>

<mark class="highlight-blue">P2</mark>

</td>
<td>

Sales enablement (one-pager + demo script)

</td>
<td>

{{hollyMention}} + {{cliffMention}}

</td>
<td>

In Cliff\u2019s hands and used in live demos

</td>
</tr>
<tr>
<td>

<mark class="highlight-blue">P2</mark>

</td>
<td>

Editor interaction audit

</td>
<td>

{{mattMention}}

</td>
<td>

Living reference doc

</td>
</tr>
</tbody>
</table>

## P0s

### Tables in the rich text editor

The biggest single deliverable of the quarter. Mason has the core working — selection, keyboard nav,
insert/delete rows and columns. Matt\u2019s design review came back with substantive notes on the
cell selection model, toolbar placement, and column resizing. Mason is working through them.

The column resizing debate (snap vs. smooth) is the only thing actually unresolved. I\u2019ll make
the call by Wednesday so we don\u2019t lose another week to it. My current lean is **snap by
default, hold Alt for smooth.** If either of you have a strong reason that doesn\u2019t work, tell
me before then.

What \u201Cshipped\u201D means:

- [ ] Cell selection model resolved and implemented
- [ ] Toolbar placement final, no conflict with the floating format menu
- [ ] Column resizing decision made and implemented
- [ ] Paste from spreadsheets works for the obvious cases (Sheets, Excel, Numbers)
- [ ] Nested lists inside cells don\u2019t break selection (Mason flagged this)
- [ ] Help doc written and live — Holly
- [ ] Forum announcement — Holly

**Target ship: week of Oct 13.** If we slip past Oct 17 we should talk about why; this isn\u2019t a
feature we should be quietly extending.

### Realtime reliability

Elle has been on this all quarter and the work has been quietly excellent. The thundering herd
discovery in week 3 changed the plan — jittered exponential backoff on the client side, rolling out
incrementally per region. The first two phases are already live with no observed regressions.

Remaining for Q3:

- [ ] Deployment health checks on the new path
- [ ] Alerting (the part where we actually find out before customers do)
- [ ] Postmortem-style retro at the end so the lessons don\u2019t evaporate

This work is invisible to users when it works, which is the point. I want to make sure it gets
credit internally even though it won\u2019t generate a launch post.

### Senior backend engineer hire

Final round happened last week. Rose and I debriefed — strong yes from both of us. Offer goes out
this week. If they accept, start date is mid-November. If they decline, we restart the loop; the
pipeline thins out fast at this level so we should plan for that contingency rather than pretend it
isn\u2019t a real branch.

Holly — once we have an accept, you\u2019ll be on the announcement (internal first, then external
once they\u2019ve started).

## P1s

### Enterprise SSO scoping

Three of Cliff\u2019s deals are waiting on this. We are **not building it this quarter.** We are
committing to a plan we can actually execute against in Q4. Elle is writing the technical design doc
covering the auth flow, IdP integrations, the admin UI surface, and the migration path for existing
accounts.

What we need by end of Q3:

- A reviewable draft of the design doc
- A realistic build estimate (with the parts you\u2019re least sure about called out)
- A go/no-go recommendation for a Q4 build window

Cliff: keep telling prospects \u201Cearly next year\u201D and not a date. Elle and I will give you a
real answer when we have one. Don\u2019t pre-commit on our behalf.

### Customer case studies

The first one published in late September and brought in a strong inbound that\u2019s now in
Cliff\u2019s pipeline. Goal for Q3:

| Case study | Status                               | Target                    |
| ---------- | ------------------------------------ | ------------------------- |
| #1         | Published                            |                           |
| #2         | In draft, customer reviewing         | Publish by end of October |
| #3         | Subject identified, interview booked | Draft by end of November  |

The bottleneck is customer approval cycles, not Holly\u2019s writing speed. Plan around that rather
than pretending it isn\u2019t real.

### Sales enablement (one-pager + demo script)

Cliff has been using the draft in live demos and has feedback — some of the language is too
technical for a first conversation, and the inbox section is missing entirely. Holly and Cliff are
iterating in chat. Final version in Cliff\u2019s hands by mid-October. After that, Cliff owns
updates as the product evolves; Holly is not the long-term owner of this artifact.

## P2s

### Editor interaction audit

Matt\u2019s living document. Not a quarterly deliverable, but worth listing because it\u2019s
load-bearing. The tables design review pulled directly from it, and the next editor project
(Matt\u2019s image gallery sketches — early!) will too. Keep it alive, keep it honest. If something
in there starts to feel out of date, fix it in place rather than starting a new doc.
            `,
            {
                masonMention: `[](https://alpine.inc/mention/${accounts.masonClay.account.id}#short)`,
                elleMention: `[](https://alpine.inc/mention/${accounts.elleKappaTan.account.id}#short)`,
                cassMention: `[](https://alpine.inc/mention/${accounts.cassCade.account.id}#short)`,
                mattMention: `[](https://alpine.inc/mention/${accounts.mattRHorn.account.id}#short)`,
                roseMention: `[](https://alpine.inc/mention/${accounts.roseCompas.account.id}#short)`,
                cliffMention: `[](https://alpine.inc/mention/${accounts.cliffWeathers.account.id}#short)`,
                hollyMention: `[](https://alpine.inc/mention/${accounts.hollyEvergreen.account.id}#short)`,
            },
        ),
    });

    const commentThread1 = await document.createCommentThread(
        accounts.elleKappaTan,
        {from: 180, to: 200},
        markdown`
small thing: calling it \u201Cthe sync deploy incident\u201D makes it sound like the deployment was
the cause. the underlying fragility was already there, the deploy just surfaced it. i don\u2019t
think the takeaway here should be \u201Cdon\u2019t push code on fridays\u201D
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<DocumentCommentThreadId>(
                runner.stableRandom,
                "commentThread1",
            ),
            overrideCreatedTime: new Date("2025-10-06T16:15:00.000Z"),
        },
    );

    // Make sure we wait for an inbox entry to be added to Cass's inbox so the next
    // comment can reliably dismiss the entry.
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    const comment = await commentThread1.createComment(
        accounts.cassCade,
        markdown`
Fair. I\u2019ll rephrase. How about something like \u201Cthe sync incident exposed underlying
fragility in the realtime layer\u201D?
        `,
        {overrideCreatedTime: new Date("2025-10-06T18:45:00.000Z")},
    );

    await comment.setReaction(accounts.elleKappaTan, "Yes");
    await comment.setReaction(accounts.masonClay, "Yes");

    const commentModel = await comment.get();
    assert(commentModel.payload.type === "Content");
    const reactionsSearchParam = `${commentModel.payload.content.doc.content.size}@${
        commentModel.payload.contentUpdate?.mappings.length ?? 0
    }`;

    const commentThread2 = await document.createCommentThread(
        accounts.mattRHorn,
        {from: 430, to: 468},
        markdown`
Want to flag that I don\u2019t think the column resizing question is small. It shapes how every
table a user creates ends up looking, it sets the pattern people internalize. The reason typesetters
spent a century arguing about column widths is that the answer is load-bearing on whether the result
reads well. I\u2019d rather take an extra week than ship a snap-vs-smooth answer that doesn\u2019t
feel right. Not blocking, just registering the concern in the doc rather than only in chat.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<DocumentCommentThreadId>(
                runner.stableRandom,
                "commentThread2",
            ),
            overrideCreatedTime: new Date("2025-10-06T19:35:00.000Z"),
        },
    );

    await commentThread2.createComment(
        accounts.cassCade,
        markdown`
Noted, and I hear you. I\u2019m making the call Wednesday. If we ship and the answer feels wrong in
practice, I\u2019d rather find out in the first week post-release and iterate than slip the date
again for a question we\u2019ve been circling for two weeks. We can change a default.
        `,
        {overrideCreatedTime: new Date("2025-10-06T20:10:00.000Z")},
    );

    await commentThread2.createComment(
        accounts.masonClay,
        markdown`
I already have a half working version of the smooth resize implementation.
        `,
        {overrideCreatedTime: new Date("2025-10-06T20:10:01.000Z")},
    );

    const lastCommentInCommentThread2 = await commentThread2.createComment(
        accounts.mattRHorn,
        markdown`
Totally hear you on time, I\u2019m not arguing for a slip. I just want to leave a fuller version of
the reasoning in the doc so we can point back at it the next time this kind of question comes up on
something else, because it will.

The thing I keep landing on is that if we choose to change defaults then existing documents
can\u2019t be updated. When you set a default for column behavior you\u2019re choosing what kind of
artifact a typical document is. Snap nudges people toward proportional layouts the way grid paper
does for sketches. You don\u2019t notice it doing the work, but it\u2019s doing the work. Smooth
gives total control, and in practice mostly produces tables full of slightly-off widths that no one
bothers to clean up. Once a hundred thousand Alpine docs have been authored under whichever default
we pick, we own the shape of those documents. The decision doesn\u2019t feel weighty in the
moment—defaults never do—but it sets the rhythm of every table screenshot we ever post and every
help doc we ever write.

The reason I keep reaching for typesetting analogies is that we\u2019ve been here before, just with
different tools. Newspapers didn\u2019t land on roughly 60–75 character columns in the 19th century
because anyone had taste opinions about it, they landed there because anything wider doesn\u2019t
read, and once they figured it out the convention held for a hundred and some years. The web threw
it out and we\u2019ve spent twenty-five years re-learning it. I don\u2019t think we should re-learn
it table by table when we can encode it in the default and be done.

Adjacent thing I\u2019ve been turning over and might as well drop here: same question is going to
land in our laps the moment I get to image galleries. Do you crop to a grid, let images sit at
native ratios, round to thirds, force a baseline alignment across rows? It\u2019s the same problem.
I\u2019d love for us to have a coherent answer across both surfaces rather than re-litigate it
twice. Not asking us to design image galleries today. Just flagging that the column resizing call is
going to set a precedent that\u2019s bigger than tables, and I\u2019d rather we make it deliberately
than fall into one.

Anyway. Call it Wednesday, I\u2019ll work with whatever you land on. Mostly wanted the reasoning on
the page so future us doesn\u2019t have to go through this debate again.
        `,
        {overrideCreatedTime: new Date("2025-10-07T14:20:00.000Z")},
    );

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // Make sure Cass dismisses the comment thread inbox entry by setting a reaction.
    await lastCommentInCommentThread2.setReaction(accounts.cassCade, "GenericLike");

    await runner.goto(accounts.cassCade, `/doc/${document.id}`);
    await runner.screenshot("a0", "basic");

    const syncDeployListItem = runner
        .getByTestId("DocumentContentEditorMain")
        .locator("[data-list-indent]")
        .filter({hasText: "The sync deploy incident at the end of August"})
        .first();
    const syncDeployListItemBox = await syncDeployListItem.boundingBox();
    assert(syncDeployListItemBox !== null);
    await runner.mouse.click(
        syncDeployListItemBox.x + 180,
        syncDeployListItemBox.y + syncDeployListItemBox.height / 2,
        {button: "right"},
    );
    await runner.getByText("Turn into check list").waitFor();
    await runner.screenshot("a01", "list-conversion-menu");

    // Right clicking a heading offers "copy heading link" and "collapse heading"
    // actions.
    await runner.goto(accounts.cassCade, `/doc/${document.id}`);
    const prioritiesHeading = runner.getByRole("heading", {name: "Priorities"});
    const prioritiesHeadingBox = await prioritiesHeading.boundingBox();
    assert(prioritiesHeadingBox !== null);
    await runner.mouse.click(
        prioritiesHeadingBox.x + 60,
        prioritiesHeadingBox.y + prioritiesHeadingBox.height / 2,
        {button: "right"},
    );
    await runner.getByText("Copy heading link").waitFor();
    await runner.screenshot("a02", "heading-context-menu");

    // Collapsed sections at every heading level: the expand chevron centers on the
    // first line of each heading, including a level 1 heading long enough to wrap onto
    // two lines. Lower levels come first so no section nests inside another and all
    // three chevrons are visible at once.
    const collapsedSectionsDocument = await TestDocument.create(accounts.cassCade, {
        id: unsafelyGenerateStableId<DocumentId>(runner.stableRandom, "collapsedSectionsDocument"),
        title: "Collapsed sections",
        access: "Public",
        body: markdown`
### Lorem ipsum dolor sit amet

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore
et dolore magna aliqua.

## Ut enim ad minim veniam quis nostrud

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
consequat.

# Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id
est laborum.
        `,
    });

    await runner.goto(accounts.cassCade, `/doc/${collapsedSectionsDocument.id}`);
    for (const headingName of [
        "Lorem ipsum dolor sit amet",
        "Ut enim ad minim veniam quis nostrud",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat",
    ]) {
        const collapsedSectionsHeading = runner.getByRole("heading", {name: headingName});
        const collapsedSectionsHeadingBox = await collapsedSectionsHeading.boundingBox();
        assert(collapsedSectionsHeadingBox !== null);
        await runner.mouse.click(
            collapsedSectionsHeadingBox.x + 60,
            collapsedSectionsHeadingBox.y + 10,
            {button: "right"},
        );
        await runner.getByText("Collapse heading").click();
        await collapsedSectionsHeading.getByLabel("Expand heading").waitFor();
    }
    // Right clicking selected the word under the cursor; clear the selection and blur
    // so the screenshot only shows the collapsed state.
    await runner.evaluate("dev.contentEditor.setTextSelection(1); document.activeElement?.blur()");
    await runner.mouse.move(0, 0);
    await runner.screenshot("a04", "collapsed-headings");

    await runner.goto(accounts.cassCade, `/doc/${document.id}`);
    await runner.getByRole("button", {name: "More"}).click();
    await runner.screenshot("a1", "more-menu");

    await runner.goto(accounts.cassCade, `/doc/${document.id}`);
    await runner.getByRole("button", {name: "Share"}).click();
    await runner.screenshot("a2", "share-overlay");

    await runner.getByRole("combobox", {name: "Add people"}).click();
    await runner.getByRole("combobox", {name: "Add people"}).fill("holly");
    await runner.getByRole("option", {name: "Holly Evergreen"}).click();
    await runner.screenshot("a3", "share-overlay-account-input");

    await runner.goto(accounts.cassCade, `/doc/${document.id}?thread=${commentThread1.id}`);
    await runner.screenshot("a4", "comment-sidebar");

    await runner.goto(accounts.cassCade, `/doc/${document.id}`, {
        viewport: "wide",
    });
    await runner.screenshot("a4G", "wide");

    await runner.goto(accounts.cassCade, `/doc/${document.id}?thread=${commentThread1.id}`, {
        viewport: "wide",
    });
    await runner.screenshot("a4V", "comment-sidebar-wide");

    await runner.goto(accounts.cassCade, `/doc/${document.id}/thread/${commentThread1.id}`);
    await runner.screenshot("a5", "comment-thread");

    await runner.goto(accounts.cassCade, `/doc/${document.id}/thread/${commentThread1.id}`, {
        peekPath: `/doc/${document.id}/thread/${commentThread1.id}/comment/${comment.index}/reactions?at=${reactionsSearchParam}`,
    });
    await runner.screenshot("a6", "comment-reactions");

    await document.access.grantUrl(accounts.cassCade);
    await runner.goto(null, `/doc/${document.id}`);
    await runner.getByRole("heading", {name: "Q3 Planning"}).waitFor();
    await runner.screenshot("a7", "url-grant");

    const oldDocumentAccessPolicy = await document.access.get();
    assert(oldDocumentAccessPolicy.type === "Local");

    const documentSite = await TestSite.create(accounts.cassCade, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });
    await screenshotFileEntity(runner, accounts.cassCade, "a7", "a8", `Document:${document.id}`, {
        siteOptions: {
            site: documentSite,
            revertAccessPolicy: () =>
                document.access.set(accounts.cassCade, oldDocumentAccessPolicy),
        },
    });

    await runner.goto(accounts.cassCade, `/doc/${generateId()}?create=${space.id}`);
    await runner.screenshot("a8", "new");

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        peekPath: `/doc/${generateId()}?create=${space.id}`,
    });
    await runner.screenshot("a9", "new-peek");

    {
        const duplicateDocument = await TestDocument.create(accounts.cassCade, {
            title: "Incident postmortem: {{Name}}",
            access: "Public",
            body: markdown`
> Fill this in within 48 hours of resolution. Blameless. Be specific. Delete light grey text and
> replace it with your own notes.

<table data-column-widths="1,5">
<tr>
<td>

Date

</td>
<td>

{{Date}}

</td>
</tr>
<tr>
<td>

Severity

</td>
<td>

{{Severity}}

</td>
</tr>
<tr>
<td>

Author

</td>
<td>

{{Author}}

</td>
</tr>
</table>

# Summary

> One paragraph. What broke, who noticed, how long it lasted, who was affected. Write this so
> someone who wasn\u2019t on call can understand the shape of the incident in thirty seconds.

# Timeline

All times in UTC. Stick to facts. Interpretation goes lower in the doc.

- **0000-00-00T00:00:00Z** -
- **0000-00-00T00:00:00Z** -
- **0000-00-00T00:00:00Z** -

# Impact

> Customers affected, requests dropped, data at risk. Be honest about the worst-case read, not just
> what we ended up with.

# Root cause

> What actually went wrong. Walk through the chain of events. If multiple things had to fail at
> once, say so. If we got lucky that it wasn\u2019t worse, say that too.

# What went well

- [ ]
- [ ]

# What didn\u2019t

- [ ]
- [ ]

# Action items

- [ ]
- [ ]
            `,
        });

        const duplicateDocumentModel = await duplicateDocument.get();
        const duplicateSchema = extractContentDuplicationVariableSchema(
            duplicateDocumentModel.content.doc,
        );
        const duplicateSearchParams = new URLSearchParams();
        duplicateSearchParams.set(
            "title",
            getDocumentContentTitle(duplicateDocumentModel.content.doc),
        );

        const encodedDuplicateSchema =
            encodeContentDuplicationVariableSchemaForUrl(duplicateSchema);
        if (encodedDuplicateSchema !== null) {
            duplicateSearchParams.set("schema", encodedDuplicateSchema);
        }

        await runner.goto(accounts.cassCade, `/doc/${duplicateDocument.id}`, {
            peekPath: `/doc/${duplicateDocument.id}/duplicate?${duplicateSearchParams.toString()}`,
        });
        await runner.screenshot("aA", "duplicate");
    }

    {
        const oldDocumentAccessPolicy = await document.access.get();
        assert(oldDocumentAccessPolicy.type === "Local");

        // Open the peek against `/dev/empty` so the background is plain and the screenshot
        // focuses on the document peek under test rather than whatever's happening on the
        // surrounding space route.
        await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
            peekPath: `/doc/${document.id}`,
        });
        await runner.getByRole("heading", {name: "Q3 Planning"}).waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aB", "document-peek");

        // Same peek, scrolled — the nav bar reveals the entity title once the user moves
        // past the in-content header. With a site present that's also when the supratitle
        // / chip in the nav bar starts carrying the site context.
        await runner.getByTestId("DocumentContentEditorMain").evaluate(element => {
            element.scrollTop = 400;
        });
        await runner.mouse.move(0, 0);
        await runner.screenshot("aC", "document-peek-scrolled");

        const peekSite = await TestSite.create(accounts.cassCade, {
            name: "FY2026 H2 Planning",
            access: "Public",
        });

        await peekSite.addEntity(accounts.cassCade, {
            entityId: `Document:${document.id}`,
            parentId: peekSite.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        await ProcessContextModule.waitForTestTasks();
        await runner.services.waitForSqsProcessJobs();

        await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
            peekPath: `/doc/${document.id}`,
        });
        await runner.getByRole("heading", {name: "Q3 Planning"}).waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aD", "document-peek-in-site");

        // Same peek, scrolled — the nav bar reveals the entity title once the user moves
        // past the in-content header. With a site present that's also when the supratitle
        // / chip in the nav bar starts carrying the site context.
        await runner.getByTestId("DocumentContentEditorMain").evaluate(element => {
            element.scrollTop = 400;
        });
        await runner.mouse.move(0, 0);
        await runner.screenshot("aE", "document-peek-in-site-scrolled");

        await peekSite.removeEntity(accounts.cassCade, `Document:${document.id}`);
        await document.access.set(accounts.cassCade, oldDocumentAccessPolicy);
    }
}
