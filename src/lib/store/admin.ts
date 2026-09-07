export type StoreManagementRole = "owner" | "admin";

export function isStoreManagementRole(
  role: unknown,
): role is StoreManagementRole {
  return role === "owner" || role === "admin";
}

export function storePostLoginDestination(
  role: unknown,
  customerDestination: string,
) {
  return isStoreManagementRole(role)
    ? "/app/tienda"
    : customerDestination;
}
