// 번역 설정 판의 화면 등록. 화면 파일이 불릴 때 registerScreen 을 부르고, 틀(open.js)이 screenOf 로 찾아 그린다.
//
// registerScreen(id, { title, icon, summary, render, face? })
//   title: string | (args) => string   화면 이름(PC 오른쪽 칸 맨 위, 휴대폰 머리의 '뒤로' 옆)
//   icon: Font Awesome 이름('book-open')
//   summary?(): string                  첫 화면 줄에 보일 값 글
//   render(box, api) → 정리 함수 | { refresh?(), close?() } | 없음
//     box: 내용을 그릴 자리. 휴대폰은 판의 몸통(또는 그 줄 아래 펼친 자리), PC 는 오른쪽 칸(.rcol 안, 제목 .rt 는 틀이 그린다)
//     api: { context, layers, memory, close(), open(id, args), refresh(), where(box, value, onPick, options?), args, wide, tools, notice(text, kind?) }
//       context()/context.x   SillyTavern.getContext() (부르거나 칸을 바로 읽거나)
//       layers                쓰는 곳 셋(store/layers.js). 저장은 이것으로만
//       refresh()             값을 고친 뒤 부른다: 열린 화면과 첫 화면 줄의 값을 다시 그린다(자기 화면도 refresh 가 불린다)
//       open(id, args)        다른 화면 열기(사람: open('person', 사람 id))   close(): 판 닫기
//       where(...)            쓰는 곳 고르기를 그린다(motion.js wherePick)
//       args                  open 에 넘긴 값   wide: PC 오른쪽 칸에 그려지는가   tools: app.js 가 넘긴 것(status · batch · redo · clearAll · onView)
//   face?(person) → 그림 주소 | ''     'person' 화면만: 첫 화면 사람 줄의 그림
// 화면 id: connection(연결) · prompts(번역 프롬프트) · view(보기) · rules(내 규칙) · more(그 밖의 설정) · terms(용어집) · fill(채우기) · person(사람) · status(상태창 번역)

const screens = new Map();

export function registerScreen(id, def) {
    screens.set(String(id), { id: String(id), ...def });
}

export const screenOf = id => screens.get(String(id)) ?? null;

/** 화면 이름(함수면 args 로 만든다) */
export const titleOf = (id, args) => { const s = screenOf(id); return typeof s?.title === 'function' ? s.title(args) : s?.title ?? ''; };
