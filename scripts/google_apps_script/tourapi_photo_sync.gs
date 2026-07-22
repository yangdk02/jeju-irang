/**
 * 제주아이랑 TourAPI 관광사진 자동 보강
 *
 * Script Properties
 * - TOUR_API_SERVICE_KEY: 공공데이터포털 일반 인증키(Decoding)
 *
 * 관리자 메뉴에서 startTourApiPhotoUpdateAndExport를 한 번 실행하면
 * 여러 배치가 시간 기반 트리거로 이어지고, 완료 후 최종 CSV를 생성합니다.
 */

const TOURAPI_PHOTO_CONFIG = Object.freeze({
  SERVICE_KEY_PROPERTY: 'TOUR_API_SERVICE_KEY',
  MOBILE_APP_PROPERTY: 'TOUR_API_MOBILE_APP',
  BASE_URL:
    'https://apis.data.go.kr/B551011/PhotoGalleryService1/gallerySearchList1',
  DETAIL_URL:
    'https://apis.data.go.kr/B551011/PhotoGalleryService1/galleryDetailList1',
  MASTER_SHEET_NAME: 'jeju_irang_master',
  MAP_SHEET_NAME: 'tourapi_photo_map',
  REVIEW_SHEET_NAME: 'tourapi_photo_review',
  LOG_SHEET_NAME: 'tourapi_photo_log',
  STATE_PROPERTY: 'TOURAPI_PHOTO_SYNC_STATE',
  LAST_RUN_PROPERTY: 'TOURAPI_PHOTO_LAST_RUN',
  CONTINUE_FUNCTION: 'continueTourApiPhotoUpdate_',
  BATCH_SIZE: 20,
  CONTINUE_AFTER_MS: 60 * 1000,
  LOCK_TIMEOUT_MS: 30000,
  TIME_ZONE: 'Asia/Seoul',
});

const TOURAPI_PHOTO_MAP_HEADERS = Object.freeze([
  'place_id',
  'place_name',
  'tourapi_photo_id',
  'tourapi_title',
  'photo_url',
  'photography_month',
  'modified_time',
  'photographer',
  'photo_credit',
  'matched_at',
  'match_method',
]);

const TOURAPI_PHOTO_REVIEW_HEADERS = Object.freeze([
  'run_id',
  'created_at',
  'place_id',
  'place_name',
  'current_photo_url',
  'status',
  'candidate_count',
  'candidate_summary',
]);

const TOURAPI_PHOTO_LOG_HEADERS = Object.freeze([
  'run_id',
  'processed_at',
  'place_id',
  'place_name',
  'result',
  'previous_photo_url',
  'new_photo_url',
  'tourapi_photo_id',
  'photography_month',
  'photographer',
  'message',
]);

/** 관리자 메뉴에서 실행하는 단일 진입점입니다. */
function startTourApiPhotoUpdateAndExport() {
  let spreadsheet = null;
  try {
    const properties = PropertiesService.getScriptProperties();
    const serviceKey = tourApiPhotoText_(
      properties.getProperty(TOURAPI_PHOTO_CONFIG.SERVICE_KEY_PROPERTY)
    );
    if (!serviceKey) {
      throw new Error(
        'Script Properties에 TOUR_API_SERVICE_KEY를 설정해 주세요.'
      );
    }

    spreadsheet = tourApiPhotoGetSpreadsheet_();
    const master = spreadsheet.getSheetByName(
      TOURAPI_PHOTO_CONFIG.MASTER_SHEET_NAME
    );
    if (!master || master.getLastRow() < 2) {
      throw new Error('jeju_irang_master에 장소 데이터가 없습니다.');
    }
    tourApiPhotoRequireMasterHeaders_(master);
    tourApiPhotoEnsureSheets_(spreadsheet);
    tourApiPhotoDeleteContinuationTriggers_();

    const now = new Date();
    const runId =
      'PHOTO-' +
      Utilities.formatDate(
        now,
        TOURAPI_PHOTO_CONFIG.TIME_ZONE,
        'yyyyMMdd-HHmmss'
      );
    const state = {
      runId: runId,
      startedAt: now.toISOString(),
      nextRow: 2,
      lastRow: master.getLastRow(),
      processed: 0,
      updated: 0,
      unchanged: 0,
      review: 0,
      notFound: 0,
      errors: 0,
    };
    properties.setProperty(
      TOURAPI_PHOTO_CONFIG.STATE_PROPERTY,
      JSON.stringify(state)
    );
    tourApiPhotoNotify_(
      spreadsheet,
      '최신 관광사진 검색을 시작했습니다. 완료될 때까지 자동으로 이어집니다.',
      'TourAPI 사진 업데이트',
      8
    );
    continueTourApiPhotoUpdate_();
  } catch (error) {
    if (spreadsheet) {
      tourApiPhotoNotify_(
        spreadsheet,
        '시작하지 못했습니다: ' + error.message,
        'TourAPI 사진 업데이트 오류',
        10
      );
    }
    Logger.log('TourAPI 사진 업데이트 시작 실패: %s', error.stack || error);
    throw error;
  }
}

