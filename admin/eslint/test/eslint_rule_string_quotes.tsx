/* eslint-disable no-console */

// eslint-disable-next-line string-quotes
console.log("Can't use straight quotes in string");

// eslint-disable-next-line string-quotes
console.log('The so called "bug" may be a feature');

const space = " ";

// eslint-disable-next-line string-quotes
console.log(`Can't use straight quotes in${space}string`);

// eslint-disable-next-line string-quotes
console.log(`The so${space}called "bug" may be a feature`);

// eslint-disable-next-line string-quotes
<div aria-label="Can't use straight quotes in string" />;

// eslint-disable-next-line string-quotes
<div aria-label='The so called "bug" may be a feature' />;

// JSX attribute strings should use HTML entities, not Unicode escapes.
// eslint-disable-next-line string-quotes
<div aria-label="Couldn\u2019t go back" />;

// HTML entity here is fine.
<div aria-label="Couldn&x2019;t go back" />;

// JSX attribute string expressions can use Unicode escapes.
<div aria-label={"Couldn\u2019t go back"} />;

// JSX text should use HTML entities, not Unicode escapes.
// eslint-disable-next-line string-quotes
<div>Can\u2019t use straight quotes in string</div>;

// HTML entity here is fine.
<div>Can&x2019;t use straight quotes in string</div>;

// eslint-disable-next-line string-quotes
<div>Can't use straight quotes in string</div>;

// eslint-disable-next-line string-quotes
<div>The so called "bug" may be a feature</div>;

// We correctly identify this as HTML and don't warn.
console.log("<mark class='highlight-red'>High</mark>");

// We correctly identify this as HTML and don't warn.
console.log('<mark class="highlight-red">High</mark>');

// We correctly identify this as HTML and don't warn.
console.log(`<mark class="highlight-red">High</mark>`);

// We correctly identify this as HTML and don't warn.
console.log(`<mark class='highlight-red'>High</mark>`);

// The `'` in `Can't` should be a curly quote.
// eslint-disable-next-line string-quotes
console.log('<mark class="highlight-red">Can\'t</mark>');

// The `'` in `Can't` should be a curly quote.
// eslint-disable-next-line string-quotes
console.log(`<mark class="highlight-red">Can't</mark>`);

// Regular strings should use Unicode escapes, not HTML entities.
// eslint-disable-next-line string-quotes
console.log("Couldn&#x2019;t go back");

// Template literals should use Unicode escapes, not HTML entities.
// eslint-disable-next-line string-quotes
console.log(`Couldn&#x2019;t go back`);

// Unicode escapes in regular strings are fine.
console.log("Couldn\u2019t go back");

// Unicode escapes in template literals are fine.
console.log(`Couldn\u2019t go back`);
