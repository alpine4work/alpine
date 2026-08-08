# External skills

This directory contains skills which are intended to be installed by the
[`skills` CLI](https://github.com/vercel-labs/skills). **These skills are designed for external
users of Alpine!** Don't add internal-only information or skills here.

Skills are authored as `*.internal.md` files and are compiled to `*.open_source.md` files which are
synced to our open source mirror. Make changes to skills in the `*.internal.md` file and then run
`bazel run //skills:write_skills` to compile them to the output `*.open_source.md` files.
