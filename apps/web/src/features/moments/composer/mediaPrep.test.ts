import { describe, expect, it } from 'vitest';
import { MOMENT_VIDEO_MAX_BYTES } from '@utmmsc/shared';
import { ImagePrepError } from '../../chat/composer/imagePrep';
import {
  LIBRARY_ACCEPT,
  mediaKindOf,
  needsPhotoPreview,
  pickProblemText,
  pickedContentType,
  planPick,
  prepProblemText,
  previewSize,
  validDimension,
  validDurationMs,
} from './mediaPrep';

const zh = (text: string) => text;
const en = (_zh: string, text: string) => text;

function file(name: string, type: string, bytes = 10): File {
  return new File(['x'.repeat(bytes)], name, { type });
}

/** A file that claims `bytes` without holding them, for the 25MB limit. */
/** 声称有 `bytes` 字节而不真正占用内存的文件，用于测试 25MB 的上限。 */
function sized(name: string, type: string, bytes: number): File {
  const item = file(name, type);
  Object.defineProperty(item, 'size', { value: bytes });
  return item;
}

const photo = (name = 'a.jpg') => file(name, 'image/jpeg');
const video = (name = 'v.mp4') => file(name, 'video/mp4');

describe('picked content types', () => {
  it('keeps the types the server takes and maps the odd ones', () => {
    expect(pickedContentType({ type: 'image/png', name: 'x' })).toBe('image/png');
    expect(pickedContentType({ type: 'image/jpg', name: 'x' })).toBe('image/jpeg');
    expect(pickedContentType({ type: 'video/quicktime', name: 'x.mov' })).toBe('video/quicktime');
    expect(pickedContentType({ type: 'image/heic', name: 'x.heic' })).toBe('');
    expect(pickedContentType({ type: 'video/3gpp', name: 'x.3gp' })).toBe('');
  });

  it('reads the extension when the picker gives no type or a generic one', () => {
    expect(pickedContentType({ type: '', name: 'IMG_1.JPG' })).toBe('image/jpeg');
    expect(pickedContentType({ type: '', name: 'clip.mov' })).toBe('video/quicktime');
    expect(pickedContentType({ type: 'application/octet-stream', name: 'clip.mp4' })).toBe('video/mp4');
    expect(pickedContentType({ type: '', name: 'notes' })).toBe('');
  });

  it('tells photos from videos', () => {
    expect(mediaKindOf('image/gif')).toBe('image');
    expect(mediaKindOf('video/webm')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBeNull();
  });

  it('lets the library offer photos and the three video types', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm']) {
      expect(LIBRARY_ACCEPT.split(',')).toContain(type);
    }
  });
});

