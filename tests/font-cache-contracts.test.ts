import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("cached font CSS uses the portable Vinext asset namespace", async () => {
  const fontsRoot = new URL("../.vinext/fonts/", import.meta.url);
  const directories = await readdir(fontsRoot, { withFileTypes: true });
  const styles = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .map((entry) => readFile(new URL(`${entry.name}/style.css`, fontsRoot), "utf8")),
  );

  assert.ok(styles.length > 0);
  for (const css of styles) {
    assert.doesNotMatch(css, /url\(\/(?:Users|home|workspace)\//);
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
    assert.ok(urls.length > 0);
    assert.ok(urls.every((url) => url.startsWith("/assets/_vinext_fonts/")));
  }
});
