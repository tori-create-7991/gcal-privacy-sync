/**
 * ユーティリティ関数
 */

/**
 * 利用可能なカレンダー一覧を表示する
 */
function listCalendars() {
  const calendars = CalendarApp.getAllCalendars();

  Logger.log('===== 利用可能なカレンダー一覧 =====');
  calendars.forEach((calendar, index) => {
    Logger.log((index + 1) + '. ' + calendar.getName());
    Logger.log('   ID: ' + calendar.getId());
    Logger.log('   ---');
  });
  Logger.log('合計: ' + calendars.length + '件');
}

/**
 * 同期済みの予定をすべて削除する（リセット用）
 */
function clearSyncedEvents() {
  const syncPairs = getSyncPairs();
  const commonConfig = getCommonConfig();

  syncPairs.forEach(pair => {
    const destCalendar = CalendarApp.getCalendarById(pair.destCalendarId);
    if (!destCalendar) {
      Logger.log('カレンダーが見つかりません: ' + pair.destCalendarId);
      return;
    }

    const syncTag = commonConfig.SYNC_TAG + '[' + pair.sourceCalendarId + ']';

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - commonConfig.DAYS_BEFORE);

    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + commonConfig.DAYS_AFTER);

    const events = destCalendar.getEvents(startDate, endDate);
    let deletedCount = 0;

    events.forEach(event => {
      if (getEventSourceId(event, syncTag) !== null) {
        event.deleteEvent();
        deletedCount++;
      }
    });

    Logger.log(pair.name + ': ' + deletedCount + '件削除');
  });
}

/**
 * 特定のカレンダーペアの同期済み予定を削除する
 * @param {number} pairIndex - 削除するペアのインデックス（0から開始）
 */
function clearSyncedEventsForPair(pairIndex) {
  const syncPairs = getSyncPairs();
  const commonConfig = getCommonConfig();

  if (pairIndex < 0 || pairIndex >= syncPairs.length) {
    Logger.log('無効なインデックスです: ' + pairIndex);
    return;
  }

  const pair = syncPairs[pairIndex];
  const destCalendar = CalendarApp.getCalendarById(pair.destCalendarId);

  if (!destCalendar) {
    Logger.log('カレンダーが見つかりません: ' + pair.destCalendarId);
    return;
  }

  const syncTag = commonConfig.SYNC_TAG + '[' + pair.sourceCalendarId + ']';

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - commonConfig.DAYS_BEFORE);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + commonConfig.DAYS_AFTER);

  const events = destCalendar.getEvents(startDate, endDate);
  let deletedCount = 0;

  events.forEach(event => {
    const desc = event.getDescription() || '';
    if (desc.includes(syncTag)) {
      event.deleteEvent();
      deletedCount++;
    }
  });

  Logger.log(pair.name + ': ' + deletedCount + '件削除');
}

/**
 * 招待されているが「参加しない」予定かどうかを判定する
 * 対象: いいえ（辞退）/ 未回答（まだ返事していない）
 * 自分が主催者(OWNER)・参加済み(YES)・保留(MAYBE)・招待者のいない単独の予定は対象外
 */
function isNotAttending(event) {
  try {
    const status = event.getMyStatus();
    return status === CalendarApp.GuestStatus.NO || status === CalendarApp.GuestStatus.INVITED;
  } catch (e) {
    return false;
  }
}

/**
 * ログ出力
 */
function log(message) {
  Logger.log(message);
}

/**
 * デバッグログ出力
 */
function debugLog(message, config) {
  if (config && config.DEBUG_MODE) {
    Logger.log('[DEBUG] ' + message);
  }
}
