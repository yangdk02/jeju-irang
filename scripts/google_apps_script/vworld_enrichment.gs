/**
 * 제주아이랑 Google Form 응답 → review_queue VWorld 장소 후보 보강
 *
 * create_google_form.gs와 같은 독립형 Apps Script 프로젝트에 넣거나,
 * Google Form이 연결된 응답 스프레드시트의 바운드 프로젝트에서 사용합니다.
 * 독립형 프로젝트에서는 자동 저장된 JEJU_IRANG_SPREADSHEET_ID를 사용합니다.
 * 설치형 "스프레드시트의 양식 제출 시" 트리거가 onFormSubmit을 호출해야 합니다.
 *
 * 중요:
 * - VWORLD_API_KEY는 Script Properties에서만 읽습니다.
 * - form_responses 원본 행은 읽기만 하며 수정하지 않습니다.
 * - 검색 결과는 후보일 뿐 자동 승인하지 않습니다.
 */

const CONFIG = Object.freeze({
  FORM_RESPONSES_SHEET_NAME: 'form_responses',
  REVIEW_QUEUE_SHEET_NAME: 'review_queue',
  VWORLD_API_KEY_PROPERTY: 'VWORLD_API_KEY',
  SPREADSHEET_ID_PROPERTY: 'JEJU_IRANG_SPREADSHEET_ID',
  VWORLD_SEARCH_URL: 'https://api.vworld.kr/req/search',
  VWORLD_CRS: 'EPSG:4326',
  JEJU_BBOX: '126.0,33.0,127.1,33.7',
  TIME_ZONE: 'Asia/Seoul',
  LOCK_TIMEOUT_MS: 30000,
  VWORLD_PAGE_SIZE: 30,
  MAX_CANDIDATES_TO_STORE: 10,
  VWORLD_MAX_ATTEMPTS: 3,
  VWORLD_RETRY_BASE_MS: 1200,
});

/**
 * form_responses 실제 한글 질문 제목과 내부 필드명의 연결표입니다.
 * Form 질문 제목을 바꾸면 이 목록도 함께 수정해야 합니다.
 */
const FORM_HEADER_ALIASES = Object.freeze({
  submitted_at: ['타임스탬프', '제출 시각', 'Timestamp'],
  request_type: ['요청 유형'],
  target_place_id: ['수정 대상 장소 ID', 'target_place_id'],
  target_place_name: ['기존 장소명'],
  changed_fields: ['수정할 항목'],
  update_note: ['무엇을 수정해야 하나요?'],
  place_name: ['장소명'],
  space_type: ['실내/실외'],
  category: ['시설유형'],
  has_admission_fee: ['입장료 여부'],
  has_age_limit: ['연령제한 여부'],
  nursing_room: ['수유실 여부'],
  stroller_rental: ['유모차 대여 여부'],
  parking: ['주차 유형'],
  location_hint: ['장소를 찾는 데 도움이 되는 정보'],
  phone: ['전화번호'],
  website_url: ['홈페이지 URL'],
  opening_hours: ['운영시간'],
  closed_days: ['휴무일'],
  admission_fee_detail: ['이용요금 상세'],
  age_limit_detail: ['연령제한 상세'],
  diaper_changing_table: ['기저귀 교환대'],
  resident_discount: ['도민 할인'],
  reservation_url: ['예약 URL'],
  photo_url: ['이미지 URL'],
  description: ['한 줄 설명'],
  review_summary: ['후기 또는 참고사항'],
});

/**
 * review_queue 열 순서입니다.
 * 장소 제공자를 특정 서비스명으로 고정하지 않도록 source_* 컬럼을 사용합니다.
 */
const REVIEW_QUEUE_HEADERS = Object.freeze([
  // A:R - 관리 컬럼
  'request_id',
  'request_type',
  'target_place_id',
  'review_status',
  'admin_action',
  'admin_note',
  'source_provider',
  'source_place_id',
  'source_place_name',
  'source_address',
  'source_road_address',
  'source_latitude',
  'source_longitude',
  'match_status',
  'approved_at',
  'synced_place_id',
  'synced_at',
  'sync_message',

  // S:AA - 원본 추적·검수 범위
  'source_response_row',
  'submitted_at',
  'target_place_name',
  'changed_fields',
  'update_note',
  'location_hint',
  'source_hash',
  'apply_fields',
  'clear_fields',

  // AB:AU - Form 제안 원본 정규화
  'proposed_place_name',
  'proposed_space_type',
  'proposed_category',
  'proposed_has_admission_fee',
  'proposed_has_age_limit',
  'proposed_nursing_room',
  'proposed_stroller_rental',
  'proposed_parking',
  'proposed_phone',
  'proposed_website_url',
  'proposed_opening_hours',
  'proposed_closed_days',
  'proposed_admission_fee_detail',
  'proposed_age_limit_detail',
  'proposed_diaper_changing_table',
  'proposed_resident_discount',
  'proposed_reservation_url',
  'proposed_photo_url',
  'proposed_description',
  'proposed_review_summary',

  // AV:BO - 관리자 최종 승인값
  'approved_place_name',
  'approved_space_type',
  'approved_category',
  'approved_has_admission_fee',
  'approved_has_age_limit',
  'approved_nursing_room',
  'approved_stroller_rental',
  'approved_parking',
  'approved_phone',
  'approved_website_url',
  'approved_opening_hours',
  'approved_closed_days',
  'approved_admission_fee_detail',
  'approved_age_limit_detail',
  'approved_diaper_changing_table',
  'approved_resident_discount',
  'approved_reservation_url',
  'approved_photo_url',
  'approved_description',
  'approved_review_summary',

  // BP:BW - 지역·검증 자동 컬럼
  'resolved_city_name',
  'resolved_legal_dong_name',
  'resolved_region_group',
  'duplicate_status',
  'validation_status',
  'validation_message',
  'current_record_hash',
  'processed_action_key',

  // BX:BZ - 외부 장소 후보 보조 컬럼
  'source_category',
  'source_candidate_count',
  'source_candidates',
]);

