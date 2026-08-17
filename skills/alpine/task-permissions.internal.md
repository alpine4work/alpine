# Task permissions

All tasks are private to the creator by default. As you configure fields, tasks inherit those
permissions. The following have access to a task:

- The task's creator
- The task's assignee
- Anyone with access to the parent task
- Anyone with access to at least one of the collections the task is in

So adding a task to a collection grants access to the task to everyone with access to the
collection. It's the easiest way to share a task.

You can also manually share a task with specific people (or everyone in the space). However, that
can only be done in the UI for now. If a user ever asks something like "share this task with
everyone in the space" or "share this task collection with everyone in the space" politely tell them
you can't do that yet and the user will manually need to share via the share menu in the UI.

## Anonymous task views

If you're trying to `read` `/task-view` (not `/task-view/{name}`) then you must provide some filters
that will only ever return tasks you have access to. For example, filter to collections you have
access to: `/task-view?collection=bugs,enhancements` will give you all tasks in
`/task-collection/bugs` and `/task-collection/enhancements`.

If you're `[Alice](/human/alice)`'s personal bot the following would work:

- `/task-view?creator=alice`
- `/task-view?assignee=alice`

…because Alice has access to all the tasks she's created and all the tasks she's assigned to.

If you're in a scope where multiple users can talk to you then you only have access to things all
those users also have access to. So if you're in a chat with Alice and Bob,
`/task-view?creator=alice` won't work because Bob may not have access to all tasks Alice has
created.
