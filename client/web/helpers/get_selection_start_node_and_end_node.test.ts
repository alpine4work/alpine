import {getSelectionStartNodeAndEndNode} from "~/client/web/helpers/get_selection_start_node_and_end_node.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

test("same text node with anchor before focus", () => {
    const textNode = document.createTextNode("Hello World");
    const selection = {
        anchorNode: textNode,
        anchorOffset: 0,
        focusNode: textNode,
        focusOffset: 5,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode);
    expect(result.endOffset).toBe(5);
    expect(result.commonParentNode).toBe(textNode);
});

test("same text node with focus before anchor", () => {
    const textNode = document.createTextNode("Hello World");
    const selection = {
        anchorNode: textNode,
        anchorOffset: 5,
        focusNode: textNode,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode);
    expect(result.endOffset).toBe(5);
    expect(result.commonParentNode).toBe(textNode);
});

test("same text node with equal offsets", () => {
    const textNode = document.createTextNode("Hello World");
    const selection = {
        anchorNode: textNode,
        anchorOffset: 5,
        focusNode: textNode,
        focusOffset: 5,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode);
    expect(result.startOffset).toBe(5);
    expect(result.endNode).toBe(textNode);
    expect(result.endOffset).toBe(5);
    expect(result.commonParentNode).toBe(textNode);
});

test("different text nodes in same parent with anchor before focus", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");
    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 2,
        focusNode: textNode2,
        focusOffset: 3,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(2);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(3);
    expect(result.commonParentNode).toBe(parent);
});

test("different text nodes in same parent with focus before anchor", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");
    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 3,
        focusNode: textNode1,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(2);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(3);
    expect(result.commonParentNode).toBe(parent);
});

test("text nodes in nested elements with anchor before focus", () => {
    const root = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    root.appendChild(span1);
    root.appendChild(span2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 1,
        focusNode: textNode2,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(1);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(2);
    expect(result.commonParentNode).toBe(root);
});

test("text nodes in nested elements with focus before anchor", () => {
    const root = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    root.appendChild(span1);
    root.appendChild(span2);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 2,
        focusNode: textNode1,
        focusOffset: 1,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(1);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(2);
    expect(result.commonParentNode).toBe(root);
});

test("deeply nested text nodes with multiple levels", () => {
    const root = document.createElement("div");
    const div1 = document.createElement("div");
    const div2 = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    div1.appendChild(span1);
    div2.appendChild(span2);
    root.appendChild(div1);
    root.appendChild(div2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 6,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(6);
    expect(result.commonParentNode).toBe(root);
});

test("text nodes in siblings with intermediate elements", () => {
    const parent = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const span3 = document.createElement("span");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Middle");
    const textNode3 = document.createTextNode("Last");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    span3.appendChild(textNode3);
    parent.appendChild(span1);
    parent.appendChild(span2);
    parent.appendChild(span3);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 2,
        focusNode: textNode3,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(2);
    expect(result.endNode).toBe(textNode3);
    expect(result.endOffset).toBe(2);
    expect(result.commonParentNode).toBe(parent);
});

test("text nodes with common grandparent", () => {
    const grandparent = document.createElement("div");
    const parent1 = document.createElement("div");
    const parent2 = document.createElement("div");
    const child1 = document.createElement("span");
    const child2 = document.createElement("span");
    const textNode1 = document.createTextNode("Text 1");
    const textNode2 = document.createTextNode("Text 2");

    child1.appendChild(textNode1);
    child2.appendChild(textNode2);
    parent1.appendChild(child1);
    parent2.appendChild(child2);
    grandparent.appendChild(parent1);
    grandparent.appendChild(parent2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(0);
    expect(result.commonParentNode).toBe(grandparent);
});

test("parent nodes arrays are populated correctly", () => {
    const root = document.createElement("div");
    const parent = document.createElement("p");
    const textNode = document.createTextNode("Text");

    parent.appendChild(textNode);
    root.appendChild(parent);

    const selection = {
        anchorNode: textNode,
        anchorOffset: 0,
        focusNode: textNode,
        focusOffset: 4,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.startParentNodes).toEqual([textNode, parent, root]);
    expect(result.endParentNodes).toEqual([textNode, parent, root]);
});

test("parent nodes arrays differ for different nodes", () => {
    const root = document.createElement("div");
    const div1 = document.createElement("div");
    const div2 = document.createElement("div");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    div1.appendChild(textNode1);
    div2.appendChild(textNode2);
    root.appendChild(div1);
    root.appendChild(div2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.startParentNodes).toEqual([textNode1, div1, root]);
    expect(result.endParentNodes).toEqual([textNode2, div2, root]);
});

test("common parent reverse index is 1 for same node", () => {
    const textNode = document.createTextNode("Text");

    const selection = {
        anchorNode: textNode,
        anchorOffset: 0,
        focusNode: textNode,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.commonParentReverseIndex).toBe(1);
});

test("common parent reverse index for direct siblings", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.commonParentReverseIndex).toBe(1);
});

test("common parent reverse index for nested nodes", () => {
    const root = document.createElement("div");
    const parent1 = document.createElement("div");
    const parent2 = document.createElement("div");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");

    parent1.appendChild(textNode1);
    parent2.appendChild(textNode2);
    root.appendChild(parent1);
    root.appendChild(parent2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.commonParentReverseIndex).toBe(1);
    expect(result.commonParentNode).toBe(root);
});

test("element nodes with text node children", () => {
    const parent = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const textNode1 = document.createTextNode("A");
    const textNode2 = document.createTextNode("B");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    parent.appendChild(span1);
    parent.appendChild(span2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 1,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.endNode).toBe(textNode2);
    expect(result.commonParentNode).toBe(parent);
});

test("zero offsets in both nodes", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("Hello");
    const textNode2 = document.createTextNode("World");

    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(0);
});

