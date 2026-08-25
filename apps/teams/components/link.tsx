"use client";

/** `next/link`를 감싼 것 - `useLinkStatus`가 `<Link>` 자손에서만 도는 제약(§0-22 결정 2) 때문에
 *  이 자리가 필요하다. 이름을 그대로 `Link`로 내보내 17개 소비 파일은 import 한 줄만 갈린다 -
 *  JSX 사용 자리 - props - ref 전달은 무수정이다.
 *
 *  **자손에는 아무것도 안 그린다**(§비주얼 §65 ⑨) - 리포터가 `null`을 반환한다. 그려지는 것은
 *  `next/link`가 이미 그리던 `<a>` 하나뿐이다. */

import NextLink, { useLinkStatus } from "next/link";
import { useLinkPendingReporter } from "@/lib/route-pending";

function LinkPendingReporter() {
  const { pending } = useLinkStatus();
  useLinkPendingReporter(pending);
  return null;
}

export default function Link({
  ref,
  children,
  ...props
}: React.ComponentProps<typeof NextLink> & { ref?: React.Ref<HTMLAnchorElement> }) {
  return (
    <NextLink ref={ref} {...props}>
      {children}
      <LinkPendingReporter />
    </NextLink>
  );
}