describe('planning a pick', () => {
  const empty = { kind: null, count: 0 } as const;

  it('takes up to nine photos', () => {
    const plan = planPick(Array.from({ length: 11 }, (_, index) => photo(`p${index}.jpg`)), empty);
    expect(plan.accepted).toHaveLength(9);
    expect(plan.accepted.map((item) => item.file.name)).toEqual(Array.from({ length: 9 }, (_, index) => `p${index}.jpg`));
    expect(plan.problems).toEqual(['too_many']);
  });

  it('counts the tiles already there', () => {
    const plan = planPick([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], { kind: 'image', count: 7 });
    expect(plan.accepted.map((item) => item.file.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(plan.problems).toEqual(['too_many']);
    expect(planPick([photo()], { kind: 'image', count: 9 })).toEqual({ accepted: [], problems: ['too_many'] });
  });

  it('keeps the photos of a mixed pick', () => {
    const plan = planPick([video(), photo('a.jpg'), photo('b.jpg')], empty);
    expect(plan.accepted.map((item) => [item.file.name, item.kind])).toEqual([
      ['a.jpg', 'image'],
      ['b.jpg', 'image'],
    ]);
    expect(plan.problems).toEqual(['mixed']);
  });

  it('lets the tiles already there decide the kind', () => {
    expect(planPick([video()], { kind: 'image', count: 2 })).toEqual({ accepted: [], problems: ['mixed'] });
    expect(planPick([photo()], { kind: 'video', count: 1 })).toEqual({ accepted: [], problems: ['mixed'] });
    expect(planPick([video('w.mp4')], { kind: 'video', count: 1 })).toEqual({ accepted: [], problems: ['one_video'] });
  });

  it('takes one video and refuses a second', () => {
    const plan = planPick([video('a.mp4'), video('b.mp4')], empty);
    expect(plan.accepted.map((item) => item.file.name)).toEqual(['a.mp4']);
    expect(plan.problems).toEqual(['one_video']);
  });

  it('refuses a video over 25MB, and takes the next one that fits', () => {
    const big = sized('big.mov', 'video/quicktime', MOMENT_VIDEO_MAX_BYTES + 1);
    expect(planPick([big], empty)).toEqual({ accepted: [], problems: ['video_too_large'] });
    const plan = planPick([big, sized('ok.mp4', 'video/mp4', MOMENT_VIDEO_MAX_BYTES)], empty);
    expect(plan.accepted.map((item) => item.file.name)).toEqual(['ok.mp4']);
    expect(plan.problems).toEqual(['video_too_large']);
  });

  it('refuses types the server does not take, once', () => {
    const plan = planPick([file('a.heic', 'image/heic'), file('b.heic', 'image/heic'), photo('c.jpg')], empty);
    expect(plan.accepted.map((item) => item.file.name)).toEqual(['c.jpg']);
    expect(plan.problems).toEqual(['unsupported']);
    expect(planPick([file('doc.pdf', 'application/pdf')], empty)).toEqual({ accepted: [], problems: ['unsupported'] });
  });

  it('relabels a file whose type had to be guessed, and keeps a right one as it is', () => {
    const guessed = file('IMG_2.JPG', '');
    const [relabelled] = planPick([guessed], empty).accepted;
    expect(relabelled?.contentType).toBe('image/jpeg');
    expect(relabelled?.file.type).toBe('image/jpeg');
    expect(relabelled?.file).not.toBe(guessed);
    const right = photo();
    expect(planPick([right], empty).accepted[0]?.file).toBe(right);
  });

  it('accepts nothing from an empty pick', () => {
    expect(planPick([], empty)).toEqual({ accepted: [], problems: [] });
  });
});

describe('problem copy', () => {
  it('says the design copy in both languages', () => {
    expect(pickProblemText('mixed', zh)).toBe('照片和视频不能发在同一条里');
    expect(pickProblemText('mixed', en)).toBe("Photos and a video can't share one post");
    expect(pickProblemText('video_too_large', zh)).toBe('视频不能超过 25MB，可以先在相册里剪短');
    expect(pickProblemText('video_too_large', en)).toBe('Videos must be 25 MB or less. Trim it in your library first');
    expect(pickProblemText('too_many', zh)).toBe('最多 9 张照片');
  });

  it('explains a photo that could not be prepared', () => {
    expect(prepProblemText(new ImagePrepError('type'), zh)).toBe(pickProblemText('unsupported', zh));
    expect(prepProblemText(new ImagePrepError('size'), zh)).toBe('照片不能超过 8MB');
    expect(prepProblemText(new ImagePrepError('invalid'), zh)).toBe('有照片或视频无法使用，请重新选择');
    expect(prepProblemText(new Error('boom'), en)).toBe("A photo or video can't be used. Choose it again");
  });
});

describe('sizes and lengths', () => {
  it('scales the long edge down to 720 and never up', () => {
    expect(previewSize(4032, 3024)).toEqual({ width: 720, height: 540 });
    expect(previewSize(1080, 1920)).toEqual({ width: 405, height: 720 });
    expect(previewSize(600, 400)).toEqual({ width: 600, height: 400 });
    expect(previewSize(10000, 10)).toEqual({ width: 720, height: 1 });
  });

  it('makes a preview unless the photo already is one', () => {
    expect(needsPhotoPreview('image/jpeg', 4032, 3024)).toBe(true);
    expect(needsPhotoPreview('image/jpeg', 720, 540)).toBe(false);
    expect(needsPhotoPreview('image/png', 300, 300)).toBe(true);
    // The grid shows a GIF's first frame, so even a small one gets a still preview.
    // 网格显示 GIF 的第一帧，因此即使很小的 GIF 也要生成静止的预览图。
    expect(needsPhotoPreview('image/gif', 200, 200)).toBe(true);
  });

  it('sends only sizes the server takes', () => {
    expect(validDimension(1080)).toBe(1080);
    expect(validDimension(719.6)).toBe(720);
    expect(validDimension(0)).toBeNull();
    expect(validDimension(20001)).toBeNull();
    expect(validDimension(Number.NaN)).toBeNull();
  });

  it('sends only lengths the server takes', () => {
    expect(validDurationMs(15.2)).toBe(15200);
    expect(validDurationMs(0)).toBe(0);
    expect(validDurationMs(600)).toBe(600_000);
    expect(validDurationMs(600.5)).toBeNull();
    expect(validDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(validDurationMs(Number.NaN)).toBeNull();
    expect(validDurationMs(-1)).toBeNull();
  });
});