test("max offsets in both nodes", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("Hello");
    const textNode2 = document.createTextNode("World");

    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 5,
        focusNode: textNode2,
        focusOffset: 5,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(5);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(5);
});

test("complex nested structure with multiple levels", () => {
    const article = document.createElement("article");
    const section1 = document.createElement("section");
    const section2 = document.createElement("section");
    const p1 = document.createElement("p");
    const p2 = document.createElement("p");
    const strong = document.createElement("strong");
    const em = document.createElement("em");
    const textNode1 = document.createTextNode("Bold text");
    const textNode2 = document.createTextNode("Italic text");

    strong.appendChild(textNode1);
    em.appendChild(textNode2);
    p1.appendChild(strong);
    p2.appendChild(em);
    section1.appendChild(p1);
    section2.appendChild(p2);
    article.appendChild(section1);
    article.appendChild(section2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 11,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(11);
    expect(result.commonParentNode).toBe(article);
});

test("selection across list items", () => {
    const ul = document.createElement("ul");
    const li1 = document.createElement("li");
    const li2 = document.createElement("li");
    const textNode1 = document.createTextNode("Item 1");
    const textNode2 = document.createTextNode("Item 2");

    li1.appendChild(textNode1);
    li2.appendChild(textNode2);
    ul.appendChild(li1);
    ul.appendChild(li2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 3,
        focusNode: textNode2,
        focusOffset: 3,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(3);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(3);
    expect(result.commonParentNode).toBe(ul);
});

test("backward selection in single text node", () => {
    const textNode = document.createTextNode("Backward selection");

    const selection = {
        anchorNode: textNode,
        anchorOffset: 18,
        focusNode: textNode,
        focusOffset: 9,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode);
    expect(result.startOffset).toBe(9);
    expect(result.endNode).toBe(textNode);
    expect(result.endOffset).toBe(18);
});

test("selection with empty text nodes", () => {
    const parent = document.createElement("div");
    const textNode1 = document.createTextNode("");
    const textNode2 = document.createTextNode("");

    parent.appendChild(textNode1);
    parent.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(0);
    expect(result.commonParentNode).toBe(parent);
});

test("anchor is common parent node", () => {
    const parent = document.createElement("div");
    const textNode = document.createTextNode("Text");

    parent.appendChild(textNode);

    // Edge case: anchor node is the parent element itself
    const selection = {
        anchorNode: parent,
        anchorOffset: 0,
        focusNode: textNode,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    // The function should handle this and pick "Anchor" as start
    expect(result.start).toBe("Anchor");
    expect(result.commonParentNode).toBe(parent);
});

test("focus is common parent node", () => {
    const parent = document.createElement("div");
    const textNode = document.createTextNode("Text");

    parent.appendChild(textNode);

    // Edge case: focus node is the parent element itself
    const selection = {
        anchorNode: textNode,
        anchorOffset: 0,
        focusNode: parent,
        focusOffset: 1,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    // The function should handle this and pick "Anchor" as start
    expect(result.start).toBe("Anchor");
    expect(result.commonParentNode).toBe(parent);
});

test("selection across multiple inline elements", () => {
    const p = document.createElement("p");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const span3 = document.createElement("span");
    const textNode1 = document.createTextNode("One");
    const textNode2 = document.createTextNode("Two");
    const textNode3 = document.createTextNode("Three");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    span3.appendChild(textNode3);
    p.appendChild(span1);
    p.appendChild(span2);
    p.appendChild(span3);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 1,
        focusNode: textNode1,
        focusOffset: 2,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(2);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(1);
    expect(result.commonParentNode).toBe(p);
});

test("selection in table cells", () => {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    const td2 = document.createElement("td");
    const textNode1 = document.createTextNode("Cell 1");
    const textNode2 = document.createTextNode("Cell 2");

    td1.appendChild(textNode1);
    td2.appendChild(textNode2);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tbody.appendChild(tr);
    table.appendChild(tbody);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 6,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.endNode).toBe(textNode2);
    expect(result.commonParentNode).toBe(tr);
});

test("very deeply nested structure", () => {
    let current: Element = document.createElement("div");
    const root = current;

    // Create a deeply nested structure
    for (let i = 0; i < 10; i++) {
        const child = document.createElement("div");
        current.appendChild(child);
        current = child;
    }

    const textNode1 = document.createTextNode("Deep 1");
    current.appendChild(textNode1);

    current = root;
    for (let i = 0; i < 5; i++) {
        current = assertExists(current.firstElementChild);
    }

    const branch = document.createElement("div");
    current.appendChild(branch);

    let deepBranch = branch;
    for (let i = 0; i < 5; i++) {
        const child = document.createElement("div");
        deepBranch.appendChild(child);
        deepBranch = child;
    }

    const textNode2 = document.createTextNode("Deep 2");
    deepBranch.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.endNode).toBe(textNode2);
});

test("selection within mixed content", () => {
    const div = document.createElement("div");
    const textNode1 = document.createTextNode("Start ");
    const strong = document.createElement("strong");
    const textNode2 = document.createTextNode("bold");
    const textNode3 = document.createTextNode(" end");

    strong.appendChild(textNode2);
    div.appendChild(textNode1);
    div.appendChild(strong);
    div.appendChild(textNode3);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 6,
        focusNode: textNode3,
        focusOffset: 4,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(6);
    expect(result.endNode).toBe(textNode3);
    expect(result.endOffset).toBe(4);
    expect(result.commonParentNode).toBe(div);
});

test("reverse selection in mixed content", () => {
    const div = document.createElement("div");
    const textNode1 = document.createTextNode("Start ");
    const strong = document.createElement("strong");
    const textNode2 = document.createTextNode("bold");
    const textNode3 = document.createTextNode(" end");

    strong.appendChild(textNode2);
    div.appendChild(textNode1);
    div.appendChild(strong);
    div.appendChild(textNode3);

    const selection = {
        anchorNode: textNode3,
        anchorOffset: 4,
        focusNode: textNode1,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode3);
    expect(result.endOffset).toBe(4);
    expect(result.commonParentNode).toBe(div);
});

test("selection starting in middle element", () => {
    const div = document.createElement("div");
    const span1 = document.createElement("span");
    const span2 = document.createElement("span");
    const span3 = document.createElement("span");
    const textNode1 = document.createTextNode("First");
    const textNode2 = document.createTextNode("Second");
    const textNode3 = document.createTextNode("Third");

    span1.appendChild(textNode1);
    span2.appendChild(textNode2);
    span3.appendChild(textNode3);
    div.appendChild(span1);
    div.appendChild(span2);
    div.appendChild(span3);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 2,
        focusNode: textNode3,
        focusOffset: 3,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode2);
    expect(result.startOffset).toBe(2);
    expect(result.endNode).toBe(textNode3);
    expect(result.endOffset).toBe(3);
    expect(result.commonParentNode).toBe(div);
});

test("single character text nodes", () => {
    const div = document.createElement("div");
    const textNode1 = document.createTextNode("A");
    const textNode2 = document.createTextNode("B");

    div.appendChild(textNode1);
    div.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 1,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(1);
});

test("text nodes at different depths - nested vs direct child", () => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    const textNode1 = document.createTextNode("Bold");
    const textNode2 = document.createTextNode(" plain");

    strong.appendChild(textNode1);
    p.appendChild(strong);
    p.appendChild(textNode2);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 6,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(6);
    expect(result.commonParentNode).toBe(p);
    expect(result.startParentNodes).toEqual([textNode1, strong, p]);
    expect(result.endParentNodes).toEqual([textNode2, p]);
});

