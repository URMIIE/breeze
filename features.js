// 기능 목록. 기능 하나 = features/<id>.js 파일 하나. 켜진 기능만 불러온다.
// 각 파일은 start(api) 를 내보내고, 새로고침 없이 끌 수 있으면 stop() 도 내보낸다.
// hasOptions: 그 파일이 options(box, api) 를 내보냄 — 설정 창에서 줄을 눌러 세부 설정으로.
// hasAction: 그 파일이 open() 을 내보냄 — 세부 설정 화면의 ▶ 로 바로 실행.
// group: 설정 창 위의 갈래, icon: Font Awesome(fa-solid) 이름, alias: 예전 이름(기능 찾기에서 옛 이름으로도 찾게)
// 설정 창 목록은 이 배열 순서대로 그림(묶음은 첫 기능 자리에)
export const GROUPS = [
    { name: '채팅', icon: 'comments' },
    { name: '알림', icon: 'bell' },
    { name: '창 정리', icon: 'table-columns' },
    { name: '꾸미기', icon: 'palette' },
    { name: '속도', icon: 'bolt' },
];

// 목록에 한 줄로 묶어 보이는 기능들(bundle 이 같은 것): 하나씩 고를 일이 적고 이름이 비슷해 헷갈렸음.
// 묶음 줄을 누르면 그 자리에서 펼쳐져 안의 기능을 하나씩 켜고 끔. 묶음 체크는 안의 것을 전부 같은 쪽으로
export const BUNDLES = {
    '답 정보 보기': { icon: 'circle-info', desc: '어떤 모델로 썼는지 답마다 보여 줘요' },
    '메시지 버튼 정리': { icon: 'hand-pointer', desc: '안 쓰는 버튼을 숨겨요', alias: '메시지 버튼' },
    '월드인포 정리': { icon: 'globe', desc: '폴더로 나누고 항목을 한 줄로 접어요' },
    '테마 손보기': { icon: 'brush', desc: '테마가 안 맞는 곳을 화면에서 바로 고쳐요' },
    '버벅임 줄이기': { icon: 'feather', desc: '긴 채팅과 긴 목록이 덜 끊겨요', alias: '긴 목록 버벅임 줄이기 가볍게' },
    '빨리 열기': { icon: 'forward-fast', desc: '실리태번과 채팅이 더 빨리 열려요', alias: '홈 화면 최근 채팅 빨리 띄우기' },
};

// 요술봉 앱 서랍의 화면 이름(이름을 바꿀 땐 여기 한 곳만)
export const WAND_WINDOW_NAME = '요술봉 앱 서랍';

