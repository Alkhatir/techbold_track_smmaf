import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Shared renderer for AI-generated and ERP-provided prose (ticket descriptions,
// agent messages, analysis, action rationale). Element styles are tuned to the
// compact workspace UI; colors inherit from the surrounding container so the
// same component blends into cards, chat rows, and the violet analysis panel.
const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-info underline underline-offset-2 hover:text-info/80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-2 text-[13px] font-semibold text-foreground first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  code: ({ className, children }) => {
    // react-markdown v10 dropped the `inline` prop; fenced blocks carry a
    // `language-*` class while inline code does not.
    if (/language-/.test(className ?? "")) {
      return <code className={cn("font-mono text-[12px]", className)}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1 py-px font-mono text-[0.9em] text-foreground">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded border border-border bg-terminal-bg px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground/90 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
};

// Inline variant: unwraps the paragraph so markdown can sit on the same line as
// surrounding labels/icons (e.g. "Next check: …").
const inlineComponents: Components = {
  ...components,
  p: ({ children }) => <>{children}</>,
};

export function Markdown({
  children,
  className,
  inline = false,
}: {
  children: string | null | undefined;
  className?: string;
  inline?: boolean;
}) {
  if (!children) return null;
  const tree = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inline ? inlineComponents : components}>
      {children}
    </ReactMarkdown>
  );
  return inline ? (
    <span className={className}>{tree}</span>
  ) : (
    <div className={className}>{tree}</div>
  );
}
