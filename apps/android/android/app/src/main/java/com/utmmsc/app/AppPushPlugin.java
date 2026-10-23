package com.utmmsc.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.firebase.FirebaseApp;

/**
 * @capacitor/push-notifications under its own name "PushNotifications", with two changes:
 * register() rejects with code UNAVAILABLE when the APK was built without google-services.json, where the stock
 * plugin throws and Capacitor turns that into an app crash; and the "messages" and "events" channels exist from
 * the first launch, so a push never lands in Android's generic channel before the web has created them.
 * 以 "PushNotifications" 原名提供的 @capacitor/push-notifications，有两处改动：
 * APK 构建时没有 google-services.json 时，register() 以 UNAVAILABLE 拒绝，而原插件会抛出异常并被 Capacitor 变成应用崩溃；
 * 以及首次启动就建好 "messages" 和 "events" 两个通知渠道，网页创建渠道之前收到的推送也不会落入安卓的通用渠道。
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
