package com.utmmsc.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;
import java.io.IOException;
import java.util.Locale;

/**
 * Takes the photo for an image input with capture, such as the chat 拍摄 button, and keeps it in the app's private cache.
 * Capacitor does this only for accept="image/*", and it keeps every shot in external storage, which other apps can read
 * on older Android and which is never cleaned up.
 * 为带 capture 的图片输入框（例如聊天的拍摄按钮）拍照，并把照片放在应用私有缓存中。
 * Capacitor 只对 accept="image/*" 这样做，而且把每张照片留在外部存储中；旧版安卓上其他应用可以读取那里，且从不清理。
 */
final class PhotoCaptureChromeClient extends BridgeWebChromeClient {

    private static final String PHOTO_DIR = "camera";

    private final Bridge bridge;
    private final ActivityResultLauncher<Intent> cameraLauncher;
    private ValueCallback<Uri[]> pendingCallback;
    private File pendingPhoto;
    private Uri pendingPhotoUri;

    PhotoCaptureChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        cameraLauncher = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onCameraResult);
    }

    /**
     * Deletes the photos of earlier sessions. Call it before the new WebView can take a photo; the old WebView,
     * the only reader of those files, is gone by then.
     * 删除之前会话的照片。须在新的 WebView 能拍照之前调用；此时唯一读取这些文件的旧 WebView 已经不在。
     */
    static void deleteOldPhotos(Context context) {
        deleteFiles(new File(context.getCacheDir(), PHOTO_DIR), null);
        // Earlier builds let Capacitor keep shots here, named JPEG_*.jpg.
        // 早期版本让 Capacitor 把照片留在这里，文件名为 JPEG_*.jpg。
        File legacyDir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (legacyDir != null) {
            deleteFiles(legacyDir, "JPEG_");
        }
    }

    private static void deleteFiles(File dir, String namePrefix) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (file.isFile() && (namePrefix == null || file.getName().startsWith(namePrefix))) {
                file.delete();
            }
        }
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
        if (!takesPhoto(fileChooserParams)) {
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }
        if (launchCamera(filePathCallback)) {
            return true;
        }
        // No camera app, so the member picks an existing photo instead.
        // 没有相机应用，改为让成员选择已有的照片。
        return super.onShowFileChooser(webView, filePathCallback, new PickOnlyParams(fileChooserParams));
    }

    /** True for every input Capacitor would take a photo for, and for image inputs that list exact types. */
    /** 对 Capacitor 会为其拍照的输入框，以及列出具体图片类型的图片输入框，返回 true。 */
    private static boolean takesPhoto(FileChooserParams params) {
        if (!params.isCaptureEnabled()) {
            return false;
        }
        boolean sawImage = false;
        for (String acceptType : params.getAcceptTypes()) {
            String type = acceptType.trim().toLowerCase(Locale.ROOT);
            if (type.equals("video/*")) {
                return false;
            }
            if (type.startsWith("image/")) {
                sawImage = true;
            }
        }
        return sawImage;
    }

    private boolean launchCamera(ValueCallback<Uri[]> filePathCallback) {
        Activity activity = bridge.getActivity();
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(activity.getPackageManager()) == null) {
            return false;
        }
        File photo;
        Uri photoUri;
        try {
            File dir = new File(activity.getCacheDir(), PHOTO_DIR);
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return false;
            }
            photo = File.createTempFile("JPEG_", ".jpg", dir);
            photoUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", photo);
        } catch (IOException | IllegalArgumentException e) {
            return false;
        }
        intent.putExtra(MediaStore.EXTRA_OUTPUT, photoUri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        pendingCallback = filePathCallback;
        pendingPhoto = photo;
        pendingPhotoUri = photoUri;
        try {
            cameraLauncher.launch(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            pendingCallback = null;
            pendingPhoto = null;
            pendingPhotoUri = null;
            photo.delete();
            return false;
        }
    }

    private void onCameraResult(ActivityResult result) {
        ValueCallback<Uri[]> callback = pendingCallback;
        File photo = pendingPhoto;
        Uri photoUri = pendingPhotoUri;
        pendingCallback = null;
        pendingPhoto = null;
        pendingPhotoUri = null;
        if (callback == null) {
            return;
        }
        if (result.getResultCode() == Activity.RESULT_OK && photo.length() > 0) {
            callback.onReceiveValue(new Uri[] { photoUri });
        } else {
            photo.delete();
            callback.onReceiveValue(null);
        }
    }

    private static final class PickOnlyParams extends FileChooserParams {

        private final FileChooserParams original;

        PickOnlyParams(FileChooserParams original) {
            this.original = original;
        }

        @Override
        public int getMode() {
            return original.getMode();
        }

        @Override
        public String[] getAcceptTypes() {
            return original.getAcceptTypes();
        }

        @Override
        public boolean isCaptureEnabled() {
            return false;
        }

        @Override
        public CharSequence getTitle() {
            return original.getTitle();
        }

        @Override
        public String getFilenameHint() {
            return original.getFilenameHint();
        }

        @Override
        public Intent createIntent() {
            return original.createIntent();
        }
    }
}
