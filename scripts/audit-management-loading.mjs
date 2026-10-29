import assert from "node:assert/strict";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

async function ready(page) {
  await page.locator(".management-main h1:visible").first().waitFor();
  await page.locator(".management-loading:visible").waitFor({ state: "hidden" });
}

async function assertFits(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert(overflow <= 1, `Horizontal overflow: ${overflow}px`);
}

function isSectionRequest(request, pathname) {
  const url = new URL(request.url());
  return url.pathname === pathname && request.headers().rsc === "1";
}

async function holdSection(page, pathname) {
  let release;
  let captured;
  const gate = new Promise((resolve) => { release = resolve; });
  const received = new Promise((resolve) => { captured = resolve; });
  const handler = async (route) => {
    if (!isSectionRequest(route.request(), pathname)) return route.continue();
    captured();
    await gate;
    // A newer navigation may legitimately cancel the previous request.
    await route.continue().catch(() => {});
  };
  await page.route("**/*", handler);
  return {
    received: () => Promise.race([received, delay(15_000).then(() => { throw new Error(`No RSC request for ${pathname}`); })]),
    async finish() {
      release();
      await page.unroute("**/*", handler);
    },
  };
}

/** Read-only browser checks; caller supplies an authenticated LOCAL audit session. */
export async function auditManagementLoading({ page, context, browser, baseUrl, artifacts, attempt }) {
  assert(localHosts.has(new URL(baseUrl).hostname), "Loading audit only runs against the local application");
  const storageState = await context.storageState();

  await attempt("Branded server loading shell before hydration at five sizes", async () => {
    // JavaScript disabled preserves the real server-rendered Suspense fallback
    // for visual inspection, without adding a delay or a preview route to the app.
    const initialContext = await browser.newContext({ storageState, javaScriptEnabled: false, serviceWorkers: "block", reducedMotion: "reduce" });
    try {
      const initialPage = await initialContext.newPage();
      for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [1366, 768], [1920, 1080]]) {
        await initialPage.setViewportSize({ width, height });
        await initialPage.goto(`${baseUrl}/app`, { waitUntil: "load" });
        const loading = initialPage.locator(".management-loading-fullscreen:visible");
        await loading.waitFor();
        assert.equal(await loading.locator('[role="status"]').count(), 1);
        const logo = loading.locator('img[src="/icons/morita-192.png"]');
        assert(await logo.evaluate((image) => image.complete && image.naturalWidth === 192), "Brand logo loads at native resolution");
        await assertFits(initialPage);
        const box = await loading.boundingBox();
        assert(box.height >= height - 1, "Initial loading fills the viewport");
        await initialPage.screenshot({ path: path.join(artifacts, `management-loading-initial-${width}.png`), fullPage: false });
        const moving = await loading.evaluate((element) => [element, ...element.querySelectorAll("*")].some((node) => getComputedStyle(node).animationName !== "none"));
        assert.equal(moving, false, "Reduced motion disables looping decoration");
      }
    } finally {
      await initialContext.close();
    }
  });

  await attempt("Reload completes without leaving branded loading or blocking the page", async () => {
    await page.goto(`${baseUrl}/app/productos`);
    await ready(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    assert.equal(await page.locator(".management-loading:visible").count(), 0);
    assert(await page.getByRole("combobox", { name: "Buscar producto", exact: true }).isEnabled());
    await assertFits(page);
  });

  await attempt("Real throttled section navigation streams the branded loading screen", async () => {
    const navigationContext = await browser.newContext({ storageState, serviceWorkers: "block", reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
    try {
      const navigationPage = await navigationContext.newPage();
      await navigationPage.goto(`${baseUrl}/app/clientes`);
      await ready(navigationPage);
      const network = await navigationContext.newCDPSession(navigationPage);
      await network.send("Network.enable");
      try {
        // Throttle the real browser transport after hydration. No response body,
        // route tree, component state or application timer is replaced.
        await network.send("Network.emulateNetworkConditions", {
          offline: false, latency: 100, downloadThroughput: 20 * 1024, uploadThroughput: 1024 * 1024,
        });
        await navigationPage.locator('.management-nav-link[href="/app/productos"]').click({ noWaitAfter: true });
        const loading = navigationPage.locator(".management-main .management-loading:visible");
        await loading.waitFor({ timeout: 30_000 });
        assert.equal(await loading.locator('[role="status"]').count(), 1);
        for (const [width, height] of [[1366, 768], [390, 844]]) {
          await navigationPage.setViewportSize({ width, height });
          await assertFits(navigationPage);
          await navigationPage.screenshot({ path: path.join(artifacts, `management-loading-section-${width}.png`), fullPage: false });
        }
      } finally {
        await network.send("Network.emulateNetworkConditions", {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        await network.detach();
      }
      await navigationPage.waitForURL((url) => url.pathname === "/app/productos");
      await ready(navigationPage);
      assert(await navigationPage.getByRole("combobox", { name: "Buscar producto", exact: true }).isEnabled());
      await assertFits(navigationPage);
    } finally {
      await navigationContext.close();
    }
  });

  await attempt("Slow section request has feedback and rapid navigation can interrupt it", async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${baseUrl}/app/productos`);
    await ready(page);
    const held = await holdSection(page, "/app/compras");
    try {
      const purchases = page.locator('.management-nav-link[href="/app/compras"]');
      await purchases.click({ noWaitAfter: true });
      await held.received();
      await purchases.locator('[data-pending="true"]').waitFor();
      assert.equal(await purchases.locator('[role="status"]').count(), 1);
      await page.screenshot({ path: path.join(artifacts, "management-navigation-pending.png"), fullPage: false });
      // A pending request must never prevent choosing a different section.
      await page.locator('.management-nav-link[href="/app/clientes"]').click({ noWaitAfter: true });
      await page.waitForURL((url) => url.pathname === "/app/clientes");
      await ready(page);
    } finally {
      await held.finish();
    }
    assert.equal(new URL(page.url()).pathname, "/app/clientes");
    assert.equal(await page.locator('.management-nav-icon-slot[data-pending="true"]').count(), 0);
    await assertFits(page);
  });

  await attempt("Navigation feedback clears after a transient RSC failure", async () => {
    const failureContext = await browser.newContext({ storageState, serviceWorkers: "block", reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
    try {
      const failurePage = await failureContext.newPage();
      await failurePage.goto(`${baseUrl}/app/productos`);
      await ready(failurePage);
      let rejected = false;
      await failurePage.route("**/*", async (route) => {
        if (!rejected && isSectionRequest(route.request(), "/app/proveedores")) {
          rejected = true;
          return route.fulfill({ status: 500, contentType: "text/plain", body: "Transient local navigation audit failure" });
        }
        await route.continue();
      });
      await failurePage.locator('.management-nav-link[href="/app/proveedores"]').click({ noWaitAfter: true });
      // Next recovers a failed RSC transport with a document navigation.
      await failurePage.waitForURL((url) => url.pathname === "/app/proveedores");
      await ready(failurePage);
      assert(rejected, "The RSC failure was exercised");
      assert.equal(await failurePage.locator('.management-nav-icon-slot[data-pending="true"]').count(), 0);
      await failurePage.locator('.management-nav-link[href="/app/clientes"]').click();
      await failurePage.waitForURL((url) => url.pathname === "/app/clientes");
      await ready(failurePage);
    } finally {
      await failureContext.close();
    }
  });

  await attempt("Sidebar hover is stable, keyboard focus visible and reduced motion honored", async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${baseUrl}/app/productos`);
    await ready(page);
    const link = page.locator('.management-nav-link[href="/app/ventas"]');
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const before = await link.locator(".management-nav-text").boundingBox();
    await link.hover();
    await delay(200);
    const after = await link.locator(".management-nav-text").boundingBox();
    assert.deepEqual(after, before, "Hover does not shift text or surrounding layout");
    const transform = await link.locator(".management-nav-icon").evaluate((icon) => getComputedStyle(icon).transform);
    assert.notEqual(transform, "none", "Fine-pointer hover feedback is present");
    await page.screenshot({ path: path.join(artifacts, "management-sidebar-hover.png"), fullPage: false });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await delay(200);
    assert.equal(await link.locator(".management-nav-icon").evaluate((icon) => getComputedStyle(icon).transform), "none");
    await page.mouse.move(900, 500);
    await link.focus();
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { sidebar: element.matches(".management-nav-link"), visible: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 };
    });
    assert(focus.sidebar && focus.visible, "Keyboard navigation keeps a visible focus ring");
  });

  await attempt("Touch drawer navigation and loader never create horizontal scroll", async () => {
    const mobileContext = await browser.newContext({ storageState, serviceWorkers: "block", hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    try {
      const mobilePage = await mobileContext.newPage();
      await mobilePage.goto(`${baseUrl}/app/productos`);
      await ready(mobilePage);
      await mobilePage.getByRole("button", { name: "Abrir menú", exact: true }).tap();
      await mobilePage.locator(".management-sidebar.is-open").waitFor();
      await assertFits(mobilePage);
      await mobilePage.screenshot({ path: path.join(artifacts, "management-sidebar-touch.png"), fullPage: false });
      await mobilePage.locator('.management-nav-link[href="/app/gastos"]').tap();
      await mobilePage.waitForURL((url) => url.pathname === "/app/gastos");
      await ready(mobilePage);
      await mobilePage.locator(".management-sidebar.is-open").waitFor({ state: "hidden" });
      assert.equal(await mobilePage.locator("html.mobile-nav-open").count(), 0);
      await assertFits(mobilePage);
    } finally {
      await mobileContext.close();
    }
  });
}
