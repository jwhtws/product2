# mukdang 관리자 구조

- 이 저장소는 관리자 화면과 관리자 전용 API만 소유한다.
- 회원·리뷰·프로필·저장·활동 데이터는 product1과 같은 `mukdang-db` D1을 읽는다.
- 스키마와 마이그레이션의 기준 저장소는 product1이다.
- 관리자 암호와 세션 키는 Cloudflare Secrets에만 둔다.
- 새 관리 기능은 `functions/api/admin/[[path]].js`의 API와 `admin.js`의 화면을 함께 추가한다.
- 배포 전 `npm run check`를 실행한다.
