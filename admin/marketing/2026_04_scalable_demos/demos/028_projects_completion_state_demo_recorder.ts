import {Locator} from "playwright";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const [projectsCollection, fy2026Q2Collection] = await runAllPromises([
        TestTaskCollection.create(accounts.cassCade, {name: "Projects", access: "Public"}),
        TestTaskCollection.create(accounts.cassCade, {name: "FY2026 Q2", access: "Public"}),
    ]);

    await runAllPromises([
        projectsCollection.updateColor(accounts.cassCade, "indigo"),
        fy2026Q2Collection.updateColor(accounts.cassCade, "green"),
    ]);

    const tablesProject = await TestTask.create(accounts.cassCade, {
        title: "Tables in the Rich Text Editor",
        layout: "Project",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        priority: "High",
        collections: [projectsCollection, fy2026Q2Collection],
        notes: markdown`
Tables is in the satisfying part of the project now. Selection model and keyboard navigation are
done. Remaining work is launch polish, examples, and the last bit of resize feel.
        `,
    });

    const realtimeReliabilityProject = await TestTask.create(accounts.cassCade, {
        title: "Realtime Reliability",
        layout: "Project",
        assignee: accounts.elleKappaTan,
        assigneeStatus: "Active",
        priority: "High",
        collections: [projectsCollection, fy2026Q2Collection],
        notes: markdown`
Rollout has held through the last deploy window. The project is mostly complete; what\u2019s left is
alert tuning and the final summary write-up.
        `,
    });

    const enterpriseSsoProject = await TestTask.create(accounts.cassCade, {
        title: "Enterprise SSO",
        layout: "Project",
        assignee: accounts.elleKappaTan,
        priority: "High",
        collections: [projectsCollection, fy2026Q2Collection],
        notes: markdown`
Scope is firming up. We still need one honest implementation window, a tighter admin story, and a
clear migration path for existing workspaces.
        `,
    });

    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Lock final keyboard navigation edge cases",
            assignee: accounts.masonClay,
            priority: "High",
        }).then(task => task.updateStatus(accounts.masonClay, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Review selection model on narrow screens",
            assignee: accounts.mattRHorn,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.mattRHorn, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Publish help doc screenshots",
            assignee: accounts.hollyEvergreen,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.hollyEvergreen, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Final column resizing polish",
            assignee: accounts.masonClay,
            assigneeStatus: "Active",
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Add one customer-facing example table",
            assignee: accounts.hollyEvergreen,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: realtimeReliabilityProject,
            title: "Roll out jittered exponential backoff",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: realtimeReliabilityProject,
            title: "Wire health checks into deploy pipeline",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: realtimeReliabilityProject,
            title: "Alert on reconnect spikes above baseline",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: realtimeReliabilityProject,
            title: "Write rollout summary for engineering",
            assignee: accounts.elleKappaTan,
            assigneeStatus: "Active",
            priority: "Low",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSsoProject,
            title: "Confirm SAML and OIDC implementation estimate",
            assignee: accounts.elleKappaTan,
            assigneeStatus: "Active",
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSsoProject,
            title: "Draft workspace admin UI requirements",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSsoProject,
            title: "Collect blocked-deal requirements from prospects",
            assignee: accounts.cliffWeathers,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.cliffWeathers, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: enterpriseSsoProject,
            title: "Review migration path with Cass",
            assignee: accounts.cassCade,
            priority: "Medium",
        }),
    ]);

    const spaceUrl = `https://alpine.inc/s/${space.id}`;
    const taskPreviewUrl = (task: TestTask) => `${spaceUrl}/tasks/${task.id}/preview`;

    const q2UpdateDocument = await TestDocument.create(accounts.cassCade, {
        title: "FY2026 Q2 Update",
        access: "Public",
        cover: {
            type: "Blobs",
            seed: "8d9be650-0f3d-45b1-96ce-18304fea93f7",
            themeColor: "indigo",
            hueSpread: 10,
        },
        body: markdown`
Q2 closed stronger than it started. Reliability work is steady, tables is down to final polish, and
we now have enough customer pressure on SSO that the implementation window needs to get real.

## Highlights

- Realtime reliability is quieter in the best way. The reconnect work held through the last rollout
  and the deployment health checks are doing their job.
- Tables is out of the architectural woods. What\u2019s left is launch polish, examples, and
  quality.
- Enterprise SSO has moved from vague customer ask to concrete planning problem.

## Ongoing Projects

The active projects below should make progress legible without opening anything.

[Tables in the Rich Text Editor](TABLES_PROJECT_PREVIEW_URL)

[Realtime Reliability](REALTIME_PROJECT_PREVIEW_URL)

[Enterprise SSO](ENTERPRISE_SSO_PROJECT_PREVIEW_URL)
        `
            .replace("TABLES_PROJECT_PREVIEW_URL", taskPreviewUrl(tablesProject))
            .replace("REALTIME_PROJECT_PREVIEW_URL", taskPreviewUrl(realtimeReliabilityProject))
            .replace("ENTERPRISE_SSO_PROJECT_PREVIEW_URL", taskPreviewUrl(enterpriseSsoProject)),
    });

    await q2UpdateDocument.updateContentPreview();

    await recorder.record({
        instructions: markdown`
The viewer starts in Cass\u2019s FY2026 Q2 update document. The document already has a blob cover
and a short narrative update. The goal is to show that project links inside a planning doc open
straight into a live project view with completion state already legible.

The recording is fully automated: it pauses on the cover, scrolls to the inline project previews,
opens the Tables project in peek, and expands that peek to full screen.

1. Expand the Chrome window so rounded corners are not visible in the recording.

2. Start recording, then press Enter in this terminal to begin the automated actions.
        `,
        session: accounts.cassCade,
        path: `/s/${space.id}/documents/${q2UpdateDocument.id}`,
        viewport: scalableDemoWideViewport,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
        actions: [
            async page => {
                const documentContentEditor = page.getByTestId("DocumentContentEditorMain");
                await documentContentEditor.waitFor({state: "visible"});

                const tablesProjectPreview = documentContentEditor
                    .getByText("Tables in the Rich Text Editor")
                    .first();

                const cursor = await createDemoCursor(page, {
                    scale: 1.5,
                    watchCssCursor: true,
                });

                await cursor.hide();
                await cursor.jumpTo(160, 520);
                await wait(1700);

                await smoothScrollLocatorIntoCenter(tablesProjectPreview, 1300);
                await wait(150);

                await cursor.show();
                await wait(80);
                await cursor.moveToElement(tablesProjectPreview, 550);
                await wait(90);
                await cursor.clickElement(tablesProjectPreview, 700, {watchCssCursor: true});

                const taskDetailView = page.getByTestId("TaskDetailViewMain");
                await taskDetailView.waitFor({state: "visible"});
                await wait(1100);

                const expandButton = page.getByRole("button", {name: "Expand"}).last();
                await expandButton.waitFor({state: "visible"});
                await cursor.moveToElement(expandButton, 850);
                await wait(180);
                await cursor.clickElement(expandButton, 650, {watchCssCursor: true});
                await wait(1700);
            },
        ],
    });
});

async function smoothScrollLocatorIntoCenter(locator: Locator, durationMs: number) {
    await locator.evaluate((element, duration) => {
        let scrollable: HTMLElement | null = element.parentElement;
        while (scrollable) {
            const {overflow, overflowY} = getComputedStyle(scrollable);
            if (
                /(auto|scroll)/.test(overflow + overflowY) &&
                scrollable.scrollHeight > scrollable.clientHeight
            ) {
                break;
            }
            scrollable = scrollable.parentElement;
        }
        if (!scrollable) return;

        const elementRect = element.getBoundingClientRect();
        const containerRect = scrollable.getBoundingClientRect();
        const targetScrollTop =
            scrollable.scrollTop +
            elementRect.top -
            containerRect.top -
            scrollable.clientHeight / 2 +
            elementRect.height / 2;

        const startScrollTop = scrollable.scrollTop;
        const distance = targetScrollTop - startScrollTop;
        const scrollView = scrollable;

        return new Promise<void>(resolve => {
            const startTime = performance.now();

            function step(now: number) {
                const t = Math.min((now - startTime) / duration, 1);
                const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                scrollView.scrollTop = startScrollTop + distance * eased;

                if (t < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(step);
        });
    }, durationMs);
}
