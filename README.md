# Claude Mochi

일본어 학습을 위한 Electron 앱. 이미지에서 일본어 단어를 추출하여 Mochi 플래시카드를 만들고, 퀴즈로 복습할 수 있습니다.

<img width="1012" height="812" alt="image" src="https://github.com/user-attachments/assets/cba3b374-81a2-4f68-a581-f6544b1db7cc" />

## 기능

### Cards 탭
이미지에서 일본어 단어를 추출하여 Mochi 덱을 생성합니다.

1. 이미지 선택
2. PaddleOCR Token 입력
3. Parse 버튼으로 단어 추출 (PaddleOCR + Claude)
4. 추출된 단어 확인/삭제
5. Mochi API Key 입력
6. Create Deck으로 덱 생성

### Quiz 탭
Mochi 덱에서 카드를 가져와 텍스트 퀴즈를 생성합니다.

1. Deck ID 입력
2. Fetch Cards로 카드 로드
3. 퀴즈 유형 선택 (요미가나, 뜻, 한자)
4. Generate Quiz로 퀴즈 텍스트 생성
5. Copy로 클립보드에 복사

### Infinite 탭
6지선다 무한 퀴즈 모드입니다.

1. Deck ID 입력
2. Fetch Cards로 카드 로드 (최소 6개 필요)
3. 퀴즈 유형 선택
4. Start로 퀴즈 시작
5. 6개 보기 중 정답 선택
6. 정답/오답 피드백 후 자동으로 다음 문제

## 설정

### PaddleOCR Token
- [PaddleOCR](https://www.paddlepaddle.org.cn/) API 토큰

### Mochi API Key
- [Mochi Cards](https://mochi.cards/) API 키
- Settings > API 에서 발급

## 개발

```bash
# 설치
npm install

# 개발 모드
npm run dev

# 빌드
npm run build
```

## 참고
- https://mochi.cards/docs/markdown/advanced-formatting/
- https://mochi.cards/docs/api/