const LEGACY_REVIEW_HEADER_RENAMES = Object.freeze({
  kakao_place_id: 'source_place_id',
  kakao_place_name: 'source_place_name',
  kakao_address: 'source_address',
  kakao_road_address: 'source_road_address',
  kakao_latitude: 'source_latitude',
  kakao_longitude: 'source_longitude',
  kakao_place_url: 'source_place_url',
  kakao_candidate_count: 'source_candidate_count',
  kakao_candidates: 'source_candidates',
});

const CHANGED_FIELD_TO_CSV_COLUMNS = Object.freeze({
  '장소명': ['place_name'],
  '공간': ['space_type'],
  '시설유형': ['category'],
  '입장료': ['has_admission_fee', 'admission_fee_detail'],
  '연령제한': ['has_age_limit', 'age_limit_detail'],
  '수유실': ['nursing_room'],
  '유모차 대여': ['stroller_rental'],
  '주차': ['parking'],
  '위치': [
    'source_place_id',
    'road_address',
    'city_name',
    'legal_dong_name',
    'region_group',
    'latitude',
    'longitude',
  ],
  '전화번호': ['phone'],
  '홈페이지': ['website_url'],
  '운영시간': ['opening_hours'],
  '휴무일': ['closed_days'],
  '이용요금 상세': ['admission_fee_detail'],
  '연령제한 상세': ['age_limit_detail'],
  '기저귀 교환대': ['diaper_changing_table'],
  '도민 할인': ['resident_discount'],
  '예약 링크': ['reservation_url'],
  '이미지': ['photo_url'],
  '한 줄 설명': ['description'],
  '후기·참고사항': ['review_summary'],
  '후기 또는 참고사항': ['review_summary'],
});

const PROPOSED_TO_APPROVED = Object.freeze({
  place_name: 'approved_place_name',
  space_type: 'approved_space_type',
  category: 'approved_category',
  has_admission_fee: 'approved_has_admission_fee',
  has_age_limit: 'approved_has_age_limit',
  nursing_room: 'approved_nursing_room',
  stroller_rental: 'approved_stroller_rental',
  parking: 'approved_parking',
  phone: 'approved_phone',
  website_url: 'approved_website_url',
  opening_hours: 'approved_opening_hours',
  closed_days: 'approved_closed_days',
  admission_fee_detail: 'approved_admission_fee_detail',
  age_limit_detail: 'approved_age_limit_detail',
  diaper_changing_table: 'approved_diaper_changing_table',
  resident_discount: 'approved_resident_discount',
  reservation_url: 'approved_reservation_url',
  photo_url: 'approved_photo_url',
  description: 'approved_description',
  review_summary: 'approved_review_summary',
});

/**
 * 설치형 스프레드시트 Form Submit 트리거가 호출하는 진입점입니다.
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onFormSubmit(e) {
  if (!e || !e.range) {
    throw new Error(
      'onFormSubmit은 스프레드시트의 설치형 양식 제출 트리거로 실행해야 합니다.'
    );
  }

  processSubmissionRow_(e.range.getSheet(), e.range.getRow());
}

/**
 * 현재 스프레드시트에 review_queue 헤더를 준비합니다.
 * 기존 헤더는 변경하지 않고 누락된 헤더만 오른쪽에 추가합니다.
 */
function setupReviewQueueSheet() {
  const spreadsheet = getTargetSpreadsheet_();
  const sheet = ensureReviewQueueSheet_(spreadsheet);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  Logger.log(
    'review_queue 준비 완료: %s개 컬럼',
    sheet.getLastColumn()
  );
}

/**
 * 기존 review_queue의 kakao_* 헤더를 source_* 헤더로 안전하게 변경하고
 * VWorld 처리에 필요한 새 헤더를 추가합니다. 기존 행 값은 삭제하지 않습니다.
 */
function migrateReviewQueueToVworld() {
  const spreadsheet = getTargetSpreadsheet_();
  ensureReviewQueueSheet_(spreadsheet);
  Logger.log('review_queue를 VWorld용 source_* 컬럼으로 전환했습니다.');
}

/**
 * 동일 스프레드시트에 onFormSubmit 설치형 트리거를 한 개만 등록합니다.
 */
function installFormSubmitTrigger() {
  const spreadsheet = getTargetSpreadsheet_();
  const existing = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return (
      trigger.getHandlerFunction() === 'onFormSubmit' &&
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT &&
      trigger.getTriggerSourceId() === spreadsheet.getId()
    );
  });

  if (existing.length > 0) {
    Logger.log('이미 onFormSubmit 트리거가 등록되어 있습니다.');
    return;
  }

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();

  Logger.log('onFormSubmit 설치형 트리거를 등록했습니다.');
}

