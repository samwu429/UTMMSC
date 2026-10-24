import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ChangeEvent } from 'react';
import { LIBRARY_ACCEPT, PHOTO_CAPTURE_ACCEPT, VIDEO_CAPTURE_ACCEPT } from './mediaPrep';

/**
 * Each method calls input.click() on its hidden input, so call it inside the tap (an ActionSheet option runs
 * inside the click) to keep the user gesture.
 * 每个方法都会对对应的隐藏输入框调用 input.click()，因此要在点击中调用（ActionSheet 的选项就在点击中执行），以保留用户手势。
 */
export interface MediaPickerHandle {
  /** 拍照: accept={IMAGE_PICK_ACCEPT} capture="environment". */
  /** 拍照：accept={IMAGE_PICK_ACCEPT} capture="environment"。 */
  takePhoto(): void;
  /** 录像: accept="video/*" capture. */
  /** 录像：accept="video/*" capture。 */
  recordVideo(): void;
  /** 从相册选择: photos plus MP4, MOV and WebM, several at once. */
  /** 从相册选择：照片以及 MP4、MOV、WebM，可多选。 */
  chooseFromLibrary(): void;
}

export interface MediaPickerProps {
  /** The files picked, in the order given; never called with an empty list. */
  /** 选中的文件，按给出的顺序；不会以空列表调用。 */
  onPicked(files: File[]): void;
}

/**
 * Hidden inputs for photo capture, video capture and the library. 拍照 lists only the photo types, which makes
 * iOS hand over JPEG instead of HEIC, and goes through PhotoCaptureChromeClient in the Android app; 录像 goes
 * to the system camera (Capacitor's chooser on Android). Each input is emptied after a pick, so the same file
 * can be picked again.
 * 用于拍照、录像和相册选择的隐藏输入框。「拍照」只列出照片类型，iOS 因此给出 JPEG 而不是 HEIC，在安卓 App 中经由
 * PhotoCaptureChromeClient；「录像」交给系统相机（安卓上是 Capacitor 的选择器）。每次选择后都会清空输入框，同一个文件可以再次选择。
 */
export const MediaPicker = forwardRef<MediaPickerHandle, MediaPickerProps>(function MediaPicker({ onPicked }, ref) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const pickedRef = useRef(onPicked);

  useLayoutEffect(() => {
    pickedRef.current = onPicked;
  });

  useImperativeHandle(
    ref,
    () => ({
      takePhoto: () => photoRef.current?.click(),
      recordVideo: () => videoRef.current?.click(),
      chooseFromLibrary: () => libraryRef.current?.click(),
    }),
    [],
  );

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) pickedRef.current(files);
  }

  return (
    <>
      <input ref={photoRef} type="file" accept={PHOTO_CAPTURE_ACCEPT} capture="environment" tabIndex={-1} aria-hidden className="hidden" onChange={onChange} />
      <input ref={videoRef} type="file" accept={VIDEO_CAPTURE_ACCEPT} capture tabIndex={-1} aria-hidden className="hidden" onChange={onChange} />
      <input ref={libraryRef} type="file" accept={LIBRARY_ACCEPT} multiple tabIndex={-1} aria-hidden className="hidden" onChange={onChange} />
    </>
  );
});
