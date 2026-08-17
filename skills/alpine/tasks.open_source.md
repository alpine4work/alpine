# Tasks

Alpine includes a task tracker for project management. It’s easy to create tasks (just as easy as writing a new line in a document) and the system scales up to support large projects.

Tasks are organized into collections or [projects](projects.md) (a project is a special kind of task). A task can be in multiple collections. When you `read` a collection like `/task-collection/bugs`, it looks like this:

```md
# Bugs

Color: Red

- [Fix dark mode flicker (Open)](/task/fix-dark-mode-flicker)

- [Upgrade dependency (Open)](/task/upgrade-dependency)

End of tasks.
```

An h1 with the collection name, the color of the collection (optional, color is represented by a small dot next to the name in the UI, if not present there’s no dot), default filters/sorts (optional, [learn more](task-filters.md)), and a list of tasks with their status in parentheses.

Task statuses:

- `(Open)`: A task that needs to be done but hasn’t been started yet.

- `(Closed)`: A task that is completed or no longer relevant.

- `(Open, active)`: If a task is active that’s a signal from the assignee that it’s in progress. Active tasks will always have an assignee. An assignee shouldn’t have more than \~5 active tasks at a time.

If a task has some fields configured it might look like this:

```md
- [Write spec (Open, active)](/task/write-spec)
  - Parent: [Plan launch](/task/plan-launch)
  - Subtasks: 2 open, 1 closed
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering), [Growth](/task-collection/growth), and 1 more
  - Priority: High
  - Due date: July 12th, 2027
```

Only fields which are configured will show up. So if the task has no assignee then `- Assignee: ...` won’t be present.

Task fields:

- Parent: If this is a subtask, what’s the task’s parent? There can only be one parent.
- Subtasks: How many subtasks does this task have?
- Assignee: Who is the [account](accounts.md) responsible for this task?
- Collections: What other collections is this task in? If you see “and n more” you can read the `/task/...` to see all collections. Mostly a task will be in 1 collection or 2. A task will be in 3+ collections only for advanced setups. If you’re reading a `/task-collection/...` page then we won’t include that collection in this field since it’d be redundant.
- Priority: What is the priority of the task? (`Low`, `Medium`, and `High`)
- Due date: When should the task be completed by?

If there are more tasks in the collection than will fit in the `read` tool’s `limit` then you’ll get a “Next page” link with an `?after={cursor}` URL search param you can use for pagination.

If you read a `/task/...` link you’ll see:

```md
# Write spec

- Status: Open (active)
- Parent: [Plan launch](/task/plan-launch)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Growth](/task-collection/growth)
- Priority: High
- Due date: July 12th, 2027

## Notes

Should include an “alternatives considered” section.

## Subtasks

- [Market research (Closed)](/task/market-research)

- [Alternatives considered section (Open)](/task/alternatives-considered-section)

- [Leadership review (Open)](/task/leadership-review)
```

The title as an h1, followed by fields, then a notes section (optional), and finally a subtasks section (optional).

If a field isn’t set it won’t be present. All the fields are the same as when they’re in a `/task-collection/...` with the following differences:

- Status: Is a field instead of a part of the task link. Same values (`Open`, `Closed`, and `Open (active)`)
- Subtasks: Isn’t present in the fields section since there’s a separate subtasks section.
- Collections: Lists all collections the task is in. You won’t see “and n more”.
- Layout: Not shown in the above example, but tells you if the task is a [project](projects.md).

A task may have comments. The conversation in a task’s comments is often important to understanding the task. You access those comments through a separate path, `/task/.../comments` (e.g. `/task/write-spec/comments`). A task’s comments use the [messaging](messaging.md) markdown format.

## Next

Pick a topic to learn more about tasks:

- [Updating and creating](task-updating.md): Not needed for simple updates (which should be intuitive) but useful information if you’re performing multi-step changes.

- [Filters and sorts](task-filters.md): Use filters to find exactly the tasks you’re looking for.

- [Permissions](task-permissions.md): New tasks are private by default. Learn more about what tasks you do/don’t have access to.

- [Projects](projects.md): A special kind of task for organizing larger initiatives broken down into smaller tasks and optionally spread across multiple people.
