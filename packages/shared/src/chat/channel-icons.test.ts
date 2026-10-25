import { describe, expect, it } from 'vitest';
import {
  CHANNEL_ICON_PRESETS,
  channelIconExtension,
  channelIconPresetId,
  channelIconPresetKey,
  channelIconThumbKey,
  isChannelIconKey,
  isChannelIconObjectKey,
  isChannelIconType,
  isChannelIconUploadKey,
} from './channel-icons';

const upload = 'channel-icon/ch_AbCdEfGhIjKlMnOp/cic_0123456789abcdEF.webp';

describe('channel icon presets', () => {
  it('has eight presets with both languages and distinct ids', () => {
    expect(CHANNEL_ICON_PRESETS).toHaveLength(8);
    expect(new Set(CHANNEL_ICON_PRESETS.map((preset) => preset.id)).size).toBe(8);
    for (const preset of CHANNEL_ICON_PRESETS) {
      expect(preset.zh).not.toBe('');
      expect(preset.en).not.toBe('');
    }
  });

  it('round-trips a preset through its stored key', () => {
    for (const preset of CHANNEL_ICON_PRESETS) expect(channelIconPresetId(channelIconPresetKey(preset.id))).toBe(preset.id);
    expect(channelIconPresetKey('announce')).toBe('preset:announce');
  });

  it('reads no preset from uploads, unknown presets or nothing', () => {
    expect(channelIconPresetId('preset:rocket')).toBeNull();
    expect(channelIconPresetId('preset:')).toBeNull();
    expect(channelIconPresetId(upload)).toBeNull();
    expect(channelIconPresetId(null)).toBeNull();
    expect(channelIconPresetId(undefined)).toBeNull();
  });
});

describe('uploaded channel icon keys', () => {
  it('accepts an upload of either type', () => {
    expect(isChannelIconUploadKey(upload)).toBe(true);
    expect(isChannelIconUploadKey(upload.replace('.webp', '.jpg'))).toBe(true);
  });

  it('refuses other folders, types, traversal and names of another shape', () => {
    expect(isChannelIconUploadKey('avatar/ch_1/cic_0123456789abcdEF.webp')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon/ch_1/cic_0123456789abcdEF.png')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon/../cic_0123456789abcdEF.webp')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon/ch_1/../cic_0123456789abcdEF.webp')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon/ch_1/x/cic_0123456789abcdEF.webp')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon/ch_1/cic_short.webp')).toBe(false);
    expect(isChannelIconUploadKey('channel-icon//cic_0123456789abcdEF.webp')).toBe(false);
    expect(isChannelIconUploadKey(`${upload}?x=1`)).toBe(false);
  });

  it('puts the thumbnail beside the upload and never mistakes one for the other', () => {
    const thumb = channelIconThumbKey(upload);
    expect(thumb).toBe('channel-icon/ch_AbCdEfGhIjKlMnOp/cic_0123456789abcdEF-96.webp');
    expect(channelIconThumbKey(upload.replace('.webp', '.jpg'))).toBe('channel-icon/ch_AbCdEfGhIjKlMnOp/cic_0123456789abcdEF-96.jpg');
    expect(isChannelIconUploadKey(thumb)).toBe(false);
    expect(isChannelIconObjectKey(thumb)).toBe(true);
    expect(isChannelIconObjectKey(upload)).toBe(true);
    expect(channelIconThumbKey(thumb)).toBe(thumb);
    expect(channelIconThumbKey('preset:chat')).toBe('preset:chat');
    // A random name that happens to end in -96 is still an upload, since the name has a fixed length.
    expect(isChannelIconUploadKey('channel-icon/ch_1/cic_0123456789abc-96.webp')).toBe(true);
  });

  it('stores only uploads and known presets', () => {
    expect(isChannelIconKey(upload)).toBe(true);
    expect(isChannelIconKey('preset:alumni')).toBe(true);
    expect(isChannelIconKey('preset:rocket')).toBe(false);
    expect(isChannelIconKey(channelIconThumbKey(upload))).toBe(false);
    expect(isChannelIconKey('https://example.com/a.png')).toBe(false);
  });

  it('maps the two types to their extensions', () => {
    expect(channelIconExtension('image/webp')).toBe('webp');
    expect(channelIconExtension('image/jpeg')).toBe('jpg');
    expect(isChannelIconType('image/png')).toBe(false);
    expect(isChannelIconType('image/jpeg')).toBe(true);
  });
});
