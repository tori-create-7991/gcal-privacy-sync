/**
 * Google Calendar 同期スクリプト
 *
 * 同じアカウントの複数カレンダー（共有カレンダーなど）から
 * 指定したカレンダーに予定をコピーして同期します。
 *
 * 使い方:
 * 1. Config.gs でカレンダーIDと設定を行う
 * 2. syncCalendars() を実行してテスト
 * 3. setupTrigger() を実行して自動同期を設定
 */

/**
 * メイン同期関数
 * 設定されたすべてのカレンダーペアを同期する
 */
function syncCalendars() {
  const syncPairs = getSyncPairs();
  const commonConfig = getCommonConfig();

  log('===== カレンダー同期開始 =====');
  log('同期ペア数: ' + syncPairs.length);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;

  syncPairs.forEach((pair, index) => {
    log('');
    log('----- [' + (index + 1) + '/' + syncPairs.length + '] ' + pair.name + ' -----');

    try {
      const result = syncSinglePair(pair, commonConfig);
      totalCreated += result.created;
      totalUpdated += result.updated;
      totalDeleted += result.deleted;
      totalSkipped += result.skipped;
    } catch (error) {
      log('エラー: ' + error.message);
    }
  });

  log('');
  log('===== 全体の同期結果 =====');
  log('作成: ' + totalCreated + '件');
  log('更新: ' + totalUpdated + '件');
  log('削除: ' + totalDeleted + '件');
  log('スキップ: ' + totalSkipped + '件');
}

/**
 * 単一のカレンダーペアを同期する
 * （オプションで主催者ルールによりコピー先カレンダーを切り替え）
 */
function syncSinglePair(pair, commonConfig) {
  const result = { created: 0, updated: 0, deleted: 0, skipped: 0 };

  const sourceCalendar = CalendarApp.getCalendarById(pair.sourceCalendarId);
  if (!sourceCalendar) {
    throw new Error('ソースカレンダーが見つかりません: ' + pair.sourceCalendarId);
  }

  const routingDestIds = getOrganizerRoutingDestinationIds(pair);
  const destIds = Object.keys(routingDestIds);
  const destCalendars = {};
  destIds.forEach(function(id) {
    const c = CalendarApp.getCalendarById(id);
    if (c) destCalendars[id] = c;
  });

  if (!destCalendars[pair.destCalendarId]) {
    throw new Error('コピー先カレンダーが見つかりません: ' + pair.destCalendarId);
  }

  log('ソース: ' + sourceCalendar.getName());
  log('コピー先（既定）: ' + destCalendars[pair.destCalendarId].getName());
  if (destIds.length > 1) {
    log('主催者ルート用の参照カレンダー数: ' + destIds.length);
  }

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - commonConfig.DAYS_BEFORE);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + commonConfig.DAYS_AFTER);
  endDate.setHours(23, 59, 59, 999);

  const syncTag = commonConfig.SYNC_TAG + '[' + pair.sourceCalendarId + ']';

  const sourceEvents = sourceCalendar.getEvents(startDate, endDate);
  debugLog('ソースの予定数: ' + sourceEvents.length, commonConfig);

  const sourceEventByKey = new Map();
  const apiEventCache = {};

  const syncedMaps = {};
  const allSyncedByDest = {};
  destIds.forEach(function(destId) {
    const cal = destCalendars[destId];
    if (!cal) return;
    const synced = (cal.getEvents(startDate, endDate) || []).filter(function(event) {
      return getEventSourceId(event, syncTag) !== null;
    });
    allSyncedByDest[destId] = synced;
    const m = new Map();
    synced.forEach(function(event) {
      const uniqueKey = getEventSourceId(event, syncTag);
      if (uniqueKey) m.set(uniqueKey, event);
    });
    syncedMaps[destId] = m;
  });

  const sourceEventKeys = new Set();

  sourceEvents.forEach(function(sourceEvent) {
    if (commonConfig.EXCLUDE_NOT_ATTENDING && isNotAttending(sourceEvent)) {
      // sourceEventKeys に加えない: 過去に参加予定でコピー済みだった場合、
      // 後段の削除ループで「ソースから消えた」扱いになり自動的に削除される
      result.skipped++;
      return;
    }

    const startTime = sourceEvent.isAllDayEvent()
      ? sourceEvent.getAllDayStartDate().getTime()
      : sourceEvent.getStartTime().getTime();
    const uniqueKey = sourceEvent.getId() + '_' + startTime;
    sourceEventKeys.add(uniqueKey);
    sourceEventByKey.set(uniqueKey, sourceEvent);

    if (sourceEvent.isAllDayEvent() && !commonConfig.COPY_ALL_DAY_EVENTS) {
      result.skipped++;
      return;
    }

    const resolved = resolveOrganizerDestination(pair, sourceEvent, apiEventCache);
    const destCalendarId = resolved.destCalendarId;
    const effectivePair = mergePairOverrides(pair, resolved.overrides);
    const destCalendar = destCalendars[destCalendarId];

    if (!destCalendar) {
      result.skipped++;
      debugLog('ルーティング先カレンダーが見つかりません: ' + destCalendarId, commonConfig);
      return;
    }

    const syncedEventMap = syncedMaps[destCalendarId] || new Map();
    const existingEvent = syncedEventMap.get(uniqueKey);

    if (existingEvent) {
      if (needsUpdate(sourceEvent, existingEvent, effectivePair, commonConfig, syncTag, uniqueKey)) {
        updateEvent(existingEvent, sourceEvent, effectivePair, syncTag, uniqueKey, commonConfig);
        result.updated++;
        debugLog('更新: ' + sourceEvent.getTitle(), commonConfig);
      }
    } else {
      createEvent(destCalendar, sourceEvent, effectivePair, syncTag, uniqueKey, commonConfig);
      result.created++;
      debugLog('作成: ' + sourceEvent.getTitle(), commonConfig);
    }
  });

  destIds.forEach(function(destId) {
    const cal = destCalendars[destId];
    if (!cal) return;
    (allSyncedByDest[destId] || []).forEach(function(syncedEvent) {
      const sourceKey = getEventSourceId(syncedEvent, syncTag);
      if (!sourceKey) return;

      if (!sourceEventKeys.has(sourceKey)) {
        syncedEvent.deleteEvent();
        result.deleted++;
        debugLog('削除: ' + syncedEvent.getTitle(), commonConfig);
        return;
      }

      const srcEv = sourceEventByKey.get(sourceKey);
      if (!srcEv) return;
      const resolved = resolveOrganizerDestination(pair, srcEv, apiEventCache);
      if (resolved.destCalendarId !== destId) {
        syncedEvent.deleteEvent();
        result.deleted++;
        debugLog('ルーティング変更のため削除: ' + syncedEvent.getTitle(), commonConfig);
      }
    });
  });

  log('結果 - 作成:' + result.created + ' 更新:' + result.updated + ' 削除:' + result.deleted);

  return result;
}
