import { describe, it, expect } from "vitest";
import { resolveEffectiveTheme } from "../../frontend/src/lib/theme";

describe("resolveEffectiveTheme", () => {
  it("returns light or dark for explicit preferences", () => {
    expect(resolveEffectiveTheme("light")).toBe("light");
    expect(resolveEffectiveTheme("dark")).toBe("dark");
  });

  it("returns a valid theme for system preference", () => {
    const theme = resolveEffectiveTheme("system");
    expect(theme === "light" || theme === "dark").toBe(true);
  });
});
