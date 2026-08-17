# Updating tasks

You can use the `update` tool to update any [task](tasks.md) path. And use the `create` tool to create a new task or task collection.

## Updating `/task/...`

When using the `update` tool with `/task/...` you can update anything. Including:

- Updating the task title h1
- Updating the task’s fields (you can change individual fields, remove fields, add new fields)
- Updating the task’s notes
- Updating the task’s subtasks

All the fields supported by a task are listed in the [task](tasks.md) skill file.

When updating the status of a task to “Open (active)” the task must have an assignee. Only update a task’s status to “Open (active)” if you know for sure that the assignee is currently working on the task.

## Updating a task list

There are a couple places you can see task lists:

- The “Subtasks” section of a `/task/...` page (or `/task/.../subtasks`)
- `/task-collection/...` pages
- `/task-view` or `/task-view/...` pages

All task lists look like this:

```md
- [Fix dark mode flicker (Open)](/task/fix-dark-mode-flicker)
  - Priority: High

- [Upgrade dependency (Open)](/task/upgrade-dependency)
  - Assignee: [Alice](/human/alice)
```

An unordered list of task links with any fields.

You can use the `update` tool here to:

- Change the task title within the link label (don’t update the link path, e.g. an `old` string of “Fix dark mode” and a `new` string of “Fix light mode”).

- Change the task status within the link label.

- Update, add, or remove any fields. (You’ll probably want to use an `old` string that includes part of the task link to make sure you’re updating the right task.)

If the task list is manually ordered (that means it has no automatic sorts) then you can also:

- Add existing tasks to the list. Use a `new` string with a task link you’ve seen before like `- [Write integration tests (Open)](/task/write-integration-tests)` and place it wherever you’d like, the position will be preserved.

- Remove existing tasks from the list. Use an `old` string to target a task you no longer want in the list and use an empty `new` string to remove it. This will not delete the task, merely remove it from the list.

- Create tasks in the list. Use a `new` string with a task title that does _not_ have a markdown link, for example `- Write integration tests (Open)`. This will create a new task in the right position. If you use the `read` tool after the `update` tool you’ll see the new tasks with markdown links.

- Move tasks in the list. The `update` tool accepts a list of updates. If you pass in two updates:

  1. With an `old` string targeting the task you want to move and an empty `new` string
  2. With an `old` string targeting the position you want to move the task to and a `new` string with the task you removed in the first update

  Then the task will be moved to the new position. It’s important you do this in one `update` tool call to prevent an add update followed by a remove update and instead get one atomic move update.

  Moving a task and updating its fields in the same update isn’t allowed and will be rejected. Instead make two separate `update` tool calls. This is to prevent accidentally changing a task when it’s moving.

A `/task/...`’s subtask section is manually ordered. A `/task-collection/...` with no filters and no sorts is also manually ordered. `/task-view` or `/task-view/...` is never manually ordered. If a task collection has default filters/sorts then you may use `?manual` (e.g. `/task-collection/bugs?manual`) to see the tasks in manual sort order.

If you try to add/remove tasks from a non-manually ordered list you’ll get an error. Instead, inspect the filters/sorts of the list to figure out how to move the task around given those filters/sorts (learn more about [filtering and sorting](task-filters.md)).

## Creating

You can create a `task` and a `task-collection` using the `create` tool. The content should follow the same formats we’ve seen so far.

When creating a `task`, all fields and sections are optional. You can also create new subtasks by writing unordered list items without markdown links (just like the `update` tool, this works because a task’s subtasks are manually ordered, remember to add an `(Open)` status):

```md
# My task

## Subtasks

- Subtask 1 (Open)

- Subtask 2 (Open)

- Subtask 3 (Open)
```

When creating a `task-collection` you can also create new tasks in the collection by writing unordered list items without markdown links:

```md
# My collection

- Task 1 (Open)

- Task 2 (Open)

- Task 3 (Open)
```