/** 시간 기반 트리거가 반복 호출하는 배치 처리 함수입니다. */
function continueTourApiPhotoUpdate_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(TOURAPI_PHOTO_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const properties = PropertiesService.getScriptProperties();
    const rawState = properties.getProperty(
      TOURAPI_PHOTO_CONFIG.STATE_PROPERTY
    );
    if (!rawState) {
      tourApiPhotoDeleteContinuationTriggers_();
      return;
    }
    const state = JSON.parse(rawState);
    const spreadsheet = tourApiPhotoGetSpreadsheet_();
    const master = spreadsheet.getSheetByName(
      TOURAPI_PHOTO_CONFIG.MASTER_SHEET_NAME
    );
    if (!master) {
      throw new Error('jeju_irang_master를 찾을 수 없습니다.');
    }
    const headers = tourApiPhotoHeaderMap_(master);
    const endRow = Math.min(
      state.nextRow + TOURAPI_PHOTO_CONFIG.BATCH_SIZE - 1,
      state.lastRow
    );

    for (let row = state.nextRow; row <= endRow; row += 1) {
      const placeId = tourApiPhotoText_(
        master.getRange(row, headers.place_id).getDisplayValue()
      );
      const placeName = tourApiPhotoText_(
        master.getRange(row, headers.place_name).getDisplayValue()
      );
      const previousUrl = tourApiPhotoText_(
        master.getRange(row, headers.photo_url).getDisplayValue()
      );
      if (!placeId || !placeName) {
        tourApiPhotoAppendLog_(spreadsheet, state.runId, {
          placeId: placeId,
          placeName: placeName,
          result: 'SKIPPED',
          previousUrl: previousUrl,
          message: 'place_id 또는 place_name이 비어 있습니다.',
        });
        state.processed += 1;
        state.errors += 1;
        continue;
      }

      try {
        const candidates = tourApiPhotoSearch_(placeName);
        const decision = tourApiPhotoChooseCandidate_(placeName, candidates);
        if (decision.status === 'AUTO_MATCH') {
          const detailCandidates = tourApiPhotoDetailSearch_(
            decision.candidate.galTitle
          );
          const candidate = tourApiPhotoChooseLatestExactPhoto_(
            placeName,
            decision.candidate,
            detailCandidates
          );
          const newUrl = tourApiPhotoSecureUrl_(candidate.galWebImageUrl);
          if (!newUrl) {
            throw new Error('선택된 후보에 이미지 URL이 없습니다.');
          }
          master.getRange(row, headers.photo_url).setValue(newUrl);
          const changed = previousUrl !== newUrl;
          tourApiPhotoAppendLog_(spreadsheet, state.runId, {
            placeId: placeId,
            placeName: placeName,
            result: changed ? 'UPDATED' : 'UNCHANGED',
            previousUrl: previousUrl,
            newUrl: newUrl,
            candidate: candidate,
            message: changed
              ? '최신 촬영 사진으로 교체했습니다.'
              : '현재 사진이 이미 최신 TourAPI 사진입니다.',
          });
          if (changed) {
            state.updated += 1;
          } else {
            state.unchanged += 1;
          }
        } else {
          tourApiPhotoAppendLog_(spreadsheet, state.runId, {
            placeId: placeId,
            placeName: placeName,
            result: decision.status,
            previousUrl: previousUrl,
            message: decision.message,
          });
          if (decision.status === 'NOT_FOUND') {
            state.notFound += 1;
          } else {
            state.review += 1;
          }
        }
      } catch (error) {
        tourApiPhotoAppendLog_(spreadsheet, state.runId, {
          placeId: placeId,
          placeName: placeName,
          result: 'ERROR',
          previousUrl: previousUrl,
          message: error.message,
        });
        state.errors += 1;
      }
      state.processed += 1;
    }

    state.nextRow = endRow + 1;
    properties.setProperty(
      TOURAPI_PHOTO_CONFIG.STATE_PROPERTY,
      JSON.stringify(state)
    );

    if (state.nextRow <= state.lastRow) {
      tourApiPhotoScheduleContinuation_();
      tourApiPhotoNotify_(
        spreadsheet,
        state.processed + '곳 처리 완료. 나머지도 자동으로 계속 처리합니다.',
        'TourAPI 사진 업데이트',
        5
      );
      return;
    }
    tourApiPhotoFinish_(spreadsheet, state);
  } finally {
    lock.releaseLock();
  }
}

