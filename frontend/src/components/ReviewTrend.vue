<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
const props = defineProps<{ placeId: string }>(),
  trend = ref<any>(null),
  error = ref(''),
  period = ref('MONTH');
onMounted(async () => {
  try {
    trend.value = await api('/places/' + props.placeId + '/trend');
  } catch {
    error.value = '리뷰 추이를 불러오지 못했어요.';
  }
});
</script>
<template>
  <section class="review-trend enrichment">
    <span class="eyebrow">REVIEW TIMELINE</span>
    <h2>리뷰로 살펴보는 관심의 흐름</h2>
    <p v-if="error">{{ error }}</p>
    <p v-else-if="!trend">저장된 통계를 확인하고 있어요…</p>
    <template v-else>
      <h3>{{ trend.message }}</h3>
      <p>{{ trend.quality.reason }}</p>
      <div v-if="trend.recentReviewCount !== null" class="trend-numbers">
        <div>
          <small>기준일 이전 30일</small>
          <strong>{{ trend.recentReviewCount }}개</strong>
        </div>
        <div>
          <small>그 이전 30일</small>
          <strong>{{ trend.previousReviewCount }}개</strong>
        </div>
        <div>
          <small>증가율</small>
          <strong>{{ trend.growthRate === null ? '판단 보류' : trend.growthRate + '%' }}</strong>
        </div>
      </div>
      <p v-if="trend.quality.asOf">
        기준일 {{ trend.quality.asOf }} · 일본 시간 · 기준일 당일 제외
      </p>
      <p v-if="trend.seasonalPatterns?.length">
        {{
          trend.seasonalPatterns
            .map((p: string) =>
              p === 'WINTER' ? '❄️ 겨울철 반복 관심 증가' : '☀️ 여름철 반복 관심 증가',
            )
            .join(' · ')
        }}
      </p>
      <p v-else>{{ trend.quality.seasonReason }}</p>
      <template v-if="trend.periods?.length">
        <label>
          집계 간격
          <select v-model="period">
            <option value="MONTH">월별</option>
            <option value="WEEK">주별</option>
          </select>
        </label>
        <div class="trend-table">
          <table>
            <thead>
              <tr>
                <th>기간 시작</th>
                <th>수집 리뷰</th>
                <th>표본 평점</th>
                <th>범위 확인</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in trend.periods.filter((p: any) => p.periodType === period)"
                :key="p.periodStart"
              >
                <td>{{ p.periodStart }}</td>
                <td>{{ p.reviewCount }}개</td>
                <td>{{ p.averageRating ?? '—' }}</td>
                <td>{{ p.complete ? '기간 확인' : '부분 수집' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <small>
        리뷰 작성량은 실제 방문객 수나 영업 여부가 아닙니다. 추천 순위에는 사용하지 않습니다. 비공식
        수집 PoC이며 운영 전 데이터 이용 조건 검토가 필요합니다.
      </small>
    </template>
  </section>
</template>
