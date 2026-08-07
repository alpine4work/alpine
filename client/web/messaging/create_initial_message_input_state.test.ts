import {Selection} from "prosemirror-state";
import {createInitialMessageInputState} from "~/client/web/messaging/create_initial_message_input_state.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft} from "~/shared/messaging/message_draft_schema.js";

const spaceId = generateId<SpaceId>();

function createTestMessageDraft(text: string): MessageDraft {
    return {
        content: {
            doc: createSimpleMessageContent(text),
            references: emptyContentReferences,
        },
        parent: null,
        fileIds: [],
        version: zeroHybridLogicalTime,
    };
}

describe("createInitialMessageInputState", () => {
    test("creates an empty non-collaborative state with no draft", () => {
        const state = createInitialMessageInputState({spaceId});

        expect({
            isCollaborative: state.isCollaborative(),
            doc: state.getDoc().toJSON(),
        }).toEqual({
            isCollaborative: false,
            doc: emptyMessageContent.toJSON(),
        });
    });

    test("creates a state with the draft\u2019s content", () => {
        const state = createInitialMessageInputState({
            spaceId,
            draft: createTestMessageDraft("hello"),
        });

        expect(state.getDoc().toJSON()).toEqual(createSimpleMessageContent("hello").toJSON());
    });

    test("puts the selection at the end of the draft content", () => {
        const state = createInitialMessageInputState({
            spaceId,
            draft: createTestMessageDraft("hello"),
        });

        expect(state.getSelection().toJSON()).toEqual(Selection.atEnd(state.getDoc()).toJSON());
    });
});
