/**
 * 제주아이랑 장소 제안·수정 Google Form 자동 생성기
 *
 * 사용 방법
 * 1. https://script.google.com 에서 새 독립형 Apps Script 프로젝트를 만듭니다.
 * 2. 이 파일의 전체 내용을 붙여 넣습니다.
 * 3. createJejuIrangForm 함수를 한 번 실행하고 권한을 승인합니다.
 *
 * 생성 결과
 * - 섹션 분기가 설정된 Google Form 1개
 * - 응답용 Google Spreadsheet 1개
 * - form_responses, review_queue, sync_log 시트
 * - 신규 장소 제안용 사전 입력 URL
 */

const FORM_BUILDER_CONFIG = Object.freeze({
  FORM_TITLE: '제주아이랑 장소 제안·수정',
  FORM_DESCRIPTION:
    '제주아이랑에 새 장소를 제안하거나 기존 장소의 정보를 수정해 주세요. 제출된 내용은 관리자 검수 후 반영됩니다.',
  CONFIRMATION_MESSAGE:
    '제안해 주셔서 감사합니다. 보내주신 내용은 관리자 검수 후 제주아이랑에 반영됩니다.',
  SPREADSHEET_TITLE: '제주아이랑 장소 제안·수정 응답',
  FORM_RESPONSES_SHEET_NAME: 'form_responses',
  REVIEW_QUEUE_SHEET_NAME: 'review_queue',
  SYNC_LOG_SHEET_NAME: 'sync_log',
  TIME_ZONE: 'Asia/Seoul',
  LOCALE: 'ko_KR',
  RESPONSE_SHEET_WAIT_MS: 90000,
  PROPERTY_FORM_ID: 'JEJU_IRANG_FORM_ID',
  PROPERTY_SPREADSHEET_ID: 'JEJU_IRANG_SPREADSHEET_ID',
  PROPERTY_BUILD_STATUS: 'JEJU_IRANG_FORM_BUILD_STATUS',
  PROPERTY_ITEM_IDS: 'JEJU_IRANG_FORM_ITEM_IDS_JSON',
  PROPERTY_NEW_PREFILLED_URL: 'JEJU_IRANG_NEW_PREFILLED_URL',
});

const FORM_BUILDER_REVIEW_HEADERS = Object.freeze([
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
  'source_response_row',
  'submitted_at',
  'target_place_name',
  'changed_fields',
  'update_note',
  'location_hint',
  'source_hash',
  'apply_fields',
  'clear_fields',
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
  'resolved_city_name',
  'resolved_legal_dong_name',
  'resolved_region_group',
  'duplicate_status',
  'validation_status',
  'validation_message',
  'current_record_hash',
  'processed_action_key',
  'source_category',
  'source_candidate_count',
  'source_candidates',
]);

