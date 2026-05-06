[Next.js](https://nextjs.org) 프로젝트입니다. [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app)으로 생성되었습니다.

## 시작하기

Node.js와 npm이 설치되어 있어야 합니다. Windows에서 설치되어 있지 않다면 Node.js LTS 버전을 먼저 설치하세요.

```bash
winget install OpenJS.NodeJS.LTS
```

처음 실행하는 경우 먼저 의존성을 설치하세요.

```bash
cd C:\Users\*유저명*\github\PolicyRec\web
npm.cmd install
```

`package.json`에 Next.js가 포함되어 있으므로 별도로 전역 설치하지 않아도 됩니다.

이미 의존성이 설치되어 있다면 개발 서버를 실행하세요.

```bash
cd C:\Users\*유저명*\github\PolicyRec\web
npm.cmd run dev
```

Conda 환경에서 실행해야 하는 경우에는 먼저 환경을 활성화한 뒤 실행하세요.

```bash
conda activate PolicyRec
cd C:\Users\*유저명*\github\PolicyRec\web
npm.cmd run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 결과를 확인할 수 있습니다.

`app/page.tsx` 파일을 수정하면 페이지 편집을 시작할 수 있습니다. 파일을 저장하면 페이지가 자동으로 업데이트됩니다.

이 프로젝트는 [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)를 사용해 Vercel의 새로운 글꼴 모음인 [Geist](https://vercel.com/font)를 자동으로 최적화하고 불러옵니다.

## 더 알아보기

Next.js에 대해 더 알아보려면 다음 자료를 참고하세요.

- [Next.js 문서](https://nextjs.org/docs) - Next.js 기능과 API를 알아볼 수 있습니다.
- [Learn Next.js](https://nextjs.org/learn) - 대화형 Next.js 튜토리얼입니다.

[Next.js GitHub 저장소](https://github.com/vercel/next.js)도 확인해보세요. 피드백과 기여는 언제나 환영합니다.

## Vercel에 배포하기

Next.js 앱을 배포하는 가장 쉬운 방법은 Next.js 제작사가 제공하는 [Vercel 플랫폼](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme)을 사용하는 것입니다.

자세한 내용은 [Next.js 배포 문서](https://nextjs.org/docs/app/building-your-application/deploying)를 확인하세요.
