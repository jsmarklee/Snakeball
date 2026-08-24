#!/usr/bin/env node
// 스토어 스크린샷 합성 — 원본 기기 캡처 + 언어별 캡션 오버레이.
//
//   node tools/make-store-screenshots.mjs <프레임폴더> <출력폴더>
//
// **왜 노드가 아니라 파이썬을 부르나.** 이미지 합성에 Pillow 를 쓴다. 레포에 npm 의존성을
// 추가하지 않으려는 것(package.json 은 vite + apps-in-toss 둘뿐이다). 파이썬은 macOS 기본
// 탑재이고 Pillow 만 있으면 된다.
//
// **프레임은 이 스크립트가 못 만든다.** 기기 캡처(1320×2868)는 시뮬레이터에서 따로 찍는다.
// docs/store-screenshots.md 의 절차를 보라.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const [, , framesDir, outDir] = process.argv;
if (!framesDir || !outDir) {
  console.error('사용법: node tools/make-store-screenshots.mjs <프레임폴더> <출력폴더>');
  process.exit(1);
}
const r = spawnSync('python3', [join(here, 'store_screenshots.py'), framesDir, outDir], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
