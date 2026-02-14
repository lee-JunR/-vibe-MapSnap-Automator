const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

/**
 * 🗺️ 네이버 지도 경로 탐색 서비스
 * - 데스크톱 최신 URL 완벽 대응
 * - 장소 제안 리스트 지능형 선택
 * - 자동차 경로 자동 전환 및 데이터 검증
 */
async function captureRoute(startName, endName, outputFilename, options = {}) {
    const viewportWidth = options.width || 900;
    const viewportHeight = options.height || 500;
    console.log(`🚀 [네이버 지도] ${startName} -> ${endName} 경로 탐색 시작 (${viewportWidth}x${viewportHeight})`);

    const outputBase = options.outputDir || path.join(__dirname, 'output');
    if (!fs.existsSync(outputBase)) fs.mkdirSync(outputBase, { recursive: true });

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        viewport: { width: viewportWidth, height: viewportHeight },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // 1. 길찾기 페이지 접속
        await page.goto('https://map.naver.com/p/directions/-/-/-/car?c=15.00,0,0,0,dh', { waitUntil: 'networkidle', timeout: 60000 });

        // 2. 장소 입력 및 선택 공통 함수
        async function setPlace(index, name) {
            console.log(`📍 [단계] ${index === 0 ? '출발지' : '도착지'} 입력: ${name}`);
            const input = page.locator('.input_search').nth(index);
            await input.click();
            await page.keyboard.type(name, { delay: 150 }); // 사람처럼 타이핑
            // 리스트가 뜰 때까지 잠시 대기 (너무 빠르면 입력 씹힘)
            await page.waitForTimeout(1000);

            // 리스트가 보이는지 체크하고 ArrowDown
            try {
                await page.waitForSelector('.search_list .item_search, [class*="SearchResult_item"], .lst_site .item_place, div[role="listbox"] div[role="option"]', { timeout: 3000 });
            } catch (e) {
                console.log('⚠️ 추천 리스트가 감지되지 않았습니다. 바로 엔터를 시도합니다.');
            }

            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);
        }

        await setPlace(0, startName);
        await setPlace(1, endName);

        // 3. '길찾기' 버튼 클릭 (리스트 선택 시 자동 실행되지 않는 경우 대비)
        console.log('🔍 경로 탐색 버튼 클릭 중...');
        const searchBtn = page.locator('button:has-text("길찾기"), .btn_direction.search').first();
        if (await searchBtn.isVisible()) {
            await searchBtn.click({ force: true });
        }

        // 4. '자동차' 탭 강제 선택 및 결과 렌더링 대기
        console.log('🚗 자동차 경로 전환 및 렌더링 대기...');
        const carTab = page.locator('a:has-text("자동차"), button:has-text("자동차")').first();
        await carTab.click({ force: true });

        // 경로 요약 정보(.directions_summary_area)가 뜰 때까지 충분히 대기
        try {
            await page.waitForSelector('[class*="summary_area"], .route_unit, .route_summary', { timeout: 15000 });
        } catch (e) {
            console.log('⏰ 요약 정보 대기 타임아웃, 5초 추가 대기 후 캡처 진행');
            await page.waitForTimeout(5000);
        }

        // 5. 이동 거리 추출 (UI 숨김 로직 제거)
        const routeData = await page.evaluate(() => {
            // 1. 첫 번째 추천 경로 찾기
            const items = document.querySelectorAll('.route_summary_box, .route_unit, [class*="summary_box"]');
            if (items.length === 0) return { distance: null, hasDistance: false };

            const firstItem = items[0];
            const rawText = firstItem.innerText.replace(/\n/g, ' ');

            // 거리 텍스트 추출 (예: "11km", "8.5km")
            const kmMatch = rawText.match(/(\d+(?:\.\d+)?km)/);
            const cleanDistance = kmMatch ? kmMatch[0] : null;

            return { distance: cleanDistance, hasDistance: !!kmMatch };
        });

        console.log(`📏 추출된 거리: ${routeData.distance || '불명'}`);

        // 거리 정보를 찾지 못하면 실패로 간주 (사용자 요청)
        if (!routeData.hasDistance) {
            console.log('⚠️ 거리 정보(km)를 찾을 수 없어 실패 처리합니다.');
            const errImg = path.join(outputBase, `NO_DIST_${Date.now()}.png`);
            await page.screenshot({ path: errImg });
            return { savePath: null, distance: null, error: 'Distance Not Found' };
        }

        // 6. 뷰포트 조절 후 최종 스크린샷
        // 사용자 요청 뷰포트 크기로 설정
        await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
        await page.waitForTimeout(500); // 리사이징 후 렌더링 안정화

        const safeName = `${startName}_${endName}`.replace(/[/\\?%*:|"<>]/g, '-');
        const savePath = outputFilename || path.join(outputBase, `${safeName}.png`);

        // 전체 화면 캡처
        await page.screenshot({ path: savePath, fullPage: false });

        console.log(`🏁 [완료] ${startName} -> ${endName} 저장 성공!`);
        return { savePath, distance: routeData.distance };

    } catch (error) {
        console.error(`❌ [에러] ${startName} -> ${endName}: ${error.message}`);
        const errImg = path.join(outputBase, `ERROR_${Date.now()}.png`);
        await page.screenshot({ path: errImg });
        return { savePath: null, distance: null }; // 에러 발생 시 null 반환
    } finally {
        await browser.close();
    }
}

// 엑셀 일괄 처리
async function runBatch(csvPath) {
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(csvPath).pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                console.log(`📊 총 ${results.length}개의 경로 자동화 시작...`);
                for (const row of results) {
                    const s = row['출발지'] || row['출발'];
                    const e = row['도착지'] || row['도착'];
                    if (s && e) await captureRoute(s, e);
                }
                console.log('✨ 모든 작업이 완료되었습니다.');
                resolve();
            });
    });
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length >= 2) captureRoute(args[0], args[1]);
    else runBatch('locations.csv');
}

module.exports = { captureRoute, runBatch };
