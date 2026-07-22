/**
 * 제주아이랑 국문 관광정보(KorService2) 자동 보강
 *
 * 같은 Apps Script 프로젝트에 csv_sync_export.gs와 tourapi_photo_sync.gs가
 * 있어야 합니다. Script Properties는 다음 값을 사용합니다.
 * - TOUR_API_SERVICE_KEY: 공공데이터포털 일반 인증키(Decoding)
 * - JEJU_IRANG_SPREADSHEET_ID: 관리 Spreadsheet ID
 * - TOUR_API_MOBILE_APP: 선택, 기본값 JejuIrang
 *
 * 관리자가 startAllTourDataUpdateAndExport를 한 번 실행하면 현재 master의
 * 신규/변경 장소를 보강하고, 이어서 최신 관광사진을 확인한 뒤 CSV를 만듭니다.
 */

const TOURAPI_KOR_CONFIG = Object.freeze({
  SERVICE_KEY_PROPERTY: 'TOUR_API_SERVICE_KEY',
  MOBILE_APP_PROPERTY: 'TOUR_API_MOBILE_APP',
  BASE_URL: 'https://apis.data.go.kr/B551011/KorService2/',
  MASTER_SHEET_NAME: 'jeju_irang_master',
  MAP_SHEET_NAME: 'tourapi_kor_map',
  REVIEW_SHEET_NAME: 'tourapi_kor_review',
  LOG_SHEET_NAME: 'tourapi_kor_log',
  STATE_PROPERTY: 'TOURAPI_KOR_SYNC_STATE',
  LAST_RUN_PROPERTY: 'TOURAPI_KOR_LAST_RUN',
  CONTINUE_FUNCTION: 'continueTourApiKorUpdate_',
  PHOTO_START_FUNCTION: 'startTourApiPhotoUpdateAndExport',
  BATCH_SIZE: 4,
  CONTINUE_AFTER_MS: 60 * 1000,
  LOCK_TIMEOUT_MS: 30000,
  TIME_ZONE: 'Asia/Seoul',
});

const TOURAPI_KOR_MAP_HEADERS = Object.freeze([
  'place_id', 'place_name', 'source_hash', 'contentid', 'contenttypeid',
  'tourapi_title', 'tourapi_modifiedtime', 'matched_at', 'last_synced_at',
  'match_method', 'last_result', 'last_message',
]);
const TOURAPI_KOR_REVIEW_HEADERS = Object.freeze([
  'run_id', 'created_at', 'place_id', 'place_name', 'status',
  'candidate_count', 'candidate_summary',
]);
const TOURAPI_KOR_LOG_HEADERS = Object.freeze([
  'run_id', 'processed_at', 'place_id', 'place_name', 'result', 'contentid',
  'applied_fields', 'message',
]);

/** 국문 정보 → 최신 사진 → CSV 생성의 단일 실행 버튼입니다. */
function startAllTourDataUpdateAndExport() {
  let spreadsheet = null;
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = tourApiKorText_(
      properties.getProperty(TOURAPI_KOR_CONFIG.SERVICE_KEY_PROPERTY)
    );
    if (!key) {
      throw new Error('Script Properties에 TOUR_API_SERVICE_KEY를 설정해 주세요.');
    }
    spreadsheet = tourApiKorGetSpreadsheet_();
    tourApiKorCleanupLeanStorage_(spreadsheet);
    if (typeof csvSyncEnsureStructuredSheet_ === 'function') {
      csvSyncEnsureStructuredSheet_(
        spreadsheet,
        TOURAPI_KOR_CONFIG.MASTER_SHEET_NAME,
        CSV_SYNC_PLACE_HEADERS,
        '#DDF5EC'
      );
    }
    const master = spreadsheet.getSheetByName(TOURAPI_KOR_CONFIG.MASTER_SHEET_NAME);
    if (!master || master.getLastRow() < 2) {
      throw new Error('jeju_irang_master에 장소 데이터가 없습니다.');
    }
    tourApiKorRequireMasterHeaders_(master);
    tourApiKorEnsureSheets_(spreadsheet);
    tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION);
    tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.PHOTO_START_FUNCTION);

    const now = new Date();
    const state = {
      runId: 'KOR-' + Utilities.formatDate(now, TOURAPI_KOR_CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss'),
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
    properties.setProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY, JSON.stringify(state));
    tourApiKorNotify_(spreadsheet, '국문 관광정보 보강을 시작했습니다.', '제주아이랑 데이터 업데이트', 8);
    continueTourApiKorUpdate_();
  } catch (error) {
    Logger.log('국문 관광정보 업데이트 시작 실패: %s', error.stack || error);
    if (spreadsheet) {
      tourApiKorNotify_(spreadsheet, '시작 실패: ' + error.message, '데이터 업데이트 오류', 10);
    }
    throw error;
  }
}

