/**
 * `@kb/code-ui`: the code family's browser half (DESIGN.md → Extension
 * families): the code view, a view node's code run in a sandbox frame the
 * page hosts through `BrowserHost.sandbox`. The page loads its entry,
 * `codeUiPlugin`, through `BROWSER_EXTENSIONS` under the family's declared
 * name.
 */
export { codeUiPlugin } from "./plugin";