const FORM_BUILDER_SYNC_LOG_HEADERS = Object.freeze([
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

/**
 * Google Form과 응답 Spreadsheet를 한 번에 생성합니다.
 * 이미 정상 생성된 ID가 Script Properties에 있으면 중복 생성하지 않습니다.
 */
function createJejuIrangForm() {
  const properties = PropertiesService.getScriptProperties();
  const existing = formBuilderGetExistingResources_(properties);
  if (existing) {
    formBuilderLogLinks_(existing.form, existing.spreadsheet, properties);
    return;
  }

  const recoverable = formBuilderGetRecoverableResources_(properties);
  if (recoverable) {
    formBuilderResumeExistingBuild_(
      recoverable.form,
      recoverable.spreadsheet,
      properties
    );
    return;
  }

  properties.setProperty(
    FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS,
    'BUILDING'
  );

  let form = null;
  let spreadsheet = null;

  try {
    spreadsheet = SpreadsheetApp.create(
      FORM_BUILDER_CONFIG.SPREADSHEET_TITLE
    );
    spreadsheet.setSpreadsheetTimeZone(FORM_BUILDER_CONFIG.TIME_ZONE);
    spreadsheet.setSpreadsheetLocale(FORM_BUILDER_CONFIG.LOCALE);

    form = FormApp.create(FORM_BUILDER_CONFIG.FORM_TITLE, true);
    formBuilderConfigureForm_(form);
    const items = formBuilderAddItems_(form);

    const initialSheetIds = spreadsheet.getSheets().map(function (sheet) {
      return sheet.getSheetId();
    });

    form.setDestination(
      FormApp.DestinationType.SPREADSHEET,
      spreadsheet.getId()
    );

    const responseSheet = formBuilderWaitForResponseSheet_(
      spreadsheet,
      initialSheetIds,
      form
    );
    responseSheet.setName(FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME);
    responseSheet.setFrozenRows(1);

    const reviewSheet = formBuilderPrepareStructuredSheet_(
      spreadsheet,
      FORM_BUILDER_CONFIG.REVIEW_QUEUE_SHEET_NAME,
      FORM_BUILDER_REVIEW_HEADERS,
      '#DDF5EC'
    );
    formBuilderStyleReviewGroups_(reviewSheet);

    formBuilderPrepareStructuredSheet_(
      spreadsheet,
      FORM_BUILDER_CONFIG.SYNC_LOG_SHEET_NAME,
      FORM_BUILDER_SYNC_LOG_HEADERS,
      '#DDF4F8'
    );

    formBuilderDeleteUnusedInitialSheets_(spreadsheet, responseSheet);

    const itemIds = {};
    Object.keys(items).forEach(function (key) {
      if (items[key] && typeof items[key].getId === 'function') {
        itemIds[key] = items[key].getId();
      }
    });

    const newPrefilledUrl = form
      .createResponse()
      .withItemResponse(
        items.request_type.createResponse('새로운 장소 제안')
      )
      .toPrefilledUrl();

    properties.setProperties({
      [FORM_BUILDER_CONFIG.PROPERTY_FORM_ID]: form.getId(),
      [FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID]: spreadsheet.getId(),
      [FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS]: 'READY',
      [FORM_BUILDER_CONFIG.PROPERTY_ITEM_IDS]: JSON.stringify(itemIds),
      [FORM_BUILDER_CONFIG.PROPERTY_NEW_PREFILLED_URL]: newPrefilledUrl,
      FORM_RESPONSES_SHEET_NAME:
        FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME,
      REVIEW_QUEUE_SHEET_NAME: FORM_BUILDER_CONFIG.REVIEW_QUEUE_SHEET_NAME,
    });

    formBuilderLogLinks_(form, spreadsheet, properties);
  } catch (error) {
    properties.setProperties({
      [FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS]: 'ERROR',
      JEJU_IRANG_FORM_BUILD_ERROR: formBuilderTruncate_(
        error && error.message ? error.message : String(error),
        1000
      ),
    });

    if (form) {
      properties.setProperty(
        FORM_BUILDER_CONFIG.PROPERTY_FORM_ID,
        form.getId()
      );
    }
    if (spreadsheet) {
      properties.setProperty(
        FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID,
        spreadsheet.getId()
      );
    }
    throw error;
  }
}

function formBuilderConfigureForm_(form) {
  form
    .setDescription(FORM_BUILDER_CONFIG.FORM_DESCRIPTION)
    .setConfirmationMessage(FORM_BUILDER_CONFIG.CONFIRMATION_MESSAGE)
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setAllowResponseEdits(false)
    .setProgressBar(true)
    .setPublishingSummary(false)
    .setShowLinkToRespondAgain(true)
    .setShuffleQuestions(false)
    .setAcceptingResponses(true);
}

function formBuilderAddItems_(form) {
  const items = {};

  items.request_type = form
    .addMultipleChoiceItem()
    .setTitle('요청 유형')
    .setHelpText('새 장소 제안과 기존 장소 수정 중 하나를 선택해 주세요.')
    .setRequired(true);

  const newSection = form
    .addPageBreakItem()
    .setTitle('새로운 장소 제안')
    .setHelpText(
      '아직 제주아이랑에 없는 장소를 제안해 주세요. 장소명을 공식 상호명으로 작성하고, 가능하면 위치 단서도 함께 남겨 주세요.'
    );

  const updateSection = form
    .addPageBreakItem()
    .setTitle('수정할 장소 확인')
    .setHelpText(
      '기존 장소 상세 페이지에서 연결된 사전 입력 링크를 사용하는 것을 권장합니다.'
    );

  items.target_place_name = form
    .addTextItem()
    .setTitle('기존 장소명')
    .setHelpText(
      '현재 제주아이랑에 표시된 장소명을 정확히 입력해 주세요.'
    )
    .setRequired(true)
    .setValidation(
      formBuilderTextLengthValidation_(
        2,
        100,
        '장소명을 2~100자로 입력해 주세요.'
      )
    );

  items.changed_fields = form
    .addCheckboxItem()
    .setTitle('수정할 항목')
    .setHelpText('실제로 변경이 필요한 항목을 모두 선택해 주세요.')
    .setChoiceValues([
      '장소명',
      '공간',
      '시설유형',
      '입장료',
      '연령제한',
      '수유실',
      '유모차 대여',
      '주차',
      '위치',
      '전화번호',
      '홈페이지',
      '운영시간',
      '휴무일',
      '이용요금 상세',
      '연령제한 상세',
      '기저귀 교환대',
      '도민 할인',
      '예약 링크',
      '이미지',
      '한 줄 설명',
      '후기·참고사항',
    ])
    .setRequired(true)
    .setValidation(
      FormApp.createCheckboxValidation()
        .setHelpText('수정할 항목을 하나 이상 선택해 주세요.')
        .requireSelectAtLeast(1)
        .build()
    );

  items.update_note = form
    .addParagraphTextItem()
    .setTitle('무엇을 수정해야 하나요?')
    .setHelpText('변경 전후의 차이를 알 수 있도록 설명해 주세요.')
    .setRequired(true)
    .setValidation(
      formBuilderParagraphLengthValidation_(
        10,
        500,
        '수정 내용을 10~500자로 입력해 주세요.'
      )
    );

  const commonSection = form
    .addPageBreakItem()
    .setTitle('장소 기본 정보')
    .setHelpText('장소의 현재 정보를 입력해 주세요.');

  items.place_name = form
    .addTextItem()
    .setTitle('장소명')
    .setHelpText('공식 상호명 또는 시설명을 입력해 주세요.')
    .setRequired(true)
    .setValidation(
      formBuilderTextLengthValidation_(
        2,
        100,
        '장소명을 2~100자로 입력해 주세요.'
      )
    );

  items.space_type = form
    .addMultipleChoiceItem()
    .setTitle('실내/실외')
    .setHelpText('모르면 선택하지 않거나 ‘잘 모르겠음’을 선택해 주세요.')
    .setChoiceValues(['실내', '실외', '실내/실외', '잘 모르겠음'])
    .setRequired(false);

  items.category = form
    .addMultipleChoiceItem()
    .setTitle('시설유형')
    .setHelpText('알맞은 유형이 없으면 ‘그 외’를 선택해 주세요. 관리자가 검수하여 분류합니다.')
    .setChoiceValues([
      '관광지',
      '영화/연극/공연',
      '전시/기념관',
      '그 외',
      '잘 모르겠음',
    ])
    .setRequired(false);

  items.has_admission_fee = form
    .addMultipleChoiceItem()
    .setTitle('입장료 여부')
    .setChoiceValues(['있음', '없음', '잘 모르겠음'])
    .setRequired(false);

  items.has_age_limit = form
    .addMultipleChoiceItem()
    .setTitle('연령제한 여부')
    .setChoiceValues(['있음', '없음', '잘 모르겠음'])
    .setRequired(false);

  items.nursing_room = form
    .addMultipleChoiceItem()
    .setTitle('수유실 여부')
    .setChoiceValues(['있음', '없음', '잘 모르겠음'])
    .setRequired(false);

  items.stroller_rental = form
    .addMultipleChoiceItem()
    .setTitle('유모차 대여 여부')
    .setChoiceValues(['가능', '불가', '잘 모르겠음'])
    .setRequired(false);

  items.parking = form
    .addMultipleChoiceItem()
    .setTitle('주차 유형')
    .setChoiceValues([
      '무료 주차',
      '유료 주차',
      '무료·유료 주차 모두 있음',
      '주차 불가',
      '잘 모르겠음',
    ])
    .setRequired(false);

  const optionalSection = form
    .addPageBreakItem()
    .setTitle('추가 정보')
    .setHelpText('아는 정보만 입력해 주세요. 선택 질문은 비워도 됩니다.');

  items.location_hint = form
    .addParagraphTextItem()
    .setTitle('장소를 찾는 데 도움이 되는 정보')
    .setHelpText(
      '주소나 동네처럼 장소를 찾는 데 도움이 되는 내용을 입력해 주세요. 예: 제주시 애월읍'
    )
    .setRequired(false)
    .setValidation(
      formBuilderParagraphMaxLengthValidation_(
        500,
        '위치 단서를 500자 이하로 입력해 주세요.'
      )
    );

  items.phone = form
    .addTextItem()
    .setTitle('전화번호')
    .setHelpText('예: 064-000-0000')
    .setRequired(false)
    .setValidation(
      formBuilderTextPatternValidation_(
        '^[0-9+()\\-\\s]{7,20}$',
        '숫자, 공백, +, -, 괄호를 사용해 7~20자로 입력해 주세요.'
      )
    );

  items.website_url = formBuilderAddOptionalUrlItem_(
    form,
    '홈페이지 URL',
    '공식 홈페이지 주소를 입력해 주세요.'
  );

  items.opening_hours = form
    .addParagraphTextItem()
    .setTitle('운영시간')
    .setHelpText('요일별 시간이 다르면 줄을 나누어 입력해 주세요.')
    .setRequired(false)
    .setValidation(
      formBuilderParagraphMaxLengthValidation_(
        300,
        '운영시간을 300자 이하로 입력해 주세요.'
      )
    );

  items.closed_days = form
    .addTextItem()
    .setTitle('휴무일')
    .setHelpText('예: 매주 월요일')
    .setRequired(false)
    .setValidation(
      formBuilderTextMaxLengthValidation_(
        200,
        '휴무일을 200자 이하로 입력해 주세요.'
      )
    );

  items.admission_fee_detail = form
    .addParagraphTextItem()
    .setTitle('이용요금 상세')
    .setHelpText('입장료가 있으면 대상별 요금을 알려 주세요.')
    .setRequired(false)
    .setValidation(
      formBuilderParagraphMaxLengthValidation_(
        500,
        '이용요금 상세를 500자 이하로 입력해 주세요.'
      )
    );

  items.age_limit_detail = form
    .addParagraphTextItem()
    .setTitle('연령제한 상세')
    .setHelpText('예: 만 36개월 이상 이용 가능')
    .setRequired(false)
    .setValidation(
      formBuilderParagraphMaxLengthValidation_(
        500,
        '연령제한 상세를 500자 이하로 입력해 주세요.'
      )
    );

  items.diaper_changing_table = form
    .addMultipleChoiceItem()
    .setTitle('기저귀 교환대')
    .setChoiceValues(['있음', '없음', '잘 모르겠음'])
    .setRequired(false);

  items.resident_discount = form
    .addMultipleChoiceItem()
    .setTitle('도민 할인')
    .setChoiceValues(['있음', '없음', '잘 모르겠음'])
    .setRequired(false);

  items.reservation_url = formBuilderAddOptionalUrlItem_(
    form,
    '예약 URL',
    '온라인 예약 주소를 입력해 주세요.'
  );

  items.photo_url = formBuilderAddOptionalUrlItem_(
    form,
    '이미지 URL',
    '관리자가 열어볼 수 있는 공개 이미지 주소를 입력해 주세요.'
  );

  items.description = form
    .addTextItem()
    .setTitle('한 줄 설명')
    .setHelpText('장소의 특징을 한 문장으로 적어 주세요.')
    .setRequired(false)
    .setValidation(
      formBuilderTextMaxLengthValidation_(
        100,
        '한 줄 설명을 100자 이하로 입력해 주세요.'
      )
    );

  items.review_summary = form
    .addParagraphTextItem()
    .setTitle('후기 또는 참고사항')
    .setHelpText('아이와 방문할 때 도움이 되는 참고사항을 적어 주세요.')
    .setRequired(false)
    .setValidation(
      formBuilderParagraphMaxLengthValidation_(
        1000,
        '후기 또는 참고사항을 1,000자 이하로 입력해 주세요.'
      )
    );

  // 첫 질문에서 신규와 수정 섹션으로 분기합니다.
  items.request_type.setChoices([
    items.request_type.createChoice('새로운 장소 제안', newSection),
    items.request_type.createChoice('기존 장소 수정', updateSection),
  ]);

  // 신규 안내 섹션을 마치면 수정 섹션을 건너뛰고 공통 정보로 이동합니다.
  updateSection.setGoToPage(commonSection);

  items._new_section = newSection;
  items._update_section = updateSection;
  items._common_section = commonSection;
  items._optional_section = optionalSection;
  return items;
}

function formBuilderAddOptionalUrlItem_(form, title, helpText) {
  return form
    .addTextItem()
    .setTitle(title)
    .setHelpText(helpText)
    .setRequired(false)
    .setValidation(
      FormApp.createTextValidation()
        .setHelpText('http:// 또는 https://로 시작하는 URL을 입력해 주세요.')
        .requireTextIsUrl()
        .build()
    );
}

function formBuilderTextPatternValidation_(pattern, helpText) {
  return FormApp.createTextValidation()
    .setHelpText(helpText)
    .requireTextMatchesPattern(pattern)
    .build();
}

function formBuilderTextLengthValidation_(minLength, maxLength, helpText) {
  return FormApp.createTextValidation()
    .setHelpText(helpText)
    .requireTextMatchesPattern(
      '^[\\s\\S]{' + minLength + ',' + maxLength + '}$'
    )
    .build();
}

function formBuilderTextMaxLengthValidation_(maxLength, helpText) {
  return FormApp.createTextValidation()
    .setHelpText(helpText)
    .requireTextLengthLessThanOrEqualTo(maxLength)
    .build();
}

function formBuilderParagraphLengthValidation_(
  minLength,
  maxLength,
  helpText
) {
  return FormApp.createParagraphTextValidation()
    .setHelpText(helpText)
    .requireTextMatchesPattern(
      '^[\\s\\S]{' + minLength + ',' + maxLength + '}$'
    )
    .build();
}

function formBuilderParagraphMaxLengthValidation_(maxLength, helpText) {
  return FormApp.createParagraphTextValidation()
    .setHelpText(helpText)
    .requireTextLengthLessThanOrEqualTo(maxLength)
    .build();
}

function formBuilderWaitForResponseSheet_(spreadsheet, initialSheetIds, form) {
  const initialSet = {};
  initialSheetIds.forEach(function (sheetId) {
    initialSet[sheetId] = true;
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < FORM_BUILDER_CONFIG.RESPONSE_SHEET_WAIT_MS) {
    SpreadsheetApp.flush();
    const refreshed = SpreadsheetApp.openById(spreadsheet.getId());
    const responseSheet = formBuilderFindResponseSheet_(
      refreshed,
      initialSet,
      form
    );
    if (responseSheet) {
      return responseSheet;
    }
    Utilities.sleep(1000);
  }

  throw new Error(
    'Form 응답 시트를 찾지 못했습니다. Form의 응답 대상 Spreadsheet가 올바른지 확인해 주세요.'
  );
}

function formBuilderFindResponseSheet_(spreadsheet, initialSet, form) {
  const hasInitialSheetIds = Object.keys(initialSet).length > 0;
  const named = spreadsheet.getSheetByName(
    FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME
  );
  if (named) {
    return named;
  }

  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    try {
      if (sheet.getFormUrl()) {
        return sheet;
      }
    } catch (error) {
      // 일부 환경에서 getFormUrl을 사용할 수 없으면 다음 판별법을 사용합니다.
    }

    if (sheet.getLastColumn() > 0) {
      const headers = sheet
        .getRange(1, 1, 1, sheet.getLastColumn())
        .getDisplayValues()[0];
      if (
        headers.indexOf('요청 유형') >= 0 &&
        (headers.indexOf('타임스탬프') >= 0 ||
          headers.indexOf('Timestamp') >= 0)
      ) {
        return sheet;
      }
    }

    if (hasInitialSheetIds && !initialSet[sheet.getSheetId()]) {
      return sheet;
    }
  }

  if (
    form &&
    form.getDestinationType() === FormApp.DestinationType.SPREADSHEET &&
    form.getDestinationId() !== spreadsheet.getId()
  ) {
    throw new Error('Form이 다른 Spreadsheet에 연결되어 있습니다.');
  }
  return null;
}

function formBuilderPrepareStructuredSheet_(
  spreadsheet,
  sheetName,
  headers,
  headerColor
) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  formBuilderEnsureColumnCapacity_(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground(headerColor)
    .setFontColor('#49382F')
    .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);
  return sheet;
}

function formBuilderStyleReviewGroups_(sheet) {
  // A:R 관리, S:AA 원본, AB:AU 제안, AV:BO 승인, BP:BZ 자동 컬럼
  sheet.getRange('A1:R1').setBackground('#FFF1C7');
  sheet.getRange('S1:AA1').setBackground('#F3F4F6');
  sheet.getRange('AB1:AU1').setBackground('#F3F4F6');
  sheet.getRange('AV1:BO1').setBackground('#FFE2B8');
  sheet.getRange('BP1:BZ1').setBackground('#DDF4F8');
  sheet.setColumnWidths(1, 78, 130);
  sheet.setColumnWidth(6, 260);
  sheet.setColumnWidth(18, 280);
  sheet.setColumnWidth(23, 280);
  sheet.setColumnWidth(78, 520);
}

function formBuilderEnsureColumnCapacity_(sheet, requiredColumns) {
  const current = sheet.getMaxColumns();
  if (current < requiredColumns) {
    sheet.insertColumnsAfter(current, requiredColumns - current);
  }
}

function formBuilderDeleteUnusedInitialSheets_(spreadsheet, responseSheet) {
  const protectedNames = {};
  protectedNames[FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME] = true;
  protectedNames[FORM_BUILDER_CONFIG.REVIEW_QUEUE_SHEET_NAME] = true;
  protectedNames[FORM_BUILDER_CONFIG.SYNC_LOG_SHEET_NAME] = true;

  spreadsheet.getSheets().forEach(function (sheet) {
    if (
      sheet.getSheetId() !== responseSheet.getSheetId() &&
      !protectedNames[sheet.getName()] &&
      sheet.getLastRow() === 0 &&
      spreadsheet.getSheets().length > 3
    ) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

function formBuilderGetExistingResources_(properties) {
  if (
    properties.getProperty(FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS) !==
    'READY'
  ) {
    return null;
  }

  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  const spreadsheetId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID
  );
  if (!formId || !spreadsheetId) {
    return null;
  }

  try {
    return {
      form: FormApp.openById(formId),
      spreadsheet: SpreadsheetApp.openById(spreadsheetId),
    };
  } catch (error) {
    return null;
  }
}

function formBuilderGetRecoverableResources_(properties) {
  const status = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS
  );
  if (status !== 'ERROR' && status !== 'BUILDING') {
    return null;
  }

  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  const spreadsheetId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID
  );
  if (!formId || !spreadsheetId) {
    return null;
  }

  try {
    return {
      form: FormApp.openById(formId),
      spreadsheet: SpreadsheetApp.openById(spreadsheetId),
    };
  } catch (error) {
    return null;
  }
}

function formBuilderResumeExistingBuild_(form, spreadsheet, properties) {
  properties.setProperty(
    FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS,
    'BUILDING'
  );

  try {
    if (
      form.getDestinationType() !== FormApp.DestinationType.SPREADSHEET ||
      form.getDestinationId() !== spreadsheet.getId()
    ) {
      form.setDestination(
        FormApp.DestinationType.SPREADSHEET,
        spreadsheet.getId()
      );
    }

    const responseSheet = formBuilderWaitForResponseSheet_(
      spreadsheet,
      [],
      form
    );
    if (
      responseSheet.getName() !==
      FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME
    ) {
      responseSheet.setName(FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME);
    }
    responseSheet.setFrozenRows(1);

    const reviewSheet = formBuilderPrepareStructuredSheet_(
      spreadsheet,
      FORM_BUILDER_CONFIG.REVIEW_QUEUE_SHEET_NAME,
      FORM_BUILDER_REVIEW_HEADERS,
      '#DDF5EC'
    );
    formBuilderStyleReviewGroups_(reviewSheet);
    formBuilderPrepareStructuredSheet_(
      spreadsheet,
      FORM_BUILDER_CONFIG.SYNC_LOG_SHEET_NAME,
      FORM_BUILDER_SYNC_LOG_HEADERS,
      '#DDF4F8'
    );
    formBuilderDeleteUnusedInitialSheets_(spreadsheet, responseSheet);

    const items = formBuilderCollectQuestionItems_(form);
    if (!items.request_type) {
      throw new Error('기존 Form에서 요청 유형 질문을 찾지 못했습니다.');
    }

    const itemIds = {};
    Object.keys(items).forEach(function (key) {
      itemIds[key] = items[key].getId();
    });
    const requestTypeItem = items.request_type.asMultipleChoiceItem();
    const newPrefilledUrl = form
      .createResponse()
      .withItemResponse(
        requestTypeItem.createResponse('새로운 장소 제안')
      )
      .toPrefilledUrl();

    properties.setProperties({
      [FORM_BUILDER_CONFIG.PROPERTY_FORM_ID]: form.getId(),
      [FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID]: spreadsheet.getId(),
      [FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS]: 'READY',
      [FORM_BUILDER_CONFIG.PROPERTY_ITEM_IDS]: JSON.stringify(itemIds),
      [FORM_BUILDER_CONFIG.PROPERTY_NEW_PREFILLED_URL]: newPrefilledUrl,
      FORM_RESPONSES_SHEET_NAME:
        FORM_BUILDER_CONFIG.FORM_RESPONSES_SHEET_NAME,
      REVIEW_QUEUE_SHEET_NAME: FORM_BUILDER_CONFIG.REVIEW_QUEUE_SHEET_NAME,
    });
    properties.deleteProperty('JEJU_IRANG_FORM_BUILD_ERROR');
    formBuilderLogLinks_(form, spreadsheet, properties);
  } catch (error) {
    properties.setProperties({
      [FORM_BUILDER_CONFIG.PROPERTY_BUILD_STATUS]: 'ERROR',
      JEJU_IRANG_FORM_BUILD_ERROR: formBuilderTruncate_(
        error && error.message ? error.message : String(error),
        1000
      ),
    });
    throw error;
  }
}

function formBuilderCollectQuestionItems_(form) {
  const keyByTitle = {
    '요청 유형': 'request_type',
    '수정 대상 장소 ID': 'target_place_id',
    '기존 장소명': 'target_place_name',
    '수정할 항목': 'changed_fields',
    '무엇을 수정해야 하나요?': 'update_note',
    '장소명': 'place_name',
    '실내/실외': 'space_type',
    '시설유형': 'category',
    '입장료 여부': 'has_admission_fee',
    '연령제한 여부': 'has_age_limit',
    '수유실 여부': 'nursing_room',
    '유모차 대여 여부': 'stroller_rental',
    '주차 유형': 'parking',
    '장소를 찾는 데 도움이 되는 정보': 'location_hint',
    '전화번호': 'phone',
    '홈페이지 URL': 'website_url',
    '운영시간': 'opening_hours',
    '휴무일': 'closed_days',
    '이용요금 상세': 'admission_fee_detail',
    '연령제한 상세': 'age_limit_detail',
    '기저귀 교환대': 'diaper_changing_table',
    '도민 할인': 'resident_discount',
    '예약 URL': 'reservation_url',
    '이미지 URL': 'photo_url',
    '한 줄 설명': 'description',
    '후기 또는 참고사항': 'review_summary',
  };
  const items = {};
  form.getItems().forEach(function (item) {
    const key = keyByTitle[item.getTitle()];
    if (key) {
      items[key] = item;
    }
  });
  return items;
}

function formBuilderLogLinks_(form, spreadsheet, properties) {
  Logger.log('Google Form 생성 완료');
  Logger.log('Form 편집 URL: %s', form.getEditUrl());
  Logger.log('Form 응답 URL: %s', form.getPublishedUrl());
  Logger.log('응답 Spreadsheet: %s', spreadsheet.getUrl());
  Logger.log(
    '신규 장소 제안 사전 입력 URL: %s',
    properties.getProperty(
      FORM_BUILDER_CONFIG.PROPERTY_NEW_PREFILLED_URL
    ) || ''
  );
}

/**
 * 생성된 Form과 Spreadsheet 링크를 다시 출력합니다.
 */
function showJejuIrangFormLinks() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  const spreadsheetId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_SPREADSHEET_ID
  );
  if (!formId || !spreadsheetId) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  formBuilderLogLinks_(
    FormApp.openById(formId),
    SpreadsheetApp.openById(spreadsheetId),
    properties
  );
}

