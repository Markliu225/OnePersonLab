import { createId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import type { SourceEvidence } from "../domain/types.js";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string, url: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || url;
}

export async function fetchSourceEvidence(
  urls: string[]
): Promise<SourceEvidence[]> {
  const uniqueUrls = [...new Set(urls.map((item) => item.trim()).filter(Boolean))];

  return Promise.all(
    uniqueUrls.map(async (url) => {
      const evidenceBase = {
        id: createId("evidence"),
        url,
        fetchedAt: nowIso()
      };

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "OnePersonLab/0.1 (+https://localhost; founder idea validation)"
          }
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return {
            ...evidenceBase,
            title: url,
            summary: "",
            excerpt: "",
            status: "failed" as const,
            error: `HTTP ${response.status}`
          };
        }

        const html = await response.text();
        const title = extractTitle(html, url);
        const text = stripHtml(html);
        const excerpt = text.slice(0, 3000);
        const summary = excerpt.slice(0, 500);

        return {
          ...evidenceBase,
          title,
          summary,
          excerpt,
          status: "fetched" as const
        };
      } catch (error) {
        return {
          ...evidenceBase,
          title: url,
          summary: "",
          excerpt: "",
          status: "failed" as const,
          error: error instanceof Error ? error.message : "Unknown fetch error"
        };
      }
    })
  );
}
