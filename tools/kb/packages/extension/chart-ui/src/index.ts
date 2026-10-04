/**
 * `@kb/chart-ui`: the chart family's browser half (DESIGN.md → Extension
 * families): the chart view, drawn from its query node's rows by Vega in a
 * chunk of its own, and "Add chart" in a query node's menu. The page loads
 * its entry, `chartUiPlugin`, through `BROWSER_EXTENSIONS` under the family's
 * declared name.
 */
export { chartUiPlugin } from "./plugin";
