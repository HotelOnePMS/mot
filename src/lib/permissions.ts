/** What an owner sees under Settings → Permissions (server/services/permissions.ts). Client-safe. */
export interface PermissionSettings {
  propertyId: string;
  permissions: {
    permission: string;
    label: string;
    description: string;
    /** Roles that have it whatever the owner sets (owners, platform admins). */
    always: string[];
    /** Roles the owner can give it to, and whether they have it at this hotel now. */
    roles: { role: string; granted: boolean; grantedBy: string | null; grantedAt: string | null }[];
  }[];
}
