import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export const taskQuerySortTestCases: Array<{name: string; sorts: Array<TaskQuerySort>}> = [
    {
        name: "empty",
        sorts: [],
    },
    {
        name: "status ascending",
        sorts: [{type: "DisplayStatus", direction: "Ascending"}],
    },
    {
        name: "status descending",
        sorts: [{type: "DisplayStatus", direction: "Descending"}],
    },
    {
        name: "priority ascending",
        sorts: [{type: "Priority", direction: "Ascending"}],
    },
    {
        name: "priority descending",
        sorts: [{type: "Priority", direction: "Descending"}],
    },
    {
        name: "layout missing first",
        sorts: [{type: "Layout", missing: "First"}],
    },
    {
        name: "layout missing last",
        sorts: [{type: "Layout", missing: "Last"}],
    },
    {
        name: "assignee missing first",
        sorts: [{type: "Assignee", missing: "First"}],
    },
    {
        name: "assignee missing last",
        sorts: [{type: "Assignee", missing: "Last"}],
    },
    {
        name: "creator",
        sorts: [{type: "Creator"}],
    },
    {
        name: "assigner missing first",
        sorts: [{type: "Assigner", missing: "First"}],
    },
    {
        name: "assigner missing last",
        sorts: [{type: "Assigner", missing: "Last"}],
    },
    {
        name: "due ascending",
        sorts: [{type: "DueDate", direction: "Ascending"}],
    },
    {
        name: "due descending",
        sorts: [{type: "DueDate", direction: "Descending"}],
    },
    {
        name: "created time ascending",
        sorts: [{type: "CreatedTime", direction: "Ascending"}],
    },
    {
        name: "created time descending",
        sorts: [{type: "CreatedTime", direction: "Descending"}],
    },
    {
        name: "assigned time ascending",
        sorts: [{type: "AssignedTime", direction: "Ascending"}],
    },
    {
        name: "assigned time descending",
        sorts: [{type: "AssignedTime", direction: "Descending"}],
    },
    {
        name: "closed time ascending",
        sorts: [{type: "ClosedTime", direction: "Ascending"}],
    },
    {
        name: "closed time descending",
        sorts: [{type: "ClosedTime", direction: "Descending"}],
    },
    {
        name: "activated time ascending",
        sorts: [{type: "ActivatedTime", direction: "Ascending"}],
    },
    {
        name: "activated time descending",
        sorts: [{type: "ActivatedTime", direction: "Descending"}],
    },
    {
        name: "multiple sorts",
        sorts: [
            {type: "Priority", direction: "Descending"},
            {type: "Assignee", missing: "Last"},
            {type: "DueDate", direction: "Ascending"},
        ],
    },
];
