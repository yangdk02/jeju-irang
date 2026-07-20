/**
 * 제주아이랑 관리자 승인 → master upsert → CSV 내보내기
 *
 * 같은 Apps Script 프로젝트의 create_google_form.gs,
 * vworld_enrichment.gs와 함께 사용합니다.
 *
 * 공개 함수 실행 순서
 * 1. setupCsvSyncSheets
 * 2. importJejuIrangCsvFromDrive 또는 Google Sheets UI로 CSV 가져오기
 * 3. setupAdminReviewControls
 * 4. review_queue에서 행 선택 → approveAndSyncSelectedRequest
 */

const CSV_SYNC_CONFIG = Object.freeze({
  SPREADSHEET_ID_PROPERTY: 'JEJU_IRANG_SPREADSHEET_ID',
  SOURCE_CSV_FILE_ID_PROPERTY: 'JEJU_IRANG_CSV_FILE_ID',
  EXPORT_FOLDER_ID_PROPERTY: 'JEJU_IRANG_EXPORT_FOLDER_ID',
  LATEST_EXPORT_FILE_ID_PROPERTY: 'JEJU_IRANG_LATEST_EXPORT_FILE_ID',
  LATEST_EXPORT_URL_PROPERTY: 'JEJU_IRANG_LATEST_EXPORT_URL',
  REVIEW_QUEUE_SHEET_NAME: 'review_queue',
  SYNC_LOG_SHEET_NAME: 'sync_log',
  MASTER_SHEET_NAME: 'jeju_irang_master',
  EXPORT_SHEET_NAME: 'jeju_irang_export',
  TIME_ZONE: 'Asia/Seoul',
  LOCK_TIMEOUT_MS: 30000,
});

const CSV_SYNC_PLACE_HEADERS = Object.freeze([
  'place_id',
  'place_name',
  'category',
  'city_name',
  'legal_dong_name',
  'region_group',
  'road_address',
  'latitude',
  'longitude',
  'phone',
  'website_url',
  'closed_days',
  'opening_hours',
  'parking',
  'has_admission_fee',
  'admission_fee_detail',
  'has_age_limit',
  'age_limit_detail',
  'nursing_room',
  'stroller_rental',
  'space_type',
  'reservation_url',
  'resident_discount',
  'diaper_changing_table',
  'photo_url',
  'description',
  'review_summary',
]);

const CSV_SYNC_LOG_HEADERS = Object.freeze([
  'log_id',
  'request_id',
  'execution_id',
  'started_at',
  'finished_at',
  'operation',
  'target_place_id',
  'synced_place_id',
  'result',
  'applied_fields',
  'cleared_fields',
  'before_hash',
  'after_hash',
  'rows_before',
  'rows_after',
  'backup_path',
  'message',
  'actor',
]);

const CSV_SYNC_APPROVED_FIELDS = Object.freeze({
  place_name: 'approved_place_name',
  category: 'approved_category',
  phone: 'approved_phone',
  website_url: 'approved_website_url',
  closed_days: 'approved_closed_days',
  opening_hours: 'approved_opening_hours',
  parking: 'approved_parking',
  has_admission_fee: 'approved_has_admission_fee',
  admission_fee_detail: 'approved_admission_fee_detail',
  has_age_limit: 'approved_has_age_limit',
  age_limit_detail: 'approved_age_limit_detail',
  nursing_room: 'approved_nursing_room',
  stroller_rental: 'approved_stroller_rental',
  space_type: 'approved_space_type',
  reservation_url: 'approved_reservation_url',
  resident_discount: 'approved_resident_discount',
  diaper_changing_table: 'approved_diaper_changing_table',
  photo_url: 'approved_photo_url',
  description: 'approved_description',
  review_summary: 'approved_review_summary',
});

const CSV_SYNC_LOCATION_FIELDS = Object.freeze([
  'source_place_id',
  'road_address',
  'city_name',
  'legal_dong_name',
  'region_group',
  'latitude',
  'longitude',
]);

const CSV_SYNC_REQUIRED_FIELDS = Object.freeze([
  'place_id',
  'place_name',
  'category',
  'city_name',
  'legal_dong_name',
  'region_group',
  'road_address',
  'latitude',
  'longitude',
  'parking',
  'has_admission_fee',
  'has_age_limit',
  'nursing_room',
  'stroller_rental',
  'space_type',
]);

const CSV_SYNC_BOOLEAN_FIELDS = Object.freeze([
  'has_admission_fee',
  'has_age_limit',
  'nursing_room',
  'stroller_rental',
  'resident_discount',
  'diaper_changing_table',
]);

/**
 * Spreadsheet를 열 때 검수자가 사용할 단일 메뉴를 표시합니다.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🍊 제주아이랑 검수')
    .addItem('선택 행 승인·반영', 'approveAndSyncSelectedRequest')
    .addToUi();
}

/**
 * review_queue의 선택 행 하나를 승인하고 즉시 master/CSV에 반영합니다.
 * 검수자는 상태값과 관리자 작업을 따로 입력할 필요가 없습니다.
 */
