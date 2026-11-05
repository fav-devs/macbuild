import { pathToFileURL } from 'node:url';
import { readProfiles } from './profile.mjs';

export function updateOptions(file, { profile = 'production', channel, environment, message, ref, platform = 'all' }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 1000) throw new Error('OTA needs a message (1–1000 characters).');
  if (typeof ref !== 'string' || !/^[\w./-]{1,200}$/.test(ref) || ref.startsWith('-') || ref.includes('..')) throw new Error('OTA needs --ref with a pushed branch or commit.');
  if (!['ios', 'android', 'all'].includes(platform)) throw new Error('OTA platform must be ios, android, or all.');
  const chosen = readProfiles(file).find((item) => item.name === profile);
  if (!chosen) throw new Error(`Unknown OTA build profile: ${profile}`);
  if (chosen.developmentClient) throw new Error('Development clients load from Metro; choose a preview or production profile for OTA.');
  if (typeof channel !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(channel)) throw new Error('OTA needs --channel with the destination channel.');
  if (!chosen.channel || chosen.channel !== channel) throw new Error(`Choose a build profile configured for channel ${channel}.`);
  environment ||= chosen.environment || (['production', 'preview', 'development'].includes(channel) ? channel : '');
  if (!['production', 'preview', 'development'].includes(environment)) throw new Error('Choose an OTA environment: production, preview, or development.');
  return { profile, channel, environment, message: message.trim(), ref, platform };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, profile, channel, environment, message, ref, platform] = process.argv.slice(2);
    const opts = updateOptions(file, { profile, channel, environment, message, ref, platform });
    console.log(`channel=${opts.channel}\nenvironment=${opts.environment}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
