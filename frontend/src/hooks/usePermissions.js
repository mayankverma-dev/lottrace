import { useAuthStore } from '../stores/auth.store';

const ROLE_PERMISSIONS = {
  org_admin:           ['*'],
  compliance_manager:  ['lots.*', 'events.*', 'trace.*', 'reports.*', 'recall.*', 'audit.read', 'imports.*'],
  operator:            ['lots.read', 'lots.create', 'events.create', 'events.read', 'trace.read', 'reports.read'],
  auditor:             ['lots.read', 'events.read', 'trace.read', 'audit.read', 'reports.read'],
};

export const usePermissions = () => {
  const { user } = useAuthStore();
  const can = (permission) => {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role] ?? [];
    return perms.includes('*') || perms.includes(permission) ||
      perms.some(p => p.endsWith('.*') && permission.startsWith(p.slice(0, -2)));
  };
  return { can, role: user?.role };
};
