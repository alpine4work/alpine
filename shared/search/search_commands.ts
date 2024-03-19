type SearchCommandId =
    | "CreateChat"
    | "CreateChatMessage"
    | "CreatePost"
    | "CreateChannel"
    | "CreateTask"
    | "CreateTaskCollection"
    | "CreateTaskView"
    | "TaskNotepad"
    | "TaskQueryFilteredToCreatorIsCurrentAccount"
    | "TaskQueryFilteredToAssigneeIsCurrentAccount"
    | "TaskQueryFilteredToAssignerIsCurrentAccount";

const x = [
    {
        title: "Create chat",
    },
    {
        title: "Send chat message",
        otherHits: ["send message", "create chat message"],
    },
    {
        title: "Create post",
    },
    {
        title: "Create channel",
    },
    {
        title: "Create document",
    },
    {
        title: "Create task",
    },
    {
        title: "Create task collection",
    },
    {
        title: "Create task view",
    },
    {
        title: "Task notepad",
        otherHits: ["my tasks"],
    },
    {
        title: "Tasks I’ve created",
        otherHits: ["my tasks", "tasks by me", "tasks created by me"],
    },
    {
        title: "Tasks assigned to me",
    },
    {
        title: "Tasks I’ve assigned to others",
    },
];