function tourApiPhotoFinish_(spreadsheet, state) {
  const properties = PropertiesService.getScriptProperties();
  tourApiPhotoDeleteContinuationTriggers_();
  let exportUrl = '';
  let exportMessage = '';
  try {
    if (typeof exportJejuIrangCsv === 'function') {
      const file = exportJejuIrangCsv();
      if (file && typeof file.getUrl === 'function') {
        exportUrl = file.getUrl();
      }
      exportMessage = '최종 CSV도 생성했습니다.';
    } else {
      exportMessage = 'CSV 내보내기 함수가 없어 master만 갱신했습니다.';
    }
  } catch (error) {
    state.errors += 1;
    exportMessage = '사진은 반영했지만 CSV 생성 실패: ' + error.message;
  }
  state.finishedAt = new Date().toISOString();
  state.exportUrl = exportUrl;
  state.exportMessage = exportMessage;
  tourApiPhotoAppendLog_(spreadsheet, state.runId, {
    result: 'COMPLETE',
    newUrl: exportUrl,
    message: exportMessage + (exportUrl ? ' 최종 CSV: ' + exportUrl : ''),
  });
  properties.setProperty(
    TOURAPI_PHOTO_CONFIG.LAST_RUN_PROPERTY,
    JSON.stringify(state)
  );
  properties.deleteProperty(TOURAPI_PHOTO_CONFIG.STATE_PROPERTY);
  tourApiPhotoNotify_(
    spreadsheet,
    '완료: 교체 ' +
      state.updated +
      '곳 · 유지 ' +
      state.unchanged +
      '곳 · 검수 ' +
      state.review +
      '곳 · 결과 없음 ' +
      state.notFound +
      '곳 · 오류 ' +
      state.errors +
      '곳. ' +
      exportMessage,
    'TourAPI 사진 업데이트 완료',
    15
  );
  Logger.log('TourAPI 사진 업데이트 완료: %s', JSON.stringify(state));
}

/**
 * Spreadsheet에 연결된 실행에서는 토스트를 표시하고, 별도 프로젝트나
 * 시간 기반 트리거에서는 Logger에만 남깁니다.
 */
function tourApiPhotoNotify_(spreadsheet, message, title, seconds) {
  Logger.log('%s: %s', title || 'TourAPI 사진 업데이트', message);
  if (!spreadsheet) return;
  try {
    spreadsheet.toast(message, title || '', seconds || 5);
  } catch (error) {
    Logger.log('화면 알림 생략: %s', error.message);
  }
}