function approveAndSyncSelectedRequest() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = csvSyncGetSpreadsheet_();
  const sheet = spreadsheet.getActiveSheet();
  if (!sheet || sheet.getName() !== CSV_SYNC_CONFIG.REVIEW_QUEUE_SHEET_NAME) {
    ui.alert('review_queue에서 검수할 행을 먼저 선택해 주세요.');
    return;
  }

  const row = sheet.getActiveRange().getRow();
  if (row < 2) {
    ui.alert('헤더가 아닌 검수할 요청 행을 선택해 주세요.');
    return;
  }

  const headers = csvSyncGetHeaderMap_(sheet);
  [
    'request_id',
    'request_type',
    'review_status',
    'admin_action',
    'match_status',
    'sync_message',
  ].forEach(function (header) {
    if (!headers[header]) {
      throw new Error('review_queue에 ' + header + ' 헤더가 없습니다.');
    }
  });

  const record = csvSyncReadQueueRow_(sheet, row);
  const requestId = csvSyncNormalizeText_(record.request_id);
  const requestType = csvSyncUpper_(record.request_type);
  const currentStatus = csvSyncUpper_(record.review_status);
  if (!requestId) {
    ui.alert('선택한 행에 request_id가 없습니다.');
    return;
  }
  if (requestType !== 'NEW' && requestType !== 'UPDATE') {
    ui.alert('request_type이 NEW 또는 UPDATE가 아닙니다.');
    return;
  }
  if (currentStatus === 'APPLIED') {
    ui.alert('이미 반영된 요청입니다.');
    return;
  }

  const applyFields = csvSyncParseFieldList_(record.apply_fields);
  if (requestType === 'UPDATE' && applyFields.length === 0) {
    ui.alert('수정 요청의 apply_fields가 비어 있습니다. 변경할 항목을 먼저 확인해 주세요.');
    return;
  }

  const needsLocation =
    requestType === 'NEW' ||
    applyFields.some(function (field) {
      return CSV_SYNC_LOCATION_FIELDS.indexOf(field) >= 0;
    });

  const placeName = csvSyncNormalizeText_(
    record.approved_place_name || record.proposed_place_name || record.target_place_name
  );
  const sourceName = csvSyncNormalizeText_(record.source_place_name);
  const sourceAddress = csvSyncNormalizeText_(
    record.source_road_address || record.source_address
  );
  const reviewSummary = csvSyncBuildOneClickSummary_(
    record,
    requestType,
    applyFields
  );

  if (needsLocation && csvSyncUpper_(record.match_status) !== 'CONFIRMED') {
    const latitude = csvSyncNumber_(record.source_latitude);
    const longitude = csvSyncNumber_(record.source_longitude);
    if (
      csvSyncUpper_(record.source_provider) !== 'VWORLD' ||
      !sourceName ||
      !sourceAddress ||
      latitude === null ||
      longitude === null
    ) {
      ui.alert(
        'VWorld 후보를 확정할 수 없습니다.',
        '장소명·주소·좌표를 확인한 뒤 다시 눌러 주세요.',
        ui.ButtonSet.OK
      );
      return;
    }

    const candidateAnswer = ui.alert(
      '이 VWorld 장소가 맞나요?',
      '요청 장소: ' + placeName + '\n' +
        reviewSummary + '\n\n' +
        'VWorld 장소: ' + sourceName + '\n' +
        '주소: ' + sourceAddress + '\n\n' +
        '맞으면 [예]를 누르세요. 승인과 CSV 반영까지 한 번에 진행됩니다.',
      ui.ButtonSet.YES_NO
    );
    if (candidateAnswer !== ui.Button.YES) {
      return;
    }
    sheet.getRange(row, headers.match_status).setValue('CONFIRMED');
  } else {
    const approveAnswer = ui.alert(
      '선택한 요청을 반영할까요?',
      '장소: ' + placeName + '\n' +
        reviewSummary + '\n\n' +
        '맞으면 [예]를 누르세요. 승인과 CSV 생성을 한 번에 진행합니다.',
      ui.ButtonSet.YES_NO
    );
    if (approveAnswer !== ui.Button.YES) {
      return;
    }
  }

  sheet.getRange(row, headers.admin_action).setValue('APPROVE');
  sheet.getRange(row, headers.review_status).setValue('APPROVED');
  SpreadsheetApp.flush();

  csvSyncSyncApprovedRequests_(requestId);
  SpreadsheetApp.flush();

  const finalStatus = csvSyncUpper_(
    sheet.getRange(row, headers.review_status).getDisplayValue()
  );
  const finalMessage = csvSyncNormalizeText_(
    sheet.getRange(row, headers.sync_message).getDisplayValue()
  );
  if (finalStatus === 'APPLIED') {
    ui.alert('완료', '장소 정보를 승인하고 CSV에 반영했습니다.', ui.ButtonSet.OK);
  } else {
    ui.alert(
      '반영하지 못했습니다.',
      finalMessage || 'sync_message를 확인해 주세요.',
      ui.ButtonSet.OK
    );
  }
}

function csvSyncReadQueueRow_(sheet, row) {
  const lastColumn = sheet.getLastColumn();
  const headerValues = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0];
  const rowValues = sheet.getRange(row, 1, 1, lastColumn).getValues()[0];
  const record = {};
  headerValues.forEach(function (header, index) {
    const normalized = csvSyncNormalizeText_(header);
    if (normalized) {
      record[normalized] = rowValues[index];
    }
  });
  return record;
}

function csvSyncBuildOneClickSummary_(record, requestType, applyFields) {
  const labels = {
    place_name: '장소명',
    category: '시설유형',
    space_type: '공간',
    parking: '주차',
    has_admission_fee: '입장료 있음',
    has_age_limit: '연령제한 있음',
    nursing_room: '수유실',
    stroller_rental: '유모차 대여',
    phone: '전화번호',
    website_url: '홈페이지',
    closed_days: '휴무일',
    opening_hours: '운영시간',
    admission_fee_detail: '이용요금 상세',
    age_limit_detail: '연령제한 상세',
    reservation_url: '예약 주소',
    resident_discount: '도민 할인',
    diaper_changing_table: '기저귀 교환대',
    photo_url: '사진',
    description: '한 줄 설명',
    review_summary: '참고사항',
    road_address: '주소',
    latitude: '위도',
    longitude: '경도',
    city_name: '시',
    legal_dong_name: '읍면동',
    region_group: '지역',
  };
  const booleanFields = [
    'has_admission_fee',
    'has_age_limit',
    'nursing_room',
    'stroller_rental',
    'resident_discount',
    'diaper_changing_table',
  ];
  const clearFields = csvSyncParseFieldList_(record.clear_fields);

  function displayValue(field) {
    if (clearFields.indexOf(field) >= 0) {
      return '삭제';
    }
    if (CSV_SYNC_LOCATION_FIELDS.indexOf(field) >= 0) {
      return 'VWorld 주소·좌표로 갱신';
    }
    const approvedHeader = CSV_SYNC_APPROVED_FIELDS[field];
    const value = approvedHeader
      ? csvSyncNormalizeText_(record[approvedHeader])
      : '';
    if (booleanFields.indexOf(field) >= 0) {
      if (csvSyncUpper_(value) === 'TRUE') {
        return '있음';
      }
      if (csvSyncUpper_(value) === 'FALSE') {
        return '없음';
      }
    }
    return value || '기존값 유지';
  }

  let fields;
  if (requestType === 'NEW') {
    fields = [
      'category',
      'space_type',
      'parking',
      'has_admission_fee',
      'has_age_limit',
      'nursing_room',
      'stroller_rental',
    ];
  } else {
    fields = applyFields.slice(0, 8);
  }

  const lines = fields.map(function (field) {
    return (labels[field] || field) + ': ' + displayValue(field);
  });
  if (requestType === 'UPDATE' && applyFields.length > fields.length) {
    lines.push('그 외 변경: ' + (applyFields.length - fields.length) + '개');
  }
  return (requestType === 'NEW' ? '신규 등록 내용' : '변경 예정 내용') +
    '\n' + lines.join('\n');
}

