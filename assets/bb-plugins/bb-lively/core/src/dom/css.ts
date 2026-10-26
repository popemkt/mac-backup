// Small CSS helpers shared by the stylesheets.

/** A CSS string literal for plain text lively prints (a quote, backslash or newline is dropped). */
export const cssString = (text: string): string => `"${text.replaceAll(/["\\\n]/gu, "")}"`;
