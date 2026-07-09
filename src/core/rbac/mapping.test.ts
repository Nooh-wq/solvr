// src/core/rbac/mapping.test.ts
//
// Unit tests for mapRoleNameToRlsRole. Uses node:test (built-in since
// Node 18, stable since 20) + node:assert/strict so this suite runs
// without adding a test-runner dependency. Execute with:
//
//   node --import tsx --test src/core/rbac/mapping.test.ts
//
// tsx (already a devDependency) provides the TS→JS transform via the
// --import loader hook.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapRoleNameToRlsRole } from "./mapping";

describe("mapRoleNameToRlsRole — standard-role names elevate", () => {
  it("'Super Admin' → SUPER_ADMIN", () => {
    assert.equal(mapRoleNameToRlsRole("Super Admin"), "SUPER_ADMIN");
  });

  it("'Admin' → ADMIN", () => {
    assert.equal(mapRoleNameToRlsRole("Admin"), "ADMIN");
  });

  it("'Agent' → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole("Agent"), "AGENT");
  });
});

describe("mapRoleNameToRlsRole — safe-fallback invariant (custom + malformed names demote to AGENT)", () => {
  it("empty string → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole(""), "AGENT");
  });

  it("a custom role name → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole("Billing Specialist"), "AGENT");
  });

  it("case mismatch: 'super admin' (lowercased) → AGENT", () => {
    // Prevents a case-fuzzed custom name from grabbing SUPER_ADMIN.
    assert.equal(mapRoleNameToRlsRole("super admin"), "AGENT");
  });

  it("case mismatch: 'ADMIN' (uppercased) → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole("ADMIN"), "AGENT");
  });

  it("whitespace-padded: 'Admin ' (trailing space) → AGENT", () => {
    // No trim() — an admin creating "Admin " as a custom role name
    // must not silently inherit Admin privileges.
    assert.equal(mapRoleNameToRlsRole("Admin "), "AGENT");
  });

  it("whitespace-padded: ' Admin' (leading space) → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole(" Admin"), "AGENT");
  });

  it("enum-form value 'SUPER_ADMIN' passed as name → AGENT", () => {
    // Guards against a custom role literally named "SUPER_ADMIN"
    // (the enum spelling) grabbing SUPER_ADMIN via loose matching.
    // Only the human-facing standard-role names elevate.
    assert.equal(mapRoleNameToRlsRole("SUPER_ADMIN"), "AGENT");
  });

  it("similar-but-different: 'Super-Admin' (hyphen) → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole("Super-Admin"), "AGENT");
  });

  it("similar-but-different: 'SuperAdmin' (no space) → AGENT", () => {
    assert.equal(mapRoleNameToRlsRole("SuperAdmin"), "AGENT");
  });

  it("Unicode look-alike does not match: 'Аdmin' (Cyrillic А) → AGENT", () => {
    // The first character is Cyrillic U+0410, not Latin U+0041.
    // String equality is byte-exact, so this correctly demotes.
    assert.equal(mapRoleNameToRlsRole("Аdmin"), "AGENT");
  });
});

describe("mapRoleNameToRlsRole — return type is narrow", () => {
  it("never returns CLIENT or GUEST (those come from non-TeamMember paths)", () => {
    // Exhaustive check over the type-level invariant. If the function
    // ever widened its return set, this loop would need to update — the
    // test acts as a change-detector at the RBAC boundary.
    const outputs = [
      mapRoleNameToRlsRole("Super Admin"),
      mapRoleNameToRlsRole("Admin"),
      mapRoleNameToRlsRole("Agent"),
      mapRoleNameToRlsRole("custom"),
      mapRoleNameToRlsRole(""),
    ];
    const allowed = new Set(["SUPER_ADMIN", "ADMIN", "AGENT"]);
    for (const out of outputs) {
      assert.ok(allowed.has(out), `unexpected return value: ${out}`);
    }
  });
});
