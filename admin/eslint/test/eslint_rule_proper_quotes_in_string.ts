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
