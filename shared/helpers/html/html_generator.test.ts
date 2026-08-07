import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";

test("can generate and patch an HTML element", () => {
    let node: Node;
    let html: string;
    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-test", "1");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        node = html1.generateNode();
    }

    assert(node instanceof HTMLElement);

    expect(node.outerHTML).toEqual('<div data-test="1">foobar<strong>qux</strong></div>');
    expect(html).toEqual('<div data-test="1">foobar<strong>qux</strong></div>');

    const nodeA = node;
    const nodeA_1 = node.childNodes[0];
    const nodeA_2 = node.childNodes[1];
    const nodeA_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeA).toBeInstanceOf(HTMLElement);
    expect(nodeA_1).toBeInstanceOf(Text);
    expect(nodeA_2).toBeInstanceOf(HTMLElement);
    expect(nodeA_2_1).toBeInstanceOf(Text);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-hello", "world");
        html1.setAttribute("data-test", "2");

        const html2 = new HtmlTextGenerator("barfoo");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(null, node)).toEqual(true);
    }

    expect(node.outerHTML).toEqual(
        '<div data-test="2" data-hello="world">barfoo<strong>qux</strong></div>',
    );
    expect(html).toEqual('<div data-hello="world" data-test="2">barfoo<strong>qux</strong></div>');

    const nodeB = node;
    const nodeB_1 = node.childNodes[0];
    const nodeB_2 = node.childNodes[1];
    const nodeB_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeB).toBeInstanceOf(HTMLElement);
    expect(nodeB_1).toBeInstanceOf(Text);
    expect(nodeB_2).toBeInstanceOf(HTMLElement);
    expect(nodeB_2_1).toBeInstanceOf(Text);

    expect(nodeB).toBe(nodeA);
    expect(nodeB_1).toBe(nodeA_1);
    expect(nodeB_2).toBe(nodeA_2);
    expect(nodeB_2_1).toBe(nodeA_2_1);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-hello", "world");

        const html2 = new HtmlTextGenerator("barfoo");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("em");
        html1.appendChild(html3);

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(null, node)).toEqual(true);
    }

    expect(html).toEqual('<div data-hello="world">barfoo<em>qux</em></div>');
    expect(node.outerHTML).toEqual('<div data-hello="world">barfoo<em>qux</em></div>');

    const nodeC = node;
    const nodeC_1 = node.childNodes[0];
    const nodeC_2 = node.childNodes[1];
    const nodeC_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeC).toBeInstanceOf(HTMLElement);
    expect(nodeC_1).toBeInstanceOf(Text);
    expect(nodeC_2).toBeInstanceOf(HTMLElement);
    expect(nodeC_2_1).toBeInstanceOf(Text);

    expect(nodeC).toBe(nodeB);
    expect(nodeC_1).toBe(nodeB_1);
    expect(nodeC_2).not.toBe(nodeB_2);
    expect(nodeC_2_1).not.toBe(nodeB_2_1);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-hello", "world");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("em");
        html1.appendChild(html3);

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        const html5 = new HtmlElementGenerator("span");
        html1.appendChild(html5);

        const html6 = new HtmlTextGenerator("wow");
        html5.appendChild(html6);

        html = html1.generateHtml();
        expect(html1.patchNode(null, node)).toEqual(true);
    }

    expect(html).toEqual('<div data-hello="world">foobar<em>qux</em><span>wow</span></div>');
    expect(node.outerHTML).toEqual(
        '<div data-hello="world">foobar<em>qux</em><span>wow</span></div>',
    );

    const nodeD = node;
    const nodeD_1 = node.childNodes[0];
    const nodeD_2 = node.childNodes[1];
    const nodeD_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeD).toBeInstanceOf(HTMLElement);
    expect(nodeD_1).toBeInstanceOf(Text);
    expect(nodeD_2).toBeInstanceOf(HTMLElement);
    expect(nodeD_2_1).toBeInstanceOf(Text);

    expect(nodeD).toBe(nodeC);
    expect(nodeD_1).toBe(nodeC_1);
    expect(nodeD_2).toBe(nodeC_2);
    expect(nodeD_2_1).toBe(nodeC_2_1);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-hello", "world");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("em");
        html1.appendChild(html3);

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(null, node)).toEqual(true);
    }

    expect(html).toEqual('<div data-hello="world">foobar<em>qux</em></div>');
    expect(node.outerHTML).toEqual('<div data-hello="world">foobar<em>qux</em></div>');

    const nodeE = node;
    const nodeE_1 = node.childNodes[0];
    const nodeE_2 = node.childNodes[1];
    const nodeE_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeE).toBeInstanceOf(HTMLElement);
    expect(nodeE_1).toBeInstanceOf(Text);
    expect(nodeE_2).toBeInstanceOf(HTMLElement);
    expect(nodeE_2_1).toBeInstanceOf(Text);

    expect(nodeE).toBe(nodeD);
    expect(nodeE_1).toBe(nodeD_1);
    expect(nodeE_2).toBe(nodeD_2);
    expect(nodeE_2_1).toBe(nodeD_2_1);
});