/**
 * master/export/sync_log 시트를 준비합니다.
 */
function setupCsvSyncSheets() {
  const spreadsheet = csvSyncGetSpreadsheet_();
  const master = csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.MASTER_SHEET_NAME,
    CSV_SYNC_PLACE_HEADERS,
    '#FFF1C7'
  );
  const exportSheet = csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.EXPORT_SHEET_NAME,
    CSV_SYNC_PLACE_HEADERS,
    '#DDF4F8'
  );
  csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.SYNC_LOG_SHEET_NAME,
    CSV_SYNC_LOG_HEADERS,
    '#F3F4F6'
  );
  master.setFrozenRows(1);
  exportSheet.setFrozenRows(1);
  Logger.log('CSV 동기화 시트 준비 완료');
  Logger.log('기준 시트: %s', CSV_SYNC_CONFIG.MASTER_SHEET_NAME);
  Logger.log('내보내기 시트: %s', CSV_SYNC_CONFIG.EXPORT_SHEET_NAME);
}

/**
 * Script Property JEJU_IRANG_CSV_FILE_ID가 가리키는 Drive CSV를
 * 비어 있는 jeju_irang_master로 한 번 가져옵니다.
 */
function importJejuIrangCsvFromDrive() {
  const properties = PropertiesService.getScriptProperties();
  const fileId = properties.getProperty(
    CSV_SYNC_CONFIG.SOURCE_CSV_FILE_ID_PROPERTY
  );
  if (!fileId) {
    throw new Error(
      'Script Properties에 JEJU_IRANG_CSV_FILE_ID를 설정해 주세요.'
    );
  }

  const spreadsheet = csvSyncGetSpreadsheet_();
  const master = csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.MASTER_SHEET_NAME,
    CSV_SYNC_PLACE_HEADERS,
    '#FFF1C7'
  );
  if (master.getLastRow() > 1) {
    throw new Error(
      'jeju_irang_master에 데이터가 이미 있습니다. 안전을 위해 가져오기를 중단했습니다.'
    );
  }

  const text = DriveApp.getFileById(fileId)
    .getBlob()
    .getDataAsString('UTF-8')
    .replace(/^\uFEFF/, '');
  const parsed = Utilities.parseCsv(text);
  if (parsed.length < 2) {
    throw new Error('CSV에 헤더 또는 데이터 행이 없습니다.');
  }

  const sourceHeaders = parsed[0].map(csvSyncNormalizeText_);
  csvSyncAssertPlaceHeaders_(sourceHeaders);
  const sourceIndex = csvSyncHeaderMapFromArray_(sourceHeaders);
  const records = parsed
    .slice(1)
    .filter(function (row) {
      return row.some(function (value) {
        return csvSyncNormalizeText_(value) !== '';
      });
    })
    .map(function (row) {
      const record = {};
      CSV_SYNC_PLACE_HEADERS.forEach(function (header) {
        record[header] = row[sourceIndex[header] - 1] || '';
      });
      return csvSyncNormalizePlaceRecord_(record);
    });

  csvSyncValidateUniqueMaster_(records);
  csvSyncWritePlaceRecords_(master, records);
  csvSyncRefreshExportSheet_(spreadsheet, records);
  Logger.log('기존 CSV 가져오기 완료: %s개 장소', records.length);
}

/**
 * review_queue에서 관리자용 드롭다운을 준비합니다.
 */
function setupAdminReviewControls() {
  const spreadsheet = csvSyncGetSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(
    CSV_SYNC_CONFIG.REVIEW_QUEUE_SHEET_NAME
  );
  if (!sheet) {
    throw new Error('review_queue 시트를 찾을 수 없습니다.');
  }
  const headers = csvSyncGetHeaderMap_(sheet);
  ['review_status', 'admin_action', 'match_status'].forEach(function (header) {
    if (!headers[header]) {
      throw new Error('review_queue에 ' + header + ' 헤더가 없습니다.');
    }
  });

  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const reviewValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      [
        'PENDING',
        'IN_REVIEW',
        'NEEDS_INFO',
        'APPROVED',
        'REJECTED',
        'APPLIED',
        'ERROR',
      ],
      true
    )
    .setAllowInvalid(false)
    .build();
  const actionValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(['APPROVE', 'REJECT'], true)
    .setAllowInvalid(false)
    .build();
  const matchValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      [
        'UNSEARCHED',
        'NO_MATCH',
        'SINGLE_CANDIDATE',
        'MULTIPLE_CANDIDATES',
        'CONFIRMED',
      ],
      true
    )
    .setAllowInvalid(false)
    .build();

  sheet
    .getRange(2, headers.review_status, rowCount, 1)
    .setDataValidation(reviewValidation);
  sheet
    .getRange(2, headers.admin_action, rowCount, 1)
    .setDataValidation(actionValidation);
  sheet
    .getRange(2, headers.match_status, rowCount, 1)
    .setDataValidation(matchValidation);
  Logger.log('관리자 검수 드롭다운 설정 완료');
}

/**
 * APPROVED + APPROVE 행을 master에 반영하고 Drive CSV를 생성합니다.
 */
function syncApprovedRequests() {
  return csvSyncSyncApprovedRequests_('');
}

