package com.utmmsc.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.firebase.FirebaseApp;

/**
 * @capacitor/push-notifications under its own name "PushNotifications", with these changes:
 * register() rejects with code UNAVAILABLE when the APK was built without google-services.json, where the stock
 * plugin throws and Capacitor turns that into an app crash; the "messages" and "events" channels exist from
 * the first launch, so a push never lands in Android's generic channel before the web has created them; before
 * Android 13 the permission reads "denied" when the member turned the app's notifications off, where the stock
 * plugin always says "granted"; and openSettings() opens the app's notification settings.
 * 以 "PushNotifications" 原名提供的 @capacitor/push-notifications，有以下改动：
 * APK 构建时没有 google-services.json 时，register() 以 UNAVAILABLE 拒绝，而原插件会抛出异常并被 Capacitor 变成应用崩溃；
 * 首次启动就建好 "messages" 和 "events" 两个通知渠道，网页创建渠道之前收到的推送也不会落入安卓的通用渠道；
 * Android 13 以前，成员关闭了本应用的通知时权限显示为 "denied"，而原插件总是回答 "granted"；
 * 以及 openSettings() 打开本应用的通知设置。
 */
@CapacitorPlugin(
    name = "PushNotifications",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "receive")
)
public class AppPushPlugin extends PushNotificationsPlugin {

    static final String NOT_CONFIGURED = "Push notifications are not available in this build: Firebase is not configured.";

    static final String CHANNEL_MESSAGES = "messages";
    static final String CHANNEL_EVENTS = "events";

    @Override
    public void load() {
        super.load();
        createChannels(getContext());
    }

    @Override
    @PluginMethod
    public void register(PluginCall call) {
        if (!isFirebaseConfigured()) {
            // Also sent as registrationError, the event the web already listens to for token failures.
            // 同时以 registrationError 事件发出，网页本就通过该事件得知获取令牌失败。
            sendError(NOT_CONFIGURED);
            call.unavailable(NOT_CONFIGURED);
            return;
        }
        super.register(call);
    }

    @Override
    @PluginMethod
    public void unregister(PluginCall call) {
        if (!isFirebaseConfigured()) {
            call.resolve();
            return;
        }
        super.unregister(call);
    }

    private boolean isFirebaseConfigured() {
        return !FirebaseApp.getApps(getContext()).isEmpty();
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveSwitch(call);
            return;
        }
        super.checkPermissions(call);
    }

    /**
     * Before Android 13 there is no dialog to show: notifications are on unless the member switched them off in
     * settings, which only they can undo there.
     * Android 13 以前没有可弹出的对话框：除非成员在设置中关闭，通知默认开启，而关闭后也只能由成员在设置中重新打开。
     */
    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveSwitch(call);
            return;
        }
        super.requestPermissions(call);
    }

    private void resolveSwitch(PluginCall call) {
        JSObject result = new JSObject();
        result.put("receive", NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied");
        call.resolve(result);
    }

    /**
     * Opens this app's notification settings, where the member allows notifications and sets each channel. A ROM
     * without that page gets the app's details page, which links to it.
     * 打开本应用的通知设置，成员可在那里允许通知并设置各个渠道。没有该页面的系统改为打开应用详情页，那里有通往通知设置的入口。
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String app = getContext().getPackageName();
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", app, null));
        Intent notifications = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app)
            : details;
        for (Intent intent : new Intent[] { notifications, details }) {
            try {
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException ignored) {
                // Try the next page.
                // 尝试下一个页面。
            }
        }
        call.unavailable("No settings page for this app");
    }

    /**
     * Creates the channels the API sends to, matching what the web asks for. An existing channel is left alone,
     * because its name may since have been set by the web and its sound and vibration by the user.
     * 创建 API 推送所用的渠道，参数与网页请求的一致。已存在的渠道不做改动，因为其名称可能已由网页设置，声音和振动可能已由用户调整。
     */
    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        createChannel(
            context,
            manager,
            CHANNEL_MESSAGES,
            R.string.notification_channel_messages,
            R.string.notification_channel_messages_description,
            NotificationManager.IMPORTANCE_MAX
        );
        createChannel(
            context,
            manager,
            CHANNEL_EVENTS,
            R.string.notification_channel_events,
            R.string.notification_channel_events_description,
            NotificationManager.IMPORTANCE_HIGH
        );
    }

    private static void createChannel(Context context, NotificationManager manager, String id, int name, int description, int importance) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || manager.getNotificationChannel(id) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(id, context.getString(name), importance);
        channel.setDescription(context.getString(description));
        channel.enableVibration(true);
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }
}
