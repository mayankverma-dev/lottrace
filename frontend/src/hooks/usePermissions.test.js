import assert from 'node:assert/strict';
import test from 'node:test';

import { hasPermission } from './usePermissions.js';

const allowed = {
  org_admin: [
    'locations.read',
    'locations.create',
    'locations.update',
    'products.read',
    'products.create',
    'products.update',
    'settings.read',
    'users.read',
    'users.manage',
  ],
  compliance_manager: [
    'locations.read',
    'locations.create',
    'locations.update',
    'products.read',
    'products.create',
    'products.update',
    'settings.read',
    'users.read',
    'lots.read',
  ],
  operator: [
    'locations.read',
    'products.read',
    'lots.read',
  ],
  auditor: [
    'locations.read',
    'products.read',
    'imports.read',
    'recall.read',
    'lots.read',
  ],
};

for (const [role, permissions] of Object.entries(allowed)) {
  test(`${role} receives expected permissions`, () => {
    for (const permission of permissions) {
      assert.equal(hasPermission(role, permission), true, `${role} should allow ${permission}`);
    }
  });
}

test('compliance_manager cannot manage users', () => {
  assert.equal(hasPermission('compliance_manager', 'users.manage'), false);
});

test('operator cannot mutate master data or access settings', () => {
  assert.equal(hasPermission('operator', 'locations.create'), false);
  assert.equal(hasPermission('operator', 'products.update'), false);
  assert.equal(hasPermission('operator', 'settings.read'), false);
});

test('auditor remains read-only', () => {
  assert.equal(hasPermission('auditor', 'recall.write'), false);
  assert.equal(hasPermission('auditor', 'imports.create'), false);
  assert.equal(hasPermission('auditor', 'users.read'), false);
});

test('wildcards grant matching permissions only', () => {
  assert.equal(hasPermission('compliance_manager', 'events.amend'), true);
  assert.equal(hasPermission('compliance_manager', 'billing.read'), false);
});

test('unknown and unauthenticated roles receive no permissions', () => {
  assert.equal(hasPermission('unknown', 'lots.read'), false);
  assert.equal(hasPermission(null, 'lots.read'), false);
  assert.equal(hasPermission(undefined, 'lots.read'), false);
});
