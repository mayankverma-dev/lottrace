import { useAuthStore } from '../stores/auth.store.js';

export const ROLE_PERMISSIONS = {
  org_admin: ['*'],
  compliance_manager: [
    'lots.*',
    'events.*',
    'trace.*',
    'reports.*',
    'recall.*',
    'audit.read',
    'imports.*',
    'locations.read',
    'locations.create',
    'locations.update',
    'products.read',
    'products.create',
    'products.update',
    'settings.read',
    'users.read',
  ],
  operator: [
    'lots.read',
    'lots.create',
    'events.create',
    'events.read',
    'trace.read',
    'reports.read',
    'locations.read',
    'products.read',
  ],
  auditor: [
    'lots.read',
    'events.read',
    'trace.read',
    'audit.read',
    'reports.read',
    'recall.read',
    'imports.read',
    'locations.read',
    'products.read',
  ],
};

export const hasPermission = (role, permission) => {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes('*') || permissions.includes(permission) ||
    permissions.some((item) => item.endsWith('.*') && permission.startsWith(item.slice(0, -2)));
};

export const usePermissions = () => {
  const { user } = useAuthStore();
  const can = (permission) => {
    if (!user) return false;
    return hasPermission(user.role, permission);
  };
  return { can, role: user?.role };
};