test("can generate and patch an HTML element using fragments (element root)", () => {
    let node: Node;
    let html: string;
    {
        const generator = new HtmlElementGenerator("div");

        const generator_1 = new HtmlFragmentGenerator();
        generator.appendChild(generator_1);

        {
            const generator_1_1 = new HtmlTextGenerator("a");
            generator_1.appendChild(generator_1_1);

            const generator_1_2 = new HtmlFragmentGenerator();
            generator_1.appendChild(generator_1_2);

            {
                const generator_1_2_1 = new HtmlTextGenerator("b");
                generator_1_2.appendChild(generator_1_2_1);

                const generator_1_2_2 = new HtmlElementGenerator("div");
                generator_1_2.appendChild(generator_1_2_2);

                {
                    const generator_1_2_2_1 = new HtmlTextGenerator("c");
                    generator_1_2_2.appendChild(generator_1_2_2_1);
                }

                const generator_1_2_3 = new HtmlTextGenerator("d");
                generator_1_2.appendChild(generator_1_2_3);
            }

            const generator_1_3 = new HtmlTextGenerator("e");
            generator_1.appendChild(generator_1_3);
        }

        const generator_2 = new HtmlElementGenerator("div");
        generator.appendChild(generator_2);

        {
            const generator_2_1 = new HtmlElementGenerator("div");
            generator_2.appendChild(generator_2_1);

            {
                const generator_2_1_1 = new HtmlTextGenerator("f");
                generator_2_1.appendChild(generator_2_1_1);
            }

            const generator_2_2 = new HtmlTextGenerator("g");
            generator_2.appendChild(generator_2_2);

            const generator_2_3 = new HtmlFragmentGenerator();
            generator_2.appendChild(generator_2_3);

            const generator_2_4 = new HtmlTextGenerator("h");
            generator_2.appendChild(generator_2_4);
        }

        const generator_3 = new HtmlFragmentGenerator();
        generator.appendChild(generator_3);

        {
            const generator_3_1 = new HtmlTextGenerator("i");
            generator_3.appendChild(generator_3_1);

            const generator_3_2 = new HtmlElementGenerator("div");
            generator_3.appendChild(generator_3_2);

            {
                const generator_3_2_1 = new HtmlTextGenerator("j");
                generator_3_2.appendChild(generator_3_2_1);
            }
        }

        const generator_4 = new HtmlFragmentGenerator();
        generator.appendChild(generator_4);

        {
            const generator_4_1 = new HtmlElementGenerator("div");
            generator_4.appendChild(generator_4_1);

            {
                const generator_4_1_1 = new HtmlTextGenerator("k");
                generator_4_1.appendChild(generator_4_1_1);
            }

            const generator_4_2 = new HtmlTextGenerator("l");
            generator_4.appendChild(generator_4_2);
        }

        html = generator.generateHtml();
        node = generator.generateNode();
    }

    assert(node instanceof HTMLElement);

    expect(html).toEqual(
        "<div>ab<div>c</div>de<div><div>f</div>gh</div>i<div>j</div><div>k</div>l</div>",
    );
    expect(node.outerHTML).toEqual(
        "<div>ab<div>c</div>de<div><div>f</div>gh</div>i<div>j</div><div>k</div>l</div>",
    );

    const deepNodeA1 = node.childNodes[node.childNodes.length - 3];
    expect(deepNodeA1 instanceof HTMLElement ? deepNodeA1.outerHTML : undefined).toEqual(
        "<div>j</div>",
    );

    const deepNodeA2 = node.childNodes[node.childNodes.length - 2];
    expect(deepNodeA2 instanceof HTMLElement ? deepNodeA2.outerHTML : undefined).toEqual(
        "<div>k</div>",
    );

    {
        const generator = new HtmlElementGenerator("div");

        const generator_1 = new HtmlFragmentGenerator();
        generator.appendChild(generator_1);

        {
            const generator_1_1 = new HtmlTextGenerator("a");
            generator_1.appendChild(generator_1_1);

            const generator_1_2 = new HtmlFragmentGenerator();
            generator_1.appendChild(generator_1_2);

            {
                const generator_1_2_1 = new HtmlTextGenerator("b");
                generator_1_2.appendChild(generator_1_2_1);

                const generator_1_2_2 = new HtmlElementGenerator("div");
                generator_1_2.appendChild(generator_1_2_2);

                {
                    const generator_1_2_2_1 = new HtmlTextGenerator("c");
                    generator_1_2_2.appendChild(generator_1_2_2_1);
                }

                const generator_1_2_3 = new HtmlTextGenerator("d");
                generator_1_2.appendChild(generator_1_2_3);
            }

            const generator_1_3 = new HtmlTextGenerator("e");
            generator_1.appendChild(generator_1_3);
        }

        const generator_2 = new HtmlElementGenerator("div");
        generator.appendChild(generator_2);

        {
            const generator_2_1 = new HtmlElementGenerator("div");
            generator_2.appendChild(generator_2_1);

            {
                const generator_2_1_1 = new HtmlTextGenerator("foo");
                generator_2_1.appendChild(generator_2_1_1);
            }

            const generator_2_2 = new HtmlTextGenerator("g2");
            generator_2.appendChild(generator_2_2);

            const generator_2_3 = new HtmlFragmentGenerator();
            generator_2.appendChild(generator_2_3);

            const generator_2_4 = new HtmlTextGenerator("h");
            generator_2.appendChild(generator_2_4);
        }

        const generator_3 = new HtmlFragmentGenerator();
        generator.appendChild(generator_3);

        {
            const generator_3_1 = new HtmlTextGenerator("i");
            generator_3.appendChild(generator_3_1);

            const generator_3_2 = new HtmlElementGenerator("div");
            generator_3.appendChild(generator_3_2);

            generator_3_2.setAttribute("data-hello", "world");

            {
                const generator_3_2_1 = new HtmlTextGenerator("j");
                generator_3_2.appendChild(generator_3_2_1);
            }
        }

        const generator_4 = new HtmlFragmentGenerator();
        generator.appendChild(generator_4);

        {
            const generator_4_1 = new HtmlElementGenerator("span");
            generator_4.appendChild(generator_4_1);

            {
                const generator_4_1_1 = new HtmlTextGenerator("k");
                generator_4_1.appendChild(generator_4_1_1);
            }

            const generator_4_2 = new HtmlTextGenerator("l");
            generator_4.appendChild(generator_4_2);
        }

        html = generator.generateHtml();
        expect(generator.patchNode(null, node)).toEqual(true);
    }

    expect(html).toEqual(
        '<div>ab<div>c</div>de<div><div>foo</div>g2h</div>i<div data-hello="world">j</div><span>k</span>l</div>',
    );
    expect(node.outerHTML).toEqual(
        '<div>ab<div>c</div>de<div><div>foo</div>g2h</div>i<div data-hello="world">j</div><span>k</span>l</div>',
    );

    const deepNodeB1 = node.childNodes[node.childNodes.length - 3];
    expect(deepNodeB1 instanceof HTMLElement ? deepNodeB1.outerHTML : undefined).toEqual(
        '<div data-hello="world">j</div>',
    );
    expect(deepNodeB1).toBe(deepNodeA1);

    const deepNodeB2 = node.childNodes[node.childNodes.length - 2];
    expect(deepNodeB2 instanceof HTMLElement ? deepNodeB2.outerHTML : undefined).toEqual(
        "<span>k</span>",
    );
    expect(deepNodeB2).not.toBe(deepNodeA2);
});