/**
 * 이 프로젝트가 만든 onFormSubmit 트리거를 제거합니다.
 */
function removeFormSubmitTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (
      trigger.getHandlerFunction() === 'onFormSubmit' &&
      trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('onFormSubmit 트리거를 제거했습니다.');
}

/**
 * API 키와 시트 구성을 확인합니다. API 키 자체는 출력하지 않습니다.
 */
function checkSetup() {
  const spreadsheet = getTargetSpreadsheet_();
  const properties = PropertiesService.getScriptProperties();
  const apiKey = properties.getProperty(CONFIG.VWORLD_API_KEY_PROPERTY);
  const formSheetName = getConfiguredSheetName_(
    'FORM_RESPONSES_SHEET_NAME',
    CONFIG.FORM_RESPONSES_SHEET_NAME
  );
  const formSheet = spreadsheet.getSheetByName(formSheetName);
  const queueSheet = ensureReviewQueueSheet_(spreadsheet);

  if (!apiKey) {
    throw new Error(
      'Script Properties에 VWORLD_API_KEY가 설정되지 않았습니다.'
    );
  }
  if (!formSheet) {
    throw new Error('form_responses 시트를 찾을 수 없습니다: ' + formSheetName);
  }

  assertHeaders_(queueSheet, REVIEW_QUEUE_HEADERS);
  Logger.log('설정 확인 완료. API 키가 존재하고 필요한 시트와 헤더가 있습니다.');
}

/**
 * 시트를 변경하지 않고 VWorld 검색만 시험합니다.
 * TEST_PLACE_NAME, TEST_LOCATION_HINT Script Properties가 있으면 그 값을 사용합니다.
 */
function testVworldSearch() {
  const properties = PropertiesService.getScriptProperties();
  const placeName =
    properties.getProperty('TEST_PLACE_NAME') || '아쿠아플라넷 제주';
  const locationHint =
    properties.getProperty('TEST_LOCATION_HINT') || '서귀포시 성산읍';
  const result = searchVworldCandidates_(placeName, locationHint);

  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * form_responses의 마지막 응답을 실제 review_queue 처리 흐름으로 시험합니다.
 * 같은 원본 행은 source_hash로 중복 등록되지 않습니다.
 */
function testLatestFormResponse() {
  const spreadsheet = getTargetSpreadsheet_();
  const formSheetName = getConfiguredSheetName_(
    'FORM_RESPONSES_SHEET_NAME',
    CONFIG.FORM_RESPONSES_SHEET_NAME
  );
  const sheet = spreadsheet.getSheetByName(formSheetName);

  if (!sheet) {
    throw new Error('form_responses 시트를 찾을 수 없습니다: ' + formSheetName);
  }
  if (sheet.getLastRow() < 2) {
    throw new Error('테스트할 Form 응답이 없습니다.');
  }

  processSubmissionRow_(sheet, sheet.getLastRow());
}

/**
 * VWorld의 일시 오류로 UNSEARCHED가 된 review_queue 행을 다시 검색합니다.
 * 기존 Form 응답이나 request_id는 새로 만들지 않습니다.
 */
function retryFailedVworldSearches() {
  const spreadsheet = getTargetSpreadsheet_();
  const sheet = ensureReviewQueueSheet_(spreadsheet);
  if (sheet.getLastRow() < 2) {
    Logger.log('다시 검색할 review_queue 행이 없습니다.');
    return;
  }

  const headerMap = getHeaderIndexMap_(sheet);
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(normalizeText_);
  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getDisplayValues();
  let successCount = 0;
  let errorCount = 0;

  values.forEach(function (row, index) {
    const record = {};
    headers.forEach(function (header, column) {
      if (header) {
        record[header] = row[column];
      }
    });
    const isRetryTarget =
      normalizeText_(record.match_status).toUpperCase() === 'UNSEARCHED' &&
      normalizeText_(record.sync_message).indexOf('VWORLD_API_ERROR:') === 0;
    if (!isRetryTarget) {
      return;
    }

    try {
      clearVworldCandidateFields_(record);
      const searchResult = searchVworldCandidates_(
        record.approved_place_name || record.proposed_place_name,
        record.location_hint
      );
      record.review_status = 'PENDING';
      record.validation_status = 'WARNING';
      record.validation_message = '';
      record.sync_message = '';
      applyVworldSearchResult_(record, searchResult);
      successCount += 1;
    } catch (error) {
      const message = sanitizeErrorMessage_(error);
      record.review_status = 'ERROR';
      record.match_status = 'UNSEARCHED';
      record.validation_status = 'BLOCKED';
      record.validation_message = 'VWorld 장소 검색에 다시 실패했습니다.';
      record.sync_message = 'VWORLD_API_ERROR: ' + message;
      errorCount += 1;
    }

    writeVworldReviewResult_(sheet, index + 2, headerMap, record);
  });

  SpreadsheetApp.flush();
  Logger.log('VWorld 재검색 성공: %s건', successCount);
  Logger.log('VWorld 재검색 실패: %s건', errorCount);
}

function processSubmissionRow_(sourceSheet, sourceRow) {
  const spreadsheet = sourceSheet.getParent();
  const response = readFormResponseRow_(sourceSheet, sourceRow);
  const sourceHash = createSourceHash_(
    spreadsheet.getId(),
    sourceSheet.getSheetId(),
    sourceRow,
    response.submitted_at,
    response.place_name
  );

  const queueSheet = ensureReviewQueueSheet_(spreadsheet);
  if (findRowByHeaderValue_(queueSheet, 'source_hash', sourceHash)) {
    Logger.log('이미 처리된 Form 응답입니다. source_hash=%s', sourceHash);
    return;
  }

  const requestId = createRequestId_();
  const record = buildBaseReviewRecord_(
    requestId,
    response,
    sourceSheet,
    sourceRow,
    sourceHash
  );

  if (record.validation_status === 'BLOCKED') {
    record.sync_message = 'VALIDATION_ERROR: ' + record.validation_message;
  } else {
    try {
      const searchResult = searchVworldCandidates_(
        record.proposed_place_name,
        record.location_hint
      );
      applyVworldSearchResult_(record, searchResult);
    } catch (error) {
      const message = sanitizeErrorMessage_(error);
      record.review_status = 'ERROR';
      record.match_status = 'UNSEARCHED';
      record.validation_status = 'BLOCKED';
      record.validation_message = 'VWorld 장소 검색에 실패했습니다.';
      record.sync_message = 'VWORLD_API_ERROR: ' + message;
    }
  }

  appendReviewRecordSafely_(queueSheet, record, sourceHash);
}

function readFormResponseRow_(sheet, rowNumber) {
  if (rowNumber < 2) {
    throw new Error('Form 응답 행 번호가 올바르지 않습니다: ' + rowNumber);
  }

  const lastColumn = sheet.getLastColumn();
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(normalizeText_);
  const rawValues = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];
  const displayValues = sheet
    .getRange(rowNumber, 1, 1, lastColumn)
    .getDisplayValues()[0];

  const rawByHeader = {};
  const displayByHeader = {};
  headers.forEach(function (header, index) {
    if (header) {
      rawByHeader[header] = rawValues[index];
      displayByHeader[header] = displayValues[index];
    }
  });

  const response = {};
  Object.keys(FORM_HEADER_ALIASES).forEach(function (logicalField) {
    response[logicalField] = getAliasedValue_(
      displayByHeader,
      FORM_HEADER_ALIASES[logicalField]
    );
  });

  const timestampHeader = findAliasHeader_(
    rawByHeader,
    FORM_HEADER_ALIASES.submitted_at
  );
  if (timestampHeader) {
    response.submitted_at = rawByHeader[timestampHeader];
  }

  return response;
}

