const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'csv_sync_export.gs');
const context = {
  console,
  Logger: { log() {} },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest(_algorithm, value) {
      return Array.from(crypto.createHash('sha256').update(value, 'utf8').digest());
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);

function run(expression) {
  return vm.runInContext(expression, context);
}

assert.strictEqual(
  run(`csvSyncNextPlaceId_([{place_id: 'P009'}, {place_id: 'P347'}])`),
  'P348'
);
assert.strictEqual(
  run(`csvSyncRegionGroup_('제주시', '애월읍')`),
  '애월/한림'
);
assert.doesNotThrow(() =>
  run(`csvSyncValidateUniqueMaster_([
    {place_id: 'P341', place_name: '휘닉스 제주 섭지코지'},
    {place_id: 'P342', place_name: '휘닉스제주섭지코지'}
  ])`)
);
assert.throws(
  () => run(`csvSyncValidateUniqueMaster_([
    {place_id: 'P341', place_name: '같은 장소'},
    {place_id: 'P342', place_name: '같은 장소'}
  ])`),
  /place_name/
);

run(`
  var testMaster = [{
    place_id: 'P001', place_name: '기존 장소', category: '관광지',
    city_name: '제주시', legal_dong_name: '애월읍', region_group: '애월/한림',
    road_address: '제주특별자치도 제주시 애월읍 애월로 1',
    latitude: '33.45', longitude: '126.31', phone: '064-111-1111',
    website_url: 'https://old.example', closed_days: '', opening_hours: '',
    parking: '무료', has_admission_fee: 'FALSE', admission_fee_detail: '',
    has_age_limit: 'FALSE', age_limit_detail: '', nursing_room: 'TRUE',
    stroller_rental: 'FALSE', space_type: '실외', reservation_url: '',
    resident_discount: '', diaper_changing_table: '', photo_url: '',
    description: '기존 설명', review_summary: ''
  }];
  var updateResult = csvSyncApplyApprovedRequest_({
    request_id: 'REQ-UPDATE-1', request_type: 'UPDATE',
    target_place_name: '기존 장소', apply_fields: 'phone,description',
    clear_fields: 'website_url', approved_phone: '064-222-2222',
    approved_description: ''
  }, testMaster);
`);
assert.strictEqual(run(`testMaster[0].phone`), '064-222-2222');
assert.strictEqual(run(`testMaster[0].description`), '기존 설명');
assert.strictEqual(run(`testMaster[0].website_url`), '');
assert.strictEqual(run(`updateResult.success`), true);

run(`
  var newResult = csvSyncApplyApprovedRequest_({
    request_id: 'REQ-NEW-1', request_type: 'NEW',
    approved_place_name: '새 장소', approved_category: '관광지',
    approved_space_type: '실내', approved_parking: '무료 주차',
    approved_has_admission_fee: '없음', approved_has_age_limit: '없음',
    approved_nursing_room: '있음', approved_stroller_rental: '없음',
    match_status: 'CONFIRMED', source_provider: 'VWORLD',
    source_place_id: 'VW-1',
    source_address: '제주특별자치도 서귀포시 성산읍 성산리 1',
    source_road_address: '제주특별자치도 서귀포시 성산읍 해맞이해안로 1',
    source_latitude: '33.45', source_longitude: '126.93'
  }, testMaster);
`);
assert.strictEqual(run(`newResult.syncedPlaceId`), 'P002');
assert.strictEqual(run(`testMaster[1].region_group`), '성산/표선');
assert.strictEqual(run(`testMaster[1].parking`), '무료');

assert.match(
  run(`csvSyncBuildOneClickSummary_({
    approved_category: '전시/기념관', approved_space_type: '실내',
    approved_parking: '무료', approved_has_admission_fee: 'FALSE',
    approved_has_age_limit: 'FALSE', approved_nursing_room: 'TRUE',
    approved_stroller_rental: 'FALSE'
  }, 'NEW', [])`),
  /시설유형: 전시\/기념관/
);
assert.match(
  run(`csvSyncBuildOneClickSummary_({
    approved_phone: '064-123-4567', approved_description: '새 설명'
  }, 'UPDATE', ['phone', 'description'])`),
  /전화번호: 064-123-4567/
);

assert.throws(
  () => run(`csvSyncApplyApprovedRequest_({
    request_id: 'REQ-BAD-1', request_type: 'UPDATE',
    target_place_name: '기존장소', apply_fields: 'phone',
    approved_phone: '064-333-3333'
  }, testMaster)`),
  /정확히 일치/
);

console.log('csv_sync_export tests passed');
