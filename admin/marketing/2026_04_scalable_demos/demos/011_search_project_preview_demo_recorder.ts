import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    // Task collections for the Mobile App Redesign project.
    const [designCollection, engineeringCollection, projectsCollection, q2Collection] =
        await runAllPromises([
            TestTaskCollection.create(accounts.cassCade, {name: "Design", access: "Public"}),
            TestTaskCollection.create(accounts.cassCade, {name: "Engineering", access: "Public"}),
            TestTaskCollection.create(accounts.cassCade, {name: "Projects", access: "Public"}),
            TestTaskCollection.create(accounts.cassCade, {name: "FY2026 Q2", access: "Public"}),
        ]);

    await runAllPromises([
        designCollection.updateColor(accounts.cassCade, "purple"),
        engineeringCollection.updateColor(accounts.cassCade, "blue"),
        q2Collection.updateColor(accounts.cassCade, "green"),
    ]);

    // The Mobile App Redesign project — assigned to Mason, lives in all four
    // collections. `layout: "Project"` gives it the interactive search preview with
    // its child task breakdown.
    const mobileAppRedesignProject = await TestTask.create(accounts.cassCade, {
        title: "Mobile App Redesign",
        layout: "Project",
        assignee: accounts.masonClay,
        collections: [designCollection, engineeringCollection, projectsCollection, q2Collection],
    });

    await mobileAppRedesignProject.updateAssigneeStatus(accounts.masonClay, "Active");

    // 12 design sub-tasks: all Matt, all Closed.
    const designTaskTitles = [
        "Sign-in screen mocks",
        "Sign-up flow wireframes",
        "Onboarding walkthrough mocks",
        "Settings page layout",
        "Profile screen mocks",
        "Notifications screen mocks",
        "Password reset flow",
        "Tab bar visual refresh",
        "Color token system",
        "Typography scale",
        "Dark mode palette",
        "Empty state illustrations",
    ];

    // 18 engineering sub-tasks: Mason or Elle, all Open. A couple are marked Active so
    // the preview shows in-progress engineering work alongside closed design work.
    const engineeringTaskSpecs: ReadonlyArray<{
        title: string;
        assignee: TestSpaceSession;
        active?: boolean;
    }> = [
        {title: "Implement new sign-in screen", assignee: accounts.masonClay, active: true},
        {title: "Implement sign-up flow", assignee: accounts.masonClay},
        {
            title: "Onboarding walkthrough implementation",
            assignee: accounts.masonClay,
            active: true,
        },
        {title: "Settings page rebuild", assignee: accounts.masonClay},
        {title: "Profile screen implementation", assignee: accounts.masonClay},
        {title: "Notifications screen refactor", assignee: accounts.masonClay},
        {title: "Password reset API + UI", assignee: accounts.elleKappaTan},
        {title: "Tab bar navigation refactor", assignee: accounts.masonClay},
        {title: "Theme provider + color tokens", assignee: accounts.masonClay},
        {title: "Typography components update", assignee: accounts.masonClay},
        {title: "Dark mode support", assignee: accounts.masonClay},
        {title: "Biometric auth integration", assignee: accounts.elleKappaTan},
        {title: "Email verification endpoint", assignee: accounts.elleKappaTan},
        {title: "Account deletion flow", assignee: accounts.elleKappaTan},
        {title: "Push notification permissions prompt", assignee: accounts.masonClay},
        {title: "Deep linking updates", assignee: accounts.masonClay},
        {title: "Offline mode cache layer", assignee: accounts.elleKappaTan},
        {title: "Analytics events: new screens", assignee: accounts.masonClay},
    ];

    await runAllPromises([
        ...designTaskTitles.map(async title => {
            const task = await TestTask.create(accounts.cassCade, {
                parent: mobileAppRedesignProject,
                title,
                assignee: accounts.mattRHorn,
                priority: "Medium",
                layout: "Project",
            });
            await task.updateStatus(accounts.mattRHorn, "Closed");
        }),
        ...engineeringTaskSpecs.map(async ({title, assignee, active}) => {
            const task = await TestTask.create(accounts.cassCade, {
                parent: mobileAppRedesignProject,
                title,
                assignee,
                priority: "Medium",
            });

            if (active) {
                await task.updateAssigneeStatus(assignee, "Active");
            }
        }),
    ]);

    // The document the viewer lands on.
    const document = await TestDocument.create(accounts.cassCade, {
        title: "FY2026 Q2 Update",
        access: "Public",
        body: markdown`
Quick update on where we landed at the end of Q2 and what\u2019s on deck. Big push this quarter was
stabilizing realtime and kicking off the mobile redesign - more on both below.

## Projects
        `,
    });

    await document.updateContentPreview();

    // Populate Cass's suggested search list. 5 entries total, with the Mobile App
    // Redesign project at position 3.

    const spaceId = space.id;
    const accountId = accounts.cassCade.account.id;

    await runAllPromises([
        // Rank 1 — Q4 Planning Draft.
        TestDocument.create(accounts.cassCade, {title: "Q4 Planning Draft"}).then(doc =>
            addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${doc.id}`,
                points: 999_000_000,
            }),
        ),
        // Rank 2 — Announcements channel.
        TestChannel.create(accounts.cassCade, {name: "Announcements", access: "Public"}).then(
            channel =>
                addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Channel:${channel.id}`,
                    points: 998_000_000,
                }),
        ),
        // Rank 3 — the star of the demo.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${mobileAppRedesignProject.id}`,
            points: 997_000_000,
        }),
        // Rank 4 — Rose's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.roseCompas.account.id}`,
            points: 996_000_000,
        }),
        // Rank 5 — Q3 Customer Survey Summary.
        TestDocument.create(accounts.cassCade, {title: "Q3 Customer Survey Summary"}).then(doc =>
            addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
                spaceId,
                accountId,
                entityId: `Document:${doc.id}`,
                points: 995_000_000,
            }),
        ),
    ]);

    await recorder.record({
        instructions: markdown`
1. Click at the end of the \u201C## Projects\u201D heading and press Enter so the cursor sits on a
   new line below it.

2. Open search. The suggested list shows 5 entries. \u201CMobile App Redesign\u201D is the 3rd
   entry.

3. Click \u201CMobile App Redesign\u201D to reveal the preview with its child tasks \u2014 a mix of
   closed design work and open/active engineering tasks.

4. Copy the Mobile App Redesign link from the preview, then dismiss search using Escape.

5. Paste into the document on the new line below \u201C## Projects\u201D. The link should render as
   an inline Mobile App Redesign reference.
        `,
        session: accounts.cassCade,
        path: `/doc/${document.id}`,
        viewport: scalableDemoWideViewport,
    });
});