/**
 * 이미 생성된 Form에서 사용자가 알 수 없는 place_id 질문을 제거합니다.
 * 수정 대상은 중복되지 않는 기존 장소명으로 식별합니다.
 * 여러 번 실행해도 안전합니다.
 */
function applyPlaceNameOnlyUpdateForm() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  if (!formId) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  const form = FormApp.openById(formId);
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].getTitle() === '수정 대상 장소 ID') {
      form.deleteItem(items[i]);
    }
  }

  const questionItems = formBuilderCollectQuestionItems_(form);
  if (!questionItems.target_place_name) {
    throw new Error('기존 장소명 질문을 찾지 못했습니다.');
  }
  questionItems.target_place_name
    .asTextItem()
    .setHelpText('현재 제주아이랑에 표시된 장소명을 정확히 입력해 주세요.')
    .setRequired(true);

  const itemIds = {};
  Object.keys(questionItems).forEach(function (key) {
    itemIds[key] = questionItems[key].getId();
  });
  properties.setProperty(
    FORM_BUILDER_CONFIG.PROPERTY_ITEM_IDS,
    JSON.stringify(itemIds)
  );
  Logger.log('수정 대상 장소 ID 질문을 제거했습니다.');
  Logger.log('수정 대상은 기존 장소명으로 식별합니다.');
  Logger.log('Form 편집 URL: %s', form.getEditUrl());
}

