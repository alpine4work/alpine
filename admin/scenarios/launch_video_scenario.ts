import {today as getToday} from "@internationalized/date";
import {stringifyCookie} from "cookie";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllObjectPromises, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function createLaunchVideoScenario(
    context: TestContext,
    {tokenAgent}: {tokenAgent: TokenAgent},
): Promise<JsonObjectValue> {
    const space = await TestSpace.create(context, {
        // We use our company name for the space since a fictional product name might
        // not be clear. Plus it's good to get our company name in more screenshots.
        name: "Alpine",
    });

    const accounts = await createFictionalAmbrookAccounts(space);
    const {cassCade} = accounts;

    const [cassCadeEmailAddress] = await runAllPromises([
        cassCade.account.createEmailAddress(),

        uploadScenarioSpaceAvatar(tokenAgent, cassCade, "light", "scenario_space_avatar_light.svg"),
        uploadScenarioSpaceAvatar(tokenAgent, cassCade, "dark", "scenario_space_avatar_dark.svg"),

        uploadFictionalAmbrookAccountAvatars(tokenAgent, accounts),

        createFictionalAmbrookSprintTasks(accounts),
    ]);

    return {
        spaceId: space.id,
        cassCade: {
            accountId: cassCade.account.id,
            emailAddress: cassCadeEmailAddress,
        },
    };
}

async function uploadScenarioSpaceAvatar(
    tokenAgent: TokenAgent,
    session: TestSpaceSession,
    themeColor: "light" | "dark",
    path: string,
): Promise<void> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures", path),
    );

    const url = new URL(
        `/api/avatar/space/${session.space.id}`,
        session.context.constants.edgeServiceUrl,
    );
    url.searchParams.set("themeColor", themeColor);

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        url,
        {
            serviceName: "EdgeService",
            route: "/api/avatar/space/:spaceId",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": file.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: new Uint8Array(file),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}

async function uploadScenarioAccountAvatar(
    tokenAgent: TokenAgent,
    session: TestSession,
    path: string,
): Promise<void> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures", path),
    );

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        new URL(
            `/api/avatar/account/${session.account.id}`,
            session.context.constants.edgeServiceUrl,
        ),
        {
            serviceName: "EdgeService",
            route: "/api/avatar/account/:accountId",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": file.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: new Uint8Array(file),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}

type FictionalAmbrookAccounts = Awaited<ReturnType<typeof createFictionalAmbrookAccounts>>;

async function createFictionalAmbrookAccounts(space: TestSpace) {
    return runAllObjectPromises({
        // Chief of Staff (landing page is from Cass's perspective)
        cassCade: space.createSession({name: "Cass Cade", role: "Admin"}),

        // CEO
        roseCompas: space.createSession({name: "Rose Compás", role: "Owner"}),

        // Designer
        mattRHorn: space.createSession({name: "Matt R. Horn"}),

        // Engineer 1
        masonClay: space.createSession({name: "Mason Clay"}),

        // Engineer 2
        elleKappaTan: space.createSession({name: "Elle Kappa-Tan"}),

        // Sales
        cliffWeathers: space.createSession({name: "Cliff Weathers"}),

        // HR
        hollyEvergreen: space.createSession({name: "Holly Evergreen"}),
    });
}

async function uploadFictionalAmbrookAccountAvatars(
    tokenAgent: TokenAgent,
    accounts: FictionalAmbrookAccounts,
) {
    const upload = (name: keyof FictionalAmbrookAccounts, path: string) =>
        uploadScenarioAccountAvatar(tokenAgent, accounts[name], path);

    await runAllPromises([
        upload("cassCade", "scenario_cass_cade_avatar.png"),
        upload("roseCompas", "scenario_rose_compas_avatar.png"),
        upload("mattRHorn", "scenario_matt_r_horn_avatar.png"),
        upload("masonClay", "scenario_mason_clay_avatar.png"),
        upload("elleKappaTan", "scenario_elle_kappa_tan_avatar.png"),
        upload("cliffWeathers", "scenario_cliff_weathers_avatar.png"),
        upload("hollyEvergreen", "scenario_holly_evergreen_avatar.png"),
    ]);
}

async function createFictionalAmbrookSprintTasks({
    roseCompas,
    mattRHorn,
    elleKappaTan,
    masonClay,
    cassCade,
}: FictionalAmbrookAccounts) {
    const today = getToday(getCurrentTimeZone());

    const [
        sprintCollection,
        receiptMobileScannerCollection,
        grantsNavigatorCollection,
        profitByAcreDashboardCollection,
        aiCollection,
        integrationsCollection,
        designSystemCollection,
        documentationCollection,
    ] = await runAllPromises([
        TestTaskCollection.create(roseCompas, {
            name: "Sprint (2026 Q2)",
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
    ]);

    await runAllPromises([
        sprintCollection.access.grantDefault(roseCompas),
        sprintCollection.updateColor(roseCompas, "green"),

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
    ]);

    await runAllPromises([
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
            const task = await TestTask.create(mattRHorn, {
                title: "Dashboard cards v1 with “view in ledger” link",
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
                title: "“Approve & post” expenses UX + undo",
                collections: [sprintCollection, receiptMobileScannerCollection],
                priority: "Medium",
                assignee: masonClay,
            });

            await task.updateAssigneeStatus(masonClay, "Active");
        })(),
        (async () => {
            const task = await TestTask.create(cassCade, {
                title: "Program match score + “why this matched” explainer copy",
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
                title: "“Explain this number” inline notes for primary metrics",
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
                title: "Voice natural language processing (e.g. “allocate 73 gal to harvest”)",
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
            await TestTask.create(mattRHorn, {
                title: "Accessibility pass (WCAG AA) for grants navigator",
                collections: [sprintCollection, grantsNavigatorCollection],
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
            await TestTask.create(mattRHorn, {
                title: "Trendlines and YoY deltas on dashboard cards",
                collections: [sprintCollection, profitByAcreDashboardCollection],
                priority: "Low",
                assignee: mattRHorn,
            });
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
}