function csvSyncSyncApprovedRequests_(onlyRequestId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CSV_SYNC_CONFIG.LOCK_TIMEOUT_MS);

  const startedAt = new Date();
  const executionId = Utilities.getUuid();
  const actor = csvSyncGetActor_();

  try {
    const spreadsheet = csvSyncGetSpreadsheet_();
    const reviewSheet = spreadsheet.getSheetByName(
      CSV_SYNC_CONFIG.REVIEW_QUEUE_SHEET_NAME
    );
    const masterSheet = spreadsheet.getSheetByName(
      CSV_SYNC_CONFIG.MASTER_SHEET_NAME
    );
    if (!reviewSheet || !masterSheet) {
      throw new Error(
        'review_queue 또는 jeju_irang_master가 없습니다. setupCsvSyncSheets를 먼저 실행해 주세요.'
      );
    }

    const masterRecords = csvSyncReadPlaceRecords_(masterSheet);
    if (masterRecords.length === 0) {
      throw new Error(
        'jeju_irang_master가 비어 있습니다. 기존 CSV를 먼저 가져와 주세요.'
      );
    }
    csvSyncValidateUniqueMaster_(masterRecords);
    const beforeRecords = masterRecords.map(function (record) {
      return Object.assign({}, record);
    });
    const rowsBefore = masterRecords.length;

    const queueHeaders = csvSyncGetHeaderMap_(reviewSheet);
    const queueRows = csvSyncReadSheetRecords_(reviewSheet);
    const eligible = queueRows.filter(function (entry) {
      return (
        csvSyncUpper_(entry.record.review_status) === 'APPROVED' &&
        csvSyncUpper_(entry.record.admin_action) === 'APPROVE' &&
        (!onlyRequestId ||
          csvSyncNormalizeText_(entry.record.request_id) === onlyRequestId)
      );
    });

    if (eligible.length === 0) {
      Logger.log('반영할 APPROVED + APPROVE 요청이 없습니다.');
      return;
    }

    const results = [];
    eligible.forEach(function (entry) {
      try {
        const result = csvSyncApplyApprovedRequest_(
          entry.record,
          masterRecords
        );
        result.queueRow = entry.row;
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          queueRow: entry.row,
          requestId: csvSyncNormalizeText_(entry.record.request_id),
          operation: csvSyncUpper_(entry.record.request_type) || 'UNKNOWN',
          targetPlaceId: csvSyncNormalizeText_(entry.record.target_place_id),
          syncedPlaceId: '',
          appliedFields: '',
          clearedFields: csvSyncParseFieldList_(entry.record.clear_fields).join(', '),
          beforeHash: '',
          afterHash: '',
          processedActionKey: '',
          resolved: null,
          message: error && error.message ? error.message : String(error),
        });
      }
    });

    const successes = results.filter(function (result) {
      return result.success;
    });
    let backupUrl = '';
    let exportUrl = '';

    if (successes.length > 0) {
      const stamp = Utilities.formatDate(
        new Date(),
        CSV_SYNC_CONFIG.TIME_ZONE,
        'yyyyMMdd-HHmmss'
      );
      backupUrl = csvSyncCreateCsvFile_(
        'jeju-irang-backup-' + stamp + '.csv',
        beforeRecords,
        '승인 반영 전 자동 백업'
      ).getUrl();

      csvSyncSortRecords_(masterRecords);
      try {
        csvSyncWritePlaceRecords_(masterSheet, masterRecords);
        csvSyncRefreshExportSheet_(spreadsheet, masterRecords);
        const exportFile = csvSyncCreateCsvFile_(
          'jeju-irang-export-' + stamp + '.csv',
          masterRecords,
          '제주아이랑 승인 데이터 CSV 내보내기'
        );
        exportUrl = exportFile.getUrl();
        PropertiesService.getScriptProperties().setProperties({
          [CSV_SYNC_CONFIG.LATEST_EXPORT_FILE_ID_PROPERTY]: exportFile.getId(),
          [CSV_SYNC_CONFIG.LATEST_EXPORT_URL_PROPERTY]: exportUrl,
        });
      } catch (error) {
        csvSyncWritePlaceRecords_(masterSheet, beforeRecords);
        csvSyncRefreshExportSheet_(spreadsheet, beforeRecords);
        throw new Error(
          'CSV 내보내기에 실패하여 master를 원상 복구했습니다: ' +
            (error && error.message ? error.message : String(error))
        );
      }
    }

    const finishedAt = new Date();
    results.forEach(function (result) {
      csvSyncUpdateQueueResult_(
        reviewSheet,
        queueHeaders,
        result,
        finishedAt,
        exportUrl
      );
      csvSyncAppendLog_(spreadsheet, {
        log_id: csvSyncCreateLogId_(),
        request_id: result.requestId,
        execution_id: executionId,
        started_at: startedAt,
        finished_at: finishedAt,
        operation: result.operation,
        target_place_id: result.targetPlaceId,
        synced_place_id: result.syncedPlaceId,
        result: result.success ? 'SUCCESS' : 'ERROR',
        applied_fields: result.appliedFields,
        cleared_fields: result.clearedFields,
        before_hash: result.beforeHash,
        after_hash: result.afterHash,
        rows_before: rowsBefore,
        rows_after: masterRecords.length,
        backup_path: backupUrl,
        message: result.success
          ? result.message + ' | export=' + exportUrl
          : result.message,
        actor: actor,
      });
    });

    Logger.log('승인 반영 성공: %s건', successes.length);
    Logger.log('승인 반영 실패: %s건', results.length - successes.length);
    if (exportUrl) {
      Logger.log('최종 CSV: %s', exportUrl);
      Logger.log('반영 전 백업 CSV: %s', backupUrl);
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 현재 master를 변경하지 않고 CSV로 내보냅니다.
 */
function exportJejuIrangCsv() {
  const spreadsheet = csvSyncGetSpreadsheet_();
  const master = spreadsheet.getSheetByName(
    CSV_SYNC_CONFIG.MASTER_SHEET_NAME
  );
  if (!master) {
    throw new Error('jeju_irang_master를 찾을 수 없습니다.');
  }
  const records = csvSyncReadPlaceRecords_(master);
  csvSyncValidateUniqueMaster_(records);
  csvSyncSortRecords_(records);
  csvSyncRefreshExportSheet_(spreadsheet, records);
  const stamp = Utilities.formatDate(
    new Date(),
    CSV_SYNC_CONFIG.TIME_ZONE,
    'yyyyMMdd-HHmmss'
  );
  const file = csvSyncCreateCsvFile_(
    'jeju-irang-export-' + stamp + '.csv',
    records,
    '제주아이랑 수동 CSV 내보내기'
  );
  PropertiesService.getScriptProperties().setProperties({
    [CSV_SYNC_CONFIG.LATEST_EXPORT_FILE_ID_PROPERTY]: file.getId(),
    [CSV_SYNC_CONFIG.LATEST_EXPORT_URL_PROPERTY]: file.getUrl(),
  });
  Logger.log('최종 CSV: %s', file.getUrl());
}

function showLatestJejuIrangExportLink() {
  const url = PropertiesService.getScriptProperties().getProperty(
    CSV_SYNC_CONFIG.LATEST_EXPORT_URL_PROPERTY
  );
  if (!url) {
    throw new Error('아직 생성된 CSV가 없습니다.');
  }
  Logger.log('최근 CSV: %s', url);
}

function csvSyncApplyApprovedRequest_(queue, masterRecords) {
  const requestId = csvSyncNormalizeText_(queue.request_id);
  const requestType = csvSyncUpper_(queue.request_type);
  if (!requestId) {
    throw new Error('request_id가 없습니다.');
  }
  if (requestType !== 'NEW' && requestType !== 'UPDATE') {
    throw new Error('request_type은 NEW 또는 UPDATE여야 합니다.');
  }

  const actionKey = csvSyncCreateActionKey_(queue);
  if (
    csvSyncNormalizeText_(queue.processed_action_key) === actionKey &&
    actionKey
  ) {
    throw new Error('동일한 승인 내용이 이미 처리되었습니다.');
  }

  const applyFields = csvSyncParseFieldList_(queue.apply_fields);
  const clearFields = csvSyncParseFieldList_(queue.clear_fields);
  csvSyncValidateClearFields_(clearFields);
  const needsLocation =
    requestType === 'NEW' ||
    applyFields.some(function (field) {
      return CSV_SYNC_LOCATION_FIELDS.indexOf(field) >= 0;
    });
  const resolved = needsLocation ? csvSyncResolveLocation_(queue) : null;

  let record;
  let targetIndex = -1;
  let targetPlaceId = '';
  let beforeHash = '';
  const applied = [];

  if (requestType === 'NEW') {
    const requestedName = csvSyncGetApprovedValue_(queue, 'place_name');
    if (!requestedName) {
      throw new Error('신규 장소의 approved_place_name이 없습니다.');
    }
    const duplicate = masterRecords.some(function (existing) {
      return (
        csvSyncNormalizeName_(existing.place_name) ===
        csvSyncNormalizeName_(requestedName)
      );
    });
    if (duplicate) {
      throw new Error('동일한 장소명이 master에 이미 존재합니다.');
    }

    record = csvSyncEmptyPlaceRecord_();
    record.place_id = csvSyncNextPlaceId_(masterRecords);
    Object.keys(CSV_SYNC_APPROVED_FIELDS).forEach(function (field) {
      const value = csvSyncGetApprovedValue_(queue, field);
      if (value !== '') {
        record[field] = value;
        applied.push(field);
      }
    });
    csvSyncApplyResolvedLocation_(record, resolved, applied);
    clearFields.forEach(function (field) {
      record[field] = '';
    });
    record = csvSyncNormalizePlaceRecord_(record);
    csvSyncValidateFinalRecord_(record);
    masterRecords.push(record);
    targetPlaceId = record.place_id;
  } else {
    const targetName = csvSyncNormalizeText_(queue.target_place_name);
    if (!targetName) {
      throw new Error('수정 요청의 target_place_name이 없습니다.');
    }
    const matches = [];
    masterRecords.forEach(function (existing, index) {
      if (csvSyncNormalizeText_(existing.place_name) === targetName) {
        matches.push(index);
      }
    });
    if (matches.length !== 1) {
      throw new Error(
        '기존 장소명과 정확히 일치하는 master 행이 ' +
          matches.length +
          '건입니다.'
      );
    }

    targetIndex = matches[0];
    record = Object.assign({}, masterRecords[targetIndex]);
    targetPlaceId = record.place_id;
    beforeHash = csvSyncHashRecord_(record);

    applyFields.forEach(function (field) {
      if (!CSV_SYNC_APPROVED_FIELDS[field]) {
        return;
      }
      const value = csvSyncGetApprovedValue_(queue, field);
      if (value !== '') {
        record[field] = value;
        applied.push(field);
      }
    });
    if (resolved) {
      csvSyncApplyResolvedLocation_(record, resolved, applied);
    }
    clearFields.forEach(function (field) {
      record[field] = '';
    });
    record = csvSyncNormalizePlaceRecord_(record);

    if (record.place_name !== masterRecords[targetIndex].place_name) {
      const duplicateName = masterRecords.some(function (existing, index) {
        return (
          index !== targetIndex &&
          csvSyncNormalizeName_(existing.place_name) ===
            csvSyncNormalizeName_(record.place_name)
        );
      });
      if (duplicateName) {
        throw new Error('변경할 장소명이 다른 master 행과 중복됩니다.');
      }
    }
    csvSyncValidateFinalRecord_(record);
    masterRecords[targetIndex] = record;
  }

  const afterHash = csvSyncHashRecord_(record);
  return {
    success: true,
    requestId: requestId,
    operation: requestType,
    targetPlaceId: targetPlaceId,
    syncedPlaceId: record.place_id,
    appliedFields: csvSyncUnique_(applied).join(', '),
    clearedFields: clearFields.join(', '),
    beforeHash: beforeHash,
    afterHash: afterHash,
    processedActionKey: actionKey,
    resolved: resolved,
    message:
      requestType === 'NEW'
        ? '신규 장소를 추가했습니다.'
        : '기존 장소를 수정했습니다.',
  };
}

function csvSyncResolveLocation_(queue) {
  if (csvSyncUpper_(queue.match_status) !== 'CONFIRMED') {
    throw new Error(
      '위치 반영 전 match_status를 CONFIRMED로 확인해야 합니다.'
    );
  }
  if (csvSyncUpper_(queue.source_provider) !== 'VWORLD') {
    throw new Error('source_provider가 VWORLD가 아닙니다.');
  }

  const road = csvSyncNormalizeText_(queue.source_road_address);
  const parcel = csvSyncNormalizeText_(queue.source_address);
  const address = road || parcel;
  const latitude = csvSyncNumber_(queue.source_latitude);
  const longitude = csvSyncNumber_(queue.source_longitude);
  if (!address || latitude === null || longitude === null) {
    throw new Error('확정된 VWorld 주소 또는 좌표가 없습니다.');
  }
  if (
    latitude < 33.0 ||
    latitude > 33.7 ||
    longitude < 126.0 ||
    longitude > 127.1
  ) {
    throw new Error('확정 좌표가 제주 검증 범위를 벗어났습니다.');
  }

  const cityName = csvSyncExtractCity_(parcel || road);
  const legalDongName = csvSyncExtractLegalDong_(parcel || road, cityName);
  if (!cityName || !legalDongName) {
    throw new Error(
      'VWorld 주소에서 city_name 또는 legal_dong_name을 만들 수 없습니다.'
    );
  }
  return {
    road_address: address,
    latitude: String(latitude),
    longitude: String(longitude),
    city_name: cityName,
    legal_dong_name: legalDongName,
    region_group: csvSyncRegionGroup_(cityName, legalDongName),
  };
}

function csvSyncApplyResolvedLocation_(record, resolved, applied) {
  if (!resolved) {
    return;
  }
  [
    'road_address',
    'latitude',
    'longitude',
    'city_name',
    'legal_dong_name',
    'region_group',
  ].forEach(function (field) {
    record[field] = resolved[field];
    applied.push(field);
  });
}

function csvSyncExtractCity_(address) {
  const match = csvSyncNormalizeText_(address).match(/(?:^|\s)(제주시|서귀포시)(?:\s|$)/);
  return match ? match[1] : '';
}

function csvSyncExtractLegalDong_(address, cityName) {
  const text = csvSyncNormalizeText_(address);
  const cityIndex = text.indexOf(cityName);
  const tail = cityIndex >= 0 ? text.slice(cityIndex + cityName.length) : text;
  const tokens = tail.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].replace(/[,()]/g, '');
    if (/[가-힣0-9·]+(?:읍|면|동)$/.test(token)) {
      return token;
    }
  }
  return '';
}

