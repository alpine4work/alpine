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