function buildBaseReviewRecord_(
  requestId,
  response,
  sourceSheet,
  sourceRow,
  sourceHash
) {
  const requestType = normalizeRequestType_(response.request_type);
  const changedFields = normalizeText_(response.changed_fields);
  const applyFields = mapChangedFieldsToCsvColumns_(changedFields);
  const proposed = buildProposedValues_(response);
  const approved = buildInitialApprovedValues_(
    requestType,
    proposed,
    applyFields
  );
  const validationProblems = validateBasicResponse_(
    requestType,
    response,
    proposed,
    applyFields
  );

  const record = {
    request_id: requestId,
    request_type: requestType,
    target_place_id: normalizeText_(response.target_place_id),
    review_status: validationProblems.length ? 'ERROR' : 'PENDING',
    admin_action: '',
    admin_note: '',
    source_provider: '',
    source_place_id: '',
    source_place_name: '',
    source_address: '',
    source_road_address: '',
    source_latitude: '',
    source_longitude: '',
    match_status: 'UNSEARCHED',
    approved_at: '',
    synced_place_id: '',
    synced_at: '',
    sync_message: '',
    source_response_row: sourceRow,
    submitted_at: response.submitted_at || new Date(),
    target_place_name: normalizeText_(response.target_place_name),
    changed_fields: changedFields,
    update_note: normalizeText_(response.update_note),
    location_hint: normalizeText_(response.location_hint),
    source_hash: sourceHash,
    apply_fields: applyFields.join(', '),
    clear_fields: '',
    duplicate_status: 'NOT_CHECKED',
    validation_status: validationProblems.length ? 'BLOCKED' : 'WARNING',
    validation_message: validationProblems.join(' | '),
    current_record_hash: '',
    processed_action_key: '',
    source_category: '',
    source_candidate_count: 0,
    source_candidates: '',
  };

  Object.keys(proposed).forEach(function (key) {
    record['proposed_' + key] = proposed[key];
  });
  Object.keys(approved).forEach(function (key) {
    record[key] = approved[key];
  });

  // 이 단계에서는 외부 장소 후보를 확정하지 않으므로 지역 파생값도 비워 둡니다.
  record.resolved_city_name = '';
  record.resolved_legal_dong_name = '';
  record.resolved_region_group = '';

  return record;
}