function csvSyncRegionGroup_(cityName, legalDongName) {
  const grouped = {
    '구좌읍': '구좌/조천',
    '조천읍': '구좌/조천',
    '성산읍': '성산/표선',
    '표선면': '성산/표선',
    '안덕면': '안덕/대정',
    '대정읍': '안덕/대정',
    '애월읍': '애월/한림',
    '한림읍': '애월/한림',
    '한경면': '애월/한림',
  };
  return grouped[legalDongName] || cityName;
}

function csvSyncValidateFinalRecord_(record) {
  CSV_SYNC_REQUIRED_FIELDS.forEach(function (field) {
    if (csvSyncNormalizeText_(record[field]) === '') {
      throw new Error('최종 데이터 필수값이 없습니다: ' + field);
    }
  });

  if (['관광지', '영화/연극/공연', '전시/기념관'].indexOf(record.category) < 0) {
    throw new Error('허용되지 않은 category입니다: ' + record.category);
  }
  if (['실내', '실외', '실내/실외'].indexOf(record.space_type) < 0) {
    throw new Error('허용되지 않은 space_type입니다: ' + record.space_type);
  }
  if (['무료', '유료', '무료/유료 주차', '주차 불가'].indexOf(record.parking) < 0) {
    throw new Error('허용되지 않은 parking입니다: ' + record.parking);
  }
  CSV_SYNC_BOOLEAN_FIELDS.forEach(function (field) {
    const value = csvSyncNormalizeText_(record[field]);
    if (value && value !== 'TRUE' && value !== 'FALSE') {
      throw new Error(field + ' 값은 TRUE, FALSE 또는 빈 값이어야 합니다.');
    }
  });

  if (['제주시', '서귀포시'].indexOf(record.city_name) < 0) {
    throw new Error('city_name은 제주시 또는 서귀포시여야 합니다.');
  }
  if (
    [
      '구좌/조천',
      '서귀포시',
      '성산/표선',
      '안덕/대정',
      '애월/한림',
      '제주시',
    ].indexOf(record.region_group) < 0
  ) {
    throw new Error('허용되지 않은 region_group입니다.');
  }
  if (csvSyncNumber_(record.latitude) === null || csvSyncNumber_(record.longitude) === null) {
    throw new Error('latitude와 longitude는 숫자여야 합니다.');
  }
}