/**
 * 이미 생성된 Form의 위치 단서 안내를 VWorld 검색 방식에 맞게 바꿉니다.
 */
function applyVworldFormSettings() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  if (!formId) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  const form = FormApp.openById(formId);
  const items = formBuilderCollectQuestionItems_(form);
  if (!items.location_hint) {
    throw new Error('장소를 찾는 데 도움이 되는 정보 질문을 찾지 못했습니다.');
  }
  items.location_hint
    .asParagraphTextItem()
    .setHelpText(
      '주소나 동네처럼 장소를 찾는 데 도움이 되는 내용을 입력해 주세요. 예: 제주시 애월읍'
    );
  Logger.log('Google Form의 위치 단서 안내를 VWorld 기준으로 변경했습니다.');
  Logger.log('Form 편집 URL: %s', form.getEditUrl());
}

/**
 * 이미 생성된 Form의 기본 정보 질문을 선택 항목으로 완화합니다.
 *
 * 사용자가 모르는 값은 응답하지 않거나 ‘잘 모르겠음’을 선택할 수 있습니다.
 * ‘잘 모르겠음’과 시설유형의 ‘그 외’는 review_queue의 proposed_* 값에서
 * 빈칸으로 남고, 관리자가 승인 전에 최종값을 확인합니다.
 * 여러 번 실행해도 안전합니다.
 */
