import { expect, test } from "bun:test";
import { setupNextStep } from "../launcher/src/setup-progress";

const installed = { manual: false, signedIn: true, smokePassed: false, installed: true,
  catalogVerified: true, pickerConfirmed: false, toolsInstalled: true, toolsVerified: true, development: false };

test("an installed catalog asks for picker confirmation instead of reinstall or retest", () => {
  expect(setupNextStep(installed)).toBe("confirm");
});
test("a saved installation with no catalog request waits for Codex", () => {
  expect(setupNextStep({ ...installed, catalogVerified: false })).toBe("catalog");
});
test("a new automatic installation still requires a verified reply first", () => {
  expect(setupNextStep({ ...installed, installed: false })).toBe("test");
});
test("manual setup routes missing credentials to tools without probing sign-in", () => {
  expect(setupNextStep({ ...installed, manual: true, signedIn: false, installed: false, toolsInstalled: false })).toBe("tools");
});
test("optional tools do not block a confirmed automatic model installation", () => {
  expect(setupNextStep({ ...installed, pickerConfirmed: true, toolsInstalled: false, toolsVerified: false })).toBe("ready");
});
