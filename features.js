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
    { id: 'reasoning_tidy', hasOptions: true, group: '꾸미기', name: '추론 칸 꾸미기', desc: '추론 칸 모양 선택 · 내 CSS 적용' },
    { id: 'lazy_render', group: '가볍게', name: '보이는 메시지만 그리기', desc: '긴 채팅에서 화면 밖 메시지는 자리만 남겨 두고, 스크롤해서 다가오면 표시' },
    { id: 'fast_recent_chats', group: '가볍게', name: '최근 채팅 바로 표시', desc: '실리태번을 켜면 최근 채팅 목록을 기다림 없이 바로 띄우고, 달라진 게 있으면 곧바로 반영' },
    { id: 'recent_chat_direct_open', group: '가볍게', name: '최근 채팅 바로 열기', desc: '홈 화면 최근 채팅을 누르면 캐릭터의 마지막 채팅을 거치지 않고 그 채팅으로 바로 이동' },
    { id: 'light_chat_manager', group: '가볍게', name: '보이는 채팅 파일만 그리기', desc: '채팅 파일이 많을 때, 채팅 파일 관리 창은 화면에 보이는 줄만 먼저 그리고 나머지는 스크롤할 때 표시' },
    { id: 'light_worldinfo', group: '가볍게', name: '보이는 월드인포 항목만 그리기', desc: '화면 밖 항목은 스크롤해서 보일 때 표시' },
    { id: 'lazy_avatars', group: '가볍게', name: '보이는 프로필 사진만 불러오기', desc: '캐릭터 · 페르소나 목록에서 보이는 사진부터 먼저 불러오기' },
    { id: 'done_sound', hasOptions: true, group: '채팅', name: '완료 알림음', desc: '메시지 생성이나 다른 확장의 일이 끝날 때 울리는 알림음' },
];
