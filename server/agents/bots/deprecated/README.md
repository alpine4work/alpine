# README

Everything in this directory is considered deprecated! The plan is to create new agents using the
`server/agents/web` framework and eventually delete these deprecated bots.

Do not import from this directory in new code you write! We may choose to "undeprecate" parts of
this directory as we add back the Cursor and ChatGPT bots in which case you should move the files
out of the `deprecated` directory instead of importing from it.

All files are placed in this `deprecated/internal` directory to prevent them from being imported by
sibling directories. For example, `server/agents/bots/agent_service.ts` can import from
`server/agents/bots/deprecated/internal` but `server/agents/bots/internal` (the home of our new
bots) can't!
