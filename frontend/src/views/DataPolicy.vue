<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '../components/Icon.vue';

const route = useRoute();
const privacy = computed(() => route.path === '/privacy');
</script>

<template>
  <main class="policy-page">
    <header class="policy-hero">
      <RouterLink to="/" class="back-link">
        <Icon name="back" :size="17" />
        홈으로
      </RouterLink>
      <span class="eyebrow">
        <span class="red-dot" />
        BOOKHAEDO POLICY
      </span>
      <h1>{{ privacy ? '개인정보 안내' : '이용 안내' }}</h1>
      <p>
        {{
          privacy
            ? '서비스가 어떤 정보를 수집하고 어디에 사용하는지 알려드립니다.'
            : 'Book해도.를 안전하고 정확하게 이용하기 위한 기준을 안내합니다.'
        }}
      </p>
      <small>시행일 2026년 9월 9일 · 개인 학습용 프로젝트</small>
    </header>

    <div class="policy-layout">
      <nav aria-label="정책 문서 선택">
        <RouterLink to="/terms" :class="{ active: !privacy }">이용 안내</RouterLink>
        <RouterLink to="/privacy" :class="{ active: privacy }">개인정보 안내</RouterLink>
      </nav>

      <article v-if="!privacy" class="policy-document">
        <section>
          <span>01</span>
          <div>
            <h2>서비스의 목적</h2>
            <p>
              Book해도.는 홋카이도 지역의 장소를 탐색하고 날짜별 여행 일정을 작성할 수 있는 개인
              학습용 웹서비스입니다. 홋카이도 관광청이나 지방자치단체가 운영하는 공식 서비스가
              아닙니다.
            </p>
          </div>
        </section>
        <section>
          <span>02</span>
          <div>
            <h2>제공 기능</h2>
            <p>
              지역·키워드 장소 검색, 취향 및 날씨 조건에 따른 규칙 기반 추천, 지도 표시, 장소
              상세정보 조회, 일정 저장, 장소 순서 변경과 구간별 거리·예상 시간 계산 기능을
              제공합니다.
            </p>
          </div>
        </section>
        <section>
          <span>03</span>
          <div>
            <h2>계정과 일정 관리</h2>
            <p>
              회원은 정확한 정보를 사용해 계정을 만들고 자신의 로그인 정보를 안전하게 관리해야
              합니다. 여행 이름 수정과 여행 삭제는 나의 여행에서 할 수 있으며, 삭제한 여행과 그 안의
              날짜·장소·메모는 복구할 수 없습니다.
            </p>
          </div>
        </section>
        <section>
          <span>04</span>
          <div>
            <h2>정보의 정확성과 여행 안전</h2>
            <p>
              추천 결과, 운영시간, 날씨, 이동거리와 예상 시간은 계획을 돕는 참고 정보입니다.
              적설·교통 통제·임시 휴업·운행 시간표 변경을 실시간으로 모두 반영하지 못할 수 있으므로
              출발 전 장소의 공식 웹사이트와 교통기관 안내를 반드시 확인해야 합니다.
            </p>
          </div>
        </section>
        <section>
          <span>05</span>
          <div>
            <h2>외부 정보와 링크</h2>
            <p>
              지도·장소·경로·날씨 정보는 Google Maps Platform, OpenStreetMap, Valhalla, Open-Meteo
              등 외부 제공자의 데이터와 서비스를 사용합니다. 외부 웹사이트의 내용과 운영은 해당
              제공자의 책임이며 각 서비스의 이용조건이 함께 적용됩니다.
            </p>
            <div class="policy-links">
              <a href="https://www.google.com/help/terms_maps/" target="_blank" rel="noreferrer">
                Google Maps 이용약관
                <Icon name="external" :size="14" />
              </a>
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap 저작권
                <Icon name="external" :size="14" />
              </a>
              <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">
                Open-Meteo 이용조건
                <Icon name="external" :size="14" />
              </a>
            </div>
          </div>
        </section>
        <section>
          <span>06</span>
          <div>
            <h2>올바른 이용</h2>
            <p>
              다른 사람의 계정을 사용하거나 서비스의 정상 작동을 방해하는 행위, 허가 없이 데이터를
              대량 수집하는 행위, 외부 제공자의 이용조건이나 관계 법령을 위반하는 행위를 해서는 안
              됩니다. 필요한 경우 해당 계정의 이용이 제한될 수 있습니다.
            </p>
          </div>
        </section>
        <section>
          <span>07</span>
          <div>
            <h2>서비스 변경과 책임 범위</h2>
            <p>
              학습용 프로젝트 특성상 기능과 데이터는 예고 없이 변경되거나 일시 중단될 수 있습니다.
              서비스는 여행 예약·결제·안전 보장을 제공하지 않으며, 사용자는 실제 여행에 필요한 최신
              정보를 직접 확인하고 판단해야 합니다.
            </p>
          </div>
        </section>
      </article>

      <article v-else class="policy-document">
        <section>
          <span>01</span>
          <div>
            <h2>수집하는 정보</h2>
            <p>
              <strong>회원 정보:</strong>
              이메일, 표시 이름, 단방향 해시로 보호된 비밀번호를 저장합니다. 원문 비밀번호는
              저장하지 않습니다.
            </p>
            <p>
              <strong>서비스 이용 정보:</strong>
              사용자가 만든 여행 이름·날짜·이동수단, 일정에 담은 장소와 순서, 메모·예상 비용·비용
              설정, 체크리스트·지출 및 분담 내역·채팅을 저장합니다. 동행자 초대에는 대상 이메일,
              초대 상태, 수락 계정과 만료일을 저장하며 링크 토큰은 해시로 보관합니다. 관리자가 회원
              권한이나 상태를 변경하면 대상·변경자·변경 전후 상태와 시각을 감사 로그에 기록합니다.
            </p>
          </div>
        </section>
        <section>
          <span>02</span>
          <div>
            <h2>이용 목적</h2>
            <p>
              회원 인증, 여행 일정 저장과 복원, 초대 수락한 동행자와의 일정·메모·비용 공유 및 채팅,
              장소 간 경로 제공, 관리자에 의한 서비스 보호와 변경 이력 확인을 위해 정보를
              사용합니다. 광고 프로파일링이나 개인정보 판매에는 사용하지 않습니다.
            </p>
          </div>
        </section>
        <section>
          <span>03</span>
          <div>
            <h2>쿠키와 브라우저 저장소</h2>
            <p>
              로그인 상태 유지를 위해 최대 7일간 유효한 HttpOnly 세션 쿠키를 사용하며 로그아웃하거나
              계정이 이용정지되면 서버 세션을 삭제합니다. 마지막으로 선택한 여행 ID와 날짜는 빠른
              화면 복원을 위해 브라우저의 localStorage에 저장되며, 브라우저 데이터를 지우면 함께
              삭제됩니다. 여행별 추천 패널 표시 여부도 이 브라우저에 저장합니다.
            </p>
          </div>
        </section>
        <section>
          <span>04</span>
          <div>
            <h2>외부 서비스로 전달되는 정보</h2>
            <p>
              기능을 사용할 때 필요한 최소한의 검색어나 좌표가 외부 제공자에게 전달됩니다. 각
              제공자는 접속 IP, 기기·브라우저 정보 등을 자체 정책에 따라 처리할 수 있습니다.
            </p>
            <ul>
              <li>
                <strong>Google Maps:</strong>
                지도 화면과 마커를 표시할 때 지도 요청 정보
              </li>
              <li>
                <strong>Google Places:</strong>
                장소 확인을 위한 장소명과 주변 좌표
              </li>
              <li>
                <strong>Google Routes·Valhalla:</strong>
                경로 계산을 위한 출발·도착 좌표, 이동수단과 출발 시각
              </li>
              <li>
                <strong>Open-Meteo:</strong>
                날씨 조회를 위한 좌표와 날짜
              </li>
            </ul>
            <div class="policy-links">
              <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
                Google 개인정보처리방침
                <Icon name="external" :size="14" />
              </a>
              <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">
                Open-Meteo 이용조건
                <Icon name="external" :size="14" />
              </a>
            </div>
          </div>
        </section>
        <section>
          <span>05</span>
          <div>
            <h2>현재 위치</h2>
            <p>
              주변 장소 탐색을 선택하고 브라우저에서 권한을 허용한 경우에만 현재 위치를 사용합니다.
              위치는 해당 검색 요청 처리에만 사용하며 Book해도. 데이터베이스에 저장하지 않습니다.
            </p>
          </div>
        </section>
        <section>
          <span>06</span>
          <div>
            <h2>보관과 삭제</h2>
            <p>
              회원 정보와 여행 데이터는 서비스 데이터베이스에 보관됩니다. 소유자는 나의 여행에서
              여행을 삭제할 수 있습니다. 사용자명 옆 알림의 계정 관리에서 현재 비밀번호와 삭제
              범위를 확인한 뒤 회원 탈퇴할 수 있습니다. 탈퇴 시 계정·세션·소유 여행과 그 여행의
              일정·메모·예산· 초대·체크리스트·채팅·정산을 삭제합니다. 다른 사람이 소유한 여행에 남긴
              채팅은 작성자 연결을 해제하고, 정산은 금액과 참여 식별자를 남겨 동행자의 기록을
              유지합니다. 관리자 감사 로그는 별도 운영 기록이므로 계정 탈퇴로 자동 삭제되지
              않습니다.
            </p>
          </div>
        </section>
        <section>
          <span>07</span>
          <div>
            <h2>보호 조치</h2>
            <p>
              비밀번호 scrypt 해시, 세션 토큰 해시, HttpOnly·SameSite 쿠키, 입력값 검증, 요청 횟수
              제한, 여행 소유자·초대 수락 동행자 접근 검사와 관리자 권한 검사를 적용합니다. 다만
              인터넷을 통한 전송과 저장에 절대적인 보안을 보장할 수는 없습니다.
            </p>
          </div>
        </section>
        <aside class="policy-notice">
          <strong>공개 배포 전 확인</strong>
          <p>
            이 문서는 현재 구현을 설명하는 학습용 안내입니다. 실제 운영 시 운영자 정보, 개인정보
            보호 책임자와 연락처, 정확한 보유기간, 파기 절차, 국외 이전 여부 및 정보주체의 요청
            방법을 확정해야 합니다.
          </p>
        </aside>
      </article>
    </div>
  </main>
