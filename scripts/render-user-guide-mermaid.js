"use strict";
/**
 * Reads docs/USER_GUIDE.md, renders ```mermaid``` blocks to PNGs under docs/assets/,
 * and writes a processed Markdown file for Pandoc (embeds images in Word/PDF).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const mdIn =
  process.argv[2] || path.join(root, "docs", "USER_GUIDE.md");
const mdOut =
  process.argv[3] || path.join(root, "docs", "_USER_GUIDE_processed.md");

/** Quote path for cmd.exe on Windows. */
function q(p) {
  return '"' + p.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function main() {
  if (!fs.existsSync(mdIn)) {
    console.error("Missing:", mdIn);
    process.exit(1);
  }

  const assetsDir = path.join(root, "docs", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  let md = fs.readFileSync(mdIn, "utf8");
  const re = /^```mermaid\s*\r?\n([\s\S]*?)```/gm;
  let count = 0;
  md = md.replace(re, (_, body) => {
    count += 1;
    const pngName = `user-guide-flow-${count}.png`;
    const pngPath = path.join(assetsDir, pngName);
    const mmdPath = path.join(assetsDir, `_tmp-${count}.mmd`);
    fs.writeFileSync(mmdPath, body.trimEnd() + "\n", "utf8");

    const cmd = [
      "npx --yes @mermaid-js/mermaid-cli",
      "-i",
      q(mmdPath),
      "-o",
      q(pngPath),
      "-w",
      "1400",
      "-H",
      "900",
      "-b",
      "white",
    ].join(" ");

    execSync(cmd, { cwd: root, stdio: "inherit", shell: true });
    fs.unlinkSync(mmdPath);

    return `\n\n![Flowchart ${count}](assets/${pngName})\n\n`;
  });

  fs.writeFileSync(mdOut, md, "utf8");
  console.log(`Rendered ${count} diagram(s) → ${mdOut}`);
}

main();
