// Paired iPhones from `xcrun devicectl`, and installing an IPA onto one.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function parseDevices(data) {
  return (data?.result?.devices ?? []).map((dev) => {
    const conn = dev.connectionProperties ?? {};
    const hw = dev.hardwareProperties ?? {};
    const props = dev.deviceProperties ?? {};
    const transport = conn.transportType ?? '';
    return {
      id: dev.identifier,
      udid: hw.udid ?? '',
      name: props.name ?? 'iPhone',
      model: hw.marketingName ?? hw.productType ?? '',
      type: hw.deviceType ?? '',
      transport,
      wifi: transport === 'localNetwork',
      wired: transport === 'wired',
      paired: conn.pairingState === 'paired',
    };
  });
}

export function pickDevice(devices, { preferred, wifiOnly } = {}) {
  const phones = devices.filter((item) => item.type === 'iPhone' && item.paired);
  const pool = wifiOnly ? phones.filter((item) => item.wifi) : phones;
  if (!pool.length) return null;
  if (preferred) return pool.find((item) => item.id === preferred || item.udid === preferred || item.name === preferred) ?? null;
  return pool.find((item) => item.wifi) ?? pool.find((item) => item.wired) ?? pool[0];
}

export function preferredDeviceId() {
  if (process.env.MACBUILD_DEVICE) return process.env.MACBUILD_DEVICE;
  try {
    return readFileSync(join(homedir(), '.config/macbuild/env'), 'utf8').match(/^MACBUILD_DEVICE=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  } catch {
    return '';
  }
}

export async function listDevices() {
  const dir = mkdtempSync(join(tmpdir(), 'macbuild-devicectl-'));
  const file = join(dir, 'devices.json');
  try {
    await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', file], { timeout: 20000 });
    return parseDevices(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function installError(error) {
  const text = `${error.stderr ?? ''}\n${error.stdout ?? ''}\n${error.message}`;
  const line = text.split('\n').map((item) => item.trim()).filter(Boolean)
    .find((item) => /error|failed|unable|not found|timed out|denied/i.test(item))
    ?? text.split('\n').map((item) => item.trim()).find(Boolean)
    ?? 'Install failed';
  return line.replace(/^error:\s*/i, '').slice(0, 240);
}

export async function installIpa(ipa, device) {
  if (!existsSync(ipa)) throw new Error('Build file was removed');
  const scratch = mkdtempSync(join(tmpdir(), 'macbuild-install-'));
  try {
    await run('unzip', ['-qo', ipa, 'Payload/*', '-d', scratch], { timeout: 60000 });
    const payload = join(scratch, 'Payload');
    const apps = existsSync(payload) ? readdirSync(payload).filter((name) => name.endsWith('.app')) : [];
    if (apps.length !== 1) throw new Error('IPA must contain one app bundle');
    await run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.id, join(payload, apps[0])], {
      timeout: 180000,
      maxBuffer: 1 << 20,
    });
    return { device: device.id, name: device.name, transport: device.transport };
  } catch (error) {
    throw new Error(installError(error));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function tryInstall(ipa, { wifiOnly, preferred } = {}) {
  const devices = await listDevices();
  const device = pickDevice(devices, { preferred: preferred || preferredDeviceId(), wifiOnly });
  if (!device) return { at: Date.now(), error: wifiOnly ? 'iPhone isn’t on Wi-Fi' : 'No paired iPhone' };
  try {
    return { at: Date.now(), ...(await installIpa(ipa, device)) };
  } catch (error) {
    return { at: Date.now(), device: device.id, name: device.name, transport: device.transport, error: error.message };
  }
}