export const FEATURES = [
    // 채팅
    { id: 'translator', added: '1.4.0', hasOptions: true, group: '채팅', icon: 'language', name: '번역', desc: '고른 모델로 답을 번역해서 보여 줘요' },
    { id: 'preset_stamp', added: '1.3.0', hasOptions: true, group: '채팅', bundle: '답 정보 보기', icon: 'stamp', name: '프리셋 스탬프', desc: '이름을 누르면 어떤 모델과 프리셋으로 썼는지 알려 줘요' },
    { id: 'stream_progress', added: '1.3.0', group: '채팅', bundle: '답 정보 보기', icon: 'pen-nib', name: '받는 중 표시', desc: '답이 써지는 동안 받은 글자 수가 보여요', alias: '답 받는 중 표시' },
    { id: 'worldinfo_fired', added: '1.2.0', group: '채팅', bundle: '답 정보 보기', icon: 'globe', name: '들어간 월드인포', desc: '그 답에 쓰인 월드인포를 볼 수 있어요', alias: '답에 들어간 월드인포 표시' },
    { id: 'message_pins', hasOptions: true, group: '채팅', bundle: '메시지 버튼 정리', icon: 'eye-slash', name: '버튼 숨기고 꺼내기', desc: '안 쓰는 버튼은 숨기고 자주 쓰는 버튼은 바로 보여요', alias: '메시지 버튼 관리' },
    { id: 'selection_menu', hasOptions: true, group: '채팅', bundle: '메시지 버튼 정리', icon: 'i-cursor', name: '글 고를 때 버튼 합치기', desc: '글을 고르면 뜨는 여러 버튼을 하나로 모아요', alias: '드래그 메뉴 합치기' },
    { id: 'preset_look_keep', hasOptions: true, group: '채팅', icon: 'thumbtack', name: '옛 답 모양 지키기', desc: '프리셋을 바꿔도 예전 답이 안 깨져요', alias: '메시지별 정규식 유지' },
    { id: 'reading_resume', group: '채팅', icon: 'bookmark', name: '읽던 곳에서 이어 보기', desc: '채팅을 다시 열면 읽던 곳으로 가요', alias: '읽던 자리 기억' },
    { id: 'swipe_duplicate', group: '채팅', icon: 'copy', name: '답 하나 더 만들기', desc: '메시지의 » 버튼을 누르면 지금 답이 옆 스와이프에 복사돼요', alias: '스와이프 복사' },
    { id: 'chat_memory', added: '1.3.0', hasOptions: true, group: '채팅', icon: 'clock-rotate-left', name: '이 채팅 기억', desc: '채팅마다 쓰던 프롬프트와 연결을 다시 열 때 그대로 맞춰요' },
    // 알림
    { id: 'done_sound', hasOptions: true, group: '알림', icon: 'volume-high', name: '완료 알림음', desc: '답이 다 써지면 소리로 알려 줘요', alias: '다 되면 소리 내기' },
    { id: 'toast_close', added: '1.2.2', hasOptions: true, group: '알림', icon: 'circle-xmark', name: '알림 바로 닫기', desc: '알림에 닫는 버튼이 생겨요', alias: '알림 닫기 버튼 알림 정리' },
    { id: 'toast_filter', hasOptions: true, group: '알림', icon: 'bell-slash', name: '안 볼 알림 숨기기', desc: '고른 알림은 다시 안 떠요', alias: '알림 숨기기 알림 정리' },
    // 창 정리
    { id: 'extension_panel', added: '1.2.2', hasOptions: true, group: '창 정리', icon: 'puzzle-piece', name: '확장 설정 찾기 쉽게', desc: '확장 이름을 목록으로 보고 하나씩 열어요', alias: '확장 창 정리' },
    { id: 'chat_file_list', added: '1.2.0', hasOptions: true, group: '창 정리', icon: 'folder-open', name: '채팅 목록 관리', desc: '열지 않고 내용을 보고, 여러 개를 한 번에 지워요', alias: '채팅 파일 창 정리' },
    { id: 'prompt_groups', added: '1.3.0', hasOptions: true, group: '창 정리', icon: 'layer-group', name: '프롬프트 그룹', desc: '프롬프트 토글을 접고 펼치는 그룹으로 묶어요' },
    { id: 'worldinfo_library', added: '1.2.0', group: '창 정리', bundle: '월드인포 정리', icon: 'folder-tree', name: '폴더와 한 줄 목록', desc: '월드인포를 폴더로 나누고 항목을 한 줄로 접어요', alias: '월드인포 창 정리' },
    { id: 'wi_real_tokens', group: '창 정리', bundle: '월드인포 정리', icon: 'calculator', name: '실제 토큰 수', desc: '항목마다 AI에게 실제로 가는 토큰 수가 보여요', alias: '월드인포 실제 토큰 수 표시' },
    { id: 'wand_window', added: '1.3.0', group: '창 정리', icon: 'table-cells', name: WAND_WINDOW_NAME, desc: '마법봉 메뉴를 아이콘이 놓인 창으로 띄워요. 옮기고 크기를 바꾸고 꾸밀 수 있어요', alias: '마법봉 창 요술봉 메뉴 앱 메뉴 아이폰' },
    { id: 'chat_list_preview', group: '창 정리', icon: 'eye', name: '미리보기도 번역으로', desc: '채팅 목록의 미리보기가 번역된 글로 보여요', alias: '채팅 미리보기에 번역 정규식 적용' },
    // 꾸미기
    { id: 'theme_scripts', hasOptions: true, group: '꾸미기', bundle: '테마 손보기', icon: 'code', name: '테마별 스크립트', desc: '테마마다 정해 둔 스크립트를 그 테마일 때만 돌려요' },
    { id: 'theme_fit', hasOptions: true, group: '꾸미기', bundle: '테마 손보기', icon: 'wand-magic-sparkles', name: '테마 맞추기 (시험판)', desc: '안 맞는 곳을 화면을 보면서 바로 고쳐요' },
    { id: 'loading_screen', hasOptions: true, group: '꾸미기', icon: 'hourglass-half', name: '로딩 화면', desc: '처음 뜨는 화면의 모양을 골라요', alias: '로딩 화면 꾸미기' },
    { id: 'reasoning_tidy', hasOptions: true, group: '꾸미기', icon: 'lightbulb', name: '추론 칸 모양', desc: 'AI가 생각한 내용이 담긴 칸의 모양을 골라요', alias: '추론 칸 꾸미기' },
    { id: 'iframe_dark_fix', group: '꾸미기', icon: 'moon', name: '상태창 흰 상자 없애기', desc: '어두운 테마에서 상태창이 하얗게 뜨지 않아요', alias: '상태창 흰 바탕 제거' },
    // 속도
    { id: 'offscreen_frame_pause', added: '1.2.2', group: '속도', bundle: '버벅임 줄이기', icon: 'pause', name: '화면 밖 상태창 멈추기', desc: '안 보이는 상태창의 움직임을 멈춰 가벼워져요', alias: '화면 밖 상태창 움직임 멈추기' },
    { id: 'lazy_render', group: '속도', bundle: '버벅임 줄이기', icon: 'align-left', name: '보이는 메시지만 그리기', desc: '긴 채팅에서 먼 메시지는 가까워질 때 그려요' },
    { id: 'light_chat_manager', group: '속도', bundle: '버벅임 줄이기', icon: 'list', name: '보이는 채팅 파일만 그리기', desc: '채팅 파일이 많아도 관리 창이 덜 끊겨요' },
    { id: 'light_worldinfo', group: '속도', bundle: '버벅임 줄이기', icon: 'globe', name: '보이는 월드인포 항목만 그리기', desc: '항목이 많아도 굴릴 때 덜 끊겨요' },
    { id: 'prompt_list_lazy', added: '1.2.2', group: '속도', bundle: '버벅임 줄이기', icon: 'list-check', name: '프롬프트 목록 나중에 그리기', desc: '목록 창을 열 때 그려서 채팅이 빨리 열려요' },
    { id: 'lazy_avatars', group: '속도', bundle: '버벅임 줄이기', icon: 'image', name: '보이는 프로필 사진만 불러오기', desc: '캐릭터 목록이 길어도 빨리 떠요' },
    { id: 'fast_recent_chats', group: '속도', bundle: '빨리 열기', icon: 'clock-rotate-left', name: '최근 채팅 바로 표시', desc: '홈 화면에 지난번 목록을 먼저 띄워요' },
    { id: 'recent_chat_direct_open', group: '속도', bundle: '빨리 열기', icon: 'arrow-up-right-from-square', name: '최근 채팅 바로 열기', desc: '홈 화면에서 고른 채팅이 바로 열려요' },
];

// 서버 플러그인이 하는 기능 중 목록에 줄로 보이는 것. server = 플러그인 쪽 기능 이름들(켜고 끄기는 이 묶음째)
// 서버 쪽은 기능마다 따로 켜고 쉬는 그대로이고, 묶는 건 화면에서만
export const SERVER_FEATURES = [
    { id: 'srv:tab_icon', server: ['tab_icon'], hasOptions: true, group: '꾸미기', icon: 'icons', name: '브라우저 탭 그림', desc: '탭에 보이는 작은 그림을 바꿔요', alias: '브라우저 탭 아이콘 바꾸기' },
    { id: 'srv:first_load', server: ['lazy_load', 'folder_cache', 'settings_once', 'no_local_compression'], group: '속도', bundle: '빨리 열기', icon: 'gauge-high', name: '실리태번을 처음 열 때 로딩 줄이기', desc: '화면을 열 때 받아 오는 양을 줄여요' },
    { id: 'srv:chat_open', server: ['light_chat_open', 'early_message_frames', 'near_message_frames', 'chat_cache'], group: '속도', bundle: '빨리 열기', icon: 'comment-dots', name: '채팅 빨리 열기', desc: '보이는 상태창부터 띄우고 먼 것은 나중에 그려요' },
];
