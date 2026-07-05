/**
 * One-off helper: replace hardcoded palette colors with CSS theme variables.
 * Safe to re-run; skips files that no longer contain hex literals.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("frontend/src");

const SKIP = new Set([
  path.normalize("frontend/src/invoice/taxInvoicePrint.css"),
]);

const REPLACEMENTS = [
  ["1px solid #f5f4f0", "1px solid var(--border)"],
  ["rgba(37,99,235,0.08)", "var(--accent-soft-bg)"],
  ["rgba(37, 99, 235, 0.08)", "var(--accent-soft-bg)"],
  ["rgba(37,99,235,0.10)", "var(--info-soft)"],
  ["rgba(37, 99, 235, 0.10)", "var(--info-soft)"],
  ["rgba(37,99,235,0.12)", "var(--accent-soft)"],
  ["rgba(37, 99, 235, 0.12)", "var(--accent-soft)"],
  ["rgba(220, 38, 38, 0.12)", "var(--danger-soft)"],
  ["rgba(220, 38, 38, 0.35)", "var(--danger-border)"],
  ["rgba(15, 23, 42, 0.45)", "var(--overlay-scrim)"],
  ["rgba(15, 23, 42, 0.35)", "var(--overlay-scrim)"],
  ["rgba(28, 25, 23, 0.45)", "var(--overlay-scrim)"],
  ["rgba(0,0,0,0.2)", "var(--shadow-color)"],
  ["rgba(0, 0, 0, 0.2)", "var(--shadow-color)"],
  ["rgba(0,0,0,0.15)", "var(--shadow-color)"],
  ["rgba(0, 0, 0, 0.15)", "var(--shadow-color)"],
  ["#fef2f2", "var(--danger-soft-solid)"],
  ["#fecaca", "var(--danger-border-solid)"],
  ["#fff7ed", "var(--warning-soft)"],
  ["#fdba74", "var(--warning-border)"],
  ["#fed7aa", "var(--warning-border-light)"],
  ["#9a3412", "var(--warning-text)"],
  ["#dcfce7", "var(--stock-ok-bg)"],
  ["#16a34a", "var(--stock-ok-text)"],
  ["#fef3c7", "var(--stock-low-bg)"],
  ["#d97706", "var(--stock-low-text)"],
  ["#fee2e2", "var(--stock-out-bg)"],
  ["#f3f4f6", "var(--neutral-soft)"],
  ["#d1d5db", "var(--neutral-border)"],
  ["#111827", "var(--neutral-text)"],
  ["#ffffff", "var(--surface)"],
  ["#fafaf9", "var(--surface-subtle)"],
  ["#f5f4f0", "var(--input-disabled)"],
  ["#e7e5e4", "var(--border)"],
  ["#44403c", "var(--text-strong)"],
  ["#78716c", "var(--muted)"],
  ["#a8a29e", "var(--text-faint)"],
  ["#1c1917", "var(--text)"],
  ["#2563eb", "var(--accent)"],
  ["#3b82f6", "var(--accent)"],
  ["#dc2626", "var(--danger-strong)"],
  ["#b91c1c", "var(--danger-text)"],
  ["#cbd5e1", "var(--sidebar-muted)"],
  ["#f0ece8", "var(--border)"],
  ["#f0efee", "var(--border)"],
  ["#ece8e1", "var(--border)"],
  ["#fca5a5", "var(--input-error-border)"],
  ["#fefce8", "var(--caution-soft)"],
  ["#fde047", "var(--caution-border)"],
  ["#854d0e", "var(--caution-text)"],
  ["#fef9ee", "var(--caution-panel)"],
  ["#eff6ff", "var(--info-panel-bg)"],
  ["#1d4ed8", "var(--accent-link)"],
  ["#92400e", "var(--caution-text)"],
  ["#57534e", "var(--muted)"],
  ["#f5f5f4", "var(--input-disabled)"],
  ["#f8fafc", "var(--sidebar-active-text)"],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(process.cwd(), full).replace(/\\/g, "/");
    if (SKIP.has(path.normalize(rel))) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function migrateContent(text) {
  let next = text;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  // background uses surface; text on accent buttons uses on-accent
  next = next.replace(/background:\s*"#fff"/g, 'background: "var(--surface)"');
  next = next.replace(/background:\s*'#fff'/g, "background: 'var(--surface)'");
  next = next.replace(/color:\s*"#fff"/g, 'color: "var(--on-accent)"');
  next = next.replace(/color:\s*'#fff'/g, "color: 'var(--on-accent)'");
  next = next.replace(/borderTopColor:\s*"#fff"/g, 'borderTopColor: "var(--on-accent)"');
  next = next.replace(/:\s*"#fff"/g, ': "var(--surface)"');
  next = next.replace(/:\s*'#fff'/g, ": 'var(--surface)'");
  // Fix ternary text on accent
  next = next.replace(
    /color: selected \? "var\(--on-accent\)" : "var\(--text\)"/g,
    'color: selected ? "var(--on-accent)" : "var(--text)"'
  );
  next = next.replace(
    /color: selected \? "var\(--surface\)" : "var\(--text-strong\)"/g,
    'color: selected ? "var(--on-accent)" : "var(--text-strong)"'
  );
  next = next.replace(
    /color: cart\.length \? "var\(--surface\)" : "var\(--text-faint\)"/g,
    'color: cart.length ? "var(--on-accent)" : "var(--text-faint)"'
  );
  next = next.replace(
    /color: loading \? "var\(--muted\)" : "var\(--surface\)"/g,
    'color: loading ? "var(--muted)" : "var(--on-accent)"'
  );
  next = next.replace(
    /color: saving \? "var\(--text-faint\)" : "var\(--surface\)"/g,
    'color: saving ? "var(--text-faint)" : "var(--on-accent)"'
  );
  next = next.replace(
    /color: batchSaving \? "var\(--text-faint\)" : "var\(--surface\)"/g,
    'color: batchSaving ? "var(--text-faint)" : "var(--on-accent)"'
  );
  next = next.replace(
    /color: loading \? "var\(--text-faint\)" : "var\(--surface\)"/g,
    'color: loading ? "var(--text-faint)" : "var(--on-accent)"'
  );
  next = next.replace(/\? "#fff" :/g, '? "var(--surface)" :');
  next = next.replace(/\? '#fff' :/g, "? 'var(--surface)' :");
  next = next.replace(/color: selected \? "#fff"/g, 'color: selected ? "var(--on-accent)"');
  next = next.replace(/color: cart\.length \? "#fff"/g, 'color: cart.length ? "var(--on-accent)"');
  return next;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const before = fs.readFileSync(file, "utf8");
  const after = migrateContent(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed += 1;
    console.log("updated", path.relative(process.cwd(), file));
  }
}
console.log(`Done. ${changed} file(s) updated.`);
