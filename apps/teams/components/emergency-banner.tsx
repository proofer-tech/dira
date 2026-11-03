"use client";

import { openWorkerSettingsNode } from "@/components/settings-dialog";
import { useT } from "@/components/language-provider";

/** P545 결정 4 - 비상정지가 켜져 있는 동안 모든 화면 맨 위의 한 줄. 푸는 자리(설정 워커 노드의 `고급`)로 바로 간다. */
export function EmergencyBanner({ at }: { at: string }) {
  const t = useT();
  return (
    <div
      role="alert"
      data-testid="emergency-banner"
      className="flex shrink-0 items-center justify-center gap-3 bg-destructive px-3 py-1 text-sm text-white"
    >
      <span>
        {t("emergency.banner")}({at})
      </span>
      <button type="button" className="underline" onClick={() => openWorkerSettingsNode({ advanced: true })}>
        {t("emergency.bannerLink")}
      </button>
    </div>
  );
}
