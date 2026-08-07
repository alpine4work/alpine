import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    CollaborationStepCacheStep,
    CollaborativeContentStepCache,
} from "~/server/content/collaboration/collaborative_content_step_cache.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";

// Context doesn't matter for these tests so we can use an empty object.
const context = {};

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

function createStep(version: number): CollaborationStepCacheStep {
    return {
        step: new ReplaceStep(version, version, textSlice(String(version))),
        invertedStep: new ReplaceStep(version, version + 1, Slice.empty),
        clientId: generateId(),
    };
}

function createStepByVersion() {
    return new Map(Array.from({length: 12}, (_, version) => [version, createStep(version)]));
}

function createStepCache(options?: {
    version?: number;
    stepByVersion?: Map<number, CollaborationStepCacheStep>;
    calls?: Array<{startVersion: number; endVersion: number}>;
}) {
    const stepByVersion = options?.stepByVersion ?? createStepByVersion();
    const calls = options?.calls ?? [];

    return new CollaborativeContentStepCache({
        startVersion: options?.version ?? 10,
        loadSteps: async (_context, versions) => {
            calls.push(versions);

            return {
                steps: Array.from(
                    {length: versions.endVersion - versions.startVersion},
                    (_, index) => stepByVersion.get(versions.startVersion + index)!,
                ),
            };
        },
    });
}

function stepVersions(steps: ReadonlyArray<CollaborationStepCacheStep>) {
    return steps.map(({step}) => step.toJSON().from);
}

describe("CollaborationStepCache", () => {
    describe("dangerouslyAddStepToEnd()", () => {
        test("makes appended steps readable", async () => {
            const stepCache = createStepCache({version: 10});
            stepCache.dangerouslyAddStepToEnd(createStep(10));
            stepCache.dangerouslyAddStepToEnd(createStep(11));

            expect(stepVersions(await stepCache.getSteps(context, 10, 12))).toEqual([10, 11]);
        });
    });

    describe("getSteps()", () => {
        test("throws the configured error when the end version is too high", async () => {
            const stepCache = createStepCache();

            await expect(async () => {
                await stepCache.getSteps(context, 7, 11);
            }).rejects.toEqual(
                new FailedPreconditionError(
                    "Cannot get collaborative content steps with end version greater than the last version in the cache",
                ),
            );
        });

        test("loads only uncached old step ranges", async () => {
            const calls: Array<{startVersion: number; endVersion: number}> = [];
            const stepCache = createStepCache({calls});

            expect({
                firstSteps: stepVersions(await stepCache.getSteps(context, 7, 10)),
                secondSteps: stepVersions(await stepCache.getSteps(context, 5, 10)),
                thirdSteps: stepVersions(await stepCache.getSteps(context, 2, 5)),
                fourthSteps: stepVersions(await stepCache.getSteps(context, 4, 8)),
                calls,
            }).toEqual({
                firstSteps: [7, 8, 9],
                secondSteps: [5, 6, 7, 8, 9],
                thirdSteps: [2, 3, 4],
                fourthSteps: [4, 5, 6, 7],
                calls: [
                    {startVersion: 7, endVersion: 10},
                    {startVersion: 5, endVersion: 7},
                    {startVersion: 2, endVersion: 5},
                ],
            });
        });

        test("shares overlapping old step loads while reading in parallel", async () => {
            const calls: Array<{startVersion: number; endVersion: number}> = [];
            const stepCache = createStepCache({calls});

            const steps = await runAllPromises([
                stepCache.getSteps(context, 7, 10).then(stepVersions),
                stepCache.getSteps(context, 5, 10).then(stepVersions),
                stepCache.getSteps(context, 5, 8).then(stepVersions),
                stepCache.getSteps(context, 2, 5).then(stepVersions),
                stepCache.getSteps(context, 4, 8).then(stepVersions),
            ]);

            expect({steps, calls}).toEqual({
                steps: [
                    [7, 8, 9],
                    [5, 6, 7, 8, 9],
                    [5, 6, 7],
                    [2, 3, 4],
                    [4, 5, 6, 7],
                ],
                calls: [
                    {startVersion: 7, endVersion: 10},
                    {startVersion: 5, endVersion: 7},
                    {startVersion: 2, endVersion: 5},
                ],
            });
        });

        test("clears the load state after a failed old step load", async () => {
            let shouldFail = true;
            const calls: Array<{startVersion: number; endVersion: number}> = [];
            const stepCache = new CollaborativeContentStepCache({
                startVersion: 10,
                loadSteps: async (_context, versions) => {
                    calls.push(versions);

                    if (shouldFail) throw new InternalError("Could not load steps");

                    return {
                        steps: Array.from({length: 3}, (_, index) => createStep(7 + index)),
                    };
                },
            });

            await expect(async () => {
                await stepCache.getSteps(context, 7, 10);
            }).rejects.toThrow("Could not load steps");

            shouldFail = false;

            expect({
                steps: stepVersions(await stepCache.getSteps(context, 7, 10)),
                calls,
            }).toEqual({
                steps: [7, 8, 9],
                calls: [
                    {startVersion: 7, endVersion: 10},
                    {startVersion: 7, endVersion: 10},
                ],
            });
        });
    });
});
