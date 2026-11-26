/**
 * 詳細の公開（disclose）
 *
 * 既定ではコピー先に「予定あり」などの匿名化した内容だけを入れる。
 * コピー先の設定に disclose を書いたときだけ、条件に合う予定について
 * 件名・説明文・場所・終日予定を元のままコピーする（オプトイン）。
 *
 *   disclose: {
 *     always: false,              // true: このコピー元の全予定を公開（元カレンダー単位）
 *     markers: ['#公開'],         // 件名か説明文にいずれかを含む予定を公開（予定単位）
 *     eventTitle: '',             // 公開時の件名。省略か '' で元の件名
 *     descriptionMode: 'full',    // 公開時の説明文: 'full' | 'link' | 'none'（省略時 'none'）
 *     location: true,             // 公開時に場所もコピーするか（省略時 false）
 *     allDay: true,               // 公開する終日予定もコピーするか（省略時 false。Outlook へ送るフローが終日に対応してから有効にする）
 *     stripMarker: true,          // コピーの件名・説明文から目印を取り除くか（省略時 true）
 *   }
 *
 * 失敗したときに公開側へ倒れないよう、always が true でない場合は
 * markers に合致した予定だけが公開される（設定の書き間違いは匿名のままになる）。
 */

var DISCLOSE_DESCRIPTION_MODES = ['full', 'link', 'none'];

/**
 * disclose 設定を検証・正規化する。無効・未設定なら null（公開しない）
 */
function normalizeDisclose(disclose) {
  if (!disclose || typeof disclose !== 'object') return null;

  var markers = [];
  if (Array.isArray(disclose.markers)) {
    disclose.markers.forEach(function(m) {
      if (typeof m !== 'string') return;
      var t = m.trim();
      if (t) markers.push(t);
    });
  }
  var always = disclose.always === true;
  if (!always && markers.length === 0) return null;

  var mode = DISCLOSE_DESCRIPTION_MODES.indexOf(disclose.descriptionMode) !== -1
    ? disclose.descriptionMode
    : 'none';

  return {
    always: always,
    markers: markers,
    eventTitle: typeof disclose.eventTitle === 'string' ? disclose.eventTitle : '',
    descriptionMode: mode,
    location: disclose.location === true,
    allDay: disclose.allDay === true,
    stripMarker: disclose.stripMarker !== false,
  };
}

/**
 * 予定が公開対象か（目印は大文字小文字を区別しない）
 * @returns {boolean}
 */
function isDisclosedEvent(sourceEvent, normalized) {
  if (!normalized) return false;
  if (normalized.always) return true;
  var haystack = ((sourceEvent.getTitle() || '') + '\n' + (sourceEvent.getDescription() || '')).toLowerCase();
  return normalized.markers.some(function(m) {
    return haystack.indexOf(m.toLowerCase()) !== -1;
  });
}

/**
 * 文字列から目印を取り除き、前後の空白を整える
 */
function stripMarkers(text, markers) {
  var out = String(text == null ? '' : text);
  (markers || []).forEach(function(m) {
    if (!m) return;
    var escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '');
  });
  return out.replace(/[ \t　]+/g, ' ').replace(/^\s+|\s+$/g, '');
}

/**
 * 予定ごとの有効なコピー設定を返す。
 * 公開対象なら件名・説明文・場所の設定を上書きし、そうでなければ元の設定のまま返す。
 * @returns {{pair: Object, disclosed: boolean}}
 */
function applyDisclosure(pair, sourceEvent) {
  var normalized = normalizeDisclose(pair.disclose);
  if (!isDisclosedEvent(sourceEvent, normalized)) {
    return { pair: pair, disclosed: false };
  }
  var next = Object.assign({}, pair, {
    eventTitle: normalized.eventTitle,
    descriptionMode: normalized.descriptionMode,
    includeLocation: normalized.location,
    stripMarkers: normalized.stripMarker ? normalized.markers : [],
  });
  next.allDayAllowed = normalized.allDay;
  return { pair: next, disclosed: true };
}

/**
 * 終日予定をコピーするか。公開対象は disclose.allDay、それ以外はコピー先の
 * copyAllDayEvents（未指定なら共通設定の COPY_ALL_DAY_EVENTS）に従う
 */
function shouldCopyAllDay(pair, disclosed, commonConfig) {
  if (disclosed) return pair.allDayAllowed !== false;
  if (pair.copyAllDayEvents != null) return pair.copyAllDayEvents === true;
  return commonConfig.COPY_ALL_DAY_EVENTS === true;
}

/**
 * コピー先に付ける件名。元の件名を使うときだけ目印を取り除く
 */
function getCopyTitle(sourceEvent, pair) {
  if (pair.eventTitle) return pair.eventTitle;
  var original = sourceEvent.getTitle();
  var stripped = stripMarkers(original, pair.stripMarkers);
  return stripped || original;
}

/**
 * コピー先に付ける場所（公開設定でなければ常に空）
 */
function getCopyLocation(sourceEvent, pair) {
  if (!pair.includeLocation) return '';
  return stripMarkers(sourceEvent.getLocation() || '', pair.stripMarkers);
}
