package com.utmmsc.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import java.lang.reflect.Method;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // initialPlugins register after the plugins Capacitor lists from npm, so this one replaces the stock
        // PushNotifications under the same name; registerPlugin() would register first and be replaced instead.
        // initialPlugins 在 Capacitor 从 npm 列出的插件之后注册，因此它会以同名替换原版 PushNotifications；
        // 用 registerPlugin() 则会先注册，反被原版替换。
        initialPlugins.add(AppPushPlugin.class);
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        // Null when the phone has no usable WebView; Capacitor then shows its own notice.
        // 手机没有可用的 WebView 时为 null，此时 Capacitor 会显示自己的提示。
        if (bridge == null) {
            return;
        }

        WebView webView = bridge.getWebView();
        PhotoCaptureChromeClient.deleteOldPhotos(this);
        webView.setWebChromeClient(new PhotoCaptureChromeClient(bridge));
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openOutside(Uri.parse(url)));
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    // The failed page sits behind the offline page; dropping it lets Back leave instead of retrying.
                    // 失败的页面排在离线页之后；清掉它，返回键就会离开应用而不是反复重试。
                    if (view.getUrl() != null && view.getUrl().equals(bridge.getErrorUrl())) {
                        view.clearHistory();
                    }
                }
            }
        );
        getOnBackPressedDispatcher().addCallback(this, new BackCallback(bridge));
    }

    private void openOutside(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed; nothing else can open the file.
            // 没有安装浏览器，没有别的应用能打开这个文件。
        }
    }

    /**
     * Back walks the web history and leaves the app at its first page, like other Android apps.
     * The @capacitor/app plugin alone stays put at the first page, so it only takes over while the page listens for Back.
     * 返回键沿网页历史后退，回到第一页后离开应用，与其他安卓应用一致。
     * 单靠 @capacitor/app 插件时第一页按返回不会有反应，因此只有网页自己监听返回键时才交给它处理。
     */
    private final class BackCallback extends OnBackPressedCallback {

        private final Bridge bridge;

        BackCallback(Bridge bridge) {
            super(true);
            this.bridge = bridge;
        }

        @Override
        public void handleOnBackPressed() {
            WebView webView = bridge.getWebView();
            if (pageListensForBack()) {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            } else if (webView.canGoBack()) {
                webView.goBack();
            } else {
                moveTaskToBack(true);
            }
        }

        private boolean pageListensForBack() {
            PluginHandle app = bridge.getPlugin("App");
            if (app == null || app.getInstance() == null) {
                return false;
            }
            try {
                // Plugin.hasListeners is protected; Capacitor has no public way to ask.
                // Plugin.hasListeners 是 protected 方法，Capacitor 没有公开的查询方式。
                Method hasListeners = Plugin.class.getDeclaredMethod("hasListeners", String.class);
                hasListeners.setAccessible(true);
                return Boolean.TRUE.equals(hasListeners.invoke(app.getInstance(), "backButton"));
            } catch (ReflectiveOperationException e) {
                return false;
            }
        }
    }
}
