import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("dist/index.html");
const target = resolve("dist/兔兔及时达自动化部署进度查询系统.html");

await stat(source);
let html = await readFile(source, "utf8");
const distDir = dirname(source);

const cssMatches = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
for (const match of cssMatches) {
  const assetPath = resolve(distDir, match[1].replace(/^\.\//, ""));
  const css = await readFile(assetPath, "utf8");
  html = html.replace(match[0], () => `<style>\n${css.replaceAll("</style", "<\\/style")}\n</style>`);
}

const scriptMatches = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)];
for (const match of scriptMatches) {
  const assetPath = resolve(distDir, match[1].replace(/^\.\//, ""));
  const js = await readFile(assetPath, "utf8");
  html = html.replace(match[0], () => `<script type="module">\n${js.replaceAll("</script", "<\\/script")}\n</script>`);
}

await writeFile(target, html, "utf8");
console.log("Created:", target);