function csvSyncValidateClearFields_(fields) {
  fields.forEach(function (field) {
    if (CSV_SYNC_PLACE_HEADERS.indexOf(field) < 0) {
      throw new Error('clear_fields에 알 수 없는 컬럼이 있습니다: ' + field);
    }
    if (field === 'place_id') {
      throw new Error('place_id는 삭제할 수 없습니다.');
    }
  });
}

function csvSyncGetApprovedValue_(queue, field) {
  const header = CSV_SYNC_APPROVED_FIELDS[field];
  return header ? csvSyncNormalizeFieldValue_(field, queue[header]) : '';
}

function csvSyncNormalizePlaceRecord_(record) {
  const normalized = csvSyncEmptyPlaceRecord_();
  CSV_SYNC_PLACE_HEADERS.forEach(function (field) {
    normalized[field] = csvSyncNormalizeFieldValue_(field, record[field]);
  });
  return normalized;
}

function csvSyncNormalizeFieldValue_(field, value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (CSV_SYNC_BOOLEAN_FIELDS.indexOf(field) >= 0) {
    const upper = text.toUpperCase();
    if (upper === 'TRUE' || ['있음', '예', '가능', '1', 'YES'].indexOf(upper) >= 0) {
      return 'TRUE';
    }
    if (upper === 'FALSE' || ['없음', '아니오', '불가', '0', 'NO'].indexOf(upper) >= 0) {
      return 'FALSE';
    }
    return '';
  }
  if (field === 'parking') {
    const parking = {
      '무료 주차': '무료',
      '무료': '무료',
      '유료 주차': '유료',
      '유료': '유료',
      '무료·유료 주차 모두 있음': '무료/유료 주차',
      '무료/유료 주차': '무료/유료 주차',
      '주차 불가': '주차 불가',
    };
    return parking[text] || text;
  }
  return text.replace(/\r\n/g, '\n');
}