/** 중단된 실행을 처음부터 다시 시작할 때 사용합니다. */
function restartAllTourDataUpdateAndExport() {
  PropertiesService.getScriptProperties().deleteProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY);
  tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION);
  startAllTourDataUpdateAndExport();
}

/**
 * 상태가 오래 남아 진행되지 않는 실행을 안전하게 정리하고 1분 뒤 다시
 * 시작합니다. 정상 진행 중에는 사용하지 않습니다.
 */
function recoverStuckTourApiKorUpdate() {
  const lock = LockService.getScriptLock();
  lock.waitLock(TOURAPI_KOR_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const properties = PropertiesService.getScriptProperties();
    properties.deleteProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY);
    tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION);
    tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.PHOTO_START_FUNCTION);
    tourApiKorDeleteTriggers_('startAllTourDataUpdateAndExport');
    tourApiKorSchedule_('startAllTourDataUpdateAndExport', 60 * 1000);
    const spreadsheet = tourApiKorGetSpreadsheet_();
    tourApiKorNotify_(
      spreadsheet,
      '멈춘 상태를 정리했습니다. 1분 뒤 국문 관광정보 업데이트를 처음부터 다시 시작합니다.',
      '제주아이랑 업데이트 복구',
      12
    );
    Logger.log('멈춘 국문 관광정보 상태를 정리하고 재시작을 예약했습니다.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 반려동물 기능과 불필요한 TourAPI 보조 시트를 한 번에 정리합니다.
 * Form 원본, review_queue, master의 기존 장소 정보, sync_log는 보존합니다.
 */
function cleanupTourApiSheetsAndRemovePetColumns() {
  const lock = LockService.getScriptLock();
  lock.waitLock(TOURAPI_KOR_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const properties = PropertiesService.getScriptProperties();
    properties.deleteProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY);
    properties.deleteProperty('TOURAPI_KOR_PET_REFRESH_PENDING');
    [
      TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION,
      TOURAPI_KOR_CONFIG.PHOTO_START_FUNCTION,
      'refreshAllTourApiPetInformation',
      'startAllTourDataUpdateAndExport',
      'continueTourApiPhotoUpdate_',
    ].forEach(tourApiKorDeleteTriggers_);

    const spreadsheet = tourApiKorGetSpreadsheet_();
    tourApiKorCleanupLeanStorage_(spreadsheet);
    let exportUrl = '';
    if (typeof exportJejuIrangCsv === 'function') {
      const file = exportJejuIrangCsv();
      if (file && typeof file.getUrl === 'function') exportUrl = file.getUrl();
    }
    tourApiKorNotify_(
      spreadsheet,
      '반려동물 컬럼과 불필요한 보조 시트를 정리했습니다.' +
        (exportUrl ? ' 새 CSV도 생성했습니다.' : ''),
      '제주아이랑 시트 정리 완료',
      12
    );
    Logger.log('시트 정리 완료. CSV: %s', exportUrl);
  } finally {
    lock.releaseLock();
  }
}

