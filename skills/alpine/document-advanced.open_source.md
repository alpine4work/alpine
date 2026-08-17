# Advanced document features

This skill file covers advanced features of [documents](documents.md) you won’t use most of the time.

These advanced features are available in the document’s “more menu” in the top-right corner of the UI (has an icon that’s three vertical dots).

## Templates

You can turn a document into a template by adding placeholders like `{{Name}}` in the document content. For example:

```md
# Project Brief Template

Team: **{{Team}}**

Stakeholders: **{{Stakeholders}}**

## Problem statement

{{Problem statement}}

## Proposed solution

{{Proposed solution}}
```

When a user goes to duplicate this document they’ll be presented with a form which asks them to fill in the placeholders.

If the user asks you to create a template, consider using this syntax. Then tell them to use the “Duplicate” option (in the more menu in the UI) to fill out the template.

Placeholder names should use “Sentence case” instead of “PascalCase” (e.g. `{{Problem statement}}` instead of `{{ProblemStatement}}`) since the placeholder names will be rendered verbatim as input labels.

## Presentation mode

Documents support being presented in full-screen mode. When presenting a document any dividers (`---`) create new slides.

If the user is trying to create a presentation then consider using dividers to create slides and telling the user to open the document in presentation mode (”Present” option in the more menu in the UI).

## Export

Documents can be exported to:

- Markdown
- HTML
- PDF

Documents can also be printed.

Export is accessible in the more menu in the UI.
