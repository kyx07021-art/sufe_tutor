import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as settings from '../src/client/features/settings/actions.js';
import * as admin from '../src/client/features/admin/actions.js';
import * as onboard from '../src/client/features/onboard/actions.js';

test('settings actions exist', () => {
  assert.equal(typeof settings.enterAccountSettings, 'function');
  assert.equal(typeof settings.loadPrivacySettings, 'function');
  assert.equal(typeof settings.submitUsername, 'function');
  assert.equal(typeof settings.openDeviceManager, 'function');
});

test('admin actions exist', () => {
  assert.equal(typeof admin.loadAdminStats, 'function');
  assert.equal(typeof admin.loadAdminDashboard, 'function');
  assert.equal(typeof admin.loadAdminUsers, 'function');
  assert.equal(typeof admin.loadAdminContent, 'function');
});

test('onboard actions exist and returning gate is function', () => {
  assert.equal(typeof onboard.showOnboardingIfNeeded, 'function');
  assert.equal(typeof onboard.startOnboardingTour, 'function');
});
