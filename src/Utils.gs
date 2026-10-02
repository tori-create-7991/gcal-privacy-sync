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
    if (getEventSourceId(event, syncTag) !== null) {
      event.deleteEvent();
      deletedCount++;
    }
  });

  Logger.log(pair.name + ': ' + deletedCount + '件削除');
}

/**
 * 設定から外したソースのコピー（孤児）を削除する
 *
 * コピー先からソースを外す・コピー元を付け替えると、そのソース由来の既存コピーは
 * どのペアからも管理されなくなり残り続ける。設定変更後に手動で1回実行する。
 * 対象は「現在の設定でコピー先になっているカレンダー」の同期期間内の予定のみ。
 * コピー先から完全に外したカレンダーは走査しない。
 */
function clearOrphanedSyncedEvents() {
  const commonConfig = getCommonConfig();
  const allowedByDest = {};

  getSyncPairs().forEach(pair => {
    const syncTag = commonConfig.SYNC_TAG + '[' + pair.sourceCalendarId + ']';
    Object.keys(getOrganizerRoutingDestinationIds(pair)).forEach(destId => {
      if (!allowedByDest[destId]) allowedByDest[destId] = {};
      allowedByDest[destId][syncTag] = true;
    });
  });

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - commonConfig.DAYS_BEFORE);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + commonConfig.DAYS_AFTER);

  Object.keys(allowedByDest).forEach(destId => {
    const destCalendar = CalendarApp.getCalendarById(destId);
    if (!destCalendar) {
      Logger.log('カレンダーが見つかりません: ' + destId);
      return;
    }

    let deletedCount = 0;
    destCalendar.getEvents(startDate, endDate).forEach(event => {
      let tag = null;
      try {
        tag = event.getTag(SYNC_TAG_KEY);
      } catch (e) {
        return;
      }
      if (isOrphanedSyncTag(tag, allowedByDest[destId], commonConfig.SYNC_TAG)) {
        event.deleteEvent();
        deletedCount++;
      }
    });

    Logger.log(destCalendar.getName() + ': 孤児コピー ' + deletedCount + '件削除');
  });
}

/**
 * 追跡タグが「このスクリプトのコピーだが、そのコピー先に対して現在設定されていないソース」かを判定する
 * @param {string|null} tag - 予定の追跡タグ（無ければ null）
 * @param {Object} allowedTags - そのコピー先で有効な追跡タグをキーに持つオブジェクト
 * @param {string} syncTagPrefix - 共通設定の SYNC_TAG
 */
function isOrphanedSyncTag(tag, allowedTags, syncTagPrefix) {
  if (typeof tag !== 'string' || tag.indexOf(syncTagPrefix + '[') !== 0) return false;
  return !(allowedTags && allowedTags[tag] === true);
}

/**
 * 件名が除外リストに一致するかを判定する（前後の空白を除いた完全一致）
 * @param {string} title - 予定の件名
 * @param {Array<string>} excludeTitles - 除外する件名の配列（未指定なら何も除外しない）
 */
function isExcludedTitle(title, excludeTitles) {
  if (!Array.isArray(excludeTitles) || excludeTitles.length === 0) return false;
  const normalized = String(title == null ? '' : title).trim();
  return excludeTitles.some(function(excluded) {
    return String(excluded).trim() === normalized;
  });
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
