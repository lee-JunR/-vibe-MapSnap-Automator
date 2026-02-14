const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { runBatch, captureRoute } = require('./batch_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('.'));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use(express.json());

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('파일이 없습니다.');

    const filePath = req.file.path;
    res.send({ message: '파일 업로드 성공. 백엔드에서 일괄 처리를 시작합니다. 콘솔 로그를 확인하세요.' });

    try {
        await runBatch(filePath);
    } catch (e) {
        console.error('배치 처리 에러:', e);
    }
});

app.post('/direct', async (req, res) => {
    const { start, end, width, height, batchId, filename } = req.body;
    if (!start || !end) return res.status(400).send('출발지와 도착지를 입력하세요.');

    // 배치 ID가 있으면 해당 폴더 사용, 없으면 기본 output
    const timestamp = batchId || new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(__dirname, 'output', timestamp);

    console.log(`[직접 요청] ${start} -> ${end} (${width}x${height}) Folder: ${timestamp} File: ${filename || 'auto'}`);

    try {
        const options = {
            width: parseInt(width) || 900,
            height: parseInt(height) || 500,
            outputDir: outputDir
        };

        // filename이 있으면 전체 경로 생성, 없으면 null (자동생성)
        const outputFilename = filename ? path.join(outputDir, filename + '.png') : null;

        const result = await captureRoute(start, end, outputFilename, options);

        if (result && result.savePath) {
            // 웹에서 접근 가능한 경로로 변환 (/output/timestamp/filename.png)
            // __dirname/output 부터의 상대 경로를 구함
            const relativePath = path.relative(path.join(__dirname, 'output'), result.savePath).replace(/\\/g, '/');

            res.send({
                message: '캡처 성공!',
                imageUrl: '/output/' + relativePath, // /output 프리픽스 명시
                distance: result.distance
            });
        } else {
            res.status(500).send({ message: '캡처 실패. 로그를 확인하세요.' });
        }
    } catch (e) {
        res.status(500).send({ message: '에러 발생: ' + e.message });
    }
});

app.get('/download-sample', (req, res) => {
    const csvContent = "\uFEFFNo,이름,소속,출발지,행사지,도착지\n1,홍길동,AA소속,서울역,대전역,부산역\n2,김철수,BB소속,광주역,대구역,";
    res.header('Content-Type', 'text/csv');
    res.attachment('sample_locations.csv');
    res.send(csvContent);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    // Signal Electron that the server is ready
    if (process.send) {
        process.send('server-started');
    }
});