function tourApiPhotoSearch_(placeName) {
  return tourApiPhotoFetchItems_(
    TOURAPI_PHOTO_CONFIG.BASE_URL,
    {
      arrange: 'A',
      numOfRows: '100',
      pageNo: '1',
      keyword: placeName,
    }
  );
}

function tourApiPhotoDetailSearch_(title) {
  return tourApiPhotoFetchItems_(
    TOURAPI_PHOTO_CONFIG.DETAIL_URL,
    {
      numOfRows: '1000',
      pageNo: '1',
      title: title,
    }
  );
}

function tourApiPhotoFetchItems_(baseUrl, requestParameters) {
  const properties = PropertiesService.getScriptProperties();
  const key = tourApiPhotoText_(
    properties.getProperty(TOURAPI_PHOTO_CONFIG.SERVICE_KEY_PROPERTY)
  );
  const mobileApp =
    tourApiPhotoText_(
      properties.getProperty(TOURAPI_PHOTO_CONFIG.MOBILE_APP_PROPERTY)
    ) || 'JejuIrang';
  const queryParts = [
    'serviceKey=' + encodeURIComponent(key),
    'MobileOS=ETC',
    'MobileApp=' + encodeURIComponent(mobileApp),
    '_type=json',
  ];
  Object.keys(requestParameters).forEach(function (name) {
    queryParts.push(
      encodeURIComponent(name) +
        '=' +
        encodeURIComponent(requestParameters[name])
    );
  });
  const url = baseUrl + '?' + queryParts.join('&');
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { Accept: 'application/json' },
    });
    const status = response.getResponseCode();
    const body = response.getContentText('UTF-8');
    if (status >= 200 && status < 300) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new Error('TourAPI가 JSON이 아닌 응답을 반환했습니다.');
      }
      const header = parsed && parsed.response && parsed.response.header;
      const resultCode = header ? String(header.resultCode || '') : '';
      if (resultCode && resultCode !== '0000' && resultCode !== '0') {
        throw new Error(
          'TourAPI 오류 ' + resultCode + ': ' + (header.resultMsg || '')
        );
      }
      const items =
        parsed &&
        parsed.response &&
        parsed.response.body &&
        parsed.response.body.items
          ? parsed.response.body.items.item
          : [];
      if (!items) {
        return [];
      }
      return Array.isArray(items) ? items : [items];
    }
    lastError = new Error(
      'TourAPI HTTP ' + status + ': ' + body.slice(0, 300)
    );
    if (status < 500 && status !== 429) {
      break;
    }
    Utilities.sleep(attempt * 700);
  }
  throw lastError || new Error('TourAPI 호출에 실패했습니다.');
}

function tourApiPhotoChooseLatestExactPhoto_(
  placeName,
  groupedCandidate,
  detailCandidates
) {
  const target = tourApiPhotoNormalizeName_(placeName);
  const eligible = (detailCandidates || []).filter(function (candidate) {
    const title = tourApiPhotoNormalizeName_(candidate.galTitle);
    const jejuEvidence = /제주/.test(
      [
        candidate.galTitle,
        candidate.galPhotographyLocation,
        candidate.galSearchKeyword,
      ].join(' ')
    );
    return title === target && jejuEvidence;
  });
  if (eligible.length === 0) {
    return groupedCandidate;
  }
  eligible.sort(function (left, right) {
    return tourApiPhotoSortDate_(right).localeCompare(
      tourApiPhotoSortDate_(left)
    );
  });
  return eligible[0];
}

