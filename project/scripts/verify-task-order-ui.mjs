import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

const expectations = [
  {
    name: "dashboard uses task order title",
    pass: app.includes('title="任务制作顺序"'),
  },
  {
    name: "priority label removed from detail form",
    pass: !app.includes(">优先级<"),
  },
  {
    name: "priority label removed from dashboard list",
    pass: !app.includes("高优先级任务"),
  },
  {
    name: "module cards use move controls",
    pass: app.includes("上移") && app.includes("下移"),
  },
  {
    name: "module cards keep drag handle",
    pass: app.includes("drag-handle"),
  },
  {
    name: "dashboard list supports sorting controls",
    pass: app.includes("moveDashboardTask") && app.includes("reorderDashboardTask"),
  },
];

const failed = expectations.filter((item) => !item.pass);

if (failed.length) {
  console.error("Verification failed:");
  for (const item of failed) {
    console.error(`- ${item.name}`);
  }
  process.exit(1);
}

console.log("Verification passed.");