function applyOptionalPlaceInformationSettings() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  if (!formId) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  const form = FormApp.openById(formId);
  const items = formBuilderCollectQuestionItems_(form);
  const settings = {
    space_type: {
      choices: ['실내', '실외', '실내/실외', '잘 모르겠음'],
      help: '모르면 선택하지 않거나 ‘잘 모르겠음’을 선택해 주세요.',
    },
    category: {
      choices: [
        '관광지',
        '영화/연극/공연',
        '전시/기념관',
        '그 외',
        '잘 모르겠음',
      ],
      help: '알맞은 유형이 없으면 ‘그 외’를 선택해 주세요. 관리자가 검수하여 분류합니다.',
    },
    has_admission_fee: {
      choices: ['있음', '없음', '잘 모르겠음'],
    },
    has_age_limit: {
      choices: ['있음', '없음', '잘 모르겠음'],
    },
    nursing_room: {
      choices: ['있음', '없음', '잘 모르겠음'],
    },
    stroller_rental: {
      choices: ['가능', '불가', '잘 모르겠음'],
    },
    parking: {
      choices: [
        '무료 주차',
        '유료 주차',
        '무료·유료 주차 모두 있음',
        '주차 불가',
        '잘 모르겠음',
      ],
    },
  };

  Object.keys(settings).forEach(function (key) {
    if (!items[key]) {
      throw new Error('Form 질문을 찾지 못했습니다: ' + key);
    }
    const item = items[key].asMultipleChoiceItem();
    item.setChoiceValues(settings[key].choices).setRequired(false);
    if (settings[key].help) {
      item.setHelpText(settings[key].help);
    }
  });

  Logger.log('기본 정보 질문을 선택 항목으로 변경했습니다.');
  Logger.log('모르는 값은 review_queue에 빈칸으로 기록됩니다.');
  Logger.log('Form 편집 URL: %s', form.getEditUrl());
}

