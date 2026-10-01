import { describe, expect, it } from "vitest";
import { formDataChanged, passwordField, textField } from "./form-state";

describe("Form text handling", () => {
  it("preserves every password character while trimming ordinary text", () => {
    const form = new FormData();
    form.set("password", "  Secure password  ");
    form.set("email", "  owner@example.com  ");
    expect(passwordField(form, "password")).toBe("  Secure password  ");
    expect(textField(form, "email")).toBe("owner@example.com");
  });
  it("does not coerce files or missing passwords", () => {
    const form = new FormData();
    form.set("password", new Blob(["secret"]));
    expect(passwordField(form, "password")).toBe("");
    expect(passwordField(form, "missing")).toBe("");
  });
});

describe("Protection from late form resets", () => {
  it("detects text entered after the submitted snapshot", () => {
    const submitted = new FormData();
    submitted.set("phone", "3511234567");
    const current = new FormData();
    current.set("phone", "3519999999");
    expect(formDataChanged(current, submitted)).toBe(true);
  });
  it("accepts identical fields regardless of key order", () => {
    const submitted = new FormData();
    submitted.set("name", "Audit"); submitted.set("phone", "351");
    const current = new FormData();
    current.set("phone", "351"); current.set("name", "Audit");
    expect(formDataChanged(current, submitted)).toBe(false);
  });
  it("detects added fields and changed multiple selections", () => {
    const submitted = new FormData();
    submitted.append("tag", "one");
    const current = new FormData();
    current.append("tag", "one"); current.append("tag", "two");
    expect(formDataChanged(current, submitted)).toBe(true);
    current.delete("tag"); current.set("note", "new");
    expect(formDataChanged(current, submitted)).toBe(true);
  });
  it("compares file metadata without coercing it to text", () => {
    const submitted = new FormData(); submitted.set("image", new File(["one"], "one.png", { lastModified: 1 }));
    const current = new FormData(); current.set("image", new File(["two"], "two.png", { lastModified: 2 }));
    expect(formDataChanged(current, submitted)).toBe(true);
    current.set("image", submitted.get("image")!);
    expect(formDataChanged(current, submitted)).toBe(false);
  });
});