function tourApiPhotoChooseCandidate_(placeName, candidates) {
  if (!candidates || candidates.length === 0) {
    return {
      status: 'NOT_FOUND',
      candidates: [],
      message: '검색 결과가 없습니다.',
    };
  }
  const target = tourApiPhotoNormalizeName_(placeName);
  const scored = candidates
    .map(function (candidate) {
      const title = tourApiPhotoNormalizeName_(candidate.galTitle);
      const location = tourApiPhotoText_(candidate.galPhotographyLocation);
      const keywords = tourApiPhotoText_(candidate.galSearchKeyword);
      const jejuEvidence = /제주/.test(
        [candidate.galTitle, location, keywords].join(' ')
      );
      const exact = title === target;
      const related =
        exact ||
        (title && target && (title.indexOf(target) >= 0 || target.indexOf(title) >= 0)) ||
        tourApiPhotoNormalizeName_(keywords).indexOf(target) >= 0;
      let score = 0;
      if (exact) score += 100;
      if (!exact && related) score += 40;
      if (jejuEvidence) score += 50;
      return {
        candidate: candidate,
        exact: exact,
        related: related,
        jejuEvidence: jejuEvidence,
        score: score,
      };
    })
    .filter(function (item) {
      return item.related && item.jejuEvidence;
    });

  scored.sort(function (left, right) {
    if (right.score !== left.score) return right.score - left.score;
    const rightDate = tourApiPhotoSortDate_(right.candidate);
    const leftDate = tourApiPhotoSortDate_(left.candidate);
    return rightDate.localeCompare(leftDate);
  });
  const exactMatches = scored.filter(function (item) {
    return item.exact;
  });
  if (exactMatches.length > 0) {
    return {
      status: 'AUTO_MATCH',
      candidate: exactMatches[0].candidate,
      candidates: scored.map(function (item) {
        return item.candidate;
      }),
      message: '제주 지역의 정확한 장소명 중 최신 촬영 사진을 선택했습니다.',
    };
  }
  return {
    status: 'REVIEW_REQUIRED',
    candidates: scored.length > 0 ? scored.map(function (item) {
      return item.candidate;
    }) : candidates,
    message: '제주 관련 후보는 있으나 장소명이 정확히 일치하지 않습니다.',
  };
}

function tourApiPhotoUpsertMap_(spreadsheet, payload) {
  const sheet = tourApiPhotoEnsureSheet_(
    spreadsheet,
    TOURAPI_PHOTO_CONFIG.MAP_SHEET_NAME,
    TOURAPI_PHOTO_MAP_HEADERS,
    '#DDF4F8'
  );
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    : [];
  let targetRow = sheet.getLastRow() + 1;
  rows.some(function (row, index) {
    if (tourApiPhotoText_(row[0]) === payload.placeId) {
      targetRow = index + 2;
      return true;
    }
    return false;
  });
  const candidate = payload.candidate;
  const photographer = tourApiPhotoText_(candidate.galPhotographer);
  const values = [[
    payload.placeId,
    payload.placeName,
    tourApiPhotoText_(candidate.galContentId),
    tourApiPhotoText_(candidate.galTitle),
    payload.photoUrl,
    tourApiPhotoText_(candidate.galPhotographyMonth),
    tourApiPhotoText_(candidate.galModifiedtime),
    photographer,
    photographer
      ? '한국관광공사 · ' + photographer
      : '한국관광공사 관광사진갤러리',
    new Date(),
    'EXACT_NAME_AND_JEJU',
  ]];
  sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
}

function tourApiPhotoAppendReview_(
  spreadsheet,
  runId,
  placeId,
  placeName,
  currentUrl,
  decision
) {
  const sheet = tourApiPhotoEnsureSheet_(
    spreadsheet,
    TOURAPI_PHOTO_CONFIG.REVIEW_SHEET_NAME,
    TOURAPI_PHOTO_REVIEW_HEADERS,
    '#FFF1C7'
  );
  const candidates = (decision.candidates || []).slice(0, 10);
  const summary = candidates
    .map(function (candidate) {
      return [
        tourApiPhotoText_(candidate.galContentId),
        tourApiPhotoText_(candidate.galTitle),
        tourApiPhotoText_(candidate.galPhotographyLocation),
        tourApiPhotoText_(candidate.galPhotographyMonth),
        tourApiPhotoSecureUrl_(candidate.galWebImageUrl),
      ].join(' | ');
    })
    .join('\n')
    .slice(0, 45000);
  sheet.appendRow([
    runId,
    new Date(),
    placeId,
    placeName,
    currentUrl,
    decision.status,
    decision.candidates ? decision.candidates.length : 0,
    summary || decision.message,
  ]);
}

