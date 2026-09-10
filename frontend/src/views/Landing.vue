<script setup lang="ts">
import Snowfall from '../components/Snowfall.vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { state } from '../store';
import Crystal from '../components/Crystal.vue';
import Island from '../components/Island.vue';
import Icon from '../components/Icon.vue';
const router = useRouter(),
  active = ref('sapporo'),
  city = ref<any>(null);
const selected = computed(() => state.regions.find((r) => r.id === active.value));
function explore(id = '') {
  router.push({
    path: '/explore',
    query: id
      ? { region: id, ...(city.value?.region === id ? { city: city.value.name } : {}) }
      : {},
  });
}
</script>
<template>
  <main class="landing">
    <section class="hero">
      <Snowfall />
      <div class="hero-copy">
        <h1>
          가고 싶은 곳을
          <br />
          <span>하나의 여행으로 .</span>
        </h1>
        <p>
          설렘을 발견하고, 하루를 연결하세요.
          <br />
          나만의 홋카이도는 여기서 시작됩니다.
        </p>
        <button class="button dark hero-cta" @click="explore()">
          나의 여행 그리기
          <Icon name="arrow" />
        </button>
        <div class="hero-footnote">
          <Crystal :size="20" />
          <span>12개의 지역, 무한한 나의 여정</span>
        </div>
      </div>
      <div class="hero-map">
        <Island :active="active" @select="active = $event" @city="city = $event" />
        <button class="floating-region" @click="explore(active)">
          <span class="mini-crystal"><Crystal /></span>
          <span>
            <small>지금, 마음이 향하는 곳</small>
            <strong>{{ city?.name || selected?.name || '삿포로' }}</strong>
            <span>{{ selected?.description || '도시의 온도, 눈의 고요함' }}</span>
          </span>
          <Icon name="arrow" />
        </button>
        <span class="map-instruction">지도 위 작은 점을 눌러보세요</span>
      </div>
      <div class="hero-bottom">
        <span>흩어진 장소들이, 하나의 여행이 되는 순간.</span>
        <span>SCROLL TO EXPLORE ↓</span>
      </div>
    </section>
    <section class="photo-story">
      <img src="/images/yotei.jpg" alt="홋카이도 니세코 히라후에서 바라본 눈 덮인 요테이산" />
      <div class="photo-scrim" />
      <div>
        <span class="eyebrow">A SCENE IN HOKKAIDO</span>
        <h2>
          다음 장면은,
          <br />
          아직 정해지지 않았으니까.
        </h2>
        <p>
          지도에 마음에 드는 곳을 하나씩.
          <br />
          서두르지 않는 여행을 만들어보세요.
        </p>
        <button class="button light" @click="explore('niseko-kutchan')">
          니세코 둘러보기
          <Icon name="arrow" />
        </button>
      </div>
      <a
        class="photo-credit"
        href="https://commons.wikimedia.org/wiki/File:Yotei-zan-from-hirafu.jpg"
        target="_blank"
        rel="noreferrer"
      >
        Mount Yōtei · Oga / CC BY-SA 3.0
      </a>
    </section>
    <section class="region-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">DISCOVER HOKKAIDO</span>
          <h2>어떤 홋카이도를 만나고 싶나요?</h2>
        </div>
        <button class="text-button" @click="explore()">
          모든 지역 보기
          <Icon name="arrow" />
        </button>
      </div>
      <div class="region-grid">
        <button
          v-for="(r, i) in state.regions.slice(0, 6)"
          :key="r.id"
          class="region-card"
          @click="explore(r.id)"
        >
          <div :class="['region-art', 'tone-' + i]">
            <Crystal :size="130" />
            <span>{{ r.ja }}</span>
            <small>0{{ i + 1 }}</small>
          </div>
          <div class="region-caption">
            <span>
              <strong>{{ r.name }}</strong>
              <small>{{ r.description }}</small>
            </span>
            <Icon name="arrow" />
          </div>
        </button>
      </div>
    </section>
    <section class="how-section" id="journey">
      <div class="section-heading">
        <div>
          <span class="eyebrow">LESS PLANNING, MORE FEELING</span>
          <h2>계획은 가볍게. 여행은 깊게.</h2>
        </div>
      </div>
      <div class="how-grid">
        <article>
          <span>01</span>
          <Icon name="search" :size="28" />
          <h3>마음이 가는 곳을 발견하고</h3>
          <p>
            지역과 장소를 검색하세요.
            <br />
            지도 위에서 위치를 바로 확인할 수 있어요.
          </p>
        </article>
        <article>
          <span>02</span>
          <Icon name="calendar" :size="28" />
          <h3>나의 하루에 담아보세요</h3>
          <p>
            날짜마다 새로운 이야기를 만들어요.
            <br />
            순서도 언제든 바꿀 수 있어요.
          </p>
        </article>
        <article>
          <span>03</span>
          <Icon name="route" :size="28" />
          <h3>길 위의 시간을 확인하세요</h3>
          <p>
            장소 사이의 거리와 이동시간을 확인하고,
            <br />
            여유 있는 하루를 완성하세요.
          </p>
        </article>
      </div>
    </section>
    <footer class="site-footer">
      <span class="wordmark">
        <Crystal :size="28" />
        Book해도.
      </span>
      <p>나의 속도로 만나는 홋카이도.</p>
      <small>
        개요 지도 Natural Earth · Public domain
        <br />
        개인 여행 프로젝트 · 홋카이도 공식 서비스가 아닙니다.
      </small>
      <span>
        <RouterLink to="/terms">이용 안내</RouterLink>
        ·
        <RouterLink to="/privacy">개인정보 안내</RouterLink>
        ·
        <a href="/appendix.html">프로젝트 Appendix</a>
      </span>
    </footer>
  </main>
</template>
