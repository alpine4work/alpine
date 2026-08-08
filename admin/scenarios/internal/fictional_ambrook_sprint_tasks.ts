import {today as getToday} from "@internationalized/date";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export type FictionalAmbrookSprintTasks = Awaited<
    ReturnType<typeof createFictionalAmbrookSprintTasks>
>;

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookSprintTasks({
    roseCompas,
    mattRHorn,
    elleKappaTan,
    masonClay,
    cassCade,
}: DemoSpaceAccounts) {
    debug("Creating sprint tasks");

    const today = getToday(getCurrentTimeZone());

    const [
        sprintCollection,
        lastSprintCollection,
        receiptMobileScannerCollection,
        grantsNavigatorCollection,
        profitByAcreDashboardCollection,
        aiCollection,
        integrationsCollection,
        designSystemCollection,
        documentationCollection,
        recruitingCollection,
    ] = await runAllPromises([
        TestTaskCollection.create(roseCompas, {
            name: "Sprint (2026 Q2)",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Sprint (2026 Q1)",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Receipt Mobile Scanner",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Grants Navigator",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Profit by Acre Dashboard",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "AI",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Integrations",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Design System",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Documentation",
        }),
        TestTaskCollection.create(roseCompas, {
            name: "Recruiting",
        }),
    ]);

    await runAllPromises([
        sprintCollection.access.grantDefault(roseCompas),
        sprintCollection.updateColor(roseCompas, "green"),

        lastSprintCollection.access.grantDefault(roseCompas),

        receiptMobileScannerCollection.access.grantDefault(roseCompas),
        receiptMobileScannerCollection.updateColor(roseCompas, "orange"),

        grantsNavigatorCollection.access.grantDefault(roseCompas),
        grantsNavigatorCollection.updateColor(roseCompas, "purple"),

        profitByAcreDashboardCollection.access.grantDefault(roseCompas),
        profitByAcreDashboardCollection.updateColor(roseCompas, "yellow"),

        aiCollection.access.grantDefault(roseCompas),
        integrationsCollection.access.grantDefault(roseCompas),
        designSystemCollection.access.grantDefault(roseCompas),
        documentationCollection.access.grantDefault(roseCompas),

        recruitingCollection.access.grantDefault(roseCompas),
        recruitingCollection.updateColor(roseCompas, "red"),
    ]);

    const [interviewTask, coldEmailCampaignTask] = await runAllPromises([
        (async () => {
            const task = await TestTask.create(roseCompas, {
                title: "Interview Cara Bina",
                collections: [recruitingCollection],
                assignee: roseCompas,
            });

            await task.updateAssigneeStatus(roseCompas, "Active");

            return task;
        })(),
        (async () => {
            const task = await TestTask.create(roseCompas, {
                title: "Cold email campaign",
                collections: [recruitingCollection],
                assignee: roseCompas,
            });

            await task.updateAssigneeStatus(roseCompas, "Active");

            return task;
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Ship capture flow v1",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: masonClay,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateAssigneeStatus(masonClay, "Active");

            await runAllPromises(
                createArrayWithLength(7, async index => {
                    const subtask = await TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 5) {
                        await subtask.updateStatus(masonClay, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Design receipt mobile scanner UI",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: mattRHorn,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(mattRHorn, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Vendor detection service (>95% vendor recall on test set)",
                collections: [sprintCollection, aiCollection, receiptMobileScannerCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today.add({days: 1}),
            });

            await task.updateAssigneeStatus(elleKappaTan, "Active");

            await runAllPromises(
                createArrayWithLength(5, async index => {
                    const subtask = await TestTask.create(elleKappaTan, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 2) {
                        await subtask.updateStatus(elleKappaTan, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            await TestTask.create(mattRHorn, {
                title: "Trendlines and YoY deltas on dashboard cards",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Low",
                assignee: mattRHorn,
            });
        })(),
        (async () => {
            await TestTask.create(cassCade, {
                title: "Empty state copy + error copy",
                collections: [sprintCollection, documentationCollection, grantsNavigatorCollection],
                priority: "Low",
                assignee: cassCade,
            });
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Bank transaction history matching with conflict flagging and one-tap resolve",
                collections: [
                    sprintCollection,
                    receiptMobileScannerCollection,
                    integrationsCollection,
                ],
                priority: "High",
                assignee: masonClay,
            });

            await task.updateAssigneeStatus(masonClay, "Active");

            await runAllPromises(
                createArrayWithLength(4, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Eligibility questionnaire v1 (operations profile + location)",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(elleKappaTan, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Pilot farm 1-page training guide",
                collections: [
                    sprintCollection,
                    receiptMobileScannerCollection,
                    grantsNavigatorCollection,
                    documentationCollection,
                ],
                priority: "High",
                assignee: cassCade,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(cassCade, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Application pre-fill for Natural Resources Conservation Service + checklist auto-generation",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: masonClay,
            });

            await runAllPromises(
                createArrayWithLength(3, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Status tracker (found, in progress, submitted, awarded)",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "High",
                assignee: mattRHorn,
            });

            await task.updateStatus(mattRHorn, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Tag schema + aggregation jobs for cost per acre",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "High",
                assignee: elleKappaTan,
                dueDate: today,
            });

            await task.updateAssigneeStatus(elleKappaTan, "Active");

            await runAllPromises(
                createArrayWithLength(4, async index => {
                    const subtask = await TestTask.create(elleKappaTan, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 1) {
                        await subtask.updateStatus(elleKappaTan, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            await TestTask.create(mattRHorn, {
                title: "Accessibility pass (WCAG AA) for grants navigator",
                collections: [sprintCollection, grantsNavigatorCollection],
                priority: "Low",
                assignee: mattRHorn,
            });
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Dashboard cards v1 with \u201Cview in ledger\u201D link",
                collections: [
                    sprintCollection,
                    profitByAcreDashboardCollection,
                    designSystemCollection,
                ],
                priority: "High",
                assignee: mattRHorn,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateStatus(mattRHorn, "Closed");

            await runAllPromises(
                createArrayWithLength(2, index =>
                    TestTask.create(mattRHorn, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            await TestTask.create(elleKappaTan, {
                title: "Duplicate receipt detection and warning flow",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });
        })(),
        (async () => {
            await TestTask.create(elleKappaTan, {
                title: "Auto-split bank transaction suggestions (enterprise/field/practice) learned from history",
                collections: [sprintCollection, receiptMobileScannerCollection, aiCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "\u201CApprove & post\u201D expenses UX + undo",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "Medium",
                assignee: masonClay,
            });

            await task.updateAssigneeStatus(masonClay, "Active");
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Program match score + \u201Cwhy this matched\u201D explainer copy",
                collections: [sprintCollection, grantsNavigatorCollection, aiCollection],
                priority: "Medium",
                assignee: cassCade,
                dueDate: today,
            });

            await task.updateStatus(cassCade, "Closed");
        })(),
        (async () => {
            await TestTask.create(masonClay, {
                title: "Grant submission webhooks + status polling (mock USDA endpoints)",
                collections: [sprintCollection, integrationsCollection, grantsNavigatorCollection],
                priority: "Medium",
                assignee: masonClay,
            });
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "\u201CExplain this number\u201D inline notes for primary metrics",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: cassCade,
                dueDate: today.subtract({days: 1}),
            });

            await task.updateAssigneeStatus(mattRHorn, "Active");

            await runAllPromises(
                createArrayWithLength(3, async index => {
                    const subtask = await TestTask.create(cassCade, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    });

                    if (index + 1 <= 2) {
                        await subtask.updateStatus(cassCade, "Closed");
                    }
                }),
            );
        })(),
        (async () => {
            const task = await TestTask.create(mattRHorn, {
                title: "Ledger table filters: field, practice, channel",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: mattRHorn,
            });

            await task.updateAssigneeStatus(mattRHorn, "Active");
        })(),
        (async () => {
            const task = await TestTask.create(elleKappaTan, {
                title: "Performance optimizations, goal is to aggregate 1M transactions in <300ms",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Medium",
                assignee: elleKappaTan,
            });

            await task.updateStatus(elleKappaTan, "Closed");
        })(),
        (async () => {
            const task = await TestTask.create(masonClay, {
                title: "Voice natural language processing (e.g. \u201Callocate 73 gal to harvest\u201D)",
                collections: [sprintCollection, receiptMobileScannerCollection, aiCollection],
                priority: "Low",
                assignee: masonClay,
            });

            await runAllPromises(
                createArrayWithLength(5, index =>
                    TestTask.create(masonClay, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Map 5 pilot programs into schema (EQIP 382, CSP, REAP, state soil health, utility rebate)",
                collections: [sprintCollection, grantsNavigatorCollection, documentationCollection],
                priority: "Low",
                assignee: cassCade,
            });

            await runAllPromises(
                createArrayWithLength(5, index =>
                    TestTask.create(cassCade, {
                        title: `Subtask ${index + 1}`,
                        parent: task,
                    }),
                ),
            );
        })(),
    ]);

    debug("Created sprint tasks");

    return {
        sprintCollection,
        lastSprintCollection,
        grantsNavigatorCollection,
        receiptMobileScannerCollection,
        aiCollection,
        integrationsCollection,
        recruitingCollection,
        interviewTask,
        coldEmailCampaignTask,
    };
}