function tourApiPhotoAppendLog_(spreadsheet, runId, payload) {
  const sheet = tourApiPhotoEnsureSheet_(
    spreadsheet,
    TOURAPI_PHOTO_CONFIG.LOG_SHEET_NAME,
    TOURAPI_PHOTO_LOG_HEADERS,
    '#F3F4F6'
  );
  const candidate = payload.candidate || {};
  sheet.appendRow([
    runId,
    new Date(),
    payload.placeId || '',
    payload.placeName || '',
    payload.result || '',
    payload.previousUrl || '',
    payload.newUrl || '',
    tourApiPhotoText_(candidate.galContentId),
    tourApiPhotoText_(candidate.galPhotographyMonth),
    tourApiPhotoText_(candidate.galPhotographer),
    payload.message || '',
  ]);
}

function tourApiPhotoEnsureSheets_(spreadsheet) {
  tourApiPhotoEnsureSheet_(
    spreadsheet,
    TOURAPI_PHOTO_CONFIG.LOG_SHEET_NAME,
    TOURAPI_PHOTO_LOG_HEADERS,
    '#F3F4F6'
  );
}

function tourApiPhotoEnsureSheet_(spreadsheet, name, headers, color) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }
  const current = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0]
    .map(tourApiPhotoText_);
  if (!current.some(Boolean)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (JSON.stringify(current) !== JSON.stringify(headers)) {
    throw new Error(name + ' 시트의 헤더가 최신 설계와 다릅니다.');
  }
  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground(color)
    .setFontColor('#49382F')
    .setWrap(true);
  sheet.setFrozenRows(1);
  return sheet;
}

function tourApiPhotoRequireMasterHeaders_(sheet) {
  const headers = tourApiPhotoHeaderMap_(sheet);
  ['place_id', 'place_name', 'photo_url'].forEach(function (header) {
    if (!headers[header]) {
      throw new Error('jeju_irang_master에 ' + header + ' 컬럼이 없습니다.');
    }
  });
  return headers;
}

function tourApiPhotoHeaderMap_(sheet) {
  const values = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const map = {};
  values.forEach(function (value, index) {
    const header = tourApiPhotoText_(value);
    if (header) map[header] = index + 1;
  });
  return map;
}

function tourApiPhotoGetSpreadsheet_() {
  if (typeof csvSyncGetSpreadsheet_ === 'function') {
    return csvSyncGetSpreadsheet_();
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('대상 Spreadsheet를 찾을 수 없습니다.');
  return active;
}

function tourApiPhotoScheduleContinuation_() {
  tourApiPhotoDeleteContinuationTriggers_();
  ScriptApp.newTrigger(TOURAPI_PHOTO_CONFIG.CONTINUE_FUNCTION)
    .timeBased()
    .after(TOURAPI_PHOTO_CONFIG.CONTINUE_AFTER_MS)
    .create();
}

function tourApiPhotoDeleteContinuationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (
      trigger.getHandlerFunction() ===
      TOURAPI_PHOTO_CONFIG.CONTINUE_FUNCTION
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function tourApiPhotoSecureUrl_(value) {
  const url = tourApiPhotoText_(value);
  return url.replace(/^http:\/\//i, 'https://');
}

function tourApiPhotoNormalizeName_(value) {
  return tourApiPhotoText_(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');
}

function tourApiPhotoSortDate_(candidate) {
  return (
    tourApiPhotoText_(candidate.galPhotographyMonth) ||
    tourApiPhotoText_(candidate.galModifiedtime) ||
    tourApiPhotoText_(candidate.galCreatedtime)
  ).replace(/\D/g, '');
}

function tourApiPhotoText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
