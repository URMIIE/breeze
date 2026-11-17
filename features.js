// 기능 목록. 기능 하나 = features/<id>.js 파일 하나. 켜진 기능만 불러온다.
// 각 파일은 start(api) 를 내보내고, 새로고침 없이 끌 수 있으면 stop() 도 내보낸다.
// hasOptions: 그 파일이 options(box, api) 를 내보냄 — 설정 창에서 ‘설정’을 눌러야 펼쳐진다.
// hasAction: 그 파일이 open() 을 내보냄 — 설정 창의 ▶ 로 바로 실행.
export const GROUPS = ['채팅', '메시지 버튼', '목록 · 설정 창', '꾸미기', '가볍게'];

export const FEATURES = [
    { id: 'swipe_duplicate', group: '채팅', name: '스와이프 복사', desc: '지금 메시지를 새 스와이프로 복사하는 기능. 메시지의 » 버튼이나 /dup 명령으로 사용' },
    { id: 'reading_resume', group: '채팅', name: '읽던 자리 기억', desc: '채팅을 다시 열면 마지막으로 읽던 문단으로 이동' },
    { id: 'preset_look_keep', hasOptions: true, group: '채팅', name: '메시지별 정규식 유지', desc: '프리셋이나 정규식을 바꿔도, 메시지는 만들 때 켜져 있던 정규식으로 표시(서버 플러그인 필요)' },
    { id: 'iframe_dark_fix', group: '채팅', name: '상태창 흰 바탕 제거', desc: '바탕을 투명하게 만든 상태창이 어두운 테마에서 흰 상자로 뜨는 문제 해결' },
    { id: 'message_pins', hasOptions: true, group: '메시지 버튼', name: '메시지 버튼 관리', desc: '안 쓰는 버튼은 숨기고 자주 쓰는 버튼은 메시지에 바로 표시' },
    { id: 'selection_menu', hasOptions: true, group: '메시지 버튼', name: '드래그 메뉴 합치기', desc: '글을 드래그할 때 여러 확장이 따로 띄우는 버튼을 버튼 하나로 합쳐서 표시' },
    { id: 'chat_list_preview', group: '목록 · 설정 창', name: '미리보기를 화면과 같게', desc: '미리보기에도 번역 · 정규식을 적용해 채팅 화면과 같은 글로 표시' },
    { id: 'extension_search', group: '목록 · 설정 창', name: '확장 관리 창 검색칸', desc: '‘확장 관리’ 창 상단에 검색칸 추가' },
    { id: 'toast_filter', hasOptions: true, group: '목록 · 설정 창', name: '알림 숨기기', desc: '고른 알림은 다음부터 표시 생략' },
    { id: 'wi_real_tokens', group: '목록 · 설정 창', name: '월드인포 토큰 수 정확하게', desc: '월드인포 항목마다 AI에게 실제로 보내는 토큰 수로 표시' },
    { id: 'theme_scripts', hasOptions: true, group: '꾸미기', name: '테마 스크립트 자동 켜기', desc: '테마마다 정해 둔 스크립트를 그 테마를 쓸 때만 실행' },
    { id: 'loading_screen', hasOptions: true, group: '꾸미기', name: '로딩 화면', desc: '실리태번을 열 때 뜨는 로딩 화면 모양 선택 · 내 CSS 적용' },
    { id: 'theme_fit', hasOptions: true, group: '꾸미기', name: '테마 맞추기 (시험판)', desc: '테마가 내 화면과 안 맞는 곳을 화면을 보면서 바로 고침. 지팡이 메뉴 › 테마 맞추기에서 시작. 테마 파일은 그대로' },
    { id: 'reasoning_tidy', hasOptions: true, group: '꾸미기', name: '추론 칸 꾸미기', desc: '추론 칸 모양 선택 · 내 CSS 적용' },
    { id: 'lazy_render', group: '가볍게', name: '보이는 메시지만 그리기', desc: '긴 채팅에서 스크롤하거나 답이 써질 때 덜 버벅임. 화면에서 먼 메시지는 가까이 올 때 그림' },
    { id: 'fast_recent_chats', group: '가볍게', name: '최근 채팅 바로 표시', desc: '켜자마자 홈 화면에 최근 채팅 목록이 보임. 지난번 목록을 먼저 띄우고 달라진 것만 고침' },
    { id: 'recent_chat_direct_open', group: '가볍게', name: '최근 채팅 바로 열기', desc: '홈 화면에서 고른 채팅이 더 빨리 열림. 다른 채팅을 먼저 열었다가 바꾸는 과정을 건너뜀' },
    { id: 'light_chat_manager', group: '가볍게', name: '보이는 채팅 파일만 그리기', desc: '채팅 파일이 많아도 관리 창이 덜 버벅임. 화면에 보이는 줄만 그림' },
    { id: 'light_worldinfo', group: '가볍게', name: '보이는 월드인포 항목만 그리기', desc: '항목이 많아도 스크롤할 때 덜 버벅임. 화면에 보이는 항목만 그림' },
    { id: 'lazy_avatars', group: '가볍게', name: '보이는 프로필 사진만 불러오기', desc: '캐릭터 · 페르소나 목록이 길어도 빨리 뜸. 화면에 보이는 사진부터 불러옴' },
    { id: 'done_sound', hasOptions: true, group: '채팅', name: '완료 알림음', desc: '메시지 생성이나 다른 확장의 일이 끝날 때 울리는 알림음' },
];
