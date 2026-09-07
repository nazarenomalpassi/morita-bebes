import { describe, expect, it } from "vitest";

import {
  isStoreManagementRole,
  storePostLoginDestination,
} from "./admin";

describe("e-commerce management roles", () => {
  it.each(["owner", "admin"])("accepts %s as a store administrator", (role) => {
    expect(isStoreManagementRole(role)).toBe(true);
    expect(storePostLoginDestination(role, "/tienda/cuenta")).toBe(
      "/app/tienda",
    );
  });

  it.each(["staff", "customer", null, undefined])(
    "does not elevate %s to store administrator",
    (role) => {
      expect(isStoreManagementRole(role)).toBe(false);
      expect(storePostLoginDestination(role, "/tienda/cuenta")).toBe(
        "/tienda/cuenta",
      );
    },
  );
});