/**
 * 기존 장소 수정용 사전 입력 URL을 생성합니다.
 * 향후 Streamlit 또는 별도 관리 스크립트에서 호출할 수 있는 보조 함수입니다.
 *
 * @param {Object} place 현재 장소 정보
 * @return {string} 사전 입력 URL
 */
function buildJejuIrangUpdatePrefilledUrl(place) {
  if (!place || !place.place_name) {
    throw new Error('place_name이 필요합니다.');
  }

  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  const itemIds = JSON.parse(
    properties.getProperty(FORM_BUILDER_CONFIG.PROPERTY_ITEM_IDS) || '{}'
  );
  if (!formId || !itemIds.request_type) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  const form = FormApp.openById(formId);
  const formResponse = form.createResponse();
  const values = formBuilderMapPlaceToPrefillValues_(place);

  Object.keys(values).forEach(function (key) {
    if (!itemIds[key] || values[key] === '' || values[key] === null) {
      return;
    }
    const item = form.getItemById(Number(itemIds[key]));
    if (!item) {
      return;
    }
    formResponse.withItemResponse(
      formBuilderCreateItemResponse_(item, values[key])
    );
  });

  return formResponse.toPrefilledUrl();
}

function formBuilderMapPlaceToPrefillValues_(place) {
  return {
    request_type: '기존 장소 수정',
    target_place_name: place.place_name,
    place_name: place.place_name,
    space_type: place.space_type || '',
    category: place.category || '',
    has_admission_fee: formBuilderBooleanChoice_(
      place.has_admission_fee,
      '있음',
      '없음'
    ),
    has_age_limit: formBuilderBooleanChoice_(
      place.has_age_limit,
      '있음',
      '없음'
    ),
    nursing_room: formBuilderBooleanChoice_(
      place.nursing_room,
      '있음',
      '없음'
    ),
    stroller_rental: formBuilderBooleanChoice_(
      place.stroller_rental,
      '가능',
      '불가'
    ),
    parking: formBuilderParkingChoice_(place.parking),
    phone: place.phone || '',
    website_url: place.website_url || '',
    opening_hours: place.opening_hours || '',
    closed_days: place.closed_days || '',
    admission_fee_detail: place.admission_fee_detail || '',
    age_limit_detail: place.age_limit_detail || '',
    diaper_changing_table: formBuilderOptionalBooleanChoice_(
      place.diaper_changing_table
    ),
    resident_discount: formBuilderOptionalBooleanChoice_(
      place.resident_discount
    ),
    reservation_url: place.reservation_url || '',
    photo_url: place.photo_url || '',
    description: place.description || '',
    review_summary: place.review_summary || '',
  };
}