test("can generate and patch an HTML element using fragments (document fragment root)", () => {
    let node: Node;
    let html: string;
    {
        const generator = new HtmlFragmentGenerator();

        const generator_1 = new HtmlFragmentGenerator();
        generator.appendChild(generator_1);

        {
            const generator_1_1 = new HtmlTextGenerator("a");
            generator_1.appendChild(generator_1_1);

            const generator_1_2 = new HtmlFragmentGenerator();
            generator_1.appendChild(generator_1_2);

            {
                const generator_1_2_1 = new HtmlTextGenerator("b");
                generator_1_2.appendChild(generator_1_2_1);

                const generator_1_2_2 = new HtmlElementGenerator("div");
                generator_1_2.appendChild(generator_1_2_2);

                {
                    const generator_1_2_2_1 = new HtmlTextGenerator("c");
                    generator_1_2_2.appendChild(generator_1_2_2_1);
                }

                const generator_1_2_3 = new HtmlTextGenerator("d");
                generator_1_2.appendChild(generator_1_2_3);
            }

            const generator_1_3 = new HtmlTextGenerator("e");
            generator_1.appendChild(generator_1_3);
        }

        const generator_2 = new HtmlElementGenerator("div");
        generator.appendChild(generator_2);

        {
            const generator_2_1 = new HtmlElementGenerator("div");
            generator_2.appendChild(generator_2_1);

            {
                const generator_2_1_1 = new HtmlTextGenerator("f");
                generator_2_1.appendChild(generator_2_1_1);
            }

            const generator_2_2 = new HtmlTextGenerator("g");
            generator_2.appendChild(generator_2_2);

            const generator_2_3 = new HtmlFragmentGenerator();
            generator_2.appendChild(generator_2_3);

            const generator_2_4 = new HtmlTextGenerator("h");
            generator_2.appendChild(generator_2_4);
        }

        const generator_3 = new HtmlFragmentGenerator();
        generator.appendChild(generator_3);

        {
            const generator_3_1 = new HtmlTextGenerator("i");
            generator_3.appendChild(generator_3_1);

            const generator_3_2 = new HtmlElementGenerator("div");
            generator_3.appendChild(generator_3_2);

            {
                const generator_3_2_1 = new HtmlTextGenerator("j");
                generator_3_2.appendChild(generator_3_2_1);
            }
        }

        const generator_4 = new HtmlFragmentGenerator();
        generator.appendChild(generator_4);

        {
            const generator_4_1 = new HtmlElementGenerator("div");
            generator_4.appendChild(generator_4_1);

            {
                const generator_4_1_1 = new HtmlTextGenerator("k");
                generator_4_1.appendChild(generator_4_1_1);
            }

            const generator_4_2 = new HtmlTextGenerator("l");
            generator_4.appendChild(generator_4_2);
        }

        html = generator.generateHtml();
        node = generator.generateNode();
    }

    assert(node instanceof DocumentFragment);

    expect(html).toEqual("ab<div>c</div>de<div><div>f</div>gh</div>i<div>j</div><div>k</div>l");
    {
        const parentNode = document.createElement("div");
        parentNode.appendChild(node.cloneNode(true));
        expect(parentNode.innerHTML).toEqual(
            "ab<div>c</div>de<div><div>f</div>gh</div>i<div>j</div><div>k</div>l",
        );
    }

    const deepNodeA1 = node.childNodes[node.childNodes.length - 3];
    expect(deepNodeA1 instanceof HTMLElement ? deepNodeA1.outerHTML : undefined).toEqual(
        "<div>j</div>",
    );

    const deepNodeA2 = node.childNodes[node.childNodes.length - 2];
    expect(deepNodeA2 instanceof HTMLElement ? deepNodeA2.outerHTML : undefined).toEqual(
        "<div>k</div>",
    );

    {
        const generator = new HtmlFragmentGenerator();

        const generator_1 = new HtmlFragmentGenerator();
        generator.appendChild(generator_1);

        {
            const generator_1_1 = new HtmlTextGenerator("a");
            generator_1.appendChild(generator_1_1);

            const generator_1_2 = new HtmlFragmentGenerator();
            generator_1.appendChild(generator_1_2);

            {
                const generator_1_2_1 = new HtmlTextGenerator("b");
                generator_1_2.appendChild(generator_1_2_1);

                const generator_1_2_2 = new HtmlElementGenerator("div");
                generator_1_2.appendChild(generator_1_2_2);

                {
                    const generator_1_2_2_1 = new HtmlTextGenerator("c");
                    generator_1_2_2.appendChild(generator_1_2_2_1);
                }

                const generator_1_2_3 = new HtmlTextGenerator("d");
                generator_1_2.appendChild(generator_1_2_3);
            }

            const generator_1_3 = new HtmlTextGenerator("e");
            generator_1.appendChild(generator_1_3);
        }

        const generator_2 = new HtmlElementGenerator("div");
        generator.appendChild(generator_2);

        {
            const generator_2_1 = new HtmlElementGenerator("div");
            generator_2.appendChild(generator_2_1);

            {
                const generator_2_1_1 = new HtmlTextGenerator("foo");
                generator_2_1.appendChild(generator_2_1_1);
            }

            const generator_2_2 = new HtmlTextGenerator("g2");
            generator_2.appendChild(generator_2_2);

            const generator_2_3 = new HtmlFragmentGenerator();
            generator_2.appendChild(generator_2_3);

            const generator_2_4 = new HtmlTextGenerator("h");
            generator_2.appendChild(generator_2_4);
        }

        const generator_3 = new HtmlFragmentGenerator();
        generator.appendChild(generator_3);

        {
            const generator_3_1 = new HtmlTextGenerator("i");
            generator_3.appendChild(generator_3_1);

            const generator_3_2 = new HtmlElementGenerator("div");
            generator_3.appendChild(generator_3_2);

            generator_3_2.setAttribute("data-hello", "world");

            {
                const generator_3_2_1 = new HtmlTextGenerator("j");
                generator_3_2.appendChild(generator_3_2_1);
            }
        }

        const generator_4 = new HtmlFragmentGenerator();
        generator.appendChild(generator_4);

        {
            const generator_4_1 = new HtmlElementGenerator("span");
            generator_4.appendChild(generator_4_1);

            {
                const generator_4_1_1 = new HtmlTextGenerator("k");
                generator_4_1.appendChild(generator_4_1_1);
            }

            const generator_4_2 = new HtmlTextGenerator("l");
            generator_4.appendChild(generator_4_2);
        }

        html = generator.generateHtml();
        expect(generator.patchNode(null, node)).toEqual(true);
    }

    expect(html).toEqual(
        'ab<div>c</div>de<div><div>foo</div>g2h</div>i<div data-hello="world">j</div><span>k</span>l',
    );
    {
        const parentNode = document.createElement("div");
        parentNode.appendChild(node.cloneNode(true));
        expect(parentNode.innerHTML).toEqual(
            'ab<div>c</div>de<div><div>foo</div>g2h</div>i<div data-hello="world">j</div><span>k</span>l',
        );
    }

    const deepNodeB1 = node.childNodes[node.childNodes.length - 3];
    expect(deepNodeB1 instanceof HTMLElement ? deepNodeB1.outerHTML : undefined).toEqual(
        '<div data-hello="world">j</div>',
    );
    expect(deepNodeB1).toBe(deepNodeA1);

    const deepNodeB2 = node.childNodes[node.childNodes.length - 2];
    expect(deepNodeB2 instanceof HTMLElement ? deepNodeB2.outerHTML : undefined).toEqual(
        "<span>k</span>",
    );
    expect(deepNodeB2).not.toBe(deepNodeA2);
});