function buildProposedValues_(response) {
  return {
    place_name: normalizeText_(response.place_name),
    space_type: normalizeSpaceType_(response.space_type),
    category: normalizeCategory_(response.category),
    has_admission_fee: normalizeBoolean_(response.has_admission_fee),
    has_age_limit: normalizeBoolean_(response.has_age_limit),
    nursing_room: normalizeBoolean_(response.nursing_room),
    stroller_rental: normalizeBoolean_(response.stroller_rental),
    parking: normalizeParking_(response.parking),
    phone: normalizeText_(response.phone),
    website_url: normalizeText_(response.website_url),
    opening_hours: normalizeMultilineText_(response.opening_hours),
    closed_days: normalizeText_(response.closed_days),
    admission_fee_detail: normalizeMultilineText_(
      response.admission_fee_detail
    ),
    age_limit_detail: normalizeMultilineText_(response.age_limit_detail),
    diaper_changing_table: normalizeBoolean_(
      response.diaper_changing_table
    ),
    resident_discount: normalizeBoolean_(response.resident_discount),
    reservation_url: normalizeText_(response.reservation_url),
    photo_url: normalizeText_(response.photo_url),
    description: normalizeText_(response.description),
    review_summary: normalizeMultilineText_(response.review_summary),
  };
}

function buildInitialApprovedValues_(requestType, proposed, applyFields) {
  const approved = {};
  const applySet = {};
  applyFields.forEach(function (field) {
    applySet[field] = true;
  });

  Object.keys(PROPOSED_TO_APPROVED).forEach(function (csvField) {
    const approvedField = PROPOSED_TO_APPROVED[csvField];
    const shouldCopy = requestType === 'NEW' || applySet[csvField];
    approved[approvedField] = shouldCopy ? proposed[csvField] : '';
  });

  return approved;
}

function validateBasicResponse_(requestType, response, proposed, applyFields) {
  const problems = [];
  const required = [
    ['장소명', proposed.place_name],
    ['실내/실외', proposed.space_type],
    ['시설유형', proposed.category],
    ['입장료 여부', proposed.has_admission_fee],
    ['연령제한 여부', proposed.has_age_limit],
    ['수유실 여부', proposed.nursing_room],
    ['유모차 대여 여부', proposed.stroller_rental],
    ['주차 유형', proposed.parking],
  ];

  required.forEach(function (item) {
    if (item[1] === '') {
      problems.push(item[0] + ' 값이 없거나 허용값이 아닙니다.');
    }
  });

  if (requestType === 'UPDATE') {
    if (!normalizeText_(response.target_place_name)) {
      problems.push('UPDATE 요청에 기존 장소명이 없습니다.');
    }
    if (applyFields.length === 0) {
      problems.push('UPDATE 요청에 수정할 항목이 없습니다.');
    }
  }

  return problems;
}

function searchVworldCandidates_(placeName, locationHint) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(
    CONFIG.VWORLD_API_KEY_PROPERTY
  );
  if (!apiKey) {
    throw new Error('Script Properties에 VWORLD_API_KEY가 없습니다.');
  }
  if (!normalizeText_(placeName)) {
    throw new Error('VWorld 검색에 사용할 장소명이 없습니다.');
  }

  const hintText = removeUrls_(locationHint);
  const queries = uniqueNonEmpty_([
    [placeName, hintText].filter(Boolean).join(' '),
    placeName,
    ['제주', placeName].filter(Boolean).join(' '),
  ]);

  let candidates = [];
  let usedQuery = '';

  for (let i = 0; i < queries.length; i += 1) {
    const documents = callVworldPlaceSearch_(queries[i], apiKey);
    const jejuDocuments = documents.filter(isJejuPlace_);
    if (jejuDocuments.length > 0) {
      candidates = deduplicateCandidates_(jejuDocuments);
      usedQuery = queries[i];
      break;
    }
  }

  candidates = sortCandidates_(
    candidates,
    placeName,
    hintText
  );

  return {
    query: usedQuery || queries[0],
    candidates: candidates,
  };
}