function csvSyncEmptyPlaceRecord_() {
  const record = {};
  CSV_SYNC_PLACE_HEADERS.forEach(function (header) {
    record[header] = '';
  });
  return record;
}

function csvSyncNextPlaceId_(records) {
  let max = 0;
  records.forEach(function (record) {
    const match = csvSyncNormalizeText_(record.place_id).match(/^P(\d+)$/i);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  const next = String(max + 1);
  return 'P' + next.padStart(Math.max(3, next.length), '0');
}

function csvSyncValidateUniqueMaster_(records) {
  const ids = {};
  const names = {};
  const normalizedNames = {};
  records.forEach(function (record, index) {
    const id = csvSyncNormalizeText_(record.place_id);
    const name = csvSyncNormalizeText_(record.place_name);
    const normalizedName = csvSyncNormalizeName_(record.place_name);
    if (!id || ids[id]) {
      throw new Error('master의 place_id가 비어 있거나 중복됩니다: ' + id);
    }
    if (!name || names[name]) {
      throw new Error(
        'master의 place_name이 비어 있거나 중복됩니다: ' + record.place_name
      );
    }
    ids[id] = index + 2;
    names[name] = index + 2;
    if (normalizedName && normalizedNames[normalizedName]) {
      Logger.log(
        '유사 장소명 경고: %s행 "%s" / %s행 "%s"',
        normalizedNames[normalizedName].row,
        normalizedNames[normalizedName].name,
        index + 2,
        name
      );
    } else if (normalizedName) {
      normalizedNames[normalizedName] = { row: index + 2, name: name };
    }
  });
}

function csvSyncUpdateQueueResult_(sheet, headers, result, now, exportUrl) {
  const values = result.success
    ? {
        target_place_id: result.targetPlaceId,
        review_status: 'APPLIED',
        approved_at: now,
        synced_place_id: result.syncedPlaceId,
        synced_at: now,
        sync_message: result.message + ' CSV: ' + exportUrl,
        duplicate_status: 'CLEAR',
        validation_status: 'PASSED',
        validation_message: '',
        current_record_hash: result.afterHash,
        processed_action_key: result.processedActionKey,
      }
    : {
        review_status: 'ERROR',
        synced_at: now,
        sync_message: result.message,
        validation_status: 'BLOCKED',
        validation_message: result.message,
      };

  if (result.resolved) {
    values.resolved_city_name = result.resolved.city_name;
    values.resolved_legal_dong_name = result.resolved.legal_dong_name;
    values.resolved_region_group = result.resolved.region_group;
  }
  Object.keys(values).forEach(function (header) {
    if (headers[header]) {
      sheet.getRange(result.queueRow, headers[header]).setValue(values[header]);
    }
  });
}

function csvSyncAppendLog_(spreadsheet, logRecord) {
  const sheet = csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.SYNC_LOG_SHEET_NAME,
    CSV_SYNC_LOG_HEADERS,
    '#F3F4F6'
  );
  const row = CSV_SYNC_LOG_HEADERS.map(function (header) {
    return logRecord[header] === undefined ? '' : logRecord[header];
  });
  sheet.appendRow(row);
}

function csvSyncReadPlaceRecords_(sheet) {
  const records = csvSyncReadSheetRecords_(sheet).map(function (entry) {
    return csvSyncNormalizePlaceRecord_(entry.record);
  });
  return records.filter(function (record) {
    return CSV_SYNC_PLACE_HEADERS.some(function (header) {
      return csvSyncNormalizeText_(record[header]) !== '';
    });
  });
}

function csvSyncReadSheetRecords_(sheet) {
  if (sheet.getLastRow() < 2) {
    return [];
  }
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(csvSyncNormalizeText_);
  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getDisplayValues();
  return values.map(function (row, index) {
    const record = {};
    headers.forEach(function (header, column) {
      if (header) {
        record[header] = row[column];
      }
    });
    return { row: index + 2, record: record };
  });
}

function csvSyncWritePlaceRecords_(sheet, records) {
  csvSyncAssertPlaceHeaders_(
    sheet
      .getRange(1, 1, 1, CSV_SYNC_PLACE_HEADERS.length)
      .getDisplayValues()[0]
      .map(csvSyncNormalizeText_)
  );
  csvSyncEnsureRows_(sheet, records.length + 1);
  const previousRows = Math.max(sheet.getLastRow() - 1, 0);
  if (previousRows > 0) {
    sheet
      .getRange(2, 1, previousRows, CSV_SYNC_PLACE_HEADERS.length)
      .clearContent();
  }
  if (records.length > 0) {
    const values = records.map(function (record) {
      return CSV_SYNC_PLACE_HEADERS.map(function (header) {
        return record[header] === undefined ? '' : record[header];
      });
    });
    sheet
      .getRange(2, 1, values.length, CSV_SYNC_PLACE_HEADERS.length)
      .setNumberFormat('@')
      .setValues(values);
  }
  sheet.setFrozenRows(1);
}

function csvSyncRefreshExportSheet_(spreadsheet, records) {
  const sheet = csvSyncEnsureStructuredSheet_(
    spreadsheet,
    CSV_SYNC_CONFIG.EXPORT_SHEET_NAME,
    CSV_SYNC_PLACE_HEADERS,
    '#DDF4F8'
  );
  csvSyncWritePlaceRecords_(sheet, records);
}

function csvSyncCreateCsvFile_(filename, records, description) {
  const csv = csvSyncRecordsToCsv_(records);
  const blob = Utilities.newBlob(
    '\uFEFF' + csv,
    'text/csv;charset=utf-8',
    filename
  );
  const folderId = PropertiesService.getScriptProperties().getProperty(
    CSV_SYNC_CONFIG.EXPORT_FOLDER_ID_PROPERTY
  );
  const file = folderId
    ? DriveApp.getFolderById(folderId).createFile(blob)
    : DriveApp.createFile(blob);
  file.setDescription(description || '');
  return file;
}

function csvSyncRecordsToCsv_(records) {
  const lines = [CSV_SYNC_PLACE_HEADERS.map(csvSyncEscapeCsv_).join(',')];
  records.forEach(function (record) {
    lines.push(
      CSV_SYNC_PLACE_HEADERS.map(function (header) {
        return csvSyncEscapeCsv_(record[header]);
      }).join(',')
    );
  });
  return lines.join('\r\n') + '\r\n';
}

function csvSyncEscapeCsv_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function csvSyncEnsureStructuredSheet_(spreadsheet, name, headers, color) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  csvSyncEnsureColumns_(sheet, headers.length);
  const existing = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
    .getDisplayValues()[0]
    .map(csvSyncNormalizeText_);
  const hasHeaders = existing.some(Boolean);
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = existing.slice(0, headers.length);
    if (JSON.stringify(current) !== JSON.stringify(headers)) {
      throw new Error(name + ' 시트의 헤더 순서가 설계와 다릅니다.');
    }
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

function csvSyncGetSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    CSV_SYNC_CONFIG.SPREADSHEET_ID_PROPERTY
  );
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error('대상 Spreadsheet를 찾을 수 없습니다.');
}