test("can preserve class names while patching HTML element", () => {
    let node: Node;
    let html: string;
    let previousHtml: HtmlGenerator;
    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("class", "c1 c2");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);

        html3.setAttribute("class", "c3 c4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        node = html1.generateNode();
        previousHtml = html1;
    }

    assert(node instanceof HTMLElement);

    expect(node.outerHTML).toEqual(
        '<div class="c1 c2">foobar<strong class="c3 c4">qux</strong></div>',
    );
    expect(html).toEqual('<div class="c1 c2">foobar<strong class="c3 c4">qux</strong></div>');

    const nodeA = node;
    const nodeA_1 = node.childNodes[0];
    const nodeA_2 = node.childNodes[1];
    const nodeA_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeA).toBeInstanceOf(HTMLElement);
    expect(nodeA_1).toBeInstanceOf(Text);
    expect(nodeA_2).toBeInstanceOf(HTMLElement);
    expect(nodeA_2_1).toBeInstanceOf(Text);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("class", "c2");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);

        html3.setAttribute("class", "c5 c3 c4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(previousHtml, node)).toEqual(true);
        previousHtml = html1;
    }

    expect(node.outerHTML).toEqual(
        '<div class="c2">foobar<strong class="c3 c4 c5">qux</strong></div>',
    );
    expect(html).toEqual('<div class="c2">foobar<strong class="c5 c3 c4">qux</strong></div>');

    const nodeB = node;
    const nodeB_1 = node.childNodes[0];
    const nodeB_2 = node.childNodes[1];
    const nodeB_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeB).toBeInstanceOf(HTMLElement);
    expect(nodeB_1).toBeInstanceOf(Text);
    expect(nodeB_2).toBeInstanceOf(HTMLElement);
    expect(nodeB_2_1).toBeInstanceOf(Text);

    expect(nodeB).toBe(nodeA);
    expect(nodeB_1).toBe(nodeA_1);
    expect(nodeB_2).toBe(nodeA_2);
    expect(nodeB_2_1).toBe(nodeA_2_1);

    nodeB.classList.add("other1");
    (nodeB_2 as HTMLElement).classList.add("other2");

    expect(node.outerHTML).toEqual(
        '<div class="c2 other1">foobar<strong class="c3 c4 c5 other2">qux</strong></div>',
    );
    expect(html).toEqual('<div class="c2">foobar<strong class="c5 c3 c4">qux</strong></div>');

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("class", "c2 c6");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);

        html3.setAttribute("class", "c5 c4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(previousHtml, node)).toEqual(true);
        previousHtml = html1;
    }

    expect(node.outerHTML).toEqual(
        '<div class="c2 other1 c6">foobar<strong class="c4 c5 other2">qux</strong></div>',
    );
    expect(html).toEqual('<div class="c2 c6">foobar<strong class="c5 c4">qux</strong></div>');

    const nodeC = node;
    const nodeC_1 = node.childNodes[0];
    const nodeC_2 = node.childNodes[1];
    const nodeC_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeC).toBeInstanceOf(HTMLElement);
    expect(nodeC_1).toBeInstanceOf(Text);
    expect(nodeC_2).toBeInstanceOf(HTMLElement);
    expect(nodeC_2_1).toBeInstanceOf(Text);

    expect(nodeC).toBe(nodeB);
    expect(nodeC_1).toBe(nodeB_1);
    expect(nodeC_2).toBe(nodeB_2);
    expect(nodeC_2_1).toBe(nodeB_2_1);
});