function callVworldPlaceSearch_(query, apiKey) {
  const params = {
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: CONFIG.VWORLD_CRS,
    bbox: CONFIG.JEJU_BBOX,
    size: CONFIG.VWORLD_PAGE_SIZE,
    page: 1,
    query: query,
    type: 'place',
    format: 'json',
    errorformat: 'json',
    key: apiKey,
  };
  const queryString = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');
  const url = CONFIG.VWORLD_SEARCH_URL + '?' + queryString;

  let response;
  let lastFetchError = null;
  for (let attempt = 1; attempt <= CONFIG.VWORLD_MAX_ATTEMPTS; attempt += 1) {
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
      });
      const retryStatus = response.getResponseCode();
      if (!isRetryableVworldStatus_(retryStatus)) {
        break;
      }
      lastFetchError = new Error('VWorld API HTTP ' + retryStatus);
    } catch (error) {
      lastFetchError = error;
    }

    if (attempt < CONFIG.VWORLD_MAX_ATTEMPTS) {
      Utilities.sleep(CONFIG.VWORLD_RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }
  if (!response) {
    throw new Error(
      'VWorld API 연결 실패: ' + sanitizeErrorMessage_(lastFetchError)
    );
  }

  const statusCode = response.getResponseCode();
  const body = response.getContentText('UTF-8');

  if (statusCode !== 200) {
    throw new Error(
      'VWorld API HTTP ' + statusCode + ': ' + truncate_(body, 500)
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error('VWorld API 응답 JSON을 해석할 수 없습니다.');
  }

  const payload = parsed && parsed.response;
  if (!payload) {
    throw new Error('VWorld API 응답에 response 객체가 없습니다.');
  }
  if (payload.status === 'NOT_FOUND') {
    return [];
  }
  if (payload.status !== 'OK') {
    const error = payload.error || {};
    throw new Error(
      'VWorld API 오류 ' +
        normalizeText_(error.code || payload.status) +
        ': ' +
        normalizeText_(error.text || '검색 요청에 실패했습니다.')
    );
  }

  const itemsNode = payload.result && payload.result.items;
  let items = [];
  if (Array.isArray(itemsNode)) {
    items = itemsNode;
  } else if (itemsNode && Array.isArray(itemsNode.item)) {
    items = itemsNode.item;
  } else if (itemsNode && itemsNode.item) {
    items = [itemsNode.item];
  }

  return items.map(function (item) {
    const address = item.address || {};
    const point = item.point || {};
    return {
      id: normalizeText_(item.id),
      place_name: normalizeText_(item.title),
      category_name: normalizeText_(item.category),
      address_name: normalizeText_(address.parcel),
      road_address_name: normalizeText_(address.road),
      x: normalizeText_(point.x),
      y: normalizeText_(point.y),
    };
  });
}

function isRetryableVworldStatus_(statusCode) {
  return [429, 500, 502, 503, 504].indexOf(Number(statusCode)) >= 0;
}

function clearVworldCandidateFields_(record) {
  [
    'source_provider',
    'source_place_id',
    'source_place_name',
    'source_address',
    'source_road_address',
    'source_latitude',
    'source_longitude',
    'source_category',
    'source_candidate_count',
    'source_candidates',
  ].forEach(function (field) {
    record[field] = '';
  });
}

function writeVworldReviewResult_(sheet, rowNumber, headerMap, record) {
  [
    'review_status',
    'source_provider',
    'source_place_id',
    'source_place_name',
    'source_address',
    'source_road_address',
    'source_latitude',
    'source_longitude',
    'source_category',
    'source_candidate_count',
    'source_candidates',
    'match_status',
    'validation_status',
    'validation_message',
    'sync_message',
  ].forEach(function (header) {
    if (headerMap[header]) {
      sheet.getRange(rowNumber, headerMap[header]).setValue(record[header] || '');
    }
  });
}

function applyVworldSearchResult_(record, searchResult) {
  const candidates = searchResult.candidates || [];
  const primary = candidates.length > 0 ? candidates[0] : null;

  record.source_provider = 'VWORLD';
  record.source_candidate_count = candidates.length;
  record.source_candidates = formatCandidateSummary_(candidates);

  if (!primary) {
    record.match_status = 'NO_MATCH';
    record.validation_status = 'WARNING';
    record.validation_message =
      '제주 지역 VWorld 장소 후보가 없습니다. 검색 단서를 확인해 주세요.';
    record.sync_message =
      'VWorld 후보 0건. 사용한 검색어: ' + searchResult.query;
    return;
  }

  // 첫 행은 어디까지나 추천 후보이며 CONFIRMED로 만들지 않습니다.
  record.source_place_id = normalizeText_(primary.id);
  record.source_place_name = normalizeText_(primary.place_name);
  record.source_category = normalizeText_(primary.category_name);
  record.source_address = normalizeText_(primary.address_name);
  record.source_road_address = normalizeText_(primary.road_address_name);
  record.source_latitude = toNumberOrBlank_(primary.y);
  record.source_longitude = toNumberOrBlank_(primary.x);

  if (candidates.length === 1) {
    record.match_status = 'SINGLE_CANDIDATE';
    record.validation_status = 'WARNING';
    record.validation_message =
      'VWorld 후보가 1건입니다. 관리자가 장소를 확인한 뒤 CONFIRMED로 변경해야 합니다.';
  } else {
    record.match_status = 'MULTIPLE_CANDIDATES';
    record.validation_status = 'WARNING';
    record.validation_message =
      'VWorld 후보가 여러 건입니다. 후보 목록에서 정확한 장소를 선택해 주세요.';
  }

  record.sync_message =
    'VWorld 후보 ' +
    candidates.length +
    '건 기록. 사용한 검색어: ' +
    searchResult.query;
}

function formatCandidateSummary_(candidates) {
  return candidates
    .slice(0, CONFIG.MAX_CANDIDATES_TO_STORE)
    .map(function (candidate, index) {
      const address =
        normalizeText_(candidate.road_address_name) ||
        normalizeText_(candidate.address_name);
      return [
        index + 1 + '.',
        '[' + normalizeText_(candidate.id) + ']',
        normalizeText_(candidate.place_name),
        '|',
        address,
        '|',
        normalizeText_(candidate.y) + ',' + normalizeText_(candidate.x),
      ].join(' ');
    })
    .join('\n');
}

function sortCandidates_(candidates, placeName, hintText) {
  const normalizedPlaceName = normalizeForComparison_(placeName);
  const normalizedHint = normalizeForComparison_(hintText);

  return candidates.slice().sort(function (left, right) {
    return (
      scoreCandidate_(right, normalizedPlaceName, normalizedHint) -
      scoreCandidate_(left, normalizedPlaceName, normalizedHint)
    );
  });
}

function scoreCandidate_(candidate, normalizedPlaceName, normalizedHint) {
  let score = 0;
  const candidateName = normalizeForComparison_(candidate.place_name);
  const candidateAddress = normalizeForComparison_(
    [candidate.road_address_name, candidate.address_name].filter(Boolean).join(' ')
  );

  if (candidateName === normalizedPlaceName) {
    score += 100;
  } else if (
    candidateName.indexOf(normalizedPlaceName) >= 0 ||
    normalizedPlaceName.indexOf(candidateName) >= 0
  ) {
    score += 50;
  }
  if (normalizedHint && candidateAddress.indexOf(normalizedHint) >= 0) {
    score += 20;
  }

  return score;
}

function deduplicateCandidates_(documents) {
  const seen = {};
  return documents.filter(function (document) {
    const key =
      normalizeText_(document.id) ||
      [document.place_name, document.road_address_name, document.address_name]
        .map(normalizeText_)
        .join('|');
    if (!key || seen[key]) {
      return false;
    }
    seen[key] = true;
    return true;
  });
}

function isJejuPlace_(document) {
  const address = [document.address_name, document.road_address_name]
    .filter(Boolean)
    .join(' ');
  return new RegExp('(?:^|\\s)제주(?:특별자치도)?\\s').test(address);
}

function appendReviewRecordSafely_(queueSheet, record, sourceHash) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);

  try {
    // API 호출 중 같은 원본 응답이 처리되었을 수 있으므로 잠금 안에서 다시 확인합니다.
    if (findRowByHeaderValue_(queueSheet, 'source_hash', sourceHash)) {
      Logger.log('동시 실행에서 이미 처리된 응답을 발견했습니다: %s', sourceHash);
      return;
    }

    const headerMap = getHeaderIndexMap_(queueSheet);
    const row = new Array(queueSheet.getLastColumn()).fill('');
    Object.keys(record).forEach(function (header) {
      if (Object.prototype.hasOwnProperty.call(headerMap, header)) {
        row[headerMap[header] - 1] = record[header];
      }
    });

    queueSheet.appendRow(row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function createRequestId_() {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
    const now = new Date();
    const day = Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyyMMdd');
    const propertyKey = 'REQUEST_SEQUENCE_' + day;
    const properties = PropertiesService.getScriptProperties();
    const previous = Number(properties.getProperty(propertyKey) || '0');
    const next = previous + 1;
    properties.setProperty(propertyKey, String(next));

    return 'REQ-' + day + '-' + String(next).padStart(6, '0');
  } catch (error) {
    // Lock 시간 초과 시에도 원본 응답 처리가 사라지지 않도록 UUID를 사용합니다.
    const timestamp = Utilities.formatDate(
      new Date(),
      CONFIG.TIME_ZONE,
      'yyyyMMdd-HHmmss'
    );
    return 'REQ-' + timestamp + '-' + Utilities.getUuid().slice(0, 8);
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

function createSourceHash_(spreadsheetId, sheetId, row, submittedAt, placeName) {
  const payload = [
    spreadsheetId,
    sheetId,
    row,
    submittedAt instanceof Date ? submittedAt.toISOString() : submittedAt,
    normalizeText_(placeName),
  ].join('|');
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    payload,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (byte) {
      return ('0' + (byte & 255).toString(16)).slice(-2);
    })
    .join('');
}

function ensureReviewQueueSheet_(spreadsheet) {
  const sheetName = getConfiguredSheetName_(
    'REVIEW_QUEUE_SHEET_NAME',
    CONFIG.REVIEW_QUEUE_SHEET_NAME
  );
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  migrateLegacyReviewHeaders_(sheet);

  const lastColumn = sheet.getLastColumn();
  const existingHeaders =
    lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
      : [];
  const hasAnyHeader = existingHeaders.some(function (value) {
    return normalizeText_(value) !== '';
  });

  if (!hasAnyHeader) {
    ensureColumnCapacity_(sheet, REVIEW_QUEUE_HEADERS.length);
    sheet
      .getRange(1, 1, 1, REVIEW_QUEUE_HEADERS.length)
      .setValues([REVIEW_QUEUE_HEADERS]);
  } else {
    const existingSet = {};
    existingHeaders.forEach(function (header) {
      if (normalizeText_(header)) {
        existingSet[normalizeText_(header)] = true;
      }
    });
    const missing = REVIEW_QUEUE_HEADERS.filter(function (header) {
      return !existingSet[header];
    });
    if (missing.length > 0) {
      const startColumn = sheet.getLastColumn() + 1;
      ensureColumnCapacity_(sheet, startColumn + missing.length - 1);
      sheet.getRange(1, startColumn, 1, missing.length).setValues([missing]);
    }
  }

  return sheet;
}

function migrateLegacyReviewHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    return;
  }
  const range = sheet.getRange(1, 1, 1, lastColumn);
  const headers = range.getDisplayValues()[0];
  let changed = false;
  const migrated = headers.map(function (header) {
    const normalized = normalizeText_(header);
    const replacement = LEGACY_REVIEW_HEADER_RENAMES[normalized];
    if (replacement) {
      changed = true;
      return replacement;
    }
    return header;
  });
  if (changed) {
    range.setValues([migrated]);
  }
}

