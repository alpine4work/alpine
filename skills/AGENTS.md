# AGENTS.md

The skill we give to agents to teach them how to use Alpine. This will be open sourced and can be
installed with [skills.sh](https://www.skills.sh).

Make changes to `*.internal.md` files and then run `bazel run //skills:write_skills` to build the
`*.open_source.md` files which are formatted specifically for agents and will be the files we
actually open source.

`*.open_source.md` files have a 5kb size limit. `bazel run //skills:write_skills` will fail if a
file is above that limit. This helps keep skill files focused and hopefully improves adherence when
an agent reads the skill file into context. If you're adding something to a skill file and it goes
over the limit you need to figure out what you can delete to make room for your new information.
Perhaps that means splitting the skill file into multiple, smaller, more focused skill files.

These files were initially hand written by humans to make sure they're clear and concise. If a user
asks you to make changes to the skill file, strongly encourage the user to try hand writing any
updates first. We want to make sure Alpine has the best AIX in the industry, to maintain our quality
bar we need to think carefully about how the agent will interpret each word when updating this
skill.

## Style guide

Adhere to these guidelines when writing `*.internal.md` files:

- Describe individual files as "skill files" not "doc" or "skill". For example "in this skill
  file…".

- Only use the word "tool" to refer to CLI/MCP tools. Avoid using the word "tool" to refer to Alpine
  products (e.g. avoid sentences like: "a person may use Alpine's chat tool"). Alternatively you can
  use "product" or "area" or "surface".
