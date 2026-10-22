import "oj-c/message-banner";
import ArrayDataProvider = require("ojs/ojarraydataprovider");
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";

export type BannerSeverity = "error" | "warning" | "info" | "confirmation";

type BannerItem = { id: number; severity: BannerSeverity; summary: string; closeAffordance: "off" };

/** One Redwood section message (no close affordance); `children`, when given, render as the message detail. */
export function Banner(props: { testId: string; severity: BannerSeverity; summary: string; class?: string; children?: ComponentChildren }) {
  const { severity, summary, children } = props;
  const data = useMemo(
    () => new ArrayDataProvider<number, BannerItem>([{ id: 1, severity, summary, closeAffordance: "off" }], { keyAttributes: "id" }),
    [severity, summary],
  );
  return (
    <oj-c-message-banner data-testid={props.testId} type="section" data={data} {...(props.class !== undefined && { class: props.class })}
      {...(children !== undefined && { detailTemplateValue: "gaiDetail" })}>
      {children !== undefined && <template slot="gaiDetail" render={() => children} />}
    </oj-c-message-banner>
  );
}
