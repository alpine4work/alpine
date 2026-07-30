import {getContentHeadingSections} from "~/shared/content/get_content_heading_sections.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";

const node = schema.node.bind(schema);
const text = schema.text.bind(schema);

function heading(level: number, headingText: string) {
    return node("heading", {level}, headingText === "" ? [] : [text(headingText)]);
}

function paragraph(paragraphText: string) {
    return node("paragraph", {}, [text(paragraphText)]);
}

test("derives a slug from the heading text", () => {
    const doc = node("doc", {}, [
        node("title", {}, []),
        heading(1, "Rollout Plan & Timeline"),
        paragraph("Body."),
    ]);

    expect(getContentHeadingSections(doc)).toMatchObject([{slug: "rollout-plan-timeline"}]);
});

test("dedupes duplicate slugs with numeric suffixes in document order", () => {
    const doc = node("doc", {}, [
        node("title", {}, []),
        heading(1, "Notes"),
        heading(1, "Notes"),
        heading(1, "Notes"),
    ]);

    expect(getContentHeadingSections(doc)).toMatchObject([
        {slug: "notes"},
        {slug: "notes-1"},
        {slug: "notes-2"},
    ]);
});

test("returns a null slug for a heading with no sluggable text", () => {
    const doc = node("doc", {}, [node("title", {}, []), heading(1, ""), paragraph("Body.")]);

    expect(getContentHeadingSections(doc)).toMatchObject([{slug: null}]);
});

test("ends a section at the next heading with the same level", () => {
    const beforeHeading = heading(1, "First");
    const body = paragraph("First body.");
    const doc = node("doc", {}, [
        node("title", {}, []),
        beforeHeading,
        body,
        heading(1, "Second"),
        paragraph("Second body."),
    ]);

    const titleSize = node("title", {}, []).nodeSize;
    expect(getContentHeadingSections(doc)[0]).toMatchObject({
        headingPos: titleSize,
        sectionFrom: titleSize + beforeHeading.nodeSize,
        sectionTo: titleSize + beforeHeading.nodeSize + body.nodeSize,
    });
});

test("includes lower-level headings in the section of a higher-level heading", () => {
    const doc = node("doc", {}, [
        node("title", {}, []),
        heading(1, "Parent"),
        heading(2, "Child"),
        paragraph("Child body."),
        heading(1, "Sibling"),
    ]);

    const sections = getContentHeadingSections(doc);
    expect(sections[0]!.sectionTo).toBe(sections[2]!.headingPos);
});

test("ends a lower-level heading section at the next higher-level heading", () => {
    const doc = node("doc", {}, [
        node("title", {}, []),
        heading(2, "Child"),
        paragraph("Child body."),
        heading(1, "Parent"),
    ]);

    const sections = getContentHeadingSections(doc);
    expect(sections[0]!.sectionTo).toBe(sections[1]!.headingPos);
});

test("extends the last section to the end of the doc", () => {
    const doc = node("doc", {}, [
        node("title", {}, []),
        heading(1, "Last"),
        paragraph("Body."),
        paragraph("More body."),
    ]);

    expect(getContentHeadingSections(doc)[0]!.sectionTo).toBe(doc.content.size);
});

test("returns an empty section range for a heading with no content", () => {
    const doc = node("doc", {}, [node("title", {}, []), heading(1, "Empty"), heading(1, "Next")]);

    const section = getContentHeadingSections(doc)[0]!;
    expect(section.sectionFrom).toBe(section.sectionTo);
});

test("returns no sections for a doc without headings", () => {
    const doc = node("doc", {}, [node("title", {}, []), paragraph("Just a paragraph.")]);

    expect(getContentHeadingSections(doc)).toEqual([]);
});