function continueTourApiKorUpdate_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(TOURAPI_KOR_CONFIG.LOCK_TIMEOUT_MS);
  try {
    const properties = PropertiesService.getScriptProperties();
    const rawState = properties.getProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY);
    if (!rawState) {
      tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION);
      return;
    }
    const state = JSON.parse(rawState);
    const spreadsheet = tourApiKorGetSpreadsheet_();
    const master = spreadsheet.getSheetByName(TOURAPI_KOR_CONFIG.MASTER_SHEET_NAME);
    const headers = tourApiKorHeaderMap_(master);
    const endRow = Math.min(state.nextRow + TOURAPI_KOR_CONFIG.BATCH_SIZE - 1, state.lastRow);

    for (let row = state.nextRow; row <= endRow; row += 1) {
      const record = tourApiKorReadRecord_(master, row, headers);
      if (!record.place_id || !record.place_name) {
        state.errors += 1;
        state.processed += 1;
        tourApiKorAppendLog_(spreadsheet, state.runId, record, 'SKIPPED', '', [], 'place_id 또는 place_name이 비어 있습니다.');
        continue;
      }
      try {
        const candidates = tourApiKorSearch_(record.place_name);
        const decision = tourApiKorChooseCandidate_(record, candidates);
        if (decision.status !== 'AUTO_MATCH') {
          tourApiKorAppendReview_(spreadsheet, state.runId, record, decision);
          tourApiKorAppendLog_(spreadsheet, state.runId, record, decision.status, '', [], decision.message);
          if (decision.status === 'NOT_FOUND') state.notFound += 1;
          else state.review += 1;
          state.processed += 1;
          continue;
        }

        const candidate = decision.candidate;
        const mapRow = tourApiKorFindMap_(spreadsheet, record.place_id);
        const sourceHash = tourApiKorHash_([
          record.place_name, record.road_address, record.latitude, record.longitude,
        ].join('|'));
        const unchanged = mapRow &&
          mapRow.source_hash === sourceHash &&
          mapRow.contentid === tourApiKorText_(candidate.contentid) &&
          mapRow.tourapi_modifiedtime === tourApiKorText_(candidate.modifiedtime);
        if (unchanged) {
          tourApiKorUpsertMap_(spreadsheet, record, candidate, sourceHash, 'UNCHANGED', '원본과 TourAPI 수정 시각이 같습니다.');
          tourApiKorAppendLog_(spreadsheet, state.runId, record, 'UNCHANGED', candidate.contentid, [], '변경 사항이 없어 상세 API 호출을 생략했습니다.');
          state.unchanged += 1;
          state.processed += 1;
          continue;
        }

        const detail = tourApiKorFetchDetail_(candidate);
        const applied = tourApiKorApplyToMaster_(master, row, headers, record, candidate, detail);
        tourApiKorUpsertMap_(spreadsheet, record, candidate, sourceHash, 'UPDATED', applied.length ? 'master 보강 완료' : '새로 적용할 값 없음');
        tourApiKorAppendLog_(spreadsheet, state.runId, record, applied.length ? 'UPDATED' : 'UNCHANGED', candidate.contentid, applied, '국문 관광정보를 저장했습니다.');
        if (applied.length) state.updated += 1;
        else state.unchanged += 1;
      } catch (error) {
        state.errors += 1;
        tourApiKorAppendLog_(spreadsheet, state.runId, record, 'ERROR', '', [], error.message);
      }
      state.processed += 1;
    }

    state.nextRow = endRow + 1;
    properties.setProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY, JSON.stringify(state));
    if (state.nextRow <= state.lastRow) {
      tourApiKorSchedule_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION, TOURAPI_KOR_CONFIG.CONTINUE_AFTER_MS);
      tourApiKorNotify_(spreadsheet, state.processed + '곳 처리 완료. 자동으로 계속합니다.', '국문 관광정보', 5);
      return;
    }
    tourApiKorFinish_(spreadsheet, state);
  } finally {
    lock.releaseLock();
  }
}

function tourApiKorFetchDetail_(candidate) {
  const contentId = tourApiKorText_(candidate.contentid);
  const contentTypeId = tourApiKorText_(candidate.contenttypeid);
  const common = tourApiKorFetchItems_('detailCommon2', {
    contentId: contentId, contentTypeId: contentTypeId, defaultYN: 'Y',
    firstImageYN: 'Y', areacodeYN: 'Y', catcodeYN: 'Y', addrinfoYN: 'Y',
    mapinfoYN: 'Y', overviewYN: 'Y',
  });
  return {
    common: common,
    intro: tourApiKorFetchItems_('detailIntro2', {contentId: contentId, contentTypeId: contentTypeId}),
  };
}

