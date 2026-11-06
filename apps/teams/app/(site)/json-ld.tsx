import { jsonLdString } from "./jsonld.ts";

export function JsonLd({ data }: { data: object | object[] }) {
  return (Array.isArray(data) ? data : [data]).map((d, i) => (
    <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(d) }} />
  ));
}
