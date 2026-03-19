export function summarizeMarkdown(markdown: string, maxLength = 220): string {
  const compact = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_\-\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3).trim()}...`;
}