function tourApiKorSearch_(placeName) {
  return tourApiKorFetchItems_('searchKeyword2', {
    keyword: placeName, numOfRows: '50', pageNo: '1', arrange: 'O',
  });
}

function tourApiKorFetchItems_(endpoint, parameters) {
  const properties = PropertiesService.getScriptProperties();
  const key = tourApiKorText_(properties.getProperty(TOURAPI_KOR_CONFIG.SERVICE_KEY_PROPERTY));
  const app = tourApiKorText_(properties.getProperty(TOURAPI_KOR_CONFIG.MOBILE_APP_PROPERTY)) || 'JejuIrang';
  const query = [
    'serviceKey=' + encodeURIComponent(key), 'MobileOS=ETC',
    'MobileApp=' + encodeURIComponent(app), '_type=json',
  ];
  Object.keys(parameters || {}).forEach(function (name) {
    query.push(encodeURIComponent(name) + '=' + encodeURIComponent(parameters[name]));
  });
  const url = TOURAPI_KOR_CONFIG.BASE_URL + endpoint + '?' + query.join('&');
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true, followRedirects: true,
      headers: {Accept: 'application/json'},
    });
    const status = response.getResponseCode();
    const body = response.getContentText('UTF-8');
    if (status >= 200 && status < 300) {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch (error) { throw new Error(endpoint + '가 JSON이 아닌 응답을 반환했습니다.'); }
      const header = parsed && parsed.response && parsed.response.header;
      const code = header ? String(header.resultCode || '') : '';
      if (code && code !== '0000' && code !== '0') {
        throw new Error(endpoint + ' 오류 ' + code + ': ' + (header.resultMsg || ''));
      }
      const item = parsed && parsed.response && parsed.response.body &&
        parsed.response.body.items ? parsed.response.body.items.item : [];
      if (!item) return [];
      return Array.isArray(item) ? item : [item];
    }
    lastError = new Error(endpoint + ' HTTP ' + status + ': ' + body.slice(0, 300));
    if (status < 500 && status !== 429) break;
    Utilities.sleep(attempt * 800);
  }
  throw lastError || new Error(endpoint + ' 호출 실패');
}

function tourApiKorChooseCandidate_(record, candidates) {
  const wanted = tourApiKorNormalizeName_(record.place_name);
  const scored = (candidates || []).map(function (candidate) {
    const title = tourApiKorNormalizeName_(candidate.title);
    const address = tourApiKorText_(candidate.addr1) + ' ' + tourApiKorText_(candidate.addr2);
    const exact = title === wanted;
    const jeju = /제주/.test(address) || tourApiKorText_(candidate.lDongRegnCd) === '50';
    let score = exact ? 100 : 0;
    if (jeju) score += 30;
    if (record.legal_dong_name && address.indexOf(record.legal_dong_name) >= 0) score += 20;
    const distance = tourApiKorDistanceKm_(record.latitude, record.longitude, candidate.mapy, candidate.mapx);
    if (distance !== null && distance < 1) score += 20;
    else if (distance !== null && distance < 5) score += 10;
    return {candidate: candidate, exact: exact, jeju: jeju, score: score, distance: distance};
  }).filter(function (item) { return item.exact && item.jeju; });
  scored.sort(function (a, b) { return b.score - a.score; });
  if (!scored.length) {
    return {status: candidates && candidates.length ? 'REVIEW_REQUIRED' : 'NOT_FOUND', candidates: candidates || [], message: candidates && candidates.length ? '제주의 정확한 장소명 후보를 자동 확정할 수 없습니다.' : '검색 결과가 없습니다.'};
  }
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return {status: 'REVIEW_REQUIRED', candidates: scored.map(function (item) { return item.candidate; }), message: '동점인 정확한 후보가 여러 개입니다.'};
  }
  return {status: 'AUTO_MATCH', candidate: scored[0].candidate, candidates: scored.map(function (item) { return item.candidate; }), message: '장소명과 제주 위치가 일치합니다.'};
}

