import {Node} from "prosemirror-model";
import {AttrStep, Mapping, Step} from "prosemirror-transform";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {ExhaustiveStep} from "~/shared/prosemirror/exhaustive_step.js";

declare module "prosemirror-transform" {
    interface Mapping {
        // We know this exists but `prosemirror-transform` marks it as internal:
        // https://github.com/ProseMirror/prosemirror-transform/blob/4372fb6de489ee6c8c6a8756682a9464ecde8f1b/src/map.ts#L221-L225
        //
        // We want to call this function in the same place as `prosemirror-collab`:
        // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L22
        setMirror(n: number, m: number): void;
    }
}

/**
 * Gets the result of applying a collaborative update to some content.
 *
 * If an update is for an old version then we rebase the update steps with
 * conflicting steps against the content.
 *
 * We return the rebased steps. It's possible the rebased steps array will be
 * empty! This happens if while rebasing, the ranges edited by the update steps
 * were completely removed.
 *
 * You need to provide a `getSteps` function which, when called, returns the array
 * of steps in that range. You can assume the range passed into this function is a
 * valid range of steps.
 */
export function getCollaborativelyUpdateContentResult(
    context: Context<{tracer: TracerContextModule}>,
    {
        currentVersion,
        currentContent,
        clientVersion,
        clientSteps,
        getSteps,
    }: {
        currentVersion: number;
        currentContent: Node;
        clientVersion: number;
        clientSteps: ReadonlyArray<Step>;
        getSteps: (
            startVersion: number,
            endVersion: number,
        ) => Promise<
            ReadonlyArray<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>
        >;
    },
): Promise<{
    newContent: Node;
    steps: ReadonlyArray<Step>;
    invertedSteps: ReadonlyArray<Step>;
    conflictingSteps: ReadonlyArray<{
        step: Step;
        invertedStep: Step;
        clientId: ContentEditorClientId;
    }>;
    clientContent: Node;
    // Mapping from client positions to positions in the final content. Will not map
    // anything if there were no conflicting steps.
    mapping: Mapping;
}> {
    return context.tracer.withSpan(
        "Get collaboratively update content result",
        async (context, span) => {
            assert(clientVersion >= 0);

            span.addData({
                content: {
                    collaborative: {
                        clientVersion,
                        clientStepCount: clientSteps.length,
                        version: currentVersion,
                    },
                },
            });

            if (clientVersion > currentVersion) {
                throw new FailedPreconditionError(
                    "Can not update content with steps at version ahead of the content\u2019s current version",
                );
            }

            let content = currentContent;
            let steps: ReadonlyArray<Step>;
            let invertedSteps: Array<Step>;
            let conflictingSteps: ReadonlyArray<{
                step: Step;
                invertedStep: Step;
                clientId: ContentEditorClientId;
            }>;
            let clientContent: Node;

            const mapping = new Mapping();

            // If the client's version is the same as our server version then we can directly
            // apply the client's steps to the content.
            if (clientVersion === currentVersion) {
                invertedSteps = [];

                for (const step of clientSteps) {
                    // ProseMirror will happily apply an `AttrStep` to any node even if the node
                    // doesn't support the attribute in question. So add extra validation on the server
                    // to make sure we're applying `AttrStep` to a node which supports this attribute.
                    if (step instanceof AttrStep) {
                        const node = content.nodeAt(step.pos);
                        if (node) {
                            const attrSpec = node.type.spec.attrs?.[step.attr];
                            if (!attrSpec) {
                                throw new FailedPreconditionError(
                                    quote`Couldn\u2019t apply attr step to node ${node.type.name} because it doesn\u2019t support attr ${step.attr}`,
                                );
                            }

                            // Make sure the step is valid.
                            attrSpec.schema.validate?.(step.value);
                        }
                    }

                    let stepResult;
                    try {
                        stepResult = step.apply(content);
                    } catch (error) {
                        if (error instanceof RangeError) {
                            throw new FailedPreconditionError(
                                `Couldn\u2019t apply step to content: ${error.message}`,
                            );
                        }
                        throw error;
                    }
                    if (!stepResult.doc) {
                        throw new FailedPreconditionError(
                            `Couldn\u2019t apply step to content: ${stepResult.failed!}`,
                        );
                    }

                    invertedSteps.push(step.invert(content));

                    content = stepResult.doc;
                }

                steps = clientSteps;
                conflictingSteps = [];
                clientContent = content;
            }

            // If the client is trying to update an older content version then we need to
            // rebase the client steps against steps which were applied before it.
            else {
                assert(clientVersion < currentVersion);

                conflictingSteps = await getSteps(clientVersion, currentVersion);
                assert(conflictingSteps.length === currentVersion - clientVersion);

                const invertedClientSteps: Array<Step> = [];

                // Make sure all steps from the client were valid against the content at
                // `clientVersion`. So revert back to to that version and try applying our client
                // steps.
                //
                // We will drop any steps we can't rebase. But we still want to validate that the
                // original steps were ok.
                {
                    clientContent = content;

                    for (let i = conflictingSteps.length - 1; i >= 0; i--) {
                        const {invertedStep} = assertExists(conflictingSteps[i]);
                        let invertedStepResult;
                        try {
                            invertedStepResult = invertedStep.apply(clientContent);
                        } catch (error) {
                            if (error instanceof RangeError) {
                                throw new DataLossError(
                                    `Couldn\u2019t apply inverse of saved content step: ${error.message}`,
                                );
                            }
                            throw error;
                        }
                        if (!invertedStepResult.doc) {
                            const failed = assertExists(invertedStepResult.failed);
                            throw new DataLossError(
                                `Couldn\u2019t apply inverse of saved content step: ${failed}`,
                            );
                        }

                        clientContent = invertedStepResult.doc;
                    }

                    for (const step of clientSteps) {
                        // ProseMirror will happily apply an `AttrStep` to any node even if the node
                        // doesn't support the attribute in question. So add extra validation on the server
                        // to make sure we're applying `AttrStep` to a node which supports this attribute.
                        if (step instanceof AttrStep) {
                            const node = clientContent.nodeAt(step.pos);
                            if (node) {
                                const attrSpec = node.type.spec.attrs?.[step.attr];
                                if (!attrSpec) {
                                    throw new FailedPreconditionError(
                                        quote`Couldn\u2019t apply attr step to node ${node.type.name} because it doesn\u2019t support attr ${step.attr}`,
                                    );
                                }

                                // Make sure the step is valid.
                                attrSpec.schema.validate?.(step.value);
                            }
                        }

                        let stepResult;
                        try {
                            stepResult = step.apply(clientContent);
                        } catch (error) {
                            if (error instanceof RangeError) {
                                throw new FailedPreconditionError(
                                    `Couldn\u2019t apply step to content: ${error.message}`,
                                );
                            }
                            throw error;
                        }
                        if (!stepResult.doc) {
                            throw new FailedPreconditionError(
                                `Couldn\u2019t apply step to content: ${stepResult.failed!}`,
                            );
                        }

                        invertedClientSteps.push(step.invert(clientContent));

                        clientContent = stepResult.doc;
                    }
                }

                // See the guide for information on how to rebase a chain of steps against another
                // chain of steps: https://prosemirror.net/docs/guide/#transform.rebasing
                //
                // Also see the client-side rebasing implementation:
                // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L14-L27

                for (let i = invertedClientSteps.length - 1; i >= 0; i--)
                    mapping.appendMap(invertedClientSteps[i]!.getMap());
                for (let i = 0; i < conflictingSteps.length; i++)
                    mapping.appendMap(conflictingSteps[i]!.step.getMap());

                const rebasedSteps = [];
                invertedSteps = [];
                let mapFrom = clientSteps.length;

                for (let i = 0; i < clientSteps.length; i++) {
                    const rebasedStep = clientSteps[i]!.map(mapping.slice(mapFrom));
                    mapFrom--;

                    // Silently ignore steps we can't rebase. That's what the client implementation
                    // does:
                    // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                    if (!rebasedStep) continue;

                    // ProseMirror will happily apply an `AttrStep` to any node even if the node
                    // doesn't support the attribute in question. So add extra validation on the server
                    // to make sure we're applying `AttrStep` to a node which supports this attribute.
                    //
                    // NOTE(calebmer): We consider this an `InternalError` (instead of
                    // `FailedPreconditionError`) and add `AFTER REBASING` to the error message since
                    // if `AttrStep` is updating an attribute on a node that doesn't support the
                    // attribute then we should error above when we apply `clientSteps` to
                    // `clientContent` not here. However, maybe a bug in ProseMirror may lead our
                    // rebased `AttrStep` targeting a different node than what it was targeting
                    // initially. If this happens we want to catch the issue early (instead of writing
                    // corrupted data to the database).
                    if (rebasedStep instanceof AttrStep) {
                        const node = content.nodeAt(rebasedStep.pos);
                        if (node) {
                            const attrSpec = node.type.spec.attrs?.[rebasedStep.attr];
                            if (!attrSpec) {
                                throw new InternalError(
                                    quote`Couldn\u2019t apply attr step to node ${node.type.name} because it doesn\u2019t support attr ${rebasedStep.attr} (AFTER REBASING)`,
                                );
                            }

                            // Make sure the step is valid.
                            attrSpec.schema.validate?.(rebasedStep.value);
                        }
                    }

                    const rebasedStepResult = rebasedStep.apply(content);

                    // Silently ignore steps we can't rebase. That's what the client implementation
                    // does:
                    // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                    if (!rebasedStepResult.doc) continue;

                    invertedSteps.push(rebasedStep.invert(content));

                    content = rebasedStepResult.doc;
                    rebasedSteps.push(rebasedStep);
                    mapping.appendMap(rebasedStep.getMap());
                    mapping.setMirror(mapFrom, mapping.maps.length - 1);
                }

                steps = rebasedSteps;
            }

            // Validate that our steps left the content in a good state.
            //
            // We collect all ranges touched by a step and we validate the content of the nodes
            // in those ranges.
            {
                const rangesToValidate: Array<{start: number; end: number}> = [];
                const mapping = new Mapping(steps.map(step => step.getMap()));

                for (const [stepIndex, _step] of steps.entries()) {
                    const step = _step as ExhaustiveStep;
                    const remainingMapping = mapping.slice(stepIndex);

                    const addRangeToValidate = (start: number, end: number) => {
                        // Make sure start/end represent positions in our new content.
                        start = remainingMapping.map(start, -1);
                        end = remainingMapping.map(end, 1);
                        assert(start <= end);

                        let hasInsertedRange = false;

                        for (const [rangeIndex, range] of rangesToValidate.entries()) {
                            assert(range.start <= range.end);

                            if (areRangesOverlapping(range.start, range.end, start, end)) {
                                range.start = Math.min(range.start, start);
                                range.end = Math.min(range.end, end);
                                hasInsertedRange = true;
                                break;
                            }

                            if (end < range.start) {
                                rangesToValidate.splice(rangeIndex, 0, {start, end: end});
                                hasInsertedRange = true;
                                break;
                            }
                        }

                        if (!hasInsertedRange) rangesToValidate.push({start, end});
                    };

                    switch (step.jsonID) {
                        case "attr":
                        case "addNodeMark":
                        case "removeNodeMark": {
                            addRangeToValidate(step.pos, step.pos);
                            break;
                        }
                        case "docAttr": {
                            // We don't perform any content structure validations when `doc` attributes change.
                            break;
                        }
                        case "addMark":
                        case "removeMark":
                        case "replace":
                        case "replaceAround": {
                            addRangeToValidate(step.from, step.to);
                            break;
                        }
                        case "removeAllMarks": {
                            // Remove valid marks does not affect the validity of the content's structure.
                            break;
                        }
                        case "addMarksAfterRemoveAll": {
                            for (const range of step.ranges) {
                                if (range.isNode) {
                                    addRangeToValidate(range.pos, range.pos + 1);
                                } else {
                                    addRangeToValidate(range.from, range.to);
                                }
                            }
                            break;
                        }
                        default:
                            throw exhaustive(step);
                    }
                }

                const validatedNodes = new Set<Node>();
                for (const range of rangesToValidate) {
                    content.nodesBetween(range.start, range.end, (node, pos, parentNode) => {
                        // Make sure we validate the parent nodes of any updated nodes as well. In case
                        // changing the type of our node made it unacceptable for its parent's content.
                        if (parentNode && !validatedNodes.has(parentNode)) {
                            validatedNodes.add(parentNode);

                            if (!parentNode.type.validContent(parentNode.content)) {
                                throw new FailedPreconditionError(
                                    `Updated content for \`${parentNode.type.name}\` node is not valid`,
                                );
                            }
                        }

                        // If we have already validated this node in a different range, don't validate
                        // again.
                        if (validatedNodes.has(node)) return false;
                        validatedNodes.add(node);

                        if (!node.type.validContent(node.content)) {
                            throw new FailedPreconditionError(
                                `Updated content for \`${node.type.name}\` node is not valid`,
                            );
                        }

                        // For code blocks, new lines should be created by adding new `codeBlockLine`s. Not
                        // by adding a `\n` character! Reject any updates that try to add a new line
                        // character to a code block line.
                        if (
                            node.isText &&
                            // `text` nodes must have a parent node.
                            parentNode!.type.name === "codeBlockLine" &&
                            node.text!.includes("\n")
                        ) {
                            throw new FailedPreconditionError(
                                "Can\u2019t add `\\n` character to `codeBlockLine` node",
                            );
                        }

                        // Don't allow adding marks to non-leaf ProseMirror nodes. ProseMirror technically
                        // allows this. For a node's children to have marks the node itself must also
                        // support those marks. Since ProseMirror doesn't give us a way to disallow marks
                        // on non-leaf nodes in the ProseMirror schema we instead block them here.
                        //
                        // Some examples of what we want to avoid:
                        //
                        // - `comment` marks on `fileRow` instead of `file`
                        // - `bold` marks on `paragraph` instead of a `paragraph`'s text
                        if (!node.type.isLeaf && node.marks.length > 0) {
                            throw new FailedPreconditionError(
                                `Can\u2019t add marks directly to non-leaf \`${node.type.name}\` node`,
                            );
                        }
                    });
                }
            }

            span.addData({
                content: {
                    collaborative: {
                        stepCount: steps.length,
                    },
                },
            });

            return {
                newContent: content,
                steps,
                invertedSteps,
                conflictingSteps,
                clientContent,
                mapping,
            };
        },
    );
}
