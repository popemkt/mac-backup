// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// These assertions exist because the unit suite could not make them. It had
// two tests asserting that `tokens.css` *contains* `var(--kb-text)` inside
// `.kb-text`, and both passed for the token's entire life — while the rule was
// `font: var(--kb-text) inherit`, which is invalid CSS (a CSS-wide keyword may
// not be a shorthand component) and was therefore dropped whole. Every row
// silently inherited the 16px body size while field labels hard-coded 14.5px,
// which is the mismatch the owner could see. A source-text assertion cannot
// catch that class of bug; only a real engine computing real styles can.
import { expect, test } from "playwright/test";

/** --kb-text-size × --kb-text-leading, resolved. */
const TEXT_SIZE = 14.5;
const LINE_BOX = 23.2;

test("the row type scale is applied, not merely declared", async ({ page }) => {
  await page.goto("/");

  const applied = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "kb-text";
    document.body.appendChild(probe);
    const style = getComputedStyle(probe);
    const out = {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
    };
    probe.remove();
    return out;
  });

  expect(applied.fontSize).toBeCloseTo(TEXT_SIZE, 1);
  expect(applied.lineHeight).toBeCloseTo(LINE_BOX, 1);
  // The failure mode was silently inheriting the body size, so pin that too:
  // equality here is what "the token never applied" looked like.
  expect(applied.fontSize).not.toBeCloseTo(applied.bodyFontSize, 1);
});

test("node text and field labels resolve to one metric", async ({ page }) => {
  await page.goto("/");

  const row = page.locator(".node-content .kb-text").first();
  await expect(row).toBeVisible();

  const metrics = await page.evaluate(() => {
    const read = (el: Element | null) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    };
    // A FieldRow label is a .kb-text span; render one the same way the outline
    // does so the comparison holds even on a fixture with no props set.
    const probe = document.createElement("span");
    probe.className = "kb-text";
    document.body.appendChild(probe);
    const label = read(probe);
    probe.remove();
    return { node: read(document.querySelector(".node-content .kb-text")), label };
  });

  expect(metrics.node).not.toBeNull();
  expect(metrics.node!.fontSize).toBeCloseTo(metrics.label!.fontSize, 1);
  expect(metrics.node!.lineHeight).toBeCloseTo(metrics.label!.lineHeight, 1);
});

test("a trailing pill yields only the first line, and fills that line", async ({
  page,
}) => {
  await page.goto("/");

  const geometry = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:0;top:0;width:400px;visibility:hidden;z-index:99999";
    host.innerHTML = `
      <div class="relative min-h-6 min-w-0" data-probe-wrap>
        <span class="kb-text-trailing flex items-center gap-1.5" data-probe-float>
          <span class="kb-tag inline-flex items-center gap-1 rounded-sm px-1.5"
                data-tag-chip="true">#todo</span>
        </span>
        <div class="kb-text kb-text-row min-h-6 min-w-0" data-probe-text>Alpha beta
gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho
sigma tau upsilon</div>
      </div>`;
    document.body.appendChild(host);

    const text = host.querySelector("[data-probe-text]")!;
    const float = host.querySelector("[data-probe-float]")!;
    const range = document.createRange();
    range.selectNodeContents(text);
    // Whitespace at a wrap point can produce its own narrow rect; only the
    // laid-out line boxes matter here.
    const lines = [...range.getClientRects()]
      .map((rect) => rect.width)
      .filter((width) => width > 20);

    const out = {
      lines,
      floatWidth: float.getBoundingClientRect().width,
      floatHeight: float.getBoundingClientRect().height,
      chipHeight: host
        .querySelector("[data-tag-chip]")!
        .getBoundingClientRect().height,
      containerWidth: host
        .querySelector("[data-probe-wrap]")!
        .getBoundingClientRect().width,
    };
    host.remove();
    return out;
  });

  expect(geometry.lines.length).toBeGreaterThan(1);
  const [first, ...rest] = geometry.lines;
  const later = Math.max(...rest);

  // The whole point of the float: line one gives up the pill's width, and the
  // lines the pill never touches stay full width. A flex sibling — the previous
  // shape — narrows every line equally, so `first === later` is the red state.
  expect(first!).toBeLessThan(later - 10);
  expect(later).toBeGreaterThan(geometry.containerWidth * 0.9);
  expect(geometry.containerWidth - later).toBeLessThan(geometry.floatWidth);

  // "Almost line height" (Tana): a readable pill, never a superscript, and
  // never so tall that it displaces a second line on its own.
  expect(geometry.chipHeight).toBeGreaterThan(LINE_BOX * 0.6);
  expect(geometry.floatHeight).toBeLessThan(LINE_BOX);
});
