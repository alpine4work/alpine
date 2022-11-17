import {Mapping, Step} from "prosemirror-transform";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document_content_schema";
import {DataLossError, FailedPreconditionError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";

/**
 * Gets the result of applying an update to some document content.
 *
 * If an update is for an old version then we rebase the update steps with
 * conflicting steps in the document.
 *
 * We return the rebased steps. It's possible the rebased steps array will be
 * empty! This happens if while rebasing, the ranges edited by the update steps
 * were completely removed.
 *
 * You need to provide a `getSteps` function which, when called, returns the
 * array of steps in that range. You can assume the range passed into this
 * function is a valid range of steps.
 */
export async function getUpdateDocumentContentResult({
    currentVersion,
    currentContent,
    clientVersion,
    clientSteps,
    getSteps,
}: {
    currentVersion: number;
    currentContent: DocumentContent;
    clientVersion: number;
    clientSteps: ReadonlyArray<Step>;
    getSteps: (
        startVersion: number,
        endVersion: number,
    ) => Promise<Array<{step: Step; invertedStep: Step; clientId: Id}>>;
}): Promise<{
    newContent: DocumentContent;
    steps: ReadonlyArray<Step>;
    invertedSteps: ReadonlyArray<Step>;
    conflictingSteps: ReadonlyArray<{step: Step; invertedStep: Step; clientId: Id}>;
    clientContent: DocumentContent;
    mapping: Mapping;
}> {
    assert(clientVersion >= 0);

    if (clientVersion > currentVersion)
        throw new FailedPreconditionError(
            "Can not update document with steps at version ahead of the document's current version",
        );

    let content = currentContent;
    let steps: ReadonlyArray<Step>;
    let invertedSteps: Array<Step>;
    let conflictingSteps: ReadonlyArray<{step: Step; invertedStep: Step; clientId: Id}>;
    let clientContent: DocumentContent;

    const mapping = new Mapping();

    // If the client's version is the same as our server version then we can
    // directly apply the client's steps to the content.
    if (clientVersion === currentVersion) {
        invertedSteps = [];

        for (const step of clientSteps) {
            const stepResult = step.apply(content);
            if (!stepResult.doc)
                throw new FailedPreconditionError(
                    `Could not apply step to document: ${stepResult.failed!}`,
                );

            invertedSteps.push(step.invert(content));

            assert(isDocumentContent(stepResult.doc));
            content = stepResult.doc;
        }

        steps = clientSteps;
        conflictingSteps = [];
        clientContent = content;
    }

    // If the client is trying to update an older document version then we need to
    // rebase the client steps against steps which were applied before it.
    else {
        assert(clientVersion < currentVersion);

        conflictingSteps = await getSteps(clientVersion, currentVersion);
        assert(conflictingSteps.length === currentVersion - clientVersion);

        const invertedClientSteps: Array<Step> = [];

        // Make sure all steps from the client were valid against the document at
        // `clientVersion`. So revert back to to that version and try applying our
        // client steps.
        //
        // We will drop any steps we can't rebase. But we still want to validate that
        // the original steps were ok.
        {
            clientContent = content;

            for (let i = conflictingSteps.length - 1; i >= 0; i--) {
                const {invertedStep} = conflictingSteps[i]!;
                const invertedStepResult = invertedStep.apply(clientContent);
                if (!invertedStepResult.doc)
                    throw new DataLossError(
                        `Could not apply inverse of saved document step: ${invertedStepResult.failed!}`,
                    );

                assert(isDocumentContent(invertedStepResult.doc));
                clientContent = invertedStepResult.doc;
            }

            for (const step of clientSteps) {
                const stepResult = step.apply(clientContent);
                if (!stepResult.doc)
                    throw new FailedPreconditionError(
                        `Could not apply step to document: ${stepResult.failed!}`,
                    );

                invertedClientSteps.push(step.invert(clientContent));

                assert(isDocumentContent(stepResult.doc));
                clientContent = stepResult.doc;
            }
        }

        // See the guide for information on how to rebase a chain of steps against
        // another chain of steps:
        // https://prosemirror.net/docs/guide/#transform.rebasing
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

            // Silently ignore steps we can't rebase. That's what the client
            // implementation does:
            // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
            if (!rebasedStep) continue;

            const rebasedStepResult = rebasedStep.apply(content);

            // Silently ignore steps we can't rebase. That's what the client
            // implementation does:
            // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
            if (!rebasedStepResult.doc) continue;

            invertedSteps.push(rebasedStep.invert(content));

            assert(isDocumentContent(rebasedStepResult.doc));
            content = rebasedStepResult.doc;
            rebasedSteps.push(rebasedStep);
            mapping.appendMap(rebasedStep.getMap());
            mapping.setMirror(mapFrom, mapping.maps.length - 1);
        }

        steps = rebasedSteps;
    }

    // We want the inverted steps to be stored in reverse order of our steps. We
    // added the inverted steps in forward step order.
    invertedSteps.reverse();

    return {
        newContent: content,
        steps,
        invertedSteps,
        conflictingSteps,
        clientContent,
        mapping,
    };
}
