package com.chronicle.app

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.ContentValues
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

data class TrackingSummary(
  val usageAccessGranted: Boolean,
  val collectionScheduled: Boolean,
  val syncScheduled: Boolean,
  val trackingActive: Boolean,
  val networkAvailable: Boolean,
  val authenticated: Boolean,
  val deviceId: String?,
  val lastCollectionAt: Long?,
  val lastSyncAt: Long?,
  val pendingSyncCount: Int,
)

data class NativeActionResult(
  val ok: Boolean,
  val message: String,
  val collected: Int = 0,
  val inserted: Int = 0,
  val updated: Int = 0,
  val synced: Int = 0,
  val duplicates: Int = 0,
  val invalid: Int = 0,
)

data class UsageSummaryRecord(
  val packageName: String,
  val lastTimeUsed: Long,
  val totalTimeInForeground: Long,
)

private const val TAG = "[Orbit Tracking]"
private const val PREFS_NAME = "orbit_tracking_state"
private const val DB_NAME = "orbit_tracking.db"
private const val DB_VERSION = 1
private const val TABLE_METADATA = "tracking_metadata"
private const val TABLE_APPS = "installed_apps"
private const val TABLE_USAGE = "usage_records"

private const val KEY_ACCESS_TOKEN = "access_token"
private const val KEY_REFRESH_TOKEN = "refresh_token"
private const val KEY_USER_ID = "user_id"
private const val KEY_DEVICE_ID = "device_id"
private const val KEY_API_BASE_URL = "api_base_url"
private const val KEY_INSTALLATION_ID = "installation_id"
private const val KEY_COLLECTION_SCHEDULED = "collection_scheduled"
private const val KEY_SYNC_SCHEDULED = "sync_scheduled"
private const val KEY_LAST_COLLECTION = "last_successful_collection_timestamp"
private const val KEY_LAST_SYNC = "last_successful_sync_timestamp"
private const val KEY_LAST_SYNC_RESULT = "last_sync_result"

private const val COL_KEY = "key"
private const val COL_VALUE = "value"
private const val COL_PACKAGE = "package_name"
private const val COL_APP_NAME = "app_name"
private const val COL_ICON_REFERENCE = "icon_reference"
private const val COL_SYSTEM_APP = "system_app"
private const val COL_LAST_SEEN = "last_seen"
private const val COL_UPDATED_AT = "updated_at"
private const val COL_RECORD_KEY = "record_key"
private const val COL_START_TIME = "start_time"
private const val COL_END_TIME = "end_time"
private const val COL_DURATION_SECONDS = "duration_seconds"
private const val COL_COLLECTED_AT = "collected_at"
private const val COL_SYNCED = "synced"
private const val COL_SYNCED_AT = "synced_at"
private const val COL_SYNC_ATTEMPTS = "sync_attempts"
private const val COL_LAST_ERROR = "last_error"
private const val COL_DATE_KEY = "date_key"
private const val COL_SOURCE = "source"

private const val DEFAULT_API_BASE_URL = "https://chronicle-backend-gvy4.onrender.com/api/v1"