</template>

<style scoped>
.policy-page {
  min-height: calc(100svh - 86px);
  padding: 58px clamp(20px, 7vw, 110px) 110px;
  background: linear-gradient(150deg, #f1f4f9 0, #fff 42%, #f7f8fb 100%);
}
.policy-hero {
  max-width: 1060px;
  margin: auto;
  padding-bottom: 38px;
  border-bottom: 1px solid #dfe4ec;
}
.policy-hero .back-link {
  margin-bottom: 42px;
}
.policy-hero .eyebrow {
  margin-bottom: 17px;
}
.policy-hero h1 {
  font-size: clamp(42px, 6vw, 68px);
  font-weight: 600;
}
.policy-hero > p {
  margin-top: 16px;
  color: #68748a;
  font-size: 16px;
}
.policy-hero > small {
  display: block;
  margin-top: 15px;
  color: #9aa3b2;
  font-size: 11px;
}
.policy-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 65px;
  max-width: 1060px;
  margin: 42px auto 0;
}
.policy-layout > nav {
  position: sticky;
  top: 30px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.policy-layout > nav a {
  padding: 13px 16px;
  border-radius: 11px;
  color: #8a94a6;
  font-size: 13px;
}
.policy-layout > nav a.active {
  background: #303752;
  color: #fff;
}
.policy-document {
  background: #fff;
  border: 1px solid #e3e7ee;
  border-radius: 24px;
  padding: 8px 42px 38px;
  box-shadow: 0 18px 60px #35405b09;
}
.policy-document > section {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 20px;
  padding: 32px 0;
  border-bottom: 1px solid #edf0f4;
}
.policy-document > section > span {
  font: 600 10px 'DM Sans';
  color: #a3adbd;
  padding-top: 5px;
}
.policy-document h2 {
  font-size: 21px;
  margin-bottom: 13px;
}
.policy-document p,
.policy-document li {
  font-size: 14px;
  line-height: 1.85;
  color: #667186;
  word-break: keep-all;
}
.policy-document p + p {
  margin-top: 12px;
}
.policy-document ul {
  padding-left: 20px;
  margin: 17px 0;
}
.policy-document li + li {
  margin-top: 9px;
}
.policy-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.policy-links a {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #dfe4ec;
  border-radius: 10px;
  padding: 9px 12px;
  color: #53627f;
  font-size: 11px;
}
.policy-links a:hover {
  background: #f2f4f8;
}
.policy-notice {
  margin-top: 30px;
  padding: 20px 22px;
  border-radius: 14px;
  background: #fff4e2;
  color: #755a31;
}
.policy-notice strong {
  font-size: 13px;
}
.policy-notice p {
  color: #836d49;
  font-size: 12px;
  margin-top: 7px;
}
@media (max-width: 760px) {
  .policy-page {
    padding: 34px 18px 90px;
  }
  .policy-hero .back-link {
    margin-bottom: 30px;
  }
  .policy-hero h1 {
    font-size: 38px;
  }
  .policy-hero > p {
    font-size: 14px;
  }
  .policy-layout {
    display: block;
    margin-top: 24px;
  }
  .policy-layout > nav {
    position: static;
    flex-direction: row;
    background: #e9edf4;
    padding: 4px;
    border-radius: 12px;
    margin-bottom: 14px;
  }
  .policy-layout > nav a {
    flex: 1;
    text-align: center;
  }
  .policy-document {
    padding: 2px 19px 27px;
    border-radius: 18px;
  }
  .policy-document > section {
    grid-template-columns: 1fr;
    gap: 7px;
    padding: 26px 0;
  }
  .policy-document > section > span {
    padding: 0;
  }
  .policy-document h2 {
    font-size: 19px;
  }
  .policy-document p,
  .policy-document li {
    font-size: 13px;
    word-break: normal;
  }
  .policy-links {
    flex-direction: column;
  }
  .policy-links a {
    justify-content: space-between;
  }
}
</style>
