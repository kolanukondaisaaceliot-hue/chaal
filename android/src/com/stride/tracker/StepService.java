package com.stride.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Foreground service that counts steps all day, even with the screen off.
 * Uses the hardware step-counter sensor when present, otherwise falls back
 * to software peak detection on the accelerometer.
 */
public class StepService extends Service implements SensorEventListener {
    private static final String PREFS = "stride_steps";
    private static final String CH_ID = "stride_steps_ch";
    private static final int NOTIF_ID = 42;

    private SensorManager sm;
    private boolean useHardware;

    // software fallback peak-detection state
    private final float[] grav = new float[3];
    private boolean gravInit = false;
    private float smooth = 0;
    private boolean inPeak = false;
    private float peakMax = 0;
    private long peakT = 0;
    private long lastStep = 0;
    private static final float THR = 1.15f;

    private long lastNotifAt = 0;
    private int lastNotifCount = -1;
    private long lastHcSync = 0;

    public static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public static int getTodaySteps(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
        if (!today().equals(p.getString("date", ""))) return 0;
        return p.getInt("count", 0);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        rolloverIfNeeded();
        sm = (SensorManager) getSystemService(SENSOR_SERVICE);
        Sensor counter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        useHardware = counter != null;
        if (useHardware) {
            sm.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL);
        } else {
            Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (acc != null) sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME);
        }
        startForeground(NOTIF_ID, buildNotif(getTodaySteps(this)));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (sm != null) sm.unregisterListener(this);
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CH_ID, "Step counting", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps Chaal counting your steps in the background");
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    private Notification buildNotif(int steps) {
        Intent i = new Intent(this, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, flags);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CH_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("Chaal")
                .setContentText(steps + " steps today - keep moving!")
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    private void maybeNotify(int steps) {
        long now = System.currentTimeMillis();
        if (steps != lastNotifCount && now - lastNotifAt > 30000) {
            lastNotifAt = now;
            lastNotifCount = steps;
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIF_ID, buildNotif(steps));
        }
        maybeHcSync(steps, now);
    }

    /** Push today's count to Health Connect at most every 30 minutes. */
    private void maybeHcSync(int steps, long now) {
        if (now - lastHcSync < 30 * 60 * 1000) return;
        lastHcSync = now;
        if (HealthSync.isEnabled(this) && HealthSync.isAvailable(this)) {
            HealthSync.writeSteps(this, steps, today());
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** Reset the day bucket when the date changed. */
    private void rolloverIfNeeded() {
        SharedPreferences p = prefs();
        if (!today().equals(p.getString("date", ""))) {
            p.edit().putString("date", today()).putInt("count", 0).putFloat("base", 0f).apply();
        }
    }

    @Override
    public void onSensorChanged(SensorEvent ev) {
        if (ev.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            float total = ev.values[0];
            SharedPreferences p = prefs();
            SharedPreferences.Editor e = p.edit();
            if (!today().equals(p.getString("date", ""))) {
                e.putString("date", today());
                e.putFloat("base", total);
                e.putInt("count", 0);
            } else {
                float base = p.getFloat("base", 0f);
                if (base == 0f || total < base) base = total; // first reading, or reboot
                e.putFloat("base", base);
                e.putInt("count", Math.max(0, (int) (total - base)));
            }
            e.apply();
            maybeNotify(getTodaySteps(this));
        } else if (ev.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            feedAccel(ev.values[0], ev.values[1], ev.values[2]);
        }
    }

    private void feedAccel(float x, float y, float z) {
        if (!gravInit) {
            grav[0] = x; grav[1] = y; grav[2] = z; gravInit = true;
        }
        float a = 0.92f;
        grav[0] = a * grav[0] + (1 - a) * x;
        grav[1] = a * grav[1] + (1 - a) * y;
        grav[2] = a * grav[2] + (1 - a) * z;
        float lx = x - grav[0], ly = y - grav[1], lz = z - grav[2];
        float mag = (float) Math.sqrt(lx * lx + ly * ly + lz * lz);
        smooth = smooth == 0 ? mag : 0.55f * smooth + 0.45f * mag;
        long now = System.currentTimeMillis();
        if (!inPeak) {
            if (smooth > THR && now - lastStep > 240) {
                inPeak = true; peakMax = smooth; peakT = now;
            }
        } else {
            if (smooth > peakMax) peakMax = smooth;
            if (smooth < THR * 0.5f) {
                long dur = now - peakT;
                inPeak = false;
                if (dur > 90 && dur < 1200 && peakMax > THR * 1.08f) {
                    lastStep = now;
                    rolloverIfNeeded();
                    SharedPreferences p = prefs();
                    int c = p.getInt("count", 0) + 1;
                    p.edit().putInt("count", c).apply();
                    maybeNotify(c);
                }
            } else if (now - peakT > 1500) {
                inPeak = false;
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }
}
