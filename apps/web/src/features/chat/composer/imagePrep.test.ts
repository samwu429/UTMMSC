import { CHAT_IMAGE_MAX_BYTES } from '@utmmsc/shared';
import { describe, expect, it } from 'vitest';
import { IMAGE_LONG_EDGE_MAX, IMAGE_PICK_ACCEPT, checkImageFile, jpegFileName, planDownscale, shrinkForRetry } from './imagePrep';

const MB = 1024 * 1024;

describe('IMAGE_PICK_ACCEPT', () => {
  it('lists exactly the types that make iOS convert HEIC', () => {
    expect(IMAGE_PICK_ACCEPT).toBe('image/jpeg,image/png,image/webp,image/gif');
  });
});

describe('checkImageFile', () => {
  it('rejects types the server does not store', () => {
    expect(checkImageFile({ type: 'image/heic', size: MB })).toBe('type');
    expect(checkImageFile({ type: '', size: MB })).toBe('type');
  });

  it('rejects only GIFs over the byte limit, since other types are shrunk', () => {
    expect(checkImageFile({ type: 'image/gif', size: CHAT_IMAGE_MAX_BYTES + 1 })).toBe('size');
    expect(checkImageFile({ type: 'image/gif', size: CHAT_IMAGE_MAX_BYTES })).toBeNull();
    expect(checkImageFile({ type: 'image/jpeg', size: 12 * MB })).toBeNull();
  });
});

describe('planDownscale', () => {
  it('keeps small images as they are', () => {
    expect(planDownscale(4000, 3000, 3 * MB, 'image/jpeg')).toBeNull();
    expect(planDownscale(IMAGE_LONG_EDGE_MAX, 1000, CHAT_IMAGE_MAX_BYTES, 'image/png')).toBeNull();
  });

  it('re-encodes at the same size when only the byte limit is passed', () => {
    expect(planDownscale(4000, 3000, 12 * MB, 'image/jpeg')).toEqual({ width: 4000, height: 3000 });
    expect(planDownscale(1000, 800, CHAT_IMAGE_MAX_BYTES + 1, 'image/webp')).toEqual({ width: 1000, height: 800 });
  });

  it('scales the long edge down to 4096px and keeps the ratio', () => {
    expect(planDownscale(4097, 1000, MB, 'image/jpeg')).toEqual({ width: 4096, height: 1000 });
    expect(planDownscale(8192, 6144, 20 * MB, 'image/jpeg')).toEqual({ width: 4096, height: 3072 });
    expect(planDownscale(3000, 9000, 2 * MB, 'image/png')).toEqual({ width: 1365, height: 4096 });
    expect(planDownscale(100_000, 10, MB, 'image/png')).toEqual({ width: 4096, height: 1 });
  });

  it('never re-encodes a GIF or an unreadable size', () => {
    expect(planDownscale(9000, 9000, 20 * MB, 'image/gif')).toBeNull();
    expect(planDownscale(0, 100, 20 * MB, 'image/jpeg')).toBeNull();
    expect(planDownscale(Number.NaN, 100, 20 * MB, 'image/jpeg')).toBeNull();
  });
});

describe('shrinkForRetry and jpegFileName', () => {
  it('shrinks both edges and never reaches zero', () => {
    expect(shrinkForRetry({ width: 4096, height: 3072 })).toEqual({ width: 3072, height: 2304 });
    expect(shrinkForRetry({ width: 1, height: 1 })).toEqual({ width: 1, height: 1 });
  });

  it('renames the file to .jpg', () => {
    expect(jpegFileName('IMG_0001.PNG')).toBe('IMG_0001.jpg');
    expect(jpegFileName('photo.final.webp')).toBe('photo.final.jpg');
    expect(jpegFileName('')).toBe('image.jpg');
    expect(jpegFileName('.png')).toBe('image.jpg');
  });
});
