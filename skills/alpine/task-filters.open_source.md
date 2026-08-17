# Task filters and sorts

You can use filters/sorts to find exactly the tasks you’re looking for in a space. Filters/sorts take the form of URL search params. For example `?priority=high` finds high priority tasks. You can add filter/sort URL search params to the following paths:

- `/task-collection/{name}`
- `/task-view`
- `/task/{title}/subtasks`

`/task-view` is a special path (not `/task-view/{name}`) that lets you create a temporary, anonymous, task view using the `read` tool call. `/task-view?assignee=alice` will give you all tasks assigned to `[Alice](/human/alice)` (if you are Alice’s personal bot, otherwise you won’t have access). You can only use `/task-view` with filters/sorts that we can guarantee will only return you tasks that you have access to. See [task permissions](task-permissions.md) to learn more about the task permission model.

Task collections may also have default filters/sorts. You’ll know because if you call the `read` tool with `/task-collection/{name}` you’ll see “Default filters and sorts” followed by a code block, like this:

````md
# Sprint

Default filters and sorts:

```
status=open,closed&sort=assignee,-status,-priority
```

- Task 1

- Task 2

- …
````

If a task collection has default filters/sorts then the task list will be automatically filtered/sorted.

Filters look like:

- `status=closed`: task is closed
- `priority=medium,high`: priority is medium or high
- `assignee[not]=alice`: assignee is not Alice (`alice` is the `{name}` part of `/human/{name}` in `/human/alice`)

All URL search params are “and”-ed together. So `status=closed&priority=high` means tasks that are closed and have high priority.

For sorts you have one `sort` param and specify the fields you want to sort by. You can prepend `-` to a sort field name to reverse the order of the sort. `sort=assignee,-status,-priority` sorts by assignee (alphabetically), status (closed → open), and priority (high → low). `sort=-assignee` (or prepending `-` to any account field) won’t sort accounts in reverse alphabetical order (as that’s not particularly useful) but rather put tasks without an assignee first.

To see a detailed reference of all filter/sort syntax, see [task filters reference](task-filters-reference.md).
