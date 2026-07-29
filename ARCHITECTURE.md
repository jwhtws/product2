# mukdang 관리자 구조

- 이 저장소는 관리자 화면과 관리자 전용 API만 소유한다.
- 회원·리뷰·프로필·저장·활동 데이터는 product1과 같은 `mukdang-db` D1을 읽는다.
- 스키마와 마이그레이션의 기준 저장소는 product1이다.
- 관리자 암호와 세션 키는 Cloudflare Secrets에만 둔다.
- 새 관리 기능은 `functions/api/admin/[[path]].js`의 API와 `admin.js`의 화면을 함께 추가한다.
- 배포 전 `npm run check`를 실행한다.
- 대량 목록은 `functions/_lib/admin-query.js`의 커서 페이지네이션을 사용하며 한 요청에서 최대 100건만 반환한다.
- 식당 변경 이력의 상세 행은 날짜를 펼칠 때만 불러온다.
- 외부 GitHub·정적 데이터 요청은 Worker 인스턴스에서 60초간 캐시한다.
- 관리자 입력 ID와 검색 문자열은 공통 검증 함수를 통과시킨다.
- D1 인덱스 변경은 `migrations/`에 기록하고 스키마 기준 저장소인 product1에도 동기화한다.