test("text nodes at different depths - reverse selection", () => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    const textNode1 = document.createTextNode("Bold");
    const textNode2 = document.createTextNode(" plain");

    strong.appendChild(textNode1);
    p.appendChild(strong);
    p.appendChild(textNode2);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 6,
        focusNode: textNode1,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode1);
    expect(result.startOffset).toBe(0);
    expect(result.endNode).toBe(textNode2);
    expect(result.endOffset).toBe(6);
    expect(result.commonParentNode).toBe(p);
    expect(result.startParentNodes).toEqual([textNode1, strong, p]);
    expect(result.endParentNodes).toEqual([textNode2, p]);
});

test("text nodes at different depths - nested vs direct child (swapped)", () => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    const textNode1 = document.createTextNode("Bold");
    const textNode2 = document.createTextNode(" plain");

    strong.appendChild(textNode1);
    p.appendChild(textNode2);
    p.appendChild(strong);

    const selection = {
        anchorNode: textNode1,
        anchorOffset: 0,
        focusNode: textNode2,
        focusOffset: 6,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Focus");
    expect(result.startNode).toBe(textNode2);
    expect(result.startOffset).toBe(6);
    expect(result.endNode).toBe(textNode1);
    expect(result.endOffset).toBe(0);
    expect(result.commonParentNode).toBe(p);
    expect(result.startParentNodes).toEqual([textNode2, p]);
    expect(result.endParentNodes).toEqual([textNode1, strong, p]);
});

test("text nodes at different depths - reverse selection (swapped)", () => {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    const textNode1 = document.createTextNode("Bold");
    const textNode2 = document.createTextNode(" plain");

    strong.appendChild(textNode1);
    p.appendChild(textNode2);
    p.appendChild(strong);

    const selection = {
        anchorNode: textNode2,
        anchorOffset: 6,
        focusNode: textNode1,
        focusOffset: 0,
    };

    const result = getSelectionStartNodeAndEndNode(selection);

    expect(result.start).toBe("Anchor");
    expect(result.startNode).toBe(textNode2);
    expect(result.startOffset).toBe(6);
    expect(result.endNode).toBe(textNode1);
    expect(result.endOffset).toBe(0);
    expect(result.commonParentNode).toBe(p);
    expect(result.startParentNodes).toEqual([textNode2, p]);
    expect(result.endParentNodes).toEqual([textNode1, strong, p]);
});
