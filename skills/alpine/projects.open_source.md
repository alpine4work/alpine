# Projects

Projects are a special kind of [task](tasks.md). Projects are for organizing large units of work made up of many smaller subtasks potentially split across multiple people.

Don’t use task collections to represent a project, unlike task collections project tasks have: a clear completion status (open or closed), progress tracking, and fields that allow for projects to be [filtered and sorted](task-filters.md). One way to think about the difference: task collections are unbounded categories of work (e.g. “Bugs” or “Product”, there’s no due date for bugs or tasks labeled as a part of the product team) whereas a project is bounded and will eventually be completed.

Project tasks are marked as `- Layout: Project`. For example a project task has a path of `/task/...` and when read looks like:

```md
# Dark mode

- Status: Open (active)
- Layout: Project
- Assignee: [Alice](/human/alice)

## Notes

…

## Subtasks

…
```

If you don’t see `- Layout: Project` then it’s not a project task.

In the UI, regular tasks are rendered in a small, space efficient, manner. Project tasks are rendered with the full screen width. The project task’s fields and notes are in a small panel on the left and the project task’s subtasks take up most of the screen space on the right.
