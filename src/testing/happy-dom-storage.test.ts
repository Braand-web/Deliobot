// @vitest-environment happy-dom
import { expect, it } from "vitest";

it("reads a key written on localStorage back through window.localStorage", () => {
  localStorage.setItem("odb", "kept");
  expect(window.localStorage.getItem("odb")).toBe("kept");
  localStorage.removeItem("odb");
  expect(window.localStorage.getItem("odb")).toBeNull();
});
