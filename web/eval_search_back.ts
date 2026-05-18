import fs from 'fs';
import path from 'path';

// --- [1. .env 로드 로직: 최상단에서 즉시 실행] ---
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envData = fs.readFileSync(envPath, 'utf-8');
  envData.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

/**
 * 🎯 통합 검색 성능 평가 스크립트 (End-to-End Evaluation) - 백업 버전
 * 실행 방법: npx tsx eval_search_back.ts
 */

const CSV_PATH = path.join(__dirname, '..', 'PolicyRec_TC_Hit50.csv');
const REPORT_PATH = path.join(__dirname, '..', 'search_eval_report_back.txt');

// --- [유틸리티: 지연 시간] ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runEvaluation() {
  console.log('🚀 [PolicyRec_TC_Hit50] 단일 답변 기반 검색 성능 평가를 시작합니다...');

  // 동적 임포트: 환경 변수가 설정된 후 로드되도록 함
  const { supabase } = await import('./lib/supabase');
  const { extractSelfQueryFilters, getQueryEmbedding } = await import('./lib/gemini');
  const { 
    calculateFinalScore, 
    chooseEmbeddingQuery, 
    compareByFinalScoreDescThenIdAsc,
    applyResultFilters
  } = await import('./app/api/search/route');

  if (!fs.existsSync(CSV_PATH)) {
    console.error('❌ CSV 파일을 찾을 수 없습니다:', CSV_PATH);
    return;
  }

  const csvData = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvData.split('\n').filter(line => line.trim() !== '');
  const rows = lines.slice(1);

  const results: any[] = [];
  let totalHitAt10 = 0;
  let totalMRR = 0;
  let totalNDCG = 0;

  console.log(`📊 총 ${rows.length}개의 고난도 테스트 케이스를 로드했습니다.\n`);

  for (let i = 0; i < rows.length; i++) {
    const values = rows[i].split(',');
    const query = values[3]; // 질문 쿼리 (인덱스 3)
    const expectedSourceId = values[7]?.trim(); // 예상 Source ID (인덱스 7)
    const tcId = values[0]; // TC ID (인덱스 0)

    if (!query || !expectedSourceId) continue;

    // API 할당량 보호를 위해 매 요청 사이 3초 대기
    if (i > 0) await sleep(3000);

    console.log(`🔍 [${i + 1}/${rows.length}] ${tcId}: "${query.substring(0, 30)}..."`);

    let retryCount = 0;
    const maxRetries = 3;
    let success = false;

    while (retryCount < maxRetries && !success) {
      try {
        // 1. AI 필터 추출 (Self-Querying)
        const selfQuery = await extractSelfQueryFilters(query);
        
        // 서비스 로직과 동일하게 필터 구성
        const selfQueryAge = selfQuery?.target_age ?? null;
        const effectiveFilterCategory = null; 
        const effectiveFilterRegion = selfQuery?.region ?? null;
        const effectiveUserAge = selfQueryAge;
        const effectiveAgeMin = selfQueryAge;
        const effectiveAgeMax = selfQueryAge;
        
        // 2. 임베딩 생성
        const embedding = await getQueryEmbedding(query);
        
        // 3. 통합 검색 (Hybrid Search)
        const { data: searchResults, error } = await supabase.rpc('hybrid_search_announcements', {
          query_text: query,
          query_embedding: embedding,
          match_count: 50,
          region_filter: effectiveFilterRegion || '전체',
          category_filter: '전체',
          age_filter: effectiveUserAge || null
        });

        if (error) throw error;

        // 4. 후속 필터링 및 리랭킹
        const mappedRows = (searchResults || []).map((row: any) => {
          const { finalScore, matchBonus } = calculateFinalScore(row, {
            region: effectiveFilterRegion,
            s_category: null,
            target_age: effectiveUserAge
          });
          return { ...row, final_score: finalScore, match_bonus: matchBonus };
        });

        const sortedResults = mappedRows.sort(compareByFinalScoreDescThenIdAsc);
        const filteredResults = applyResultFilters(
          sortedResults,
          null,
          effectiveFilterRegion,
          effectiveUserAge,
          effectiveAgeMin,
          effectiveAgeMax
        );

        // 5. 결과 분석 (단일 정답 체크)
        let rank = 0;
        for (let j = 0; j < filteredResults.length; j++) {
          const resId = String(filteredResults[j].source_id || filteredResults[j].id).trim();
          if (resId === expectedSourceId) {
            rank = j + 1;
            break;
          }
        }

        const hitAt10 = rank > 0 && rank <= 10 ? 1 : 0;
        const mrr = rank > 0 ? 1 / rank : 0;
        const ndcg = rank > 0 && rank <= 10 ? 1 / Math.log2(rank + 1) : 0;

        totalHitAt10 += hitAt10;
        totalMRR += mrr;
        totalNDCG += ndcg;

        results.push({
          tcId,
          query,
          filters: `지역:${effectiveFilterRegion || '전체'}, 분야:전체, 나이:${effectiveUserAge || '미지정'}`,
          rank: rank > 0 ? `${rank}위` : '권외(10위 밖)',
          hitAt10,
          mrr,
          ndcg
        });

        success = true;

      } catch (err: any) {
        if (err.status === 429) {
          retryCount++;
          console.warn(`⚠️ 429 에러. 재시도 중...`);
          await sleep(10000);
        } else {
          console.error(`❌ 오류:`, err);
          results.push({ tcId, query, rank: 'ERROR', hitAt10: 0, mrr: 0, ndcg: 0 });
          success = true;
        }
      }
    }
  }

  // 6. 리포트 생성
  const avgHitAt10 = (totalHitAt10 / rows.length) * 100;
  const avgMRR = totalMRR / rows.length;
  const avgNDCG = totalNDCG / rows.length;

  let report = `==================================================\n`;
  report += `📊 검색 성능 평가 리포트 (Backup Version)\n`;
  report += `생성일시: ${new Date().toLocaleString()}\n`;
  report += `==================================================\n\n`;
  report += `[종합 지표]\n`;
  report += `- 전체 테스트 케이스: ${rows.length}건\n`;
  report += `- Hit@10 성공률: ${avgHitAt10.toFixed(2)}%\n`;
  report += `- Mean MRR: ${avgMRR.toFixed(4)}\n`;
  report += `- Mean NDCG@10: ${avgNDCG.toFixed(4)}\n\n`;
  report += `[상세 결과]\n`;
  report += `ID | 순위 | Hit@10 | MRR | NDCG | 질문 | 추출 필터\n`;
  report += `---|---|---|---|---|---|---\n`;
  
  results.forEach(res => {
    report += `${res.tcId} | ${res.rank} | ${res.hitAt10} | ${res.mrr.toFixed(4)} | ${res.ndcg.toFixed(4)} | ${res.query} | ${res.filters}\n`;
  });

  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\n✅ 백업 평가 완료! 리포트: ${REPORT_PATH}`);
}

runEvaluation();
