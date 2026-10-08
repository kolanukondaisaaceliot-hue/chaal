package com.stride.tracker;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.permission.HealthPermission;
import androidx.health.connect.client.records.DistanceRecord;
import androidx.health.connect.client.records.ExerciseRouteResult;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord;
import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.units.Energy;
import androidx.health.connect.client.units.Length;

import kotlin.coroutines.Continuation;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlin.jvm.functions.Function2;
import kotlinx.coroutines.BuildersKt;

import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Health Connect sync for Stride — writes daily steps and finished workouts.
 * Everything is best-effort and silent on failure: Health Connect may not be
 * installed, the user may deny permission, or the device may be offline.
 * Requires the user to opt in (Settings → Health Connect).
 */
public class HealthSync {
    private static final String TAG = "StrideHC";
    private static final String PREFS = "stride_hc";
    private static final String KEY_ENABLED = "enabled";

    private static final Set<String> PERMS = new HashSet<>(Arrays.asList(
            HealthPermission.getWritePermission(JvmClassMappingKt.getKotlinClass(StepsRecord.class)),
            HealthPermission.getWritePermission(JvmClassMappingKt.getKotlinClass(DistanceRecord.class)),
            HealthPermission.getWritePermission(JvmClassMappingKt.getKotlinClass(ExerciseSessionRecord.class)),
            HealthPermission.getWritePermission(JvmClassMappingKt.getKotlinClass(TotalCaloriesBurnedRecord.class))
    ));

    public static boolean isEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false);
    }

    public static void setEnabled(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, on).apply();
    }

    /** True when the Health Connect provider is present and up to date. */
    public static boolean isAvailable(Context ctx) {
        try {
            return HealthConnectClient.getSdkStatus(ctx) == HealthConnectClient.SDK_AVAILABLE;
        } catch (Exception e) {
            Log.w(TAG, "availability check failed", e);
            return false;
        }
    }

    public static Intent permissionIntent(Context ctx) {
        ActivityResultContract<Set<String>, Set<String>> c =
                PermissionController.createRequestPermissionResultContract();
        return c.createIntent(ctx, PERMS);
    }

    public static boolean parsePermissionResult(int resultCode, Intent data) {
        try {
            ActivityResultContract<Set<String>, Set<String>> c =
                    PermissionController.createRequestPermissionResultContract();
            @SuppressWarnings("unchecked")
            Set<String> granted = (Set<String>) c.parseResult(resultCode, data);
            return granted != null && granted.containsAll(PERMS);
        } catch (Exception e) {
            Log.w(TAG, "permission parse failed", e);
            return false;
        }
    }

    /** Run a Kotlin suspend call from Java, blocking the current (background) thread. */
    @SuppressWarnings({ "unchecked", "rawtypes" })
    private static <T> T blocking(Function2 fn) {
        try {
            return (T) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, fn);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        }
    }

    public static boolean hasPermissions(Context ctx) {
        try {
            final HealthConnectClient client = HealthConnectClient.getOrCreate(ctx);
            final PermissionController pc = client.getPermissionController();
            Set<String> granted = blocking(new Function2() {
                @Override
                public Object invoke(Object scope, Object cont) {
                    return pc.getGrantedPermissions((Continuation) cont);
                }
            });
            return granted != null && granted.containsAll(PERMS);
        } catch (Exception e) {
            Log.w(TAG, "permission check failed", e);
            return false;
        }
    }

    private static Metadata meta(String clientRecordId, long clientRecordVersion) {
        return new Metadata(
                Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED,
                Metadata.EMPTY_ID,
                new DataOrigin("com.stride.tracker"),
                Instant.now(),
                clientRecordId,
                clientRecordVersion,
                null);
    }

    private static ZoneOffset zoneOffset(Instant t) {
        return ZoneId.systemDefault().getRules().getOffset(t);
    }

    private static void insertAsync(final Context ctx, final List<Record> records) {
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            try {
                final HealthConnectClient client = HealthConnectClient.getOrCreate(app);
                blocking(new Function2() {
                    @Override
                    public Object invoke(Object scope, Object cont) {
                        return client.insertRecords(records, (Continuation) cont);
                    }
                });
                Log.i(TAG, "synced " + records.size() + " records");
            } catch (Exception e) {
                Log.w(TAG, "insert failed", e);
            }
        }).start();
    }

    /** Write today's total step count (idempotent per day via clientRecordId). */
    public static void writeSteps(Context ctx, int steps, String dateKey) {
        if (!isEnabled(ctx) || !isAvailable(ctx) || steps < 0) return;
        try {
            Instant now = Instant.now();
            Instant start = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant();
            StepsRecord r = new StepsRecord(
                    start, zoneOffset(start), now, zoneOffset(now), steps,
                    meta("stride-steps-" + dateKey, steps));
            List<Record> records = new ArrayList<>();
            records.add(r);
            insertAsync(ctx, records);
        } catch (Exception e) {
            Log.w(TAG, "writeSteps failed", e);
        }
    }

    /** Write a finished workout: session + distance + calories + steps. */
    public static void writeWorkout(Context ctx, String json) {
        if (!isEnabled(ctx) || !isAvailable(ctx)) return;
        try {
            JSONObject w = new JSONObject(json);
            String type = w.optString("type", "other");
            int durSec = w.optInt("durSec", 0);
            double distKm = w.optDouble("distKm", 0);
            int steps = w.optInt("steps", 0);
            int kcal = w.optInt("kcal", 0);
            long endMs = w.optLong("endTime", System.currentTimeMillis());
            String wid = "w" + endMs;
            if (durSec <= 0) return;

            Instant end = Instant.ofEpochMilli(endMs);
            Instant start = end.minusSeconds(durSec);
            List<Record> records = new ArrayList<>();

            ExerciseSessionRecord session = new ExerciseSessionRecord(
                    start, zoneOffset(start), end, zoneOffset(end),
                    meta("stride-workout-" + wid, 1),
                    exerciseTypeFor(type),
                    "Stride " + type,
                    null, null, null, (ExerciseRouteResult) null, null);
            records.add(session);

            if (distKm > 0) {
                records.add(new DistanceRecord(
                        start, zoneOffset(start), end, zoneOffset(end),
                        Length.kilometers(distKm),
                        meta("stride-workout-dist-" + wid, 1)));
            }
            if (kcal > 0) {
                records.add(new TotalCaloriesBurnedRecord(
                        start, zoneOffset(start), end, zoneOffset(end),
                        Energy.calories(kcal),
                        meta("stride-workout-kcal-" + wid, 1)));
            }
            if (steps > 0) {
                records.add(new StepsRecord(
                        start, zoneOffset(start), end, zoneOffset(end), steps,
                        meta("stride-workout-steps-" + wid, steps)));
            }
            insertAsync(ctx, records);
        } catch (Exception e) {
            Log.w(TAG, "writeWorkout failed", e);
        }
    }

    /** Fire-and-forget sync of the current service step count. */
    public static void syncStepsNow(Context ctx) {
        try {
            int steps = StepService.getTodaySteps(ctx);
            writeSteps(ctx, steps, StepService.today());
        } catch (Exception e) {
            Log.w(TAG, "syncStepsNow failed", e);
        }
    }

    private static int exerciseTypeFor(String type) {
        switch (type) {
            case "walk": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "run": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "cycle": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING;
            case "gym": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