function tourApiKorApplyToMaster_(sheet, row, headers, record, candidate, detail) {
  const common = detail.common[0] || candidate || {};
  const intro = detail.intro[0] || {};
  const proposals = {
    road_address: tourApiKorJoin_([common.addr1, common.addr2]),
    latitude: tourApiKorText_(common.mapy || candidate.mapy),
    longitude: tourApiKorText_(common.mapx || candidate.mapx),
    phone: tourApiKorCleanHtml_(common.tel),
    website_url: tourApiKorFirstUrl_(common.homepage),
    closed_days: tourApiKorFirstValue_(intro, ['restdate', 'restdateculture', 'restdatefestival', 'restdateleports', 'restdateshopping', 'restdatefood', 'checkintime']),
    opening_hours: tourApiKorFirstValue_(intro, ['usetime', 'usetimeculture', 'playtime', 'usetimeleports', 'opentimefood', 'opentime', 'checkintime']),
    admission_fee_detail: tourApiKorFirstValue_(intro, ['usefee', 'usetimefestival', 'usefeeleports', 'parkingfee', 'parkingfeelevports']),
    age_limit_detail: tourApiKorFirstValue_(intro, ['expagerange', 'agelimit', 'expagerangeleports']),
    description: tourApiKorCleanHtml_(common.overview),
  };
  const feeText = proposals.admission_fee_detail;
  if (feeText) proposals.has_admission_fee = /무료|없음/.test(feeText) ? 'FALSE' : 'TRUE';
  const ageText = proposals.age_limit_detail;
  if (ageText) proposals.has_age_limit = /없음|전\s*연령|누구나|제한\s*없/.test(ageText) ? 'FALSE' : 'TRUE';
  const stroller = tourApiKorFirstValue_(intro, ['chkbabycarriage', 'chkbabycarriageculture', 'chkbabycarriageleports', 'chkbabycarriageshopping']);
  if (stroller) proposals.stroller_rental = /불가|없음|안됨/.test(stroller) ? 'FALSE' : (/가능|대여/.test(stroller) ? 'TRUE' : '');
  const parking = tourApiKorFirstValue_(intro, ['parking', 'parkingculture', 'parkingleports', 'parkingshopping', 'parkingfood', 'parkinglodging']);
  if (parking) {
    if (/불가|없음/.test(parking)) proposals.parking = '주차 불가';
    else if (/무료/.test(parking) && /유료/.test(parking)) proposals.parking = '무료/유료 주차';
    else if (/무료/.test(parking)) proposals.parking = '무료';
    else if (/유료/.test(parking)) proposals.parking = '유료';
  }
  if (!record.photo_url) proposals.photo_url = tourApiKorText_(common.firstimage || common.firstimage2);

  const applied = [];
  Object.keys(proposals).forEach(function (field) {
    if (!headers[field]) return;
    const value = tourApiKorText_(proposals[field]);
    if (!value) return;
    const current = tourApiKorText_(sheet.getRange(row, headers[field]).getDisplayValue());
    if (current !== value) {
      sheet.getRange(row, headers[field]).setValue(value);
      applied.push(field);
    }
  });
  return applied;
}

function tourApiKorUpsertMap_(spreadsheet, record, candidate, sourceHash, result, message) {
  const sheet = tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.MAP_SHEET_NAME, TOURAPI_KOR_MAP_HEADERS, '#DDF4F8');
  let target = sheet.getLastRow() + 1;
  if (sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, TOURAPI_KOR_MAP_HEADERS.length).getDisplayValues();
    values.some(function (value, index) {
      if (tourApiKorText_(value[0]) === record.place_id) {
        target = index + 2;
        return true;
      }
      return false;
    });
  }
  sheet.getRange(target, 1, 1, TOURAPI_KOR_MAP_HEADERS.length).setValues([[
    record.place_id, record.place_name, sourceHash, candidate.contentid || '', candidate.contenttypeid || '', candidate.title || '',
    candidate.modifiedtime || '', new Date(), new Date(), 'EXACT_NAME_AND_JEJU', result, message,
  ]]);
}

