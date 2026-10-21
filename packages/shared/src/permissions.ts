export const ROLES = ["owner", "admin", "sales", "project_manager", "site_staff", "procurement", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:manage",
  "member:manage",
  "lead:read",
  "lead:write",
  "project:read",
  "project:write",
  "project:assign",
  "bom:write",
  "vendor:read",
  "vendor:write",
  "procurement:write",
  "vendor_payment:write",
  "quotation:write",
  "quotation:send",
  "quotation:record",
  "vo:write",
  "vo:record",
  "billing:write",
  "billing:mark_paid",
  "einvoice:submit",
  "file:write",
  "document:send",
  "report:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// The one place role permissions are defined (spec §7). Edit here to change a role.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  sales: ["lead:read", "lead:write", "project:read", "vendor:read"],
  project_manager: [
    "project:read",
    "project:write",
    "bom:write",
    "vendor:read",
    "procurement:write",
    "quotation:write",
    "quotation:send",
    "quotation:record",
    "vo:write",
    "vo:record",
    "file:write",
    "document:send",
  ],
  site_staff: ["project:read", "file:write"],
  procurement: ["project:read", "vendor:read", "vendor:write", "procurement:write", "file:write", "document:send"],
  finance: [
    "project:read",
    "vendor:read",
    "vendor_payment:write",
    "billing:write",
    "billing:mark_paid",
    "einvoice:submit",
    "document:send",
    "report:read",
  ],
};

/** Roles that only see projects they are assigned to. */
export const PROJECT_SCOPED_ROLES: readonly Role[] = ["project_manager", "site_staff"];

/** Roles a project assignment can carry. */
export const ASSIGNABLE_ROLES = ["project_manager", "site_staff"] as const;

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isProjectScoped(role: Role): boolean {
  return PROJECT_SCOPED_ROLES.includes(role);
}