function formBuilderCreateItemResponse_(item, value) {
  switch (item.getType()) {
    case FormApp.ItemType.TEXT:
      return item.asTextItem().createResponse(String(value));
    case FormApp.ItemType.PARAGRAPH_TEXT:
      return item.asParagraphTextItem().createResponse(String(value));
    case FormApp.ItemType.MULTIPLE_CHOICE:
      return item.asMultipleChoiceItem().createResponse(String(value));
    case FormApp.ItemType.CHECKBOX:
      return item
        .asCheckboxItem()
        .createResponse(Array.isArray(value) ? value : [String(value)]);
    default:
      throw new Error('사전 입력을 지원하지 않는 질문 유형입니다.');
  }
}

function formBuilderBooleanChoice_(value, trueLabel, falseLabel) {
  if (value === true || String(value).toUpperCase() === 'TRUE') {
    return trueLabel;
  }
  if (value === false || String(value).toUpperCase() === 'FALSE') {
    return falseLabel;
  }
  return '';
}

function formBuilderOptionalBooleanChoice_(value) {
  return formBuilderBooleanChoice_(value, '있음', '없음');
}

function formBuilderParkingChoice_(value) {
  const mapping = {
    '무료': '무료 주차',
    '유료': '유료 주차',
    '무료/유료 주차': '무료·유료 주차 모두 있음',
    '주차 불가': '주차 불가',
  };
  return mapping[String(value || '').trim()] || '';
}

