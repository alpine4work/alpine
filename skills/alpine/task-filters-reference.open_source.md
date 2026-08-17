# Task filters and sorts reference

Reference of all [task filter/sort](task-filters.md) syntax.

## Filters

All URL search params are “and”-ed together. So `status=closed&priority=high` means tasks that are closed and have high priority.

Params may have some operators in brackets, for example `status[not]=closed` means tasks that aren’t closed. Generally `a=b` means “a is b” and `a[not]=b` means “a is not b”. Comma separated lists in a URL search param value (e.g. `a=b,c` or `a[not]=b,c`) often mean “a is b or a is c” or “a is not b and a is not c”.

Status:

- `status={x}`: status is `{x}`
- `status={x},{y}`: status is `{x}` or `{y}`
- `status[not]={x}`: status isn’t `{x}`
- `status[not]={x},{y}`: status isn’t `{x}` and isn’t `{y}`
- `{x}` could be `open`, `closed`, `open-inactive`, or `open-active` (`open` is a shortcut for `open-inactive,open-active`)

Collections:

- `collection=none`: has no collections
- `collection={x}`: has collection `{x}`
- `collection={x},{y}`: has one of collections `{x}` or `{y}`
- `collection[not]={x}`: doesn’t have collection `{x}`
- `collection[not]={x},{y}`: has none of collections `{x}` and `{y}`
- `collection[all]={x},{y}`: has all of collections `{x}` and `{y}`
- `{x}` is the `{name}` part of a `/task-collection/{name}` path (e.g. `bugs` for `/task-collection/bugs`)

Priority:

- `priority=none`: has no priority
- `priority={x}`: priority is `{x}`
- `priority={x},{y}`: priority is `{x}` or `{y}`
- `priority[not]={x}`: priority isn’t `{x}`
- `priority[not]={x},{y}`: priority isn’t `{x}` and isn’t `{y}`
- `{x}` could be `low`, `medium`, `high`, or `urgent` (`urgent` is a special priority that repeatedly notifies the task assignee and should be used sparingly)

Layout:

- `layout=project`: is project
- `layout[not]=project`: isn’t project

Title:

- `title={x}`: title contains `{x}`
- `title[not]={x}`: title doesn’t contain `{x}`
- We split `{x}` into individual words, lowercase, and then check if the task title contains those words in that order exactly. Spaces are often formatted as `+` (e.g. `title=hello+world`)
- Commas are matched literally `title=hello,+world` doesn’t match “hello” or “world”

Assignee:

- `assignee=none`: has no assignee
- `assignee=me`: assignee is the human currently looking at the task list
- `assignee={x}`: assignee is `{x}`
- `assignee={x},{y}`: assignee is `{x}` or `{y}`
- `assignee[not]={x}`: assignee isn’t `{x}`
- `assignee[not]={x},{y}`: assignee isn’t `{x}` and isn’t `{y}`
- `{x}` is the `{name}` part of a `/human/{name}` or `/bot/{name}` path (e.g. `alice` for `/human/alice`)

Creator: Same syntax as assignee but with `creator` instead of `assignee` (e.g. `creator=alice`). Doesn’t support `creator=none` since all tasks have a creator.

Assigner: Same syntax as assignee but with `assigner` instead of `assignee` (e.g. `assigner=alice`).

Created time:

- `created[before]={date}`: created before `{date}`
- `created[after]={date}`: created after `{date}`
- `{date}`:
  - ISO 8601 date without time (e.g. `2027-07-12`)
  - `today`
  - `today+{n}` or `today-{n}` (relative to today), `{n}` is a number and a unit, e.g. `today+1d` (tomorrow). Units include `d` (day), `w` (week), `mo` (month), and `y` (year).

Assigned time: Same syntax as created time but with `assigned` instead of `created` (e.g. `assigned[after]=today-1w`).

Closed time: Same syntax as created time but with `closed` instead of `created` (e.g. `closed[after]=today-1mo`).

Activated time (when was the task made active): Same syntax as created time but with `activated` instead of `created` (e.g. `activated[after]=today-7d`).

Due date:

- Same syntax as created time but with `due` instead of `created` (e.g. `due[after]=today+1w`).
- Additionally:
  - `due=overdue`: task is overdue (due date is before today)
  - `due=none`: task has no due date

## Sorts

To sort you use one `sort` search param and you specify a list of sort fields. We start with the first sort field then fallback to the next if the tasks are equal and so on. In the case where all sort fields tie tasks are sorted by created time.

You can put a `-` in front of many sort field to reverse the sort order (e.g. `sort=created` and `sort=-created`).

Sort fields:

- `status`: open, active, closed
- `-status`: closed, active, open
- `priority`: low, medium, high
- `-priority`: high, medium, low
- `layout`: projects, not projects
- `-layout`: not projects, projects
- `creator`: creator (alphabetically)
- `assignee`: with assignees (alphabetically), without assignees
- `-assignee`: without assignees, with assignees (alphabetically)
- `assigner`: with assigner (alphabetically), without assigner
- `-assigner`: without assigner, with assigner (alphabetically)
- `due`/`-due`: ascending/descending dates
- `created`/`-created`: ascending/descending times
- `assigned`/`-assigned`: ascending/descending times
- `closed`/`-closed`: ascending/descending times
- `activated`/`-activated`: ascending/descending times