test("can preserve attributes while patching HTML element", () => {
    let node: Node;
    let html: string;
    let previousHtml: HtmlGenerator;
    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-a", "1");
        html1.setAttribute("data-b", "2");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);
        html3.setAttribute("data-c", "3");
        html3.setAttribute("data-d", "4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        node = html1.generateNode();
        previousHtml = html1;
    }

    assert(node instanceof HTMLElement);

    expect(node.outerHTML).toEqual(
        '<div data-a="1" data-b="2">foobar<strong data-c="3" data-d="4">qux</strong></div>',
    );
    expect(html).toEqual(
        '<div data-a="1" data-b="2">foobar<strong data-c="3" data-d="4">qux</strong></div>',
    );

    const nodeA = node;
    const nodeA_1 = node.childNodes[0];
    const nodeA_2 = node.childNodes[1];
    const nodeA_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeA).toBeInstanceOf(HTMLElement);
    expect(nodeA_1).toBeInstanceOf(Text);
    expect(nodeA_2).toBeInstanceOf(HTMLElement);
    expect(nodeA_2_1).toBeInstanceOf(Text);

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-b", "2");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);
        html3.setAttribute("data-e", "5");
        html3.setAttribute("data-c", "3");
        html3.setAttribute("data-d", "4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(previousHtml, node)).toEqual(true);
        previousHtml = html1;
    }

    expect(node.outerHTML).toEqual(
        '<div data-b="2">foobar<strong data-c="3" data-d="4" data-e="5">qux</strong></div>',
    );
    expect(html).toEqual(
        '<div data-b="2">foobar<strong data-e="5" data-c="3" data-d="4">qux</strong></div>',
    );

    const nodeB = node;
    const nodeB_1 = node.childNodes[0];
    const nodeB_2 = node.childNodes[1];
    const nodeB_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeB).toBeInstanceOf(HTMLElement);
    expect(nodeB_1).toBeInstanceOf(Text);
    expect(nodeB_2).toBeInstanceOf(HTMLElement);
    expect(nodeB_2_1).toBeInstanceOf(Text);

    expect(nodeB).toBe(nodeA);
    expect(nodeB_1).toBe(nodeA_1);
    expect(nodeB_2).toBe(nodeA_2);
    expect(nodeB_2_1).toBe(nodeA_2_1);

    nodeB.setAttribute("data-other", "1");
    (nodeB_2 as HTMLElement).setAttribute("data-other", "2");

    expect(node.outerHTML).toEqual(
        '<div data-b="2" data-other="1">foobar<strong data-c="3" data-d="4" data-e="5" data-other="2">qux</strong></div>',
    );
    expect(html).toEqual(
        '<div data-b="2">foobar<strong data-e="5" data-c="3" data-d="4">qux</strong></div>',
    );

    {
        const html1 = new HtmlElementGenerator("div");
        html1.setAttribute("data-b", "2");
        html1.setAttribute("data-f", "6");

        const html2 = new HtmlTextGenerator("foobar");
        html1.appendChild(html2);

        const html3 = new HtmlElementGenerator("strong");
        html1.appendChild(html3);
        html3.setAttribute("data-e", "5");
        html3.setAttribute("data-d", "4");

        const html4 = new HtmlTextGenerator("qux");
        html3.appendChild(html4);

        html = html1.generateHtml();
        expect(html1.patchNode(previousHtml, node)).toEqual(true);
        previousHtml = html1;
    }

    expect(node.outerHTML).toEqual(
        '<div data-b="2" data-other="1" data-f="6">foobar<strong data-d="4" data-e="5" data-other="2">qux</strong></div>',
    );
    expect(html).toEqual(
        '<div data-b="2" data-f="6">foobar<strong data-e="5" data-d="4">qux</strong></div>',
    );

    const nodeC = node;
    const nodeC_1 = node.childNodes[0];
    const nodeC_2 = node.childNodes[1];
    const nodeC_2_1 = node.childNodes[1]!.childNodes[0];

    expect(nodeC).toBeInstanceOf(HTMLElement);
    expect(nodeC_1).toBeInstanceOf(Text);
    expect(nodeC_2).toBeInstanceOf(HTMLElement);
    expect(nodeC_2_1).toBeInstanceOf(Text);

    expect(nodeC).toBe(nodeB);
    expect(nodeC_1).toBe(nodeB_1);
    expect(nodeC_2).toBe(nodeB_2);
    expect(nodeC_2_1).toBe(nodeB_2_1);
});