/**
 * Script Properties의 테스트 값을 이용해 수정용 사전 입력 URL을 로그에 표시합니다.
 */
function showTestUpdatePrefilledUrl() {
  const properties = PropertiesService.getScriptProperties();
  const url = buildJejuIrangUpdatePrefilledUrl({
    place_name:
      properties.getProperty('TEST_TARGET_PLACE_NAME') || '아쿠아플라넷 제주',
    space_type: '실내',
    category: '관광지',
    has_admission_fee: true,
    has_age_limit: false,
    nursing_room: true,
    stroller_rental: true,
    parking: '무료',
  });
  Logger.log('수정용 사전 입력 URL: %s', url);
}

/**
 * Streamlit의 .streamlit/secrets.toml에 넣을 Google Form 설정을 출력합니다.
 * 질문을 다시 만들었을 때 entry 번호가 바뀌어도 이 함수를 다시 실행하면 됩니다.
 */
function showStreamlitFormSecrets() {
  const properties = PropertiesService.getScriptProperties();
  const formId = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_FORM_ID
  );
  if (!formId) {
    throw new Error('먼저 createJejuIrangForm을 실행해 주세요.');
  }

  const form = FormApp.openById(formId);
  const items = formBuilderCollectQuestionItems_(form);
  const requiredKeys = ['request_type', 'target_place_name', 'location_hint'];
  requiredKeys.forEach(function (key) {
    if (!items[key]) {
      throw new Error('Form 질문을 찾을 수 없습니다: ' + key);
    }
  });

  const sentinels = {
    request_type: '기존 장소 수정',
    target_place_name: '__JEJU_IRANG_PLACE__',
    location_hint: '__JEJU_IRANG_LOCATION__',
  };
  const response = form.createResponse();
  Object.keys(sentinels).forEach(function (key) {
    response.withItemResponse(
      formBuilderCreateItemResponse_(items[key], sentinels[key])
    );
  });
  const updateUrl = response.toPrefilledUrl();
  const newUrl = properties.getProperty(
    FORM_BUILDER_CONFIG.PROPERTY_NEW_PREFILLED_URL
  );
  const requestEntry = formBuilderFindPrefillEntry_(
    updateUrl,
    sentinels.request_type
  );
  const placeEntry = formBuilderFindPrefillEntry_(
    updateUrl,
    sentinels.target_place_name
  );
  const locationEntry = formBuilderFindPrefillEntry_(
    updateUrl,
    sentinels.location_hint
  );
  if (!newUrl || !requestEntry || !placeEntry || !locationEntry) {
    throw new Error('Streamlit용 사전 입력 설정을 만들지 못했습니다.');
  }

  const baseUrl = updateUrl.split('?')[0];
  const lines = [
    '[google_form]',
    'new_place_url = "' + formBuilderEscapeToml_(newUrl) + '"',
    'update_base_url = "' + formBuilderEscapeToml_(baseUrl) + '"',
    'request_type_entry = "' + requestEntry + '"',
    'target_place_name_entry = "' + placeEntry + '"',
    'location_hint_entry = "' + locationEntry + '"',
    'update_request_value = "기존 장소 수정"',
  ];
  Logger.log('Streamlit Secrets:\n%s', lines.join('\n'));
}

function formBuilderFindPrefillEntry_(url, expectedValue) {
  const query = String(url || '').split('?')[1] || '';
  const pairs = query.split('&');
  for (let i = 0; i < pairs.length; i += 1) {
    const parts = pairs[i].split('=');
    const key = decodeURIComponent(parts[0] || '');
    const value = decodeURIComponent((parts.slice(1).join('=') || '').replace(/\+/g, ' '));
    if (key.indexOf('entry.') === 0 && value === expectedValue) {
      return key;
    }
  }
  return '';
}

function formBuilderEscapeToml_(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formBuilderTruncate_(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}