function ensureColumnCapacity_(sheet, requiredColumns) {
  const current = sheet.getMaxColumns();
  if (current < requiredColumns) {
    sheet.insertColumnsAfter(current, requiredColumns - current);
  }
}

function assertHeaders_(sheet, requiredHeaders) {
  const headerMap = getHeaderIndexMap_(sheet);
  const missing = requiredHeaders.filter(function (header) {
    return !Object.prototype.hasOwnProperty.call(headerMap, header);
  });
  if (missing.length > 0) {
    throw new Error('review_queue 누락 헤더: ' + missing.join(', '));
  }
}

function getHeaderIndexMap_(sheet) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0];
  const map = {};
  headers.forEach(function (header, index) {
    const normalized = normalizeText_(header);
    if (normalized) {
      map[normalized] = index + 1;
    }
  });
  return map;
}

function findRowByHeaderValue_(sheet, header, value) {
  if (!value || sheet.getLastRow() < 2) {
    return 0;
  }
  const headerMap = getHeaderIndexMap_(sheet);
  const column = headerMap[header];
  if (!column) {
    return 0;
  }
  const match = sheet
    .getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function getConfiguredSheetName_(propertyName, defaultName) {
  return (
    PropertiesService.getScriptProperties().getProperty(propertyName) ||
    defaultName
  );
}

/**
 * Form 자동 생성 스크립트가 저장한 Spreadsheet ID를 우선 사용합니다.
 * 기존처럼 응답 Spreadsheet에 바운드된 프로젝트에서도 동작합니다.
 */
function getTargetSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SPREADSHEET_ID_PROPERTY
  );
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  throw new Error(
    '대상 Spreadsheet를 찾을 수 없습니다. 먼저 createJejuIrangForm을 실행하거나 JEJU_IRANG_SPREADSHEET_ID를 설정해 주세요.'
  );
}

