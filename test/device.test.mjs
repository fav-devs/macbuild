import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevices, pickDevice } from '../lib/device.mjs';

const phone = (over = {}) => ({
  identifier: over.id ?? 'id-1',
  connectionProperties: { pairingState: 'paired', transportType: over.transport ?? 'localNetwork' },
  deviceProperties: { name: over.name ?? 'Phone' },
  hardwareProperties: { deviceType: 'iPhone', udid: over.udid ?? 'udid-1', marketingName: 'iPhone 14' },
});

test('parseDevices reads name, wifi and pairing from devicectl JSON', () => {
  const [device] = parseDevices({ result: { devices: [phone()] } });
  assert.equal(device.name, 'Phone');
  assert.equal(device.wifi, true);
  assert.equal(device.wired, false);
  assert.equal(device.paired, true);
});

test('pickDevice prefers MACBUILD_DEVICE, then Wi-Fi, and skips USB when wifiOnly', () => {
  const wifi = parseDevices({ result: { devices: [phone({ id: 'wifi', name: 'Wi-Fi Phone' })] } })[0];
  const usb = parseDevices({ result: { devices: [phone({ id: 'usb', name: 'USB Phone', transport: 'wired' })] } })[0];
  assert.equal(pickDevice([usb, wifi]).id, 'wifi');
  assert.equal(pickDevice([usb, wifi], { preferred: 'usb' }).id, 'usb');
  assert.equal(pickDevice([usb], { wifiOnly: true }), null);
  assert.equal(pickDevice([usb, wifi], { preferred: 'usb', wifiOnly: true }), null);
  assert.equal(pickDevice([usb, wifi], { preferred: 'wifi', wifiOnly: true }).id, 'wifi');
});