private class TrackingDatabaseHelper(context: Context) : SQLiteOpenHelper(
  context.applicationContext,
  DB_NAME,
  null,
  DB_VERSION
) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $TABLE_METADATA (
        $COL_KEY TEXT PRIMARY KEY NOT NULL,
        $COL_VALUE TEXT NOT NULL
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $TABLE_APPS (
        $COL_PACKAGE TEXT PRIMARY KEY NOT NULL,
        $COL_APP_NAME TEXT NOT NULL,
        $COL_ICON_REFERENCE TEXT,
        $COL_SYSTEM_APP INTEGER NOT NULL DEFAULT 0,
        $COL_LAST_SEEN INTEGER NOT NULL DEFAULT 0,
        $COL_UPDATED_AT INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS $TABLE_USAGE (
        $COL_RECORD_KEY TEXT PRIMARY KEY NOT NULL,
        $COL_PACKAGE TEXT NOT NULL,
        $COL_APP_NAME TEXT NOT NULL,
        $COL_START_TIME INTEGER NOT NULL,
        $COL_END_TIME INTEGER NOT NULL,
        $COL_DURATION_SECONDS INTEGER NOT NULL,
        $COL_DATE_KEY TEXT NOT NULL,
        $COL_COLLECTED_AT INTEGER NOT NULL,
        $COL_SYNCED INTEGER NOT NULL DEFAULT 0,
        $COL_SYNCED_AT INTEGER,
        $COL_SYNC_ATTEMPTS INTEGER NOT NULL DEFAULT 0,
        $COL_LAST_ERROR TEXT,
        $COL_SOURCE TEXT NOT NULL DEFAULT 'system'
      )
      """.trimIndent()
    )
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_usage_synced ON $TABLE_USAGE($COL_SYNCED, $COL_START_TIME)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_usage_package_start ON $TABLE_USAGE($COL_PACKAGE, $COL_START_TIME)")
    db.execSQL("CREATE INDEX IF NOT EXISTS idx_usage_date_key ON $TABLE_USAGE($COL_DATE_KEY)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    if (oldVersion < newVersion) {
      db.execSQL("DROP TABLE IF EXISTS $TABLE_USAGE")
      db.execSQL("DROP TABLE IF EXISTS $TABLE_APPS")
      db.execSQL("DROP TABLE IF EXISTS $TABLE_METADATA")
      onCreate(db)
    }
  }
}

private object TrackingDateFormats {
  private fun utcFormatter(pattern: String): SimpleDateFormat {
    return SimpleDateFormat(pattern, Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }
  }

  fun utcDateKey(timeMs: Long): String = utcFormatter("yyyy-MM-dd").format(Date(timeMs))
  fun utcIso(timeMs: Long): String = utcFormatter("yyyy-MM-dd'T'HH:mm:ss'Z'").format(Date(timeMs))
}

object TrackingStore {
  private fun database(context: Context): SQLiteDatabase {
    return TrackingDatabaseHelper(context).writableDatabase
  }

  private fun readPreferences(context: Context): SharedPreferences {
    return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  @JvmStatic fun isUsageAccessGranted(context: Context): Boolean {
    return try {
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        context.packageName
      )
      mode == AppOpsManager.MODE_ALLOWED
    } catch (_: Exception) {
      false
    }
  }

  @JvmStatic fun getInstallationId(context: Context): String {
    val prefs = readPreferences(context)
    val existing = prefs.getString(KEY_INSTALLATION_ID, null)
    if (!existing.isNullOrBlank()) return existing
    val generated = UUID.randomUUID().toString()
    prefs.edit().putString(KEY_INSTALLATION_ID, generated).apply()
    Log.d(TAG, "Installation identity generated: $generated")
    return generated
  }

  fun isNetworkAvailable(context: Context): Boolean {
    return try {
      val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      } else {
        @Suppress("DEPRECATION")
        val info = connectivityManager.activeNetworkInfo
        @Suppress("DEPRECATION")
        info != null && info.isConnected
      }
    } catch (_: Exception) {
      false
    }
  }

  @JvmStatic fun cacheAuthState(
    context: Context,
    accessToken: String,
    refreshToken: String,
    userId: String,
    deviceId: String,
    apiBaseUrl: String,
  ) {
    val editor = readPreferences(context).edit()
    if (accessToken.isNotBlank()) editor.putString(KEY_ACCESS_TOKEN, accessToken)
    if (refreshToken.isNotBlank()) editor.putString(KEY_REFRESH_TOKEN, refreshToken)
    if (userId.isNotBlank()) editor.putString(KEY_USER_ID, userId)
    if (deviceId.isNotBlank()) editor.putString(KEY_DEVICE_ID, deviceId)
    if (apiBaseUrl.isNotBlank()) editor.putString(KEY_API_BASE_URL, apiBaseUrl)
    editor.apply()
    Log.d(TAG, "Auth state cached for device $deviceId")
  }

  @JvmStatic fun clearAuthState(context: Context) {
    readPreferences(context).edit()
      .remove(KEY_ACCESS_TOKEN)
      .remove(KEY_REFRESH_TOKEN)
      .remove(KEY_USER_ID)
      .remove(KEY_LAST_SYNC_RESULT)
      .apply()
    Log.d(TAG, "Auth state cleared")
  }

  fun getDeviceId(context: Context): String? = readPreferences(context).getString(KEY_DEVICE_ID, null)
  fun getApiBaseUrl(context: Context): String = readPreferences(context).getString(KEY_API_BASE_URL, DEFAULT_API_BASE_URL) ?: DEFAULT_API_BASE_URL
  fun getAccessToken(context: Context): String? = readPreferences(context).getString(KEY_ACCESS_TOKEN, null)
  fun getRefreshToken(context: Context): String? = readPreferences(context).getString(KEY_REFRESH_TOKEN, null)
  fun getUserId(context: Context): String? = readPreferences(context).getString(KEY_USER_ID, null)

  @JvmStatic fun markCollectionScheduled(context: Context, scheduled: Boolean) {
    setMetadata(context, KEY_COLLECTION_SCHEDULED, if (scheduled) "1" else "0")
  }

  @JvmStatic fun markSyncScheduled(context: Context, scheduled: Boolean) {
    setMetadata(context, KEY_SYNC_SCHEDULED, if (scheduled) "1" else "0")
  }

  fun isCollectionScheduled(context: Context): Boolean = getMetadata(context, KEY_COLLECTION_SCHEDULED) == "1"
  fun isSyncScheduled(context: Context): Boolean = getMetadata(context, KEY_SYNC_SCHEDULED) == "1"

  @JvmStatic fun getPendingSyncCount(context: Context): Int {
    val db = TrackingDatabaseHelper(context).readableDatabase
    return try {
      db.rawQuery(
        "SELECT COUNT(*) FROM $TABLE_USAGE WHERE $COL_SYNCED = 0",
        null
      ).use { cursor ->
        if (cursor.moveToFirst()) cursor.getInt(0) else 0
      }
    } finally {
      db.close()
    }
  }

  @JvmStatic fun getLastCollectionTimestamp(context: Context): Long? = getMetadata(context, KEY_LAST_COLLECTION)?.toLongOrNull()
  fun getLastSyncTimestamp(context: Context): Long? = getMetadata(context, KEY_LAST_SYNC)?.toLongOrNull()

  @JvmStatic fun getTrackingSummary(context: Context): TrackingSummary {
    val authenticated = !getAccessToken(context).isNullOrBlank() && !getRefreshToken(context).isNullOrBlank()
    val usageAccessGranted = isUsageAccessGranted(context)
    val collectionScheduled = isCollectionScheduled(context)
    val syncScheduled = isSyncScheduled(context)
    val pendingSyncCount = getPendingSyncCount(context)
    val networkAvailable = isNetworkAvailable(context)
    return TrackingSummary(
      usageAccessGranted = usageAccessGranted,
      collectionScheduled = collectionScheduled,
      syncScheduled = syncScheduled,
      trackingActive = usageAccessGranted && collectionScheduled,
      networkAvailable = networkAvailable,
      authenticated = authenticated,
      deviceId = getDeviceId(context),
      lastCollectionAt = getLastCollectionTimestamp(context),
      lastSyncAt = getLastSyncTimestamp(context),
      pendingSyncCount = pendingSyncCount,
    )
  }

  @JvmStatic fun collectUsageSinceLastTimestamp(context: Context): NativeActionResult {
    if (!isUsageAccessGranted(context)) {
      return NativeActionResult(false, "Usage access is not granted.")
    }

    val now = System.currentTimeMillis()
    val fallbackWindow = TimeUnit.HOURS.toMillis(24)
    val lastSuccessful = getLastCollectionTimestamp(context) ?: (now - fallbackWindow)
    val startTime = if (lastSuccessful < 0) 0L else lastSuccessful

    val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val packageManager = context.packageManager
    val stats = usageStatsManager.queryUsageStats(
      UsageStatsManager.INTERVAL_BEST,
      startTime,
      now
    ) ?: emptyList()

    val aggregatedStats = aggregateUsageStats(stats)
    val db = TrackingDatabaseHelper(context).writableDatabase
    if (aggregatedStats.isEmpty()) {
      setMetadataDirect(db, KEY_LAST_COLLECTION, now.toString())
      db.close()
      Log.d(TAG, "Background collection completed with no new usage")
      return NativeActionResult(true, "No new usage records found.", collected = 0)
    }

    var inserted = 0
    var updated = 0
    var ignored = 0
    db.beginTransaction()
    try {
      for (item in aggregatedStats) {
        if (item.packageName.isBlank() || item.totalTimeInForeground <= 0 || item.lastTimeUsed <= 0) {
          ignored += 1
          continue
        }
        if (item.packageName == context.packageName) {
          ignored += 1
          continue
        }

        val appInfo = try {
          packageManager.getApplicationInfo(item.packageName, 0)
        } catch (_: PackageManager.NameNotFoundException) {
          ignored += 1
          continue
        }

        val isSystemApp = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
        if (isSystemApp && packageManager.getLaunchIntentForPackage(item.packageName) == null) {
          ignored += 1
          continue
        }

        val appName = try {
          packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
          item.packageName
        }

        upsertInstalledApp(
          db = db,
          packageName = item.packageName,
          appName = appName,
          isSystemApp = isSystemApp,
          lastSeen = item.lastTimeUsed,
        )

        val intervalEnd = minOf(item.lastTimeUsed, now)
        val durationMs = item.totalTimeInForeground
        val intervalStart = maxOf(startTime, intervalEnd - durationMs)
        if (intervalEnd <= intervalStart) {
          ignored += 1
          continue
        }

        val recordKey = "${item.packageName}|$intervalStart|$intervalEnd"
        val insertedRows = upsertUsageRecord(
          db = db,
          recordKey = recordKey,
          packageName = item.packageName,
          appName = appName,
          startTime = intervalStart,
          endTime = intervalEnd,
          durationSeconds = (durationMs / 1000L).toInt().coerceAtLeast(1),
          dateKey = TrackingDateFormats.utcDateKey(intervalEnd),
          collectedAt = now,
          synced = false,
          source = "system",
        )
        if (insertedRows > 0) {
          inserted += 1
        } else {
          updated += 1
        }
      }

      setMetadataDirect(db, KEY_LAST_COLLECTION, now.toString())
      db.setTransactionSuccessful()
      Log.d(TAG, "Collected ${inserted + updated} usage records")
      return NativeActionResult(
        ok = true,
        message = "Collected ${inserted + updated} usage records.",
        collected = inserted + updated,
        inserted = inserted,
        updated = updated,
        invalid = ignored,
      )
    } catch (error: Exception) {
      Log.e(TAG, "Collection failed", error)
      return NativeActionResult(false, error.message ?: "Usage collection failed.")
    } finally {
      db.endTransaction()
      db.close()
    }
  }

  @JvmStatic fun syncPendingUsage(context: Context): NativeActionResult {
    val deviceId = getDeviceId(context)
    if (deviceId.isNullOrBlank()) {
      return NativeActionResult(false, "Device is not registered.")
    }

    val accessToken = getAccessToken(context)
    val refreshToken = getRefreshToken(context)
    if (accessToken.isNullOrBlank() || refreshToken.isNullOrBlank()) {
      return NativeActionResult(false, "Sign in to sync pending activity.")
    }

    if (!isNetworkAvailable(context)) {
      return NativeActionResult(false, "Network is unavailable.")
    }

    val db = TrackingDatabaseHelper(context).writableDatabase
    val pending = readPendingUsageRecords(db)
    if (pending.isEmpty()) {
      db.beginTransaction()
      try {
        setMetadataDirect(db, KEY_LAST_SYNC, System.currentTimeMillis().toString())
        setMetadataDirect(db, KEY_LAST_SYNC_RESULT, "Nothing to sync")
        db.setTransactionSuccessful()
      } finally {
        db.endTransaction()
        db.close()
      }
      db.close()
      return NativeActionResult(true, "No pending activity to sync.")
    }

    val apiBaseUrl = getApiBaseUrl(context)
    val initialResult = postUsagePayload(
      apiBaseUrl = apiBaseUrl,
      accessToken = accessToken,
      refreshToken = refreshToken,
      deviceId = deviceId,
      sessions = pending,
    )

    val finalResult = if (initialResult.status == 401) {
      val refreshedToken = refreshAccessToken(apiBaseUrl, refreshToken)
      if (refreshedToken != null) {
        cacheAuthState(
          context = context,
          accessToken = refreshedToken.first,
          refreshToken = refreshedToken.second,
          userId = getUserId(context) ?: "",
          deviceId = deviceId,
          apiBaseUrl = apiBaseUrl,
        )
        postUsagePayload(
          apiBaseUrl = apiBaseUrl,
          accessToken = refreshedToken.first,
          refreshToken = refreshedToken.second,
          deviceId = deviceId,
          sessions = pending,
        )
      } else {
        initialResult
      }
    } else {
      initialResult
    }

    if (!finalResult.ok) {
      markSyncAttempt(db, pending, finalResult.error ?: "Sync failed")
      db.close()
      setMetadata(context, KEY_LAST_SYNC_RESULT, finalResult.error ?: "Sync failed")
      return NativeActionResult(false, finalResult.error ?: "Sync failed")
    }

    val syncedCount: Int
    val now = System.currentTimeMillis()
    db.beginTransaction()
    try {
      syncedCount = markRecordsSynced(db, pending)
      setMetadataDirect(db, KEY_LAST_SYNC, now.toString())
      setMetadataDirect(db, KEY_LAST_SYNC_RESULT, "Synced $syncedCount records")
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
      db.close()
    }
    Log.d(TAG, "Sync successful for $syncedCount records")
    return NativeActionResult(
      ok = true,
      message = "Synced $syncedCount records.",
      synced = syncedCount,
    )
  }

  @JvmStatic fun getStoredUsageStats(context: Context, startTime: Long, endTime: Long): List<UsageSummaryRecord> {
    val db = TrackingDatabaseHelper(context).readableDatabase
    val recordsByPackage = linkedMapOf<String, MutableList<UsageSummaryRecord>>()
    db.rawQuery(
      """
      SELECT $COL_PACKAGE, $COL_START_TIME, $COL_END_TIME, $COL_DURATION_SECONDS
      FROM $TABLE_USAGE
      WHERE $COL_START_TIME >= ? AND $COL_END_TIME <= ? AND $COL_DURATION_SECONDS > 0
      ORDER BY $COL_END_TIME DESC
      """.trimIndent(),
      arrayOf(startTime.toString(), endTime.toString())
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val packageName = cursor.getString(0) ?: continue
        val sessionEnd = cursor.getLong(2)
        val durationMs = cursor.getLong(3) * 1000L
        val existing = recordsByPackage.getOrPut(packageName) { mutableListOf() }
        existing.add(
          UsageSummaryRecord(
            packageName = packageName,
            lastTimeUsed = sessionEnd,
            totalTimeInForeground = durationMs,
          )
        )
      }
    }
    db.close()

    return recordsByPackage.values.mapNotNull { records ->
      if (records.isEmpty()) {
        null
      } else {
        val packageName = records.first().packageName
        val lastTimeUsed = records.maxOf { it.lastTimeUsed }
        val totalTime = records.sumOf { it.totalTimeInForeground }
        UsageSummaryRecord(packageName, lastTimeUsed, totalTime)
      }
    }
  }

  fun queryStoredDailyUsage(context: Context, dateKey: String): JSONArray {
    val db = TrackingDatabaseHelper(context).readableDatabase
    val result = JSONArray()
    db.rawQuery(
      """
      SELECT $COL_PACKAGE, $COL_APP_NAME, SUM($COL_DURATION_SECONDS) AS total_seconds, MAX($COL_END_TIME) AS last_seen
      FROM $TABLE_USAGE
      WHERE $COL_DATE_KEY = ? AND $COL_DURATION_SECONDS > 0
      GROUP BY $COL_PACKAGE, $COL_APP_NAME
      ORDER BY total_seconds DESC
      """.trimIndent(),
      arrayOf(dateKey)
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val entry = JSONObject()
        entry.put("packageName", cursor.getString(0) ?: "")
        entry.put("appName", cursor.getString(1) ?: cursor.getString(0) ?: "")
        entry.put("lastTimeUsed", cursor.getLong(3) * 1.0)
        entry.put("totalTimeInForeground", cursor.getLong(2) * 1000.0)
        result.put(entry)
      }
    }
    db.close()
    return result
  }

  fun buildSummaryPayload(context: Context): JSONObject {
    val summary = getTrackingSummary(context)
    val payload = JSONObject()
    payload.put("usageAccessGranted", summary.usageAccessGranted)
    payload.put("collectionScheduled", summary.collectionScheduled)
    payload.put("syncScheduled", summary.syncScheduled)
    payload.put("trackingActive", summary.trackingActive)
    payload.put("networkAvailable", summary.networkAvailable)
    payload.put("authenticated", summary.authenticated)
    payload.put("deviceId", summary.deviceId ?: JSONObject.NULL)
    payload.put("lastCollectionAt", summary.lastCollectionAt ?: JSONObject.NULL)
    payload.put("lastSyncAt", summary.lastSyncAt ?: JSONObject.NULL)
    payload.put("pendingSyncCount", summary.pendingSyncCount)
    return payload
  }

  private fun aggregateUsageStats(stats: List<UsageStats>): List<UsageSummaryRecord> {
    val aggregated = linkedMapOf<String, UsageSummaryRecord>()
    for (stat in stats) {
      val packageName = stat.packageName ?: continue
      val totalTime = stat.totalTimeInForeground
      val lastTimeUsed = stat.lastTimeUsed
      if (packageName.isBlank() || totalTime <= 0L || lastTimeUsed <= 0L) {
        continue
      }
      val existing = aggregated[packageName]
      if (existing == null) {
        aggregated[packageName] = UsageSummaryRecord(packageName, lastTimeUsed, totalTime)
      } else {
        aggregated[packageName] = UsageSummaryRecord(
          packageName = packageName,
          lastTimeUsed = maxOf(existing.lastTimeUsed, lastTimeUsed),
          totalTimeInForeground = existing.totalTimeInForeground + totalTime,
        )
      }
    }
    return aggregated.values.toList()
  }

  private fun upsertInstalledApp(
    db: SQLiteDatabase,
    packageName: String,
    appName: String,
    isSystemApp: Boolean,
    lastSeen: Long,
  ) {
    val values = ContentValues().apply {
      put(COL_PACKAGE, packageName)
      put(COL_APP_NAME, appName)
      put(COL_SYSTEM_APP, if (isSystemApp) 1 else 0)
      put(COL_LAST_SEEN, lastSeen)
      put(COL_UPDATED_AT, System.currentTimeMillis())
    }
    db.insertWithOnConflict(TABLE_APPS, null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  private fun upsertUsageRecord(
    db: SQLiteDatabase,
    recordKey: String,
    packageName: String,
    appName: String,
    startTime: Long,
    endTime: Long,
    durationSeconds: Int,
    dateKey: String,
    collectedAt: Long,
    synced: Boolean,
    source: String,
  ): Long {
    val values = ContentValues().apply {
      put(COL_RECORD_KEY, recordKey)
      put(COL_PACKAGE, packageName)
      put(COL_APP_NAME, appName)
      put(COL_START_TIME, startTime)
      put(COL_END_TIME, endTime)
      put(COL_DURATION_SECONDS, durationSeconds)
      put(COL_DATE_KEY, dateKey)
      put(COL_COLLECTED_AT, collectedAt)
      put(COL_SYNCED, if (synced) 1 else 0)
      put(COL_SOURCE, source)
    }
    return db.insertWithOnConflict(TABLE_USAGE, null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  private fun readPendingUsageRecords(db: SQLiteDatabase): List<Map<String, Any?>> {
    val records = mutableListOf<Map<String, Any?>>()
    db.rawQuery(
      """
      SELECT $COL_RECORD_KEY, $COL_PACKAGE, $COL_APP_NAME, $COL_START_TIME, $COL_END_TIME, $COL_DURATION_SECONDS
      FROM $TABLE_USAGE
      WHERE $COL_SYNCED = 0
      ORDER BY $COL_START_TIME ASC
      """.trimIndent(),
      null
    ).use { cursor ->
      while (cursor.moveToNext()) {
        records.add(
          mapOf(
            COL_RECORD_KEY to cursor.getString(0),
            COL_PACKAGE to cursor.getString(1),
            COL_APP_NAME to cursor.getString(2),
            COL_START_TIME to cursor.getLong(3),
            COL_END_TIME to cursor.getLong(4),
            COL_DURATION_SECONDS to cursor.getInt(5),
          )
        )
      }
    }
    return records
  }

  private fun markRecordsSynced(db: SQLiteDatabase, records: List<Map<String, Any?>>): Int {
    var count = 0
    val now = System.currentTimeMillis()
    for (record in records) {
      val recordKey = record[COL_RECORD_KEY] as? String ?: continue
      val values = ContentValues().apply {
        put(COL_SYNCED, 1)
        put(COL_SYNCED_AT, now)
        put(COL_LAST_ERROR, null as String?)
      }
      count += db.update(
        TABLE_USAGE,
        values,
        "$COL_RECORD_KEY = ?",
        arrayOf(recordKey)
      )
    }
    return count
  }

  private fun markSyncAttempt(db: SQLiteDatabase, records: List<Map<String, Any?>>, error: String) {
    val now = System.currentTimeMillis()
    for (record in records) {
      val recordKey = record[COL_RECORD_KEY] as? String ?: continue
      db.execSQL(
        """
        UPDATE $TABLE_USAGE
        SET $COL_SYNC_ATTEMPTS = $COL_SYNC_ATTEMPTS + 1,
            $COL_LAST_ERROR = ?
        WHERE $COL_RECORD_KEY = ?
        """.trimIndent(),
        arrayOf(error, recordKey)
      )
    }
    setMetadataDirect(db, KEY_LAST_SYNC_RESULT, error)
    setMetadataDirect(db, KEY_LAST_SYNC, now.toString())
  }

  private data class SyncHttpResult(
    val ok: Boolean,
    val status: Int,
    val result: JSONObject? = null,
    val error: String? = null,
  )

  private fun postUsagePayload(
    apiBaseUrl: String,
    accessToken: String,
    refreshToken: String,
    deviceId: String,
    sessions: List<Map<String, Any?>>,
  ): SyncHttpResult {
    val url = "$apiBaseUrl/usage/sync/"
    return try {
      val payload = JSONObject()
      payload.put("device_id", deviceId)
      val sessionArray = JSONArray()
      for (session in sessions) {
        val packageName = session[COL_PACKAGE] as? String ?: continue
        val appName = session[COL_APP_NAME] as? String ?: packageName
        val startTime = session[COL_START_TIME] as? Long ?: continue
        val endTime = session[COL_END_TIME] as? Long ?: continue
        val durationSeconds = session[COL_DURATION_SECONDS] as? Int ?: continue
        val item = JSONObject()
        item.put("package_name", packageName)
        item.put("app_name", appName)
        item.put("start_time", TrackingDateFormats.utcIso(startTime))
        item.put("end_time", TrackingDateFormats.utcIso(endTime))
        item.put("duration_seconds", durationSeconds)
        sessionArray.put(item)
      }
      payload.put("sessions", sessionArray)

      val connection = java.net.URL(url).openConnection() as java.net.HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 15000
      connection.readTimeout = 20000
      connection.doInput = true
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Authorization", "Bearer $accessToken")

      connection.outputStream.use { output ->
        output.write(payload.toString().toByteArray(Charsets.UTF_8))
      }

      val status = connection.responseCode
      val responseBody = try {
        (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }
      } catch (_: Exception) {
        null
      }
      val parsed = responseBody?.takeIf { it.isNotBlank() }?.let { JSONObject(it) }
      connection.disconnect()

      if (status in 200..299) {
        Log.d(TAG, "Sync response status $status")
        SyncHttpResult(true, status, parsed, null)
      } else if (status == 401) {
        SyncHttpResult(false, status, parsed, parsed?.optString("detail") ?: "Unauthorized")
      } else {
        SyncHttpResult(false, status, parsed, parsed?.optString("detail") ?: "Sync failed")
      }
    } catch (error: Exception) {
      Log.e(TAG, "Sync request failed", error)
      SyncHttpResult(false, 0, null, error.message ?: "Network error")
    }
  }

  private fun refreshAccessToken(
    apiBaseUrl: String,
    refreshToken: String,
  ): Pair<String, String>? {
    return try {
      val url = java.net.URL("$apiBaseUrl/auth/refresh/")
      val payload = JSONObject()
      payload.put("refresh", refreshToken)

      val connection = url.openConnection() as java.net.HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 15000
      connection.readTimeout = 20000
      connection.doInput = true
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { output ->
        output.write(payload.toString().toByteArray(Charsets.UTF_8))
      }

      val status = connection.responseCode
      if (status !in 200..299) {
        connection.disconnect()
        return null
      }
      val responseBody = connection.inputStream.bufferedReader().use { it.readText() }
      connection.disconnect()
      val parsed = JSONObject(responseBody)
      val access = parsed.optString("access").takeIf { it.isNotBlank() } ?: return null
      val refresh = parsed.optString("refresh").takeIf { it.isNotBlank() } ?: refreshToken
      Pair(access, refresh)
    } catch (error: Exception) {
      Log.e(TAG, "Token refresh failed", error)
      null
    }
  }

  private fun getMetadata(context: Context, key: String): String? {
    val db = TrackingDatabaseHelper(context).readableDatabase
    return try {
      db.rawQuery("SELECT $COL_VALUE FROM $TABLE_METADATA WHERE $COL_KEY = ?", arrayOf(key)).use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } finally {
      db.close()
    }
  }

  private fun setMetadata(context: Context, key: String, value: String) {
    val db = TrackingDatabaseHelper(context).writableDatabase
    setMetadataDirect(db, key, value)
    db.close()
  }

  private fun setMetadataDirect(db: SQLiteDatabase, key: String, value: String) {
    val values = ContentValues().apply {
      put(COL_KEY, key)
      put(COL_VALUE, value)
    }
    db.insertWithOnConflict(TABLE_METADATA, null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }
}

private fun <T : Cursor, R> T.use(block: (T) -> R): R {
  try {
    return block(this)
  } finally {
    close()
  }
}