function csvSyncGetHeaderMap_(sheet) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  return csvSyncHeaderMapFromArray_(headers);
}

function csvSyncHeaderMapFromArray_(headers) {
  const map = {};
  headers.forEach(function (header, index) {
    const normalized = csvSyncNormalizeText_(header);
    if (normalized) {
      map[normalized] = index + 1;
    }
  });
  return map;
}

function csvSyncAssertPlaceHeaders_(headers) {
  const normalized = headers.map(csvSyncNormalizeText_);
  const missing = CSV_SYNC_PLACE_HEADERS.filter(function (header) {
    return normalized.indexOf(header) < 0;
  });
  if (missing.length > 0) {
    throw new Error('CSV 또는 master에 누락된 컬럼: ' + missing.join(', '));
  }
}

function csvSyncParseFieldList_(value) {
  if (!value) {
    return [];
  }
  return csvSyncUnique_(
    String(value)
      .split(/[\n,]+/)
      .map(csvSyncNormalizeText_)
      .filter(Boolean)
  );
}

function csvSyncCreateActionKey_(queue) {
  const payload = {
    request_id: csvSyncNormalizeText_(queue.request_id),
    request_type: csvSyncUpper_(queue.request_type),
    admin_action: csvSyncUpper_(queue.admin_action),
    target_place_name: csvSyncNormalizeText_(queue.target_place_name),
    apply_fields: csvSyncParseFieldList_(queue.apply_fields),
    clear_fields: csvSyncParseFieldList_(queue.clear_fields),
    match_status: csvSyncUpper_(queue.match_status),
    source_provider: csvSyncUpper_(queue.source_provider),
    source_place_id: csvSyncNormalizeText_(queue.source_place_id),
    source_address: csvSyncNormalizeText_(queue.source_address),
    source_road_address: csvSyncNormalizeText_(queue.source_road_address),
    source_latitude: csvSyncNormalizeText_(queue.source_latitude),
    source_longitude: csvSyncNormalizeText_(queue.source_longitude),
  };
  Object.keys(CSV_SYNC_APPROVED_FIELDS).forEach(function (field) {
    payload[field] = csvSyncGetApprovedValue_(queue, field);
  });
  return csvSyncSha256_(JSON.stringify(payload));
}

function csvSyncHashRecord_(record) {
  const values = CSV_SYNC_PLACE_HEADERS.map(function (header) {
    return record[header] === undefined ? '' : record[header];
  });
  return csvSyncSha256_(JSON.stringify(values));
}

function csvSyncSha256_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (byte) {
      return ('0' + (byte & 255).toString(16)).slice(-2);
    })
    .join('');
}

function csvSyncCreateLogId_() {
  return (
    'LOG-' +
    Utilities.formatDate(
      new Date(),
      CSV_SYNC_CONFIG.TIME_ZONE,
      'yyyyMMddHHmmss'
    ) +
    '-' +
    Utilities.getUuid().slice(0, 8)
  );
}

function csvSyncGetActor_() {
  return (
    Session.getEffectiveUser().getEmail() ||
    Session.getActiveUser().getEmail() ||
    'apps-script'
  );
}

function csvSyncSortRecords_(records) {
  records.sort(function (left, right) {
    return csvSyncNormalizeText_(left.place_id).localeCompare(
      csvSyncNormalizeText_(right.place_id),
      'en',
      { numeric: true }
    );
  });
}

function csvSyncEnsureColumns_(sheet, required) {
  if (sheet.getMaxColumns() < required) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      required - sheet.getMaxColumns()
    );
  }
}

function csvSyncEnsureRows_(sheet, required) {
  if (sheet.getMaxRows() < required) {
    sheet.insertRowsAfter(sheet.getMaxRows(), required - sheet.getMaxRows());
  }
}

function csvSyncNumber_(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function csvSyncNormalizeText_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function csvSyncNormalizeName_(value) {
  return csvSyncNormalizeText_(value)
    .toLowerCase()
    .replace(/[\s()[\]{}\-_.·]/g, '');
}

function csvSyncUpper_(value) {
  return csvSyncNormalizeText_(value).toUpperCase();
}

function csvSyncUnique_(values) {
  const seen = {};
  return values.filter(function (value) {
    if (!value || seen[value]) {
      return false;
    }
    seen[value] = true;
    return true;
  });
}