function tourApiKorFindMap_(spreadsheet, placeId) {
  const sheet = tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.MAP_SHEET_NAME, TOURAPI_KOR_MAP_HEADERS, '#DDF4F8');
  if (sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TOURAPI_KOR_MAP_HEADERS.length).getDisplayValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (tourApiKorText_(rows[i][0]) === placeId) {
      const result = {}; TOURAPI_KOR_MAP_HEADERS.forEach(function (header, index) { result[header] = tourApiKorText_(rows[i][index]); }); return result;
    }
  }
  return null;
}

function tourApiKorAppendReview_(spreadsheet, runId, record, decision) {
  const sheet = tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.REVIEW_SHEET_NAME, TOURAPI_KOR_REVIEW_HEADERS, '#FFF1C7');
  const summary = (decision.candidates || []).slice(0, 10).map(function (item) {
    return [item.contentid, item.title, item.addr1, item.mapy, item.mapx].map(tourApiKorText_).join(' | ');
  }).join('\n').slice(0, 45000);
  sheet.appendRow([runId, new Date(), record.place_id, record.place_name, decision.status, (decision.candidates || []).length, summary || decision.message]);
}

function tourApiKorAppendLog_(spreadsheet, runId, record, result, contentId, fields, message) {
  const sheet = tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.LOG_SHEET_NAME, TOURAPI_KOR_LOG_HEADERS, '#F3F4F6');
  sheet.appendRow([runId, new Date(), record.place_id || '', record.place_name || '', result, contentId || '', (fields || []).join(','), message || '']);
}

function tourApiKorFinish_(spreadsheet, state) {
  const properties = PropertiesService.getScriptProperties();
  tourApiKorDeleteTriggers_(TOURAPI_KOR_CONFIG.CONTINUE_FUNCTION);
  state.finishedAt = new Date().toISOString();
  state.nextStep = '최신 관광사진 업데이트 후 CSV 생성';
  properties.setProperty(TOURAPI_KOR_CONFIG.LAST_RUN_PROPERTY, JSON.stringify(state));
  properties.deleteProperty(TOURAPI_KOR_CONFIG.STATE_PROPERTY);
  tourApiKorAppendLog_(spreadsheet, state.runId, {}, 'COMPLETE', '', [], '국문 정보 완료. 1분 뒤 최신 사진 및 CSV 생성을 시작합니다.');
  tourApiKorSchedule_(TOURAPI_KOR_CONFIG.PHOTO_START_FUNCTION, 60 * 1000);
  tourApiKorNotify_(spreadsheet, '국문 정보 완료. 최신 사진과 CSV 생성이 자동으로 이어집니다.', '제주아이랑 데이터 업데이트', 12);
  Logger.log('국문 관광정보 업데이트 완료: %s', JSON.stringify(state));
}

function tourApiKorEnsureSheets_(spreadsheet) {
  tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.MAP_SHEET_NAME, TOURAPI_KOR_MAP_HEADERS, '#DDF4F8');
  tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.REVIEW_SHEET_NAME, TOURAPI_KOR_REVIEW_HEADERS, '#FFF1C7');
  tourApiKorEnsureSheet_(spreadsheet, TOURAPI_KOR_CONFIG.LOG_SHEET_NAME, TOURAPI_KOR_LOG_HEADERS, '#F3F4F6');
}

function tourApiKorCleanupLeanStorage_(spreadsheet) {
  [
    'tourapi_kor_content',
    'tourapi_kor_repeat',
    'tourapi_kor_images',
    'tourapi_kor_pet',
    'tourapi_kor_raw',
    'tourapi_photo_map',
    'tourapi_photo_review',
  ].forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) spreadsheet.deleteSheet(sheet);
  });

  ['jeju_irang_master', 'jeju_irang_export'].forEach(function (name) {
    tourApiKorRemoveColumns_(
      spreadsheet.getSheetByName(name),
      ['pet_allowed', 'pet_info']
    );
  });
  tourApiKorRemoveColumns_(
    spreadsheet.getSheetByName(TOURAPI_KOR_CONFIG.MAP_SHEET_NAME),
    ['pet_checked_at', 'pet_item_count']
  );
}

function tourApiKorRemoveColumns_(sheet, headersToRemove) {
  if (!sheet || sheet.getLastColumn() < 1) return;
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(tourApiKorText_);
  const columns = [];
  headers.forEach(function (header, index) {
    if (headersToRemove.indexOf(header) >= 0) columns.push(index + 1);
  });
  columns.sort(function (a, b) { return b - a; });
  columns.forEach(function (column) { sheet.deleteColumn(column); });
}

