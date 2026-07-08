import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebTaskCollectionPage,
    normalizeAgentWebTaskCollectionPage,
    parseAgentWebTaskCollectionPage,
    printAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {ApiTaskReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const collectionId = generateId<TaskCollectionId>();

const writeSpecTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: false},
};

const shipLaunchTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Ship launch",
    status: {type: "Closed"},
};

runAgentWebPageTests<TaskCollectionId, AgentWebTaskCollectionPage>({
    print: printAgentWebTaskCollectionPage,
    parse: parseAgentWebTaskCollectionPage,
    normalize: normalizeAgentWebTaskCollectionPage,
    tests: [
        {
            name: "task collection page with color and tasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                tasks: [writeSpecTaskReference, shipLaunchTaskReference],
            },
        },
        {
            name: "task collection page without color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                tasks: [writeSpecTaskReference],
            },
        },
        {
            name: "task collection page without tasks",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Blue
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Blue",
                tasks: [],
            },
        },
        {
            name: "task collection page with only a name",
            pageLink: collectionId,
            markdown: `\
# Roadmap
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with none color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: None
`,
            printMarkdown: `\
# Roadmap
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: null,
                tasks: [],
            },
        },
        {
            name: "task collection page with lowercase color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

color: red
`,
            printMarkdown: `\
# Roadmap

Color: Red
`,
            page: {
                type: "TaskCollection",
                name: "Roadmap",
                color: "Red",
                tasks: [],
            },
        },
        {
            name: "empty task collection page",
            pageLink: collectionId,
            markdown: `\
#
`,
            page: {
                type: "TaskCollection",
                name: "",
                color: null,
                tasks: [],
            },
        },
        {
            name: "missing task collection name",
            pageLink: collectionId,
            markdown: `\
## Roadmap

Color: Red
`,
            parseError:
                "A name is required for task collections. Try again but make sure the task " +
                "collection markdown starts with a markdown h1 (e.g. `# My Collection`) on line 1.",
        },
        {
            name: "unknown task collection color",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Magenta
`,
            parseError:
                "Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
                "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, " +
                "\u201CCyan\u201D, \u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, " +
                "\u201CPink\u201D, or \u201CNone\u201D to remove the color.",
        },
        {
            name: "unknown task collection field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Priority: High
`,
            parseError:
                "Unknown task collection field \u201CPriority\u201D on line 3. Try again with " +
                "the \u201CColor\u201D field (e.g. `Color: Red`).",
        },
        {
            name: "unexpected paragraph without a field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Tasks for the launch.
`,
            parseError:
                "Unexpected markdown on line 3. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected second color field",
            pageLink: collectionId,
            markdown: `\
# Roadmap

Color: Red

Color: Blue
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected color field after task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec)

Color: Red
`,
            parseError:
                "Unexpected markdown on line 5. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "unexpected ordered task list",
            pageLink: collectionId,
            markdown: `\
# Roadmap

1. [Write spec (Open)](/task/write-spec)
`,
            parseError:
                "Unexpected markdown on line 3. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) " +
                "after the task collection name.",
        },
        {
            name: "task list item without a link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- Write spec
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task](/task/my-task)`) in each task list item.",
        },
        {
            name: "task list item with extra content after the link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) is important
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task](/task/my-task)`) in each task list item.",
        },
        {
            name: "task list item with multiple links",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Write spec (Open)](/task/write-spec) [Ship launch (Closed)](/task/ship-launch)
`,
            parseError:
                "Unexpected markdown in the task list item on line 3. Try again with a single " +
                "task link (e.g. `- [My Task](/task/my-task)`) in each task list item.",
        },
        {
            name: "unknown task link",
            pageLink: collectionId,
            markdown: `\
# Roadmap

- [Missing task](/task/missing-task)
`,
            parseError:
                "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. Try " +
                "again with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
        },
        {
            name: "task link to another entity type",
            pageLink: collectionId,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, {
                    type: "Account",
                    id: generateId<AccountId>(),
                    title: "Alice",
                    shortName: "Alice",
                });
            },
            markdown: `\
# Roadmap

- [Alice](/human/alice)
`,
            parseError:
                "Couldn\u2019t find a task for the link \u201CAlice\u201D on line 3. Try again " +
                "with a link to a task you\u2019ve seen before (e.g. `[My Task](/task/my-task)`).",
        },
    ],
});
