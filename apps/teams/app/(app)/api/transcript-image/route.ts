/** 진행 기록 이미지 바이트 - 여섯째 API 라우트 (DESIGN.md §P539). 본체는 `lib/transcript-image.ts`. */
import { serveTranscriptImage } from "@/lib/transcript-image";

export const GET = (request: Request) => serveTranscriptImage(new URL(request.url).searchParams);
