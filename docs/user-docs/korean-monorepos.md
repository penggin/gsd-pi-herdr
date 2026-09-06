# 한국어 입력과 모노레포에서 GSD 사용하기

GSD의 역할별 모델 배정, 검증과 작업 상태 관리는 그대로 사용합니다. 한국어
지원 때문에 새 모델 라우터나 별도 실행기를 켤 필요는 없습니다.

## 응답 언어를 명시하려면

기존 프로젝트 `.gsd/PREFERENCES.md`의 YAML frontmatter에 필요한 필드만
추가합니다. 아래 예제로 파일 전체를 교체하지 말고, 기존 `models`, fallback,
Herdr 및 Git 설정을 유지하세요.

```yaml
language: Korean
```

`language`는 질문·설명·요약의 응답 언어를 지정합니다. 명령어, 파일 경로,
코드 식별자나 검증 결과의 machine-readable 값을 번역하는 설정은 아닙니다.
새 세션/auto 작업 프롬프트에도 기존 언어 지시 경로가 적용됩니다.

## 조회와 실행을 구분하기

`/gsd do`는 제한된 자연어 단축 문법입니다. 일반 대화 전체를 이해하는 분류기가
아니며, 애매하거나 부정된 요청은 실행하지 않고 명시적 명령을 안내합니다.

| 입력 | 동작 |
| --- | --- |
| `/gsd do 현재 상태가 어때?` | 상태 조회 |
| `/gsd do merge 하지 말고 상태만 알려줘` | 상태 조회, ship 실행 안 함 |
| `/gsd do what happens if we merge?` | 실행하지 않고 명령 안내 |
| `/gsd do 메모해 다음에 결제 검증 추가` | 메모 저장 |
| `/gsd do 로그인 오류를 수정해줘` | 명확한 quick 작업 |
| `/gsd do merge.md 파일을 수정해줘` | 파일 수정 quick 작업, ship 아님 |

실행을 원하는데 단축 문법이 인식하지 못하면 `/gsd quick <작업>`처럼 직접
명령을 사용합니다. `/gsd auto`, `/gsd ship` 등 직접 명령의 기존 의미와
승인·검증 절차는 바뀌지 않습니다. 음성 재생이나 TTS 같은 수동 UAT 성공은
질문 문구에서 추측하지 말고 실제 사용자 관찰로 확인해야 합니다.

한국어만 있는 quick/debug 제목도 사용할 수 있습니다. 원문은 보존되며,
안전한 ASCII 파일·브랜치 식별자가 따로 생성됩니다. 같은 한글의 완성형과
분해형 표현은 동일하게 정규화됩니다. 기존 세션 이름이나 경로는 자동
변환하지 않습니다.

## 필요한 방법론만 선택하기

Structured skill 규칙은 한국어·영어를 명시적으로 함께 지정할 수 있습니다.
아래는 이미 설치된 skill에 대한 선택형 예시이며 새 skill을 설치하지 않습니다.

```yaml
skill_discovery: suggest
skill_rules:
  - match:
      any:
        - token: regression
        - token: 회귀
        - phrase: 간헐적 오류
      none:
        - unitType: documentation
    use: [systematic-debugging]
```

`token`은 정확한 단어 매칭입니다. `결제`는 `결제처리`나 `결제가`를 자동으로
매칭하지 않습니다. 어간 분석이나 번역은 하지 않으므로 필요한 단어·구문을
명시합니다. `none`도 같은 기준으로 제외합니다. 기존 `when`은 호환성을 위해
느슨한 ASCII 매칭을 유지하므로 한국어 조건에는 structured `match`를 쓰세요.
설정은 자동 마이그레이션되지 않습니다. [Skill 설정](skills.md)을 참고하세요.

## 모노레포 검증 범위를 좁게 유지하기

프로젝트의 root/workspace `AGENTS.md`, 패키지 script와 개발 가이드를 먼저
확인합니다. 패키지 매니저와 실제 테스트 실행기는 다를 수 있습니다. 예를 들어
pnpm workspace의 `test` script가 Bun을 실행할 수 있으므로 script를 우회해
다른 테스트 실행기로 바꾸지 않습니다.

하위 패키지에 자체 lockfile이나 `packageManager`가 없으면, GSD는 가장 가까운
workspace 선언에 실제 포함된 경우에만 상위 패키지 매니저를 상속합니다.
제외된 경로나 별도 Git 저장소에는 상속하지 않습니다. 또한 하위 Rust/Go/Python
manifest를 발견한 것만으로 루트에서 실행할 명령을 만들지 않습니다.

Pengbot처럼 고정 pnpm wrapper를 사용하는 프로젝트에서는 해당 가이드를
따릅니다. 다음은 실제 대상 workspace에 맞춰 명시적으로 선택할 명령 예입니다.

```bash
rtk scripts/pnpm-pinned.sh --filter <workspace> test
rtk scripts/pnpm-pinned.sh --filter <workspace> typecheck
rtk scripts/pnpm-pinned.sh --filter <workspace> lint:biome
```

루트 aggregate test나 Docker·브라우저·전체 빌드를 모든 작은 작업마다 돌리는
설정은 피합니다. 작업별 Verify에 필요한 명령을 적고, 전체 검증은 해당
검증 경계에서 실행하세요. [검증 명령 설정](configuration.md#verification)은
자동 실행 범위를 결정하므로 프로젝트의 명시적 정책을 우선합니다.

선택 파일/제외 경로가 있는 커밋에서는 이전 snapshot을 별도 커밋으로 유지해
무관한 변경의 재스테이징을 피합니다. 이 수정만으로 프로젝트가 임시로 꺼 둔
자동 Git 기능을 다시 켜지는 않습니다. 운영자가 검증된 설치본을 채택한 뒤
기존 안전 설정의 해제 여부를 결정해야 합니다.