function tourApiKorEnsureSheet_(spreadsheet, name, headers, color) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  const existing = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
    .getDisplayValues()[0]
    .map(tourApiKorText_);
  if (!existing.some(Boolean)) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const populatedLength = existing.reduce(function (last, header, index) {
      return header ? index + 1 : last;
    }, 0);
    const current = existing.slice(0, populatedLength);
    const isExact = JSON.stringify(current) === JSON.stringify(headers);
    const isLegacyPrefix = current.length < headers.length &&
      JSON.stringify(current) === JSON.stringify(headers.slice(0, current.length));
    if (isLegacyPrefix) {
      const missing = headers.slice(current.length);
      sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    } else if (!isExact) {
      throw new Error(name + ' 시트의 헤더가 최신 설계와 다릅니다.');
    }
  }
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(color).setFontColor('#49382F').setWrap(true);
  sheet.setFrozenRows(1);
  return sheet;
}

function tourApiKorRequireMasterHeaders_(sheet) {
  const map = tourApiKorHeaderMap_(sheet);
  ['place_id', 'place_name', 'road_address', 'latitude', 'longitude', 'photo_url'].forEach(function (header) {
    if (!map[header]) throw new Error('jeju_irang_master에 ' + header + ' 컬럼이 없습니다. csv_sync_export.gs를 최신 코드로 교체해 주세요.');
  });
}

function tourApiKorHeaderMap_(sheet) {
  const map = {};
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].forEach(function (header, index) {
    const key = tourApiKorText_(header); if (key) map[key] = index + 1;
  });
  return map;
}

function tourApiKorReadRecord_(sheet, row, headers) {
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const record = {};
  Object.keys(headers).forEach(function (header) { record[header] = tourApiKorText_(values[headers[header] - 1]); });
  return record;
}

function tourApiKorSchedule_(functionName, delay) {
  tourApiKorDeleteTriggers_(functionName);
  ScriptApp.newTrigger(functionName).timeBased().after(delay).create();
}

function tourApiKorDeleteTriggers_(functionName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(trigger);
  });
}

function tourApiKorGetSpreadsheet_() {
  if (typeof csvSyncGetSpreadsheet_ === 'function') return csvSyncGetSpreadsheet_();
  const id = PropertiesService.getScriptProperties().getProperty('JEJU_IRANG_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('대상 Spreadsheet를 찾을 수 없습니다.');
}

function tourApiKorNotify_(spreadsheet, message, title, seconds) {
  try { if (spreadsheet && typeof spreadsheet.toast === 'function') spreadsheet.toast(message, title, seconds); }
  catch (error) { Logger.log('%s: %s', title, message); }
}

function tourApiKorFirstValue_(object, fields) {
  for (let i = 0; i < fields.length; i += 1) {
    const value = tourApiKorCleanHtml_(object[fields[i]]); if (value) return value;
  }
  return '';
}

function tourApiKorCleanHtml_(value) {
  return tourApiKorText_(value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function tourApiKorFirstUrl_(value) {
  const text = tourApiKorText_(value);
  const href = text.match(/href=["']([^"']+)["']/i);
  const raw = href ? href[1] : ((text.match(/https?:\/\/[^\s"'<>]+/i) || [])[0] || '');
  return raw.replace(/&amp;/g, '&');
}

function tourApiKorJoin_(values) { return values.map(tourApiKorText_).filter(Boolean).join(' '); }
function tourApiKorText_(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function tourApiKorNormalizeName_(value) { return tourApiKorText_(value).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^0-9a-z가-힣]/g, ''); }
function tourApiKorHash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function (byte) { const number = byte < 0 ? byte + 256 : byte; return ('0' + number.toString(16)).slice(-2); }).join(''); }
function tourApiKorDistanceKm_(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some(function (value) { return !isFinite(value); })) return null;
  const rad = Math.PI / 180;
  const dLat = (values[2] - values[0]) * rad;
  const dLon = (values[3] - values[1]) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(values[0] * rad) * Math.cos(values[2] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
