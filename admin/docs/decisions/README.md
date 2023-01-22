# Technical Decision Log

This folder contains decision log files, also known as
[architectural decision records](https://adr.github.io/). A decision log is an immutable, append
only, resource for documenting choices made while building a project. Decision logs have two main
benefits as a documentation resource:

1. Tradeoffs evolve over time, decisions may change, new choices build open previously made
   decisions. A decision log provides historical context which is essential for interpreting why a
   system is the way it is.

2. Decision log entries are easy to write and maintain. After you write an entry, you never need to
   update it. Individual entries may also be brief since you are not exhaustively documenting the
   entire system.

## Template

Create a new file of the format `yyyy/mm/yyyy_mm_dd_title.md`. We nest files by both year and month
to make them easier to search.

```md
# \[yyyy-mm-dd\] Title

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

(Optional) What becomes easier or more difficult to do because of this change?

## Alternatives considered

(Optional) What other options were considered while evaluating what decision to make?
```