function getAliasedValue_(valuesByHeader, aliases) {
  const header = findAliasHeader_(valuesByHeader, aliases);
  return header ? valuesByHeader[header] : '';
}

function findAliasHeader_(valuesByHeader, aliases) {
  for (let i = 0; i < aliases.length; i += 1) {
    const alias = normalizeText_(aliases[i]);
    if (Object.prototype.hasOwnProperty.call(valuesByHeader, alias)) {
      return alias;
    }
  }
  return '';
}

function mapChangedFieldsToCsvColumns_(changedFields) {
  const selected = splitMultiValue_(changedFields);
  const result = [];
  const seen = {};

  selected.forEach(function (label) {
    const columns = CHANGED_FIELD_TO_CSV_COLUMNS[normalizeText_(label)] || [];
    columns.forEach(function (column) {
      if (!seen[column]) {
        seen[column] = true;
        result.push(column);
      }
    });
  });

  return result;
}

function splitMultiValue_(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(/\s*,\s*/)
    .map(normalizeText_)
    .filter(Boolean);
}

function normalizeRequestType_(value) {
  const text = normalizeText_(value);
  if (text === 'UPDATE' || text.indexOf('수정') >= 0) {
    return 'UPDATE';
  }
  return 'NEW';
}

function normalizeBoolean_(value) {
  const text = normalizeText_(value).toLowerCase();
  if (['있음', '예', '가능', 'true', '1', 'yes'].indexOf(text) >= 0) {
    return 'TRUE';
  }
  if (['없음', '아니오', '불가', 'false', '0', 'no'].indexOf(text) >= 0) {
    return 'FALSE';
  }
  return '';
}

function normalizeSpaceType_(value) {
  const text = normalizeText_(value);
  return ['실내', '실외', '실내/실외'].indexOf(text) >= 0 ? text : '';
}

function normalizeCategory_(value) {
  const text = normalizeText_(value);
  const allowed = ['관광지', '영화/연극/공연', '전시/기념관'];
  return allowed.indexOf(text) >= 0 ? text : '';
}

function normalizeParking_(value) {
  const text = normalizeText_(value);
  const mapping = {
    '무료 주차': '무료',
    '무료': '무료',
    '유료 주차': '유료',
    '유료': '유료',
    '무료·유료 주차 모두 있음': '무료/유료 주차',
    '무료/유료 주차': '무료/유료 주차',
    '주차 불가': '주차 불가',
  };
  return mapping[text] || '';
}

function normalizeText_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeForComparison_(value) {
  return normalizeText_(value)
    .toLowerCase()
    .replace(/[\s()\[\]{}\-_.·]/g, '');
}

function removeUrls_(value) {
  return normalizeText_(value).replace(/https?:\/\/\S+/gi, '').trim();
}

function toNumberOrBlank_(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function uniqueNonEmpty_(values) {
  const seen = {};
  return values.filter(function (value) {
    const normalized = normalizeText_(value);
    if (!normalized || seen[normalized]) {
      return false;
    }
    seen[normalized] = true;
    return true;
  });
}

function sanitizeErrorMessage_(error) {
  const message = error && error.message ? error.message : String(error);
  const apiKey = PropertiesService.getScriptProperties().getProperty(
    CONFIG.VWORLD_API_KEY_PROPERTY
  );
  return truncate_(apiKey ? message.split(apiKey).join('[REDACTED]') : message, 1000);
}

function truncate_(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}
