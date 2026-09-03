/**
 * イベント操作関数
 */

/**
 * 新しい予定を作成する
 */
function createEvent(destCalendar, sourceEvent, pair, syncTag, uniqueKey, commonConfig) {
  const title = pair.eventTitle || sourceEvent.getTitle();
  const effectiveConfig = buildEffectiveConfig(commonConfig, pair);
  const description = buildDisplayDescription(sourceEvent, effectiveConfig);

  let newEvent;

  if (sourceEvent.isAllDayEvent()) {
    const startDate = sourceEvent.getAllDayStartDate();
    const endDate = sourceEvent.getAllDayEndDate();

    if (endDate.getTime() - startDate.getTime() > 24 * 60 * 60 * 1000) {
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setDate(adjustedEndDate.getDate() - 1);
      newEvent = destCalendar.createAllDayEvent(title, startDate, adjustedEndDate);
    } else {
      newEvent = destCalendar.createAllDayEvent(title, startDate);
    }
  } else {
    newEvent = destCalendar.createEvent(
      title,
      sourceEvent.getStartTime(),
      sourceEvent.getEndTime()
    );
  }

  newEvent.setDescription(description);
  applySyncTags(newEvent, syncTag, uniqueKey);

  if (pair.eventColor) {
    newEvent.setColor(String(pair.eventColor));
  }

  applyVisibilityConfig(newEvent, effectiveConfig);

  return newEvent;
}

/**
 * 既存の予定を更新する
 */
function updateEvent(existingEvent, sourceEvent, pair, syncTag, uniqueKey, commonConfig) {
  const title = pair.eventTitle || sourceEvent.getTitle();
  const effectiveConfig = buildEffectiveConfig(commonConfig, pair);

  existingEvent.setTitle(title);

  if (sourceEvent.isAllDayEvent()) {
    existingEvent.setAllDayDate(sourceEvent.getAllDayStartDate());
  } else {
    existingEvent.setTime(sourceEvent.getStartTime(), sourceEvent.getEndTime());
  }

  existingEvent.setDescription(buildDisplayDescription(sourceEvent, effectiveConfig));
  applySyncTags(existingEvent, syncTag, uniqueKey);

  if (pair.eventColor) {
    existingEvent.setColor(String(pair.eventColor));
  }

  applyVisibilityConfig(existingEvent, effectiveConfig);
}

/**
 * 予定の更新が必要かチェックする
 */
function needsUpdate(sourceEvent, existingEvent, pair, commonConfig, syncTag, uniqueKey) {
  const expectedTitle = pair.eventTitle || sourceEvent.getTitle();

  if (existingEvent.getTitle() !== expectedTitle) {
    return true;
  }

  if (sourceEvent.isAllDayEvent()) {
    if (!existingEvent.isAllDayEvent()) {
      return true;
    }
    if (sourceEvent.getAllDayStartDate().getTime() !== existingEvent.getAllDayStartDate().getTime()) {
      return true;
    }
  } else {
    if (existingEvent.isAllDayEvent()) {
      return true;
    }
    if (sourceEvent.getStartTime().getTime() !== existingEvent.getStartTime().getTime()) {
      return true;
    }
    if (sourceEvent.getEndTime().getTime() !== existingEvent.getEndTime().getTime()) {
      return true;
    }
  }

  // description (descriptionMode 差分など) の差分を検出
  const effectiveConfig = buildEffectiveConfig(commonConfig, pair);
  const expectedDesc = buildDisplayDescription(sourceEvent, effectiveConfig);
  if ((existingEvent.getDescription() || '') !== expectedDesc) {
    return true;
  }

  // 同期タグの差分を検出（旧description埋め込み方式からの移行や再同期を確実に検出する）
  if (getEventSourceId(existingEvent, syncTag) !== uniqueKey) {
    return true;
  }

  // busy/free の差分を検出
  if (effectiveConfig.SHOW_AS_BUSY != null) {
    try {
      const expectedTransparency = effectiveConfig.SHOW_AS_BUSY
        ? CalendarApp.EventTransparency.OPAQUE
        : CalendarApp.EventTransparency.TRANSPARENT;
      if (existingEvent.getTransparency && existingEvent.getTransparency() !== expectedTransparency) {
        return true;
      }
    } catch (e) {
      // ignore (API unavailable)
    }
  }

  return false;
}

/**
 * 予定の説明文を作成する（ユーザーに見える内容のみ。同期の追跡情報は含まない）
 *
 * DESCRIPTION_MODE:
 *   'full' - 元イベントのdescriptionをそのままコピー
 *   'link' - 元予定へのリンクのみ
 *   'none' - 常に空文字（デフォルト）
 */
function buildDisplayDescription(sourceEvent, effectiveConfig) {
  const mode = effectiveConfig.DESCRIPTION_MODE;

  if (mode === 'full') {
    return sourceEvent.getDescription() || '';
  }

  if (mode === 'link') {
    const eventUrl = 'https://calendar.google.com/calendar/event?eid=' +
      Utilities.base64Encode(sourceEvent.getId().split('@')[0] + ' ' + effectiveConfig.sourceCalendarId);
    return '元の予定: ' + eventUrl;
  }

  return '';
}

/**
 * 同期の追跡情報（SYNC_TAG / SourceID）を予定の非表示メタデータ（Tag）に書き込む
 * descriptionには一切書き込まない
 */
function applySyncTags(event, syncTag, uniqueKey) {
  event.setTag(SYNC_TAG_KEY, syncTag);
  event.setTag(SOURCE_ID_TAG_KEY, uniqueKey);
}

/**
 * 予定の非表示メタデータから、このスクリプトが作成したコピーかどうかを判定し、
 * そうであれば SourceID を返す（syncTag が一致しない/タグが無い場合は null）
 */
function getEventSourceId(event, expectedSyncTag) {
  try {
    if (event.getTag(SYNC_TAG_KEY) !== expectedSyncTag) {
      return null;
    }
    return event.getTag(SOURCE_ID_TAG_KEY) || null;
  } catch (e) {
    return null;
  }
}

/**
 * 共通設定 + コピー先設定をマージした設定を作る
 */
function buildEffectiveConfig(commonConfig, pair) {
  const descriptionMode = pair.descriptionMode != null
    ? pair.descriptionMode
    : (pair.includeOriginalLink != null
        ? (pair.includeOriginalLink ? 'link' : 'none')
        : (commonConfig.INCLUDE_ORIGINAL_LINK ? 'link' : 'none'));

  return Object.assign({}, commonConfig, {
    SHOW_AS_BUSY: pair.showAsBusy != null ? pair.showAsBusy : commonConfig.SHOW_AS_BUSY,
    DESCRIPTION_MODE: descriptionMode,
    sourceCalendarId: pair.sourceCalendarId,
  });
}

/**
 * 予定の「予定あり/空き」を反映する
 */
function applyVisibilityConfig(event, config) {
  try {
    if (config.SHOW_AS_BUSY == null) {
      return;
    }
    event.setTransparency(
      config.SHOW_AS_BUSY ? CalendarApp.EventTransparency.OPAQUE : CalendarApp.EventTransparency.TRANSPARENT
    );
  } catch (e) {
    // ignore
  }
}